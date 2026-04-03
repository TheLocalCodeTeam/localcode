import { logger } from '../core/logger.js';
// src/ui/App.tsx
import React, { useState, useEffect, useRef, useCallback, Component } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json');
import { PROVIDERS, SLASH_COMMANDS, THEMES, } from '../types/index.js';
import { NyxHeader } from './NyxHeader.js';
import { CommandPicker } from './CommandPicker.js';
import { PermissionPrompt, needsApproval } from './PermissionPrompt.js';
import { MarkdownText } from './MarkdownText.js';
import { runAgent, streamProvider, listModels, estimateCost, BUILTIN_TOOLS } from '../providers/client.js';
import { ToolExecutor } from '../tools/executor.js';
import { McpManager } from '../mcp/manager.js';
import { saveSession, createCheckpoint, restoreCheckpoint, estimateTokens, loadNyxMemories, loadHooks, saveHistory, loadHistory, loadTemplates, saveTemplates, loadAliases, saveAliases, listSessions, loadSessionById, } from '../sessions/manager.js';
import { loadPlugins } from '../plugins/loader.js';
import { buildIndex, searchWithContext } from '../search/tfidf.js';
import { runSwarm } from '../agents/swarm.js';
import { detectTestCommand, runTestLoop } from '../agents/testloop.js';
import { runBenchmark, buildTargets } from '../agents/benchmark.js';
import { runAllBenchmarks, formatBenchmark, generateBenchmarkReport } from '../benchmarks/index.js';
import { getAgentRegistry } from '../agents/registry/loader.js';
import { getOrchestrator } from '../agents/orchestrator.js';
import { AgentPicker } from './AgentPicker.js';
import { trackCommand, trackToolUse, trackError, getTelemetryConfig, setTelemetryEnabled } from '../telemetry/index.js';
import { compactConversation, buildCompactedMessages, needsCompacting } from '../compacting/index.js';
import { getDiffSummary } from '../diff/index.js';
import { createRateLimiter } from '../rate-limit/index.js';
// ─── Spinner ──────────────────────────────────────────────────────────────────
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
class ErrorBoundary extends Component {
    state = { hasError: false, error: '' };
    static getDerivedStateFromError(err) {
        return { hasError: true, error: err.message };
    }
    render() {
        if (this.state.hasError) {
            return (React.createElement(Box, { flexDirection: "column", paddingX: 2, paddingY: 1 },
                React.createElement(Text, { color: "red", bold: true }, "Localcode crashed"),
                React.createElement(Text, { color: "gray", wrap: "wrap" }, this.state.error),
                React.createElement(Text, { color: "gray", dimColor: true }, "Press Enter to exit and save session.")));
        }
        return this.props.children;
    }
}
export function App({ initialState }) {
    const { exit } = useApp();
    const { stdout } = useStdout();
    // ── State ────────────────────────────────────────────────────────────────────
    const [session, setSession] = useState(initialState);
    const sessionRef = useRef(initialState);
    // Keep sessionRef in sync to avoid stale closures in callbacks
    useEffect(() => { sessionRef.current = session; }, [session]);
    const [displayMessages, setDisplayMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const lastSendTimeRef = useRef(0);
    const [mood, setMood] = useState('idle');
    const [showPicker, setShowPicker] = useState(false);
    const [pickerQuery, setPickerQuery] = useState('');
    const [pickerSelectedIndex, setPickerSelectedIndex] = useState(0);
    const [showAgentPicker, setShowAgentPicker] = useState(false);
    const [agentPickerQuery, setAgentPickerQuery] = useState('');
    const [agentPickerSelectedIndex, setAgentPickerSelectedIndex] = useState(0);
    const [activeAgent, setActiveAgent] = useState(null);
    const [pendingPermission, setPendingPermission] = useState(null);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [isMultiline, setIsMultiline] = useState(false);
    const [multilineBuffer, setMultilineBuffer] = useState([]);
    const [spinnerFrame, setSpinnerFrame] = useState(0);
    const [streamingTokens, setStreamingTokens] = useState(0);
    // Pending test output for "fix?" prompt
    const [pendingTestFix, setPendingTestFix] = useState(null);
    const executorRef = useRef(new ToolExecutor(initialState.workingDir));
    const mcpRef = useRef(new McpManager());
    const streamingIdRef = useRef(null);
    const abortRef = useRef(null);
    const hooksRef = useRef(loadHooks());
    const aliasesRef = useRef({});
    const pluginsRef = useRef([]);
    const watcherRef = useRef(null);
    const watchFileRef = useRef(null);
    const lastUserMsgRef = useRef('');
    const searchIndexRef = useRef(null);
    // v4 refs
    const autopilotWatcherRef = useRef(null);
    const safeStashRef = useRef(null); // stash name when safeMode active
    const rateLimiterRef = useRef(createRateLimiter());
    // Derive current theme
    const theme = THEMES[session.theme ?? 'dark'];
    // ── Mount effects ─────────────────────────────────────────────────────────────
    // Load input history on mount
    useEffect(() => {
        const saved = loadHistory();
        if (saved.length > 0) {
            setHistory(saved);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Load aliases on mount
    useEffect(() => {
        aliasesRef.current = loadAliases();
    }, []);
    // Load plugins on mount
    useEffect(() => {
        loadPlugins().then((plugins) => {
            pluginsRef.current = plugins;
            if (plugins.length > 0) {
                // Silently loaded — available via /plugins
            }
        }).catch(() => { });
    }, []);
    // First-run onboarding
    useEffect(() => {
        const { isFirstRun } = require('../sessions/manager.js');
        if (isFirstRun()) {
            const onboardingSteps = [
                'Welcome to Localcode v4.0.0! 🎉',
                '',
                'Quick setup:',
                '1. Choose a provider:',
                '   /provider ollama    ← Free, local, no API key needed',
                '   /provider openai    ← Requires OPENAI_API_KEY',
                '   /provider claude    ← Requires ANTHROPIC_API_KEY',
                '   /provider groq      ← Requires GROQ_API_KEY',
                '',
                '2. Browse 139 agents: /agents',
                '3. Start coding: Just type your request!',
                '',
                'Type /help for all commands, /onboarding to see this again.',
            ];
            setTimeout(() => {
                sysMsg(onboardingSteps.join('\n'));
            }, 500);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Spinner animation while streaming
    useEffect(() => {
        if (!isStreaming)
            return;
        const id = setInterval(() => {
            setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
        }, 80);
        return () => clearInterval(id);
    }, [isStreaming]);
    // Load .nyx.md memory hierarchy on mount (global + project) + auto-context
    useEffect(() => {
        const memories = loadNyxMemories(initialState.workingDir);
        if (memories.length > 0) {
            const combined = memories.map((m) => `[Memory: ${m.source}]\n${m.content}`).join('\n\n');
            setSession((s) => ({
                ...s,
                pinnedContext: [combined, ...s.pinnedContext],
            }));
            sysMsg(`Loaded ${memories.length} memory file${memories.length > 1 ? 's' : ''}: ${memories.map((m) => path.basename(m.source)).join(', ')}`);
        }
        else {
            // No .nyx.md found — try to inject git auto-context
            const tryGitContext = async () => {
                try {
                    const gitLog = await new Promise((res) => {
                        execFile('git', ['log', '--oneline', '-5'], { cwd: initialState.workingDir }, (err, out) => res(err ? '' : out));
                    });
                    const gitStatus = await new Promise((res) => {
                        execFile('git', ['status', '--short'], { cwd: initialState.workingDir }, (err, out) => res(err ? '' : out));
                    });
                    if (gitLog.trim() || gitStatus.trim()) {
                        const autoCtx = `[Auto-context]\ngit log:\n${gitLog.trim()}\n\ngit status:\n${gitStatus.trim()}`;
                        setSession((s) => ({
                            ...s,
                            pinnedContext: [autoCtx, ...s.pinnedContext],
                        }));
                        sysMsg('Auto-context: injected git state (no .nyx.md found — run /init to create one)');
                    }
                }
                catch (err) {
                    logger.debug('Not a git repo', { error: err instanceof Error ? err.message : String(err) });
                }
            };
            tryGitContext();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Compute filtered commands for picker
    const q = pickerQuery.toLowerCase();
    const filteredCommands = q
        ? SLASH_COMMANDS.filter((c) => c.name.startsWith(q) || c.description.toLowerCase().includes(q))
        : SLASH_COMMANDS;
    // ── Helpers ──────────────────────────────────────────────────────────────────
    const addDisplay = useCallback((msg) => {
        const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        setDisplayMessages((prev) => [...prev, { ...msg, id, timestamp: Date.now() }]);
        return id;
    }, []);
    const updateDisplay = useCallback((id, patch) => {
        setDisplayMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    }, []);
    const sysMsg = useCallback((text, isError = false) => {
        addDisplay({ role: 'system', content: text, isError });
    }, [addDisplay]);
    // Ask for permission — returns a Promise that resolves when user presses y/n/a
    const requestPermission = useCallback((toolCall) => {
        return new Promise((resolve) => {
            setPendingPermission({
                toolCall,
                resolve: (allowed, allowAll = false) => {
                    setPendingPermission(null);
                    resolve({ allowed, allowAll });
                },
            });
        });
    }, []);
    // ── Hooks runner ──────────────────────────────────────────────────────────────
    const runHooks = useCallback(async (event, toolCall, output) => {
        const hooks = hooksRef.current[event] ?? [];
        for (const hook of hooks) {
            if (hook.matcher && toolCall && !toolCall.name.includes(hook.matcher) && !new RegExp(hook.matcher).test(toolCall.name))
                continue;
            const env = {
                ...process.env,
                LC_TOOL_NAME: toolCall?.name ?? '',
                LC_TOOL_ARGS: toolCall ? JSON.stringify(toolCall.args) : '',
                LC_TOOL_OUTPUT: output ?? '',
                LC_TOOL_PATH: toolCall?.args?.path ?? toolCall?.args?.source ?? '',
            };
            try {
                await new Promise((resolve) => {
                    execFile('sh', ['-c', hook.command], { env, timeout: 10000 }, () => resolve());
                });
            }
            catch (err) {
                logger.warn('Hook execution failed', { error: err instanceof Error ? err.message : String(err) });
            }
        }
    }, []);
    // ── Slash command handler ─────────────────────────────────────────────────────
    const sendMessage = useCallback(async (text) => {
        if (!text.trim() || isStreaming)
            return;
        // Rate limit: prevent double-send if user spams Enter
        const now = Date.now();
        if (now - lastSendTimeRef.current < 500)
            return;
        lastSendTimeRef.current = now;
        // Rate limiter check
        const rateCheck = rateLimiterRef.current.canMakeRequest();
        if (!rateCheck.allowed) {
            const retrySec = rateCheck.retryAfter ? (rateCheck.retryAfter / 1000).toFixed(1) : '?';
            sysMsg(`⚠ Rate limited (${rateCheck.reason}). Retry in ${retrySec}s.`, true);
            trackError(new Error(`Rate limited: ${rateCheck.reason}`), { context: 'sendMessage' });
            return;
        }
        // Add to history
        const newHistory = [text, ...history.slice(0, 199)];
        setHistory(newHistory);
        saveHistory(newHistory);
        setHistoryIndex(-1);
        setInput('');
        lastUserMsgRef.current = text;
        // Handle @context syntax inline
        let processedText = text;
        const atMatches = text.match(/@[\w./\\-]+/g) ?? [];
        for (const match of atMatches) {
            const p = match.slice(1);
            const result = await executorRef.current.execute({ name: 'read_file', args: { path: p } });
            if (result.success) {
                processedText = processedText.replace(match, `\n\`\`\`${p}\n${result.output}\n\`\`\``);
            }
            else {
                sysMsg(`@context warning: could not read "${p}" — ${result.output}`, true);
                processedText = processedText.replace(match, `[file not found: ${p}]`);
            }
        }
        const userMsg = { role: 'user', content: processedText };
        addDisplay({ role: 'user', content: text });
        setSession((s) => {
            const updated = { ...s, messages: [...s.messages, userMsg] };
            return updated;
        });
        setIsStreaming(true);
        setMood('thinking');
        setStreamingTokens(0);
        // Create streaming display message
        const streamId = addDisplay({ role: 'assistant', content: '', streaming: true });
        streamingIdRef.current = streamId;
        let accumulated = '';
        // Abort controller — cancelled by Escape key
        const controller = new AbortController();
        abortRef.current = controller;
        // Snapshot session for this run (may be mutated below for budget switching)
        let currentSession = sessionRef.current;
        // ── Budget guard ─────────────────────────────────────────────────────────
        if (currentSession.budgetLimit !== null && currentSession.sessionCost >= currentSession.budgetLimit) {
            const fallback = currentSession.budgetFallbackModel ?? PROVIDERS.ollama.defaultModel;
            sysMsg(`⚠  Budget $${currentSession.budgetLimit.toFixed(2)} reached ($${currentSession.sessionCost.toFixed(4)} spent). Switching to Ollama / ${fallback}.`);
            const budgetSession = { ...currentSession, provider: 'ollama', model: fallback };
            setSession(budgetSession);
            currentSession = budgetSession;
        }
        const run = async () => {
            const pinnedMsg = currentSession.pinnedContext.length
                ? [{ role: 'user', content: `[Pinned context — always relevant]\n${currentSession.pinnedContext.join('\n')}` }]
                : [];
            // Inject DNA if set
            const dnaMsg = currentSession.dna
                ? [{ role: 'user', content: `[Codebase DNA — your coding style guide]\n${currentSession.dna}` }]
                : [];
            const msgs = [...pinnedMsg, ...dnaMsg, ...currentSession.messages, userMsg];
            // Merge built-in tools with MCP tools
            const mcpToolDefs = mcpRef.current.getToolDefinitions();
            const allTools = [...BUILTIN_TOOLS, ...mcpToolDefs];
            await runAgent(currentSession.provider, currentSession.apiKeys, currentSession.model, msgs, async (chunk) => {
                if (controller.signal.aborted)
                    return;
                switch (chunk.type) {
                    case 'agent_step':
                        if ((chunk.step ?? 0) > 0) {
                            // Show step indicator after first iteration
                            addDisplay({
                                role: 'system',
                                content: `${SPINNER_FRAMES[spinnerFrame]}  Step ${(chunk.step ?? 0) + 1}/${chunk.maxSteps}`,
                            });
                        }
                        break;
                    case 'text':
                        accumulated += chunk.text ?? '';
                        updateDisplay(streamId, { content: accumulated, streaming: true });
                        setStreamingTokens((prev) => prev + Math.ceil((chunk.text ?? '').length / 4));
                        break;
                    case 'done':
                        updateDisplay(streamId, { streaming: false });
                        setStreamingTokens(0);
                        if (accumulated.trim()) {
                            const inputTokens = Math.ceil(msgs.reduce((a, m) => a + m.content.length, 0) / 4);
                            const outputTokens = Math.ceil(accumulated.length / 4);
                            const cost = estimateCost(currentSession.model, inputTokens, outputTokens);
                            setSession((s) => {
                                const newMessages = [
                                    ...s.messages,
                                    { role: 'assistant', content: accumulated },
                                ];
                                const shouldCheckpoint = s.autoCheckpoint && newMessages.length % 20 === 0;
                                const checkpoints = shouldCheckpoint
                                    ? [...s.checkpoints, {
                                            id: `cp_auto_${Date.now()}`,
                                            label: `auto-${newMessages.length}msgs`,
                                            timestamp: Date.now(),
                                            messages: newMessages,
                                            files: {},
                                        }]
                                    : s.checkpoints;
                                if (shouldCheckpoint)
                                    setTimeout(() => sysMsg(`Auto-checkpoint saved.`), 100);
                                // Multi-file diff summary
                                const sessionFiles = executorRef.current.getSessionFiles();
                                const modifiedPaths = Object.keys(sessionFiles);
                                if (modifiedPaths.length > 0) {
                                    const summaryParts = modifiedPaths.slice(0, 5).map((fp) => {
                                        const diff = executorRef.current.unifiedDiff(fp);
                                        if (!diff)
                                            return `  ${path.basename(fp)}`;
                                        const adds = (diff.match(/^\+[^+]/gm) ?? []).length;
                                        const dels = (diff.match(/^-[^-]/gm) ?? []).length;
                                        return `  ${path.basename(fp)} +${adds} -${dels}`;
                                    });
                                    if (summaryParts.length > 0) {
                                        setTimeout(() => sysMsg(`· Files changed: ${summaryParts.join('  |')}`), 50);
                                    }
                                }
                                const next = {
                                    ...s,
                                    messages: newMessages,
                                    lastAssistantMessage: accumulated,
                                    sessionCost: s.sessionCost + cost,
                                    checkpoints,
                                    providerCallLog: [
                                        ...s.providerCallLog,
                                        {
                                            provider: currentSession.provider,
                                            model: currentSession.model,
                                            estimatedTokens: inputTokens + outputTokens,
                                            timestamp: Date.now(),
                                        },
                                    ],
                                };
                                try {
                                    saveSession(next);
                                }
                                catch (err) {
                                    logger.error('Failed to save session', { error: err instanceof Error ? err.message : String(err) });
                                }
                                return next;
                            });
                        }
                        break;
                    case 'error':
                        updateDisplay(streamId, { content: chunk.error ?? 'Unknown error', streaming: false, isError: true });
                        setMood('error');
                        setStreamingTokens(0);
                        break;
                }
            }, {
                maxSteps: currentSession.maxSteps,
                tools: allTools,
                routing: currentSession.modelRouting,
                onToolCall: async (toolCall) => {
                    // ── Safe mode: stash before first risky write ───────────────────
                    const riskyTools = new Set(['write_file', 'patch_file', 'delete_file', 'run_shell']);
                    if (currentSession.safeMode && !safeStashRef.current && riskyTools.has(toolCall.name)) {
                        const stashName = `nyx-safe-${Date.now()}`;
                        const stashRes = await executorRef.current.execute({
                            name: 'git_operation',
                            args: { args: `stash push -m "${stashName}"` },
                        });
                        if (stashRes.success) {
                            safeStashRef.current = stashName;
                            sysMsg(`⊛  Safe mode: stashed current changes as "${stashName}"`);
                        }
                    }
                    if (needsApproval(toolCall, currentSession.approvalMode)) {
                        setMood('waiting');
                        const perm = await requestPermission(toolCall);
                        if (perm.allowAll)
                            setSession((s) => ({ ...s, approvalMode: 'full-auto' }));
                        setMood('thinking');
                        return perm;
                    }
                    return { allowed: true, allowAll: false };
                },
                onToolResult: (toolCall, output, diff) => {
                    // Truncate tool output to 200 chars for display
                    const truncated = output.length > 200
                        ? output.slice(0, 200) + `  [truncated +${output.length - 200} chars]`
                        : output;
                    addDisplay({
                        role: 'tool',
                        content: `${toolCall.name} → ${truncated}`,
                        toolName: toolCall.name,
                        streaming: false,
                    });
                    if (diff && typeof diff === 'object' && 'additions' in diff) {
                        const d = diff;
                        addDisplay({ role: 'system', content: `  ${d.path}  +${d.additions} -${d.deletions}` });
                    }
                    // Show diff summary for file-modifying tools
                    const writeTools = new Set(['write_file', 'patch_file', 'delete_file']);
                    if (writeTools.has(toolCall.name)) {
                        const sessionFiles = executorRef.current.getSessionFiles();
                        const allDiffs = Object.entries(sessionFiles)
                            .map(([fp]) => executorRef.current.unifiedDiff(fp))
                            .filter(Boolean)
                            .join('\n');
                        if (allDiffs) {
                            const summary = getDiffSummary(allDiffs);
                            addDisplay({ role: 'system', content: `📝 ${summary}` });
                        }
                    }
                },
                executeTool: async (toolCall) => {
                    await runHooks('PreToolUse', toolCall);
                    const toolStart = Date.now();
                    let result;
                    if (mcpRef.current.isMcpTool(toolCall.name)) {
                        const r = await mcpRef.current.callTool(toolCall.name, toolCall.args);
                        result = { success: r.success, output: r.output };
                    }
                    else {
                        result = await executorRef.current.execute(toolCall);
                    }
                    const durationMs = Date.now() - toolStart;
                    trackToolUse(toolCall.name, result.success, durationMs);
                    await runHooks('PostToolUse', toolCall, result.output);
                    return result;
                },
            }, currentSession.systemPrompt, controller.signal);
        };
        try {
            await run();
            rateLimiterRef.current.recordRequest(streamingTokens);
            // ── Safe mode: post-run test check ──────────────────────────────────
            if (currentSession.safeMode && safeStashRef.current) {
                const testCmd = await detectTestCommand(currentSession.workingDir);
                if (testCmd) {
                    sysMsg(`⊛  Safe mode: running ${testCmd} to verify changes…`);
                    const { passed, output } = await import('../agents/testloop.js').then((m) => m.runTests(testCmd, currentSession.workingDir));
                    if (!passed) {
                        sysMsg(`⊛  Tests failed after changes. Reverting to stash "${safeStashRef.current}".`, true);
                        await executorRef.current.execute({ name: 'git_operation', args: { args: 'checkout .' } });
                        await executorRef.current.execute({ name: 'git_operation', args: { args: 'stash pop' } });
                        sysMsg(`⊛  Reverted. Test output:\n${output.slice(0, 500)}`);
                    }
                    else {
                        sysMsg(`⊛  Safe mode: tests passed. Changes kept.`);
                    }
                    safeStashRef.current = null;
                }
            }
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            trackError(error, { context: 'sendMessage', provider: currentSession.provider, model: currentSession.model });
            updateDisplay(streamId, {
                content: `Error: ${error.message}`,
                streaming: false,
                isError: true,
            });
            setMood('error');
        }
        finally {
            setIsStreaming(false);
            setMood((m) => (m === 'thinking' || m === 'waiting' ? 'idle' : m));
            runHooks('Notification');
        }
    }, [isStreaming, session, history, addDisplay, updateDisplay, requestPermission, runHooks, spinnerFrame, sysMsg]);
    const handleSlashCommand = useCallback(async (raw) => {
        const parts = raw.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');
        // Check aliases first
        const aliasedCmd = aliasesRef.current[cmd];
        if (aliasedCmd) {
            await handleSlashCommand(args ? `${aliasedCmd} ${args}` : aliasedCmd);
            return;
        }
        // Check plugins
        const plugin = pluginsRef.current.find((p) => p.trigger === cmd);
        if (plugin) {
            try {
                await plugin.execute(args, {
                    workingDir: session.workingDir,
                    sysMsg,
                    addDisplay: (msg) => addDisplay(msg),
                });
            }
            catch (err) {
                sysMsg(`Plugin ${plugin.name} error: ${err instanceof Error ? err.message : String(err)}`, true);
            }
            return;
        }
        switch (cmd) {
            case '/help': {
                trackCommand(cmd, args);
                trackCommand(cmd, args);
                setShowPicker(true);
                setPickerQuery('');
                setPickerSelectedIndex(0);
                setInput('/');
                return;
            }
            case '/clear': {
                trackCommand(cmd, args);
                trackCommand(cmd, args);
                setDisplayMessages([]);
                setSession((s) => ({ ...s, messages: [] }));
                setMood('idle');
                sysMsg('Conversation cleared.');
                return;
            }
            case '/theme': {
                trackCommand(cmd, args);
                const validThemes = ['dark', 'nord', 'monokai', 'light'];
                if (!args) {
                    const list = validThemes.map((t) => `  ${session.theme === t ? '▶ ' : '  '}${t}`).join('\n');
                    sysMsg(`Themes:\n${list}\n\nUsage: /theme <name>`);
                    return;
                }
                if (!validThemes.includes(args)) {
                    sysMsg(`Unknown theme: ${args}. Options: dark, nord, monokai, light`, true);
                    return;
                }
                setSession((s) => ({ ...s, theme: args }));
                sysMsg(`Theme set to: ${args}`);
                return;
            }
            case '/template': {
                trackCommand(cmd, args);
                const tParts = args.split(/\s+/);
                const tSub = tParts[0]?.toLowerCase() ?? '';
                const tRest = tParts.slice(1).join(' ');
                if (!tSub || tSub === 'list') {
                    const templates = loadTemplates();
                    if (!templates.length) {
                        sysMsg('No templates saved. Usage: /template add <name> <prompt>');
                        return;
                    }
                    const list = templates.map((t, i) => `  ${i + 1}. ${t.name}  —  ${t.description || t.prompt.slice(0, 60)}`).join('\n');
                    sysMsg(`Templates (${templates.length}):\n${list}\n\nUsage: /template use <name>`);
                    return;
                }
                if (tSub === 'add') {
                    const nameParts = tRest.split(/\s+/);
                    const tName = nameParts[0];
                    const tPrompt = nameParts.slice(1).join(' ');
                    if (!tName || !tPrompt) {
                        sysMsg('Usage: /template add <name> <prompt text>', true);
                        return;
                    }
                    const templates = loadTemplates();
                    const existing = templates.findIndex((t) => t.name === tName);
                    const newTemplate = { name: tName, prompt: tPrompt, description: tPrompt.slice(0, 60) };
                    if (existing >= 0) {
                        templates[existing] = newTemplate;
                    }
                    else {
                        templates.push(newTemplate);
                    }
                    saveTemplates(templates);
                    sysMsg(`Template saved: "${tName}"`);
                    return;
                }
                if (tSub === 'use') {
                    const tName = tRest.trim();
                    if (!tName) {
                        sysMsg('Usage: /template use <name>', true);
                        return;
                    }
                    const templates = loadTemplates();
                    const found = templates.find((t) => t.name === tName);
                    if (!found) {
                        sysMsg(`Template not found: ${tName}`, true);
                        return;
                    }
                    setInput(found.prompt);
                    sysMsg(`Template loaded into input: "${tName}"`);
                    return;
                }
                if (tSub === 'delete') {
                    const tName = tRest.trim();
                    if (!tName) {
                        sysMsg('Usage: /template delete <name>', true);
                        return;
                    }
                    const templates = loadTemplates();
                    const filtered = templates.filter((t) => t.name !== tName);
                    if (filtered.length === templates.length) {
                        sysMsg(`Template not found: ${tName}`, true);
                        return;
                    }
                    saveTemplates(filtered);
                    sysMsg(`Template deleted: "${tName}"`);
                    return;
                }
                sysMsg('Usage: /template [list|add|use|delete] ...');
                return;
            }
            case '/alias': {
                trackCommand(cmd, args);
                const aParts = args.split(/\s+/);
                const aSub = aParts[0] ?? '';
                if (!aSub) {
                    const aliases = aliasesRef.current;
                    const keys = Object.keys(aliases);
                    if (!keys.length) {
                        sysMsg('No aliases. Usage: /alias <name> <command>');
                        return;
                    }
                    const list = keys.map((k) => `  ${k}  →  ${aliases[k]}`).join('\n');
                    sysMsg(`Aliases (${keys.length}):\n${list}`);
                    return;
                }
                if (aSub === 'delete') {
                    const aName = aParts[1];
                    if (!aName) {
                        sysMsg('Usage: /alias delete <name>', true);
                        return;
                    }
                    const aliases = { ...aliasesRef.current };
                    if (!(aName in aliases)) {
                        sysMsg(`Alias not found: ${aName}`, true);
                        return;
                    }
                    delete aliases[aName];
                    aliasesRef.current = aliases;
                    saveAliases(aliases);
                    sysMsg(`Alias deleted: ${aName}`);
                    return;
                }
                // /alias <name> <command>
                const aName = aSub;
                const aCmd = aParts.slice(1).join(' ');
                if (!aCmd) {
                    sysMsg('Usage: /alias <name> <command>', true);
                    return;
                }
                const aliases = { ...aliasesRef.current, [aName]: aCmd };
                aliasesRef.current = aliases;
                saveAliases(aliases);
                sysMsg(`Alias set: ${aName}  →  ${aCmd}`);
                return;
            }
            case '/plugins': {
                trackCommand(cmd, args);
                const plugins = pluginsRef.current;
                if (!plugins.length) {
                    sysMsg(`No plugins loaded.\n\nPlace .js plugin files in ~/.localcode/plugins/\nEach file should export default: { name, trigger, description, execute }`);
                    return;
                }
                const list = plugins.map((p) => `  ${p.trigger.padEnd(16)} ${p.description}`).join('\n');
                sysMsg(`Loaded plugins (${plugins.length}):\n${list}`);
                return;
            }
            case '/provider': {
                trackCommand(cmd, args);
                if (!args) {
                    const list = Object.values(PROVIDERS)
                        .map((p) => {
                        const hasKey = !!session.apiKeys[p.name];
                        const active = session.provider === p.name ? '▶ ' : '  ';
                        const keyMark = p.requiresKey ? (hasKey ? '⚿ ' : '✕ ') : '  ';
                        return `${active}${keyMark}${p.displayName}  (${p.name})  default: ${p.defaultModel}`;
                    })
                        .join('\n');
                    sysMsg(`Available providers:\n${list}`);
                    return;
                }
                const provider = args.toLowerCase();
                if (!PROVIDERS[provider]) {
                    sysMsg(`Unknown provider: ${args}. Options: ollama, claude, openai, groq`, true);
                    return;
                }
                const newModel = PROVIDERS[provider].defaultModel;
                setSession((s) => ({ ...s, provider, model: newModel }));
                sysMsg(`Switched to ${PROVIDERS[provider].displayName} — model: ${newModel}`);
                return;
            }
            case '/apikey': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /apikey <key>');
                    return;
                }
                const masked = args.slice(0, 8) + '...';
                setSession((s) => ({
                    ...s,
                    apiKeys: { ...s.apiKeys, [s.provider]: args },
                }));
                sysMsg(`API key set for ${PROVIDERS[session.provider].displayName}: ${masked}`);
                return;
            }
            case '/model': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg(`Current model: ${session.model}\nUsage: /model <model-name>`);
                    return;
                }
                setSession((s) => ({ ...s, model: args }));
                sysMsg(`Model set to: ${args}`);
                return;
            }
            case '/checkpoint': {
                trackCommand(cmd, args);
                const label = args || `checkpoint-${Date.now()}`;
                setSession((s) => {
                    const { state, checkpoint } = createCheckpoint(s, label);
                    saveSession(state);
                    return state;
                });
                sysMsg(`Checkpoint saved: "${label}"`);
                return;
            }
            case '/restore': {
                trackCommand(cmd, args);
                const cps = session.checkpoints;
                if (!cps.length) {
                    sysMsg('No checkpoints saved. Use /checkpoint <label> to create one.');
                    return;
                }
                if (!args) {
                    const list = cps
                        .map((c, i) => `  ${i + 1}. ${c.label}  (${new Date(c.timestamp).toLocaleTimeString()})  id: ${c.id}`)
                        .join('\n');
                    sysMsg(`Checkpoints:\n${list}\n\nUsage: /restore <id>`);
                    return;
                }
                const restored = restoreCheckpoint(session, args);
                if (!restored) {
                    sysMsg(`Checkpoint not found: ${args}`, true);
                    return;
                }
                setSession(restored);
                setDisplayMessages([]);
                sysMsg(`Restored checkpoint: ${args}`);
                return;
            }
            case '/history': {
                trackCommand(cmd, args);
                const sessions = listSessions();
                if (!sessions.length) {
                    sysMsg('No session history found.');
                    return;
                }
                if (!args) {
                    const list = sessions.slice(0, 20).map((s, i) => {
                        const date = new Date(s.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                        const shortCwd = s.cwd.replace(os.homedir(), '~').slice(-40);
                        return `  ${String(i + 1).padStart(2)}. ${date}  ${shortCwd}  (${s.messageCount} msgs)  ${s.provider}/${s.model}`;
                    }).join('\n');
                    sysMsg(`Session history (${Math.min(20, sessions.length)}):\n${list}\n\nUsage: /history <n> to restore`);
                    return;
                }
                const n = parseInt(args, 10);
                if (isNaN(n) || n < 1 || n > sessions.length) {
                    sysMsg(`Invalid session number: ${args}`, true);
                    return;
                }
                const target = sessions[n - 1];
                const loaded = loadSessionById(target.id);
                if (!loaded) {
                    sysMsg(`Could not load session: ${target.id}`, true);
                    return;
                }
                setSession(loaded);
                setDisplayMessages([]);
                sysMsg(`Loaded session from ${new Date(target.timestamp).toLocaleString()} — ${loaded.messages.length} messages`);
                return;
            }
            case '/review': {
                trackCommand(cmd, args);
                setMood('thinking');
                sysMsg('Running code review…');
                try {
                    // Prefer staged diff, fall back to working tree diff
                    const staged = await new Promise((res, rej) => {
                        execFile('git', ['diff', '--staged'], { cwd: session.workingDir }, (err, out) => err ? rej(err) : res(out));
                    });
                    const diff = staged.trim() || await new Promise((res, rej) => {
                        execFile('git', ['diff', 'HEAD'], { cwd: session.workingDir }, (err, out) => err ? rej(err) : res(out));
                    });
                    if (!diff.trim()) {
                        sysMsg('No changes to review. Stage files or make edits first.', true);
                        setMood('idle');
                        return;
                    }
                    const prompt = `Do a thorough code review of this diff. Group findings by severity:\n🔴 Critical — bugs, security vulnerabilities, data loss risk\n🟡 Warning  — performance, missing error handling, anti-patterns\n🔵 Suggestion — style, readability, improvements\n\nBe specific with exact line references. If there are no issues in a category, skip it.\n\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\``;
                    const reviewId = addDisplay({ role: 'assistant', content: '', streaming: true });
                    let review = '';
                    await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: prompt }], (chunk) => { if (chunk.text) {
                        review += chunk.text;
                        updateDisplay(reviewId, { content: review, streaming: true });
                    } }, session.systemPrompt);
                    updateDisplay(reviewId, { content: review, streaming: false });
                    setSession((s) => ({ ...s, lastAssistantMessage: review }));
                }
                catch (err) {
                    sysMsg(`Review failed: ${err instanceof Error ? err.message : String(err)}`, true);
                    setMood('error');
                }
                setMood('idle');
                return;
            }
            case '/commit': {
                trackCommand(cmd, args);
                setMood('thinking');
                sysMsg('Generating commit message…');
                try {
                    const stdout = await new Promise((res, rej) => {
                        execFile('git', ['diff', '--staged'], { cwd: session.workingDir }, (err, out) => {
                            if (err)
                                rej(err);
                            else
                                res(out);
                        });
                    });
                    if (!stdout.trim()) {
                        sysMsg('No staged changes. Run `git add` first.', true);
                        setMood('error');
                        return;
                    }
                    // Ask the model to generate a commit message
                    const prompt = `Generate a conventional commit message for this diff. Reply with ONLY the commit message, nothing else.\n\n${stdout.slice(0, 4000)}`;
                    let commitMsg = '';
                    await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: prompt }], (chunk) => { if (chunk.text)
                        commitMsg += chunk.text; });
                    commitMsg = commitMsg.trim().split('\n')[0];
                    const fullMsg = `${commitMsg}\n\nCo-authored-by: Nyx <nyx@thealxlabs.ca>`;
                    execFile('git', ['commit', '-m', fullMsg], { cwd: session.workingDir }, (err) => {
                        if (err) {
                            sysMsg(`Commit failed: ${err.message}`, true);
                            setMood('error');
                        }
                        else {
                            sysMsg(`Committed: ${commitMsg}`);
                            setMood('happy');
                        }
                    });
                }
                catch (err) {
                    sysMsg(`Commit error: ${err}`, true);
                    setMood('error');
                }
                return;
            }
            case '/git': {
                trackCommand(cmd, args);
                const gParts = args.split(/\s+/);
                const gSub = gParts[0]?.toLowerCase() ?? '';
                const runGit = async (gitArgs) => {
                    return new Promise((res) => {
                        execFile('git', gitArgs, { cwd: session.workingDir }, (err, out, errOut) => {
                            res(err ? (errOut || err.message) : out);
                        });
                    });
                };
                if (!gSub || gSub === 'status') {
                    const status = await runGit(['status', '--short']);
                    const log = await runGit(['log', '--oneline', '-5']);
                    sysMsg(`git status:\n${status.trim() || '(clean)'}\n\ngit log (last 5):\n${log.trim()}`);
                    return;
                }
                if (gSub === 'log') {
                    const log = await runGit(['log', '--oneline', '-20']);
                    sysMsg(`git log:\n${log.trim()}`);
                    return;
                }
                if (gSub === 'stash') {
                    const out = await runGit(['stash']);
                    sysMsg(`git stash:\n${out.trim()}`);
                    return;
                }
                if (gSub === 'branch') {
                    const branches = await runGit(['branch', '-a']);
                    sysMsg(`git branch:\n${branches.trim()}`);
                    return;
                }
                // Pass-through any git command
                const out = await runGit(args.split(/\s+/).filter(Boolean));
                sysMsg(`git ${args}:\n${out.trim()}`);
                return;
            }
            case '/diff': {
                trackCommand(cmd, args);
                const files = executorRef.current.getSessionFiles();
                const paths = Object.keys(files);
                if (!paths.length) {
                    sysMsg('No files modified in this session.');
                    return;
                }
                if (args === '--list' || args === '-l') {
                    sysMsg(`Files modified this session:\n${paths.map((p) => `  ± ${p}`).join('\n')}`);
                    return;
                }
                // Show unified diffs for all (or specified) modified files
                const target = args ? paths.filter((p) => p.includes(args)) : paths;
                if (!target.length) {
                    sysMsg(`No modified files matching: ${args}`);
                    return;
                }
                for (const filePath of target) {
                    const diff = executorRef.current.unifiedDiff(filePath);
                    if (diff) {
                        sysMsg(diff.slice(0, 3000));
                    }
                    else {
                        sysMsg(`  ${filePath}  (unchanged)`);
                    }
                }
                return;
            }
            case '/context': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /context <file-or-folder>');
                    return;
                }
                const result = await executorRef.current.execute({ name: 'list_dir', args: { path: args, recursive: true } });
                if (!result.success) {
                    // Try reading as file
                    const fileResult = await executorRef.current.execute({ name: 'read_file', args: { path: args } });
                    if (!fileResult.success) {
                        sysMsg(`Could not read: ${args}`, true);
                        return;
                    }
                    const contextMsg = { role: 'user', content: `Context for ${args}:\n\`\`\`\n${fileResult.output}\n\`\`\`` };
                    setSession((s) => ({ ...s, messages: [...s.messages, contextMsg] }));
                    sysMsg(`Added ${args} to context (${fileResult.output.split('\n').length} lines)`);
                }
                else {
                    const contextMsg = { role: 'user', content: `Directory contents of ${args}:\n${result.output}` };
                    setSession((s) => ({ ...s, messages: [...s.messages, contextMsg] }));
                    sysMsg(`Added directory ${args} to context`);
                }
                return;
            }
            case '/allowall': {
                trackCommand(cmd, args);
                // Cycle through modes: suggest → auto-edit → full-auto → suggest
                setSession((s) => {
                    const current = s.approvalMode;
                    const next = current === 'suggest' ? 'auto-edit' :
                        current === 'auto-edit' ? 'full-auto' : 'suggest';
                    sysMsg(`Approval mode: ${next}`);
                    return { ...s, approvalMode: next };
                });
                return;
            }
            case '/mode': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg(`Current mode: ${session.approvalMode}\n\n` +
                        `  suggest    — prompt before every write, delete, shell, or git op\n` +
                        `  auto-edit  — file edits auto-approved; only shell needs approval\n` +
                        `  full-auto  — everything runs without prompting\n\n` +
                        `Usage: /mode <suggest|auto-edit|full-auto>`);
                    return;
                }
                if (!['suggest', 'auto-edit', 'full-auto'].includes(args)) {
                    sysMsg(`Unknown mode: ${args}. Options: suggest, auto-edit, full-auto`, true);
                    return;
                }
                setSession((s) => ({ ...s, approvalMode: args }));
                sysMsg(`Approval mode set to: ${args}`);
                return;
            }
            case '/steps': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg(`Max agent steps: ${session.maxSteps}\nUsage: /steps <number>  (default: 20)`);
                    return;
                }
                const n = parseInt(args, 10);
                if (isNaN(n) || n < 1 || n > 200) {
                    sysMsg('Steps must be a number between 1 and 200.', true);
                    return;
                }
                setSession((s) => ({ ...s, maxSteps: n }));
                sysMsg(`Max agent steps set to ${n}.`);
                return;
            }
            case '/compact': {
                trackCommand(cmd, args);
                if (!session.messages.length) {
                    sysMsg('No conversation to compact.');
                    return;
                }
                const threshold = parseInt(args, 10) || 20;
                if (!needsCompacting(session.messages, threshold)) {
                    sysMsg(`Conversation has ${session.messages.length} messages (threshold: ${threshold}). Not yet needed.`);
                    return;
                }
                sysMsg('Compacting conversation…');
                setMood('thinking');
                try {
                    const compactConfig = {
                        provider: session.provider,
                        apiKeys: session.apiKeys,
                        model: session.model,
                        systemPrompt: session.systemPrompt,
                        threshold,
                        keepRecent: 6,
                    };
                    const result = await compactConversation(session.messages, compactConfig);
                    if (!result.summary) {
                        sysMsg('Compacting returned no summary. Keeping messages as-is.', true);
                        setMood('idle');
                        return;
                    }
                    const newMessages = buildCompactedMessages(session.messages, result.summary, compactConfig);
                    setSession((s) => ({ ...s, messages: newMessages }));
                    setDisplayMessages([]);
                    executorRef.current.clearSessionFiles();
                    sysMsg(`Conversation compacted: ${result.compactedMessages} messages → summary + ${result.remainingMessages} recent messages (~${result.tokensSaved} tokens saved)`);
                }
                catch (err) {
                    trackError(err instanceof Error ? err : new Error(String(err)), { context: 'compact' });
                    sysMsg(`Compacting failed: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                setMood('idle');
                return;
            }
            case '/status': {
                trackCommand(cmd, args);
                const tokens = estimateTokens(session.messages);
                const cps = session.checkpoints.length;
                const provider = PROVIDERS[session.provider];
                const hasKey = provider.requiresKey ? (session.apiKeys[session.provider] ? '✓' : '✕ missing') : 'n/a';
                sysMsg(`Provider  ${provider.displayName}\n` +
                    `Model     ${session.model}\n` +
                    `API key   ${hasKey}\n` +
                    `Messages  ${session.messages.length}\n` +
                    `~Tokens   ${tokens.toLocaleString()}\n` +
                    `Checkpts  ${cps}\n` +
                    `CWD       ${session.workingDir}\n` +
                    `Mode      ${session.approvalMode}\n` +
                    `Theme     ${session.theme ?? 'dark'}`);
                return;
            }
            case '/sys': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg(`System prompt:\n\n${session.systemPrompt}\n\nPersona: ${session.activePersona ?? 'custom'}\nUsage: /sys <new prompt>`);
                    return;
                }
                setSession((s) => ({ ...s, systemPrompt: args, activePersona: null }));
                sysMsg(`System prompt updated (${args.length} chars). Persona set to custom.`);
                return;
            }
            case '/persona': {
                trackCommand(cmd, args);
                const personas = session.personas;
                if (!args) {
                    const list = personas
                        .map((p) => `  ${session.activePersona === p.name ? '▶ ' : '  '}${p.name}`)
                        .join('\n');
                    sysMsg(`Personas:\n${list}\n\nUsage: /persona <name>`);
                    return;
                }
                const found = personas.find((p) => p.name === args.toLowerCase());
                if (!found) {
                    sysMsg(`Persona not found: ${args}. Options: ${personas.map((p) => p.name).join(', ')}`, true);
                    return;
                }
                setSession((s) => ({ ...s, systemPrompt: found.prompt, activePersona: found.name }));
                sysMsg(`Switched to persona: ${found.name}`);
                setMood('happy');
                return;
            }
            case '/pin': {
                trackCommand(cmd, args);
                if (!args) {
                    if (!session.pinnedContext.length) {
                        sysMsg('No pinned context. Usage: /pin <text to always include>');
                        return;
                    }
                    const list = session.pinnedContext.map((p, i) => `  ${i + 1}. ${p.slice(0, 80)}${p.length > 80 ? '…' : ''}`).join('\n');
                    sysMsg(`Pinned context (${session.pinnedContext.length}):\n${list}`);
                    return;
                }
                setSession((s) => ({ ...s, pinnedContext: [...s.pinnedContext, args] }));
                sysMsg(`Pinned: "${args.slice(0, 60)}${args.length > 60 ? '…' : ''}"`);
                return;
            }
            case '/unpin': {
                trackCommand(cmd, args);
                if (!session.pinnedContext.length) {
                    sysMsg('No pinned context to remove.');
                    return;
                }
                if (!args) {
                    const list = session.pinnedContext.map((p, i) => `  ${i + 1}. ${p.slice(0, 80)}`).join('\n');
                    sysMsg(`Pinned context:\n${list}\n\nUsage: /unpin <number>`);
                    return;
                }
                const idx = parseInt(args, 10) - 1;
                if (isNaN(idx) || idx < 0 || idx >= session.pinnedContext.length) {
                    sysMsg(`Invalid index: ${args}`, true);
                    return;
                }
                setSession((s) => ({
                    ...s,
                    pinnedContext: s.pinnedContext.filter((_, i) => i !== idx),
                }));
                sysMsg(`Unpinned item ${idx + 1}.`);
                return;
            }
            case '/retry': {
                trackCommand(cmd, args);
                const msgs = session.messages;
                if (!msgs.length) {
                    sysMsg('Nothing to retry.');
                    return;
                }
                // Remove last assistant message, re-send last user message
                const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
                if (!lastUser) {
                    sysMsg('No user message to retry.', true);
                    return;
                }
                const trimmed = msgs.slice(0, msgs.lastIndexOf(lastUser));
                setSession((s) => ({ ...s, messages: trimmed }));
                setDisplayMessages((prev) => {
                    const lastAssistantIdx = [...prev].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'assistant')?.i;
                    return lastAssistantIdx !== undefined ? prev.slice(0, lastAssistantIdx) : prev;
                });
                sysMsg('Retrying…');
                await sendMessage(lastUser.content);
                return;
            }
            case '/copy': {
                trackCommand(cmd, args);
                if (!session.lastAssistantMessage) {
                    sysMsg('No response to copy yet.');
                    return;
                }
                try {
                    // Pass content via stdin to avoid any shell expansion of the message content
                    const content = session.lastAssistantMessage;
                    if (process.platform === 'darwin') {
                        execFileSync('pbcopy', [], { input: content, encoding: 'utf8' });
                    }
                    else if (process.platform === 'win32') {
                        execFileSync('clip', [], { input: content, encoding: 'utf8' });
                    }
                    else {
                        // Linux — try xclip, then xsel, then wl-clipboard (Wayland)
                        try {
                            execFileSync('xclip', ['-selection', 'clipboard'], { input: content, encoding: 'utf8' });
                        }
                        catch {
                            try {
                                execFileSync('xsel', ['--clipboard', '--input'], { input: content, encoding: 'utf8' });
                            }
                            catch {
                                execFileSync('wl-copy', [], { input: content, encoding: 'utf8' });
                            }
                        }
                    }
                    sysMsg(`Copied ${session.lastAssistantMessage.length} chars to clipboard.`);
                }
                catch {
                    sysMsg('Clipboard not available. Here is the last response:\n\n' + session.lastAssistantMessage);
                }
                return;
            }
            case '/export': {
                trackCommand(cmd, args);
                const filename = (args || `localcode-${Date.now()}`).replace(/\.md$/, '') + '.md';
                const outPath = path.join(session.workingDir, filename);
                const lines = [
                    `# LocalCode Session Export`,
                    ``,
                    `**Date:** ${new Date().toLocaleString()}`,
                    `**Provider:** ${PROVIDERS[session.provider].displayName}`,
                    `**Model:** ${session.model}`,
                    `**Persona:** ${session.activePersona ?? 'custom'}`,
                    ``,
                    `---`,
                    ``,
                    ...session.messages.map((m) => {
                        const role = m.role === 'user' ? '### You' : m.role === 'assistant' ? '### Nyx' : '### System';
                        return `${role}\n\n${m.content}\n`;
                    }),
                ];
                fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
                sysMsg(`Exported to ${outPath}`);
                return;
            }
            case '/share': {
                trackCommand(cmd, args);
                const timestamp = Date.now();
                const outPath = path.join(session.workingDir, `localcode-share-${timestamp}.html`);
                const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const msgHtml = session.messages.map((m) => {
                    const roleLabel = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Nyx' : 'System';
                    const roleClass = m.role;
                    const content = escapeHtml(m.content)
                        .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => `<pre><code class="lang-${lang}">${code}</code></pre>`)
                        .replace(/`([^`]+)`/g, '<code>$1</code>')
                        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                        .replace(/\n/g, '<br>');
                    return `<div class="message ${roleClass}"><span class="role">${roleLabel}</span><div class="content">${content}</div></div>`;
                }).join('\n');
                const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LocalCode Session — ${new Date(timestamp).toLocaleString()}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1a1a2e; color: #e0e0e0; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 14px; line-height: 1.6; padding: 24px; }
  h1 { color: #f5c518; margin-bottom: 8px; font-size: 20px; }
  .meta { color: #888; font-size: 12px; margin-bottom: 24px; }
  .message { margin-bottom: 20px; padding: 12px 16px; border-radius: 8px; max-width: 900px; }
  .message.user { background: #16213e; border-left: 3px solid #f5c518; }
  .message.assistant { background: #0f3460; border-left: 3px solid #e94560; }
  .message.system { background: #0a0a1a; border-left: 3px solid #444; color: #888; }
  .role { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; display: block; margin-bottom: 6px; }
  .message.user .role { color: #f5c518; }
  .message.assistant .role { color: #e94560; }
  .content { white-space: pre-wrap; word-break: break-word; }
  pre { background: #0d1117; border: 1px solid #333; border-radius: 6px; padding: 12px; margin: 8px 0; overflow-x: auto; }
  code { background: #1e1e2e; padding: 2px 6px; border-radius: 3px; color: #a6da95; font-size: 13px; }
  pre code { background: none; padding: 0; color: #cdd6f4; }
  strong { color: #f5c518; }
  footer { margin-top: 32px; color: #444; font-size: 11px; text-align: center; }
</style>
</head>
<body>
<h1>LocalCode Session Export</h1>
<div class="meta">
  Date: ${new Date(timestamp).toLocaleString()} &nbsp;·&nbsp;
  Provider: ${PROVIDERS[session.provider].displayName} &nbsp;·&nbsp;
  Model: ${escapeHtml(session.model)} &nbsp;·&nbsp;
  Messages: ${session.messages.length}
</div>
${msgHtml}
<footer>Generated by LocalCode &nbsp;·&nbsp; github.com/TheLocalCodeTeam/localcode</footer>
</body>
</html>`;
                try {
                    fs.writeFileSync(outPath, html, 'utf8');
                    sysMsg(`HTML export saved to:\n  ${outPath}`);
                }
                catch (err) {
                    sysMsg(`Export failed: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                return;
            }
            case '/undo': {
                trackCommand(cmd, args);
                const files = executorRef.current.getSessionFiles();
                const paths = Object.keys(files);
                if (!paths.length) {
                    sysMsg('No file changes to undo this session.');
                    return;
                }
                const result = executorRef.current.undoLastChange();
                if (result) {
                    sysMsg(`Undone: ${result}`);
                }
                else {
                    sysMsg('Nothing to undo.');
                }
                return;
            }
            case '/todo': {
                trackCommand(cmd, args);
                if (!session.messages.length) {
                    sysMsg('No conversation to extract todos from.');
                    return;
                }
                sysMsg('Extracting todos…');
                setMood('thinking');
                const todoPrompt = `From this conversation, extract a concise numbered todo list of outstanding tasks, bugs, and things to implement. Format as a simple numbered list. If there are no clear todos, say so.\n\n${session.messages.slice(-20).map((m) => `${m.role}: ${m.content.slice(0, 400)}`).join('\n\n')}`;
                let todos = '';
                await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: todoPrompt }], (c) => { if (c.text)
                    todos += c.text; });
                sysMsg(`Todos:\n${todos.trim()}`);
                setMood('idle');
                return;
            }
            case '/web': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /web <search query>');
                    return;
                }
                sysMsg(`Searching: "${args}"…`);
                setMood('thinking');
                try {
                    // Try multiple search engines with fallback
                    const searchUrls = [
                        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args)}`,
                        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(args)}`,
                    ];
                    let text = null;
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    for (const url of searchUrls) {
                        try {
                            const res = await fetch(url, {
                                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
                                signal: controller.signal,
                            });
                            if (res.ok) {
                                text = await res.text();
                                if (text && text.length > 100)
                                    break;
                            }
                        }
                        catch {
                            // Try next URL
                        }
                    }
                    clearTimeout(timeoutId);
                    if (!text) {
                        // Fallback: provide a helpful message instead of failing
                        sysMsg(`Web search unavailable. Consider using /context to add relevant files, or search manually and paste results.`);
                        setMood('idle');
                        return;
                    }
                    // Extract snippets with multiple patterns for resilience
                    const patterns = [
                        /class="result__snippet"[^>]*>([^<]{20,300})</g,
                        /class="result-snippet"[^>]*>([^<]{20,300})</g,
                        /<td[^>]*class="result-snippet"[^>]*>([^<]{20,300})</g,
                    ];
                    let snippets = [];
                    for (const pattern of patterns) {
                        const matches = [...text.matchAll(pattern)].slice(0, 5);
                        if (matches.length > 0) {
                            snippets = matches.map((m, i) => `${i + 1}. ${m[1].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]*>/g, '').trim()}`);
                            break;
                        }
                    }
                    if (!snippets.length) {
                        sysMsg('No results found. Try a different query.');
                        setMood('idle');
                        return;
                    }
                    const contextText = `Web search results for "${args}":\n\n${snippets.join('\n\n')}`;
                    const webMsg = { role: 'user', content: contextText };
                    setSession((s) => ({ ...s, messages: [...s.messages, webMsg] }));
                    sysMsg(`Added ${snippets.length} search results to context.`);
                }
                catch {
                    sysMsg('Web search failed. Check your connection or try a different query.', true);
                }
                setMood('idle');
                return;
            }
            case '/open': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /open <file>');
                    return;
                }
                const editor = process.env.EDITOR || (process.platform === 'darwin' ? 'open' : 'xdg-open');
                execFile(editor, [args], { cwd: session.workingDir }, (err) => {
                    if (err)
                        sysMsg(`Could not open: ${err.message}`, true);
                    else
                        sysMsg(`Opened ${args} in ${editor}`);
                });
                return;
            }
            case '/models': {
                trackCommand(cmd, args);
                sysMsg(`Fetching models for ${PROVIDERS[session.provider].displayName}…`);
                setMood('thinking');
                const models = await listModels(session.provider, session.apiKeys);
                if (!models.length) {
                    sysMsg('No models found. Make sure your API key is set and the provider is reachable.', true);
                }
                else {
                    sysMsg(`Available models (${models.length}):\n${models.map((m) => `  · ${m}`).join('\n')}\n\nUse /model <name> to switch.`);
                }
                setMood('idle');
                return;
            }
            case '/cost': {
                trackCommand(cmd, args);
                const tokens = estimateTokens(session.messages);
                const cost = session.sessionCost;
                const provider = PROVIDERS[session.provider];
                if (!provider.requiresKey) {
                    sysMsg(`Provider: ${provider.displayName} (free/local)\n~Tokens this session: ${tokens.toLocaleString()}\nNo cost estimate for local models.`);
                }
                else {
                    sysMsg(`Provider: ${provider.displayName}\nModel: ${session.model}\n~Tokens this session: ${tokens.toLocaleString()}\nEstimated cost: $${cost.toFixed(6)} USD`);
                }
                return;
            }
            case '/explain': {
                trackCommand(cmd, args);
                setMood('thinking');
                let prompt;
                if (args) {
                    // Load file at path
                    const filePath = path.isAbsolute(args) ? args : path.join(session.workingDir, args);
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        prompt = `Explain this code clearly: what it does, how it works, key patterns and design decisions.\n\nFile: ${args}\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\``;
                    }
                    catch {
                        sysMsg(`Could not read file: ${args}`, true);
                        setMood('idle');
                        return;
                    }
                }
                else {
                    prompt = 'Explain the last code snippet in this conversation: what it does, how it works, and any key patterns or design decisions.';
                }
                const explainId = addDisplay({ role: 'assistant', content: '', streaming: true });
                let explanation = '';
                await streamProvider(session.provider, session.apiKeys, session.model, [...session.messages, { role: 'user', content: prompt }], (chunk) => { if (chunk.text) {
                    explanation += chunk.text;
                    updateDisplay(explainId, { content: explanation, streaming: true });
                } }, session.systemPrompt);
                updateDisplay(explainId, { content: explanation, streaming: false });
                setSession((s) => ({ ...s, lastAssistantMessage: explanation }));
                setMood('idle');
                return;
            }
            case '/test': {
                trackCommand(cmd, args);
                setMood('thinking');
                sysMsg('Detecting test runner…');
                const cwd = session.workingDir;
                let testCmd = null;
                // Detect test runner
                try {
                    const pkgPath = path.join(cwd, 'package.json');
                    if (fs.existsSync(pkgPath)) {
                        const pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                        const deps = { ...(pkgContent.dependencies ?? {}), ...(pkgContent.devDependencies ?? {}) };
                        if (deps['vitest']) {
                            testCmd = 'npx vitest run';
                        }
                        else if (deps['jest'] || pkgContent.scripts?.test?.includes('jest')) {
                            testCmd = 'npm test';
                        }
                    }
                }
                catch (err) {
                    logger.warn('Operation failed', { error: err instanceof Error ? err.message : String(err) });
                }
                if (!testCmd && fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
                    testCmd = 'cargo test';
                }
                if (!testCmd && fs.existsSync(path.join(cwd, 'go.mod'))) {
                    testCmd = 'go test ./...';
                }
                if (!testCmd) {
                    const pyFiles = ['pytest.ini', 'pyproject.toml', 'setup.cfg'];
                    for (const f of pyFiles) {
                        const fp = path.join(cwd, f);
                        if (fs.existsSync(fp)) {
                            const content = fs.readFileSync(fp, 'utf8');
                            if (f === 'pyproject.toml' ? content.includes('[tool.pytest') : true) {
                                testCmd = 'pytest';
                                break;
                            }
                        }
                    }
                }
                if (!testCmd) {
                    sysMsg('Could not detect a test runner. Expected: package.json (jest/vitest), pytest.ini, Cargo.toml, or go.mod', true);
                    setMood('idle');
                    return;
                }
                sysMsg(`Running: ${testCmd}`);
                const testOutputId = addDisplay({ role: 'system', content: `$ ${testCmd}\n`, streaming: true });
                let testOutput = `$ ${testCmd}\n`;
                let exitCode = 0;
                await new Promise((resolve) => {
                    const child = execFile('sh', ['-c', testCmd], { cwd, env: process.env }, (err, out, errOut) => {
                        if (err)
                            exitCode = err.code ?? 1;
                        testOutput += out + errOut;
                        resolve();
                    });
                    if (child.stdout) {
                        child.stdout.on('data', (data) => {
                            testOutput += data;
                            updateDisplay(testOutputId, { content: testOutput, streaming: true });
                        });
                    }
                    if (child.stderr) {
                        child.stderr.on('data', (data) => {
                            testOutput += data;
                            updateDisplay(testOutputId, { content: testOutput, streaming: true });
                        });
                    }
                });
                updateDisplay(testOutputId, { content: testOutput, streaming: false });
                if (exitCode !== 0) {
                    sysMsg(`Tests failed (exit code ${exitCode}). Ask Nyx to fix? [y/N]`);
                    setPendingTestFix(testOutput);
                }
                else {
                    sysMsg('All tests passed!');
                    setMood('happy');
                }
                setMood(exitCode !== 0 ? 'error' : 'idle');
                return;
            }
            case '/watch': {
                trackCommand(cmd, args);
                const wSub = args.trim();
                if (!wSub) {
                    if (watchFileRef.current) {
                        sysMsg(`Watching: ${watchFileRef.current}\n\nUse /watch stop to stop.`);
                    }
                    else {
                        sysMsg('No file being watched. Usage: /watch <file>');
                    }
                    return;
                }
                if (wSub === 'stop') {
                    if (watcherRef.current) {
                        watcherRef.current.close();
                        watcherRef.current = null;
                        const prev = watchFileRef.current;
                        watchFileRef.current = null;
                        sysMsg(`Stopped watching: ${prev}`);
                    }
                    else {
                        sysMsg('No active watcher.');
                    }
                    return;
                }
                // Start watching
                const watchPath = path.isAbsolute(wSub) ? wSub : path.join(session.workingDir, wSub);
                if (!fs.existsSync(watchPath)) {
                    sysMsg(`File not found: ${watchPath}`, true);
                    return;
                }
                // Stop previous watcher
                if (watcherRef.current) {
                    watcherRef.current.close();
                    watcherRef.current = null;
                }
                watchFileRef.current = watchPath;
                sysMsg(`Watching ${watchPath}…`);
                let debounceTimer = null;
                watcherRef.current = fs.watch(watchPath, () => {
                    if (debounceTimer)
                        clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        const lastMsg = lastUserMsgRef.current;
                        if (lastMsg && !isStreaming) {
                            sysMsg(`File changed: ${path.basename(watchPath)} — re-running last message…`);
                            sendMessage(lastMsg);
                        }
                    }, 500);
                });
                return;
            }
            case '/image': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /image <file-path>');
                    return;
                }
                const imgPath = path.isAbsolute(args) ? args : path.join(session.workingDir, args);
                if (!fs.existsSync(imgPath)) {
                    sysMsg(`File not found: ${imgPath}`, true);
                    return;
                }
                try {
                    const imgBuf = fs.readFileSync(imgPath);
                    const base64 = imgBuf.toString('base64');
                    const ext = path.extname(imgPath).toLowerCase().slice(1);
                    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
                    const mimeType = mimeMap[ext] ?? 'image/png';
                    const sizeKb = Math.round(imgBuf.length / 1024);
                    const imgMsg = {
                        role: 'user',
                        content: `[Image: ${path.basename(imgPath)}]`,
                        images: [{ base64, mimeType }],
                    };
                    setSession((s) => ({ ...s, messages: [...s.messages, imgMsg] }));
                    addDisplay({ role: 'user', content: `[Image: ${path.basename(imgPath)}]` });
                    sysMsg(`Image loaded: ${path.basename(imgPath)} (${sizeKb}kb). You can now ask about it.`);
                }
                catch (err) {
                    sysMsg(`Could not read image: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                return;
            }
            case '/index': {
                trackCommand(cmd, args);
                sysMsg(`Building TF-IDF index for ${session.workingDir}…`);
                setMood('thinking');
                try {
                    const index = buildIndex(session.workingDir, 500);
                    searchIndexRef.current = index;
                    sysMsg(`Indexed ${index.files.length} files. Use /search <query> for semantic search.`);
                }
                catch (err) {
                    sysMsg(`Indexing failed: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                setMood('idle');
                return;
            }
            case '/search': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /search <pattern>  — search file contents in working dir');
                    return;
                }
                // Use TF-IDF if indexed
                if (searchIndexRef.current) {
                    sysMsg(`Searching (TF-IDF + context) for "${args}"…`);
                    const results = searchWithContext(args, searchIndexRef.current, 10, 2);
                    if (!results.length) {
                        sysMsg(`No results for: ${args}`);
                        return;
                    }
                    const list = results.map((r, i) => {
                        const rel = r.filePath.replace(session.workingDir + '/', '');
                        const band = r.relevance === 'high' ? '[high]' : r.relevance === 'medium' ? '[med] ' : '[low] ';
                        const ctxLines = r.matchingLines.slice(0, 4).map((l) => `       ${String(l.lineNumber).padStart(4)}: ${l.text.trim().slice(0, 90)}`).join('\n');
                        return `  ${i + 1}. ${band} ${rel}  (${r.score.toFixed(3)})\n${ctxLines || `       ${r.snippet}`}`;
                    }).join('\n');
                    sysMsg(`TF-IDF results for "${args}":\n${list}`);
                    return;
                }
                sysMsg(`Searching for "${args}"…`);
                const result = await executorRef.current.execute({ name: 'search_files', args: { pattern: args, path: '.' } });
                sysMsg(result.success && result.output.trim() ? result.output : `No matches found for: ${args}\n\nTip: run /index first for semantic search.`);
                return;
            }
            case '/init': {
                trackCommand(cmd, args);
                sysMsg('Analyzing project…');
                setMood('thinking');
                try {
                    // Gather project signals
                    const signals = [];
                    const tryRead = (f) => { try {
                        return fs.readFileSync(path.join(session.workingDir, f), 'utf8').slice(0, 500);
                    }
                    catch {
                        return null;
                    } };
                    const pkgFile = tryRead('package.json');
                    const cargo = tryRead('Cargo.toml');
                    const pyproj = tryRead('pyproject.toml');
                    const gomod = tryRead('go.mod');
                    const readme = tryRead('README.md') ?? tryRead('README');
                    if (pkgFile)
                        signals.push(`package.json:\n${pkgFile}`);
                    if (cargo)
                        signals.push(`Cargo.toml:\n${cargo}`);
                    if (pyproj)
                        signals.push(`pyproject.toml:\n${pyproj}`);
                    if (gomod)
                        signals.push(`go.mod:\n${gomod}`);
                    if (readme)
                        signals.push(`README:\n${readme}`);
                    const dirResult = await executorRef.current.execute({ name: 'list_dir', args: { path: '.', recursive: true } });
                    signals.push(`Directory structure:\n${dirResult.output.slice(0, 1000)}`);
                    const prompt = `Generate a .nyx.md project configuration file for an AI coding assistant named Nyx.\n\nBased on this project info:\n${signals.join('\n\n')}\n\nThe .nyx.md should include:\n1. A brief description of what this project does\n2. Key technologies, frameworks, and conventions\n3. Important files and their purpose\n4. How to run tests and build\n5. Any gotchas or things the AI should know\n\nFormat it as clean markdown. Be concise and specific. This will be injected into every AI request.`;
                    const initId = addDisplay({ role: 'assistant', content: '', streaming: true });
                    let content = '';
                    await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: prompt }], (chunk) => { if (chunk.text) {
                        content += chunk.text;
                        updateDisplay(initId, { content, streaming: true });
                    } });
                    updateDisplay(initId, { content, streaming: false });
                    const nyxMdPath = path.join(session.workingDir, '.nyx.md');
                    fs.writeFileSync(nyxMdPath, content.trim(), 'utf8');
                    sysMsg(`.nyx.md created at ${nyxMdPath}\nRestart or run /memory to reload.`);
                    setMood('happy');
                }
                catch (err) {
                    sysMsg(`Init failed: ${err instanceof Error ? err.message : String(err)}`, true);
                    setMood('error');
                }
                return;
            }
            case '/doctor': {
                trackCommand(cmd, args);
                setMood('thinking');
                const checks = [];
                // Node.js
                checks.push({ label: 'Node.js', status: process.version, ok: true });
                // Ollama
                try {
                    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
                    if (res.ok) {
                        const data = await res.json();
                        checks.push({ label: 'Ollama', status: `running — ${data.models.length} model${data.models.length !== 1 ? 's' : ''}`, ok: true });
                    }
                    else {
                        checks.push({ label: 'Ollama', status: 'reachable but returned error', ok: false });
                    }
                }
                catch {
                    checks.push({ label: 'Ollama', status: 'not running (start with: ollama serve)', ok: false });
                }
                // API keys
                for (const [p, cfg] of Object.entries(PROVIDERS)) {
                    if (cfg.requiresKey) {
                        const has = !!session.apiKeys[p];
                        checks.push({ label: `${cfg.displayName} key`, status: has ? 'set' : 'missing — use /apikey', ok: has });
                    }
                }
                // Git
                const gitCheck = await executorRef.current.execute({ name: 'git_operation', args: { args: 'rev-parse --git-dir' } });
                checks.push({ label: 'Git repo', status: gitCheck.success ? 'yes' : 'not a git repo', ok: gitCheck.success });
                // Memory files
                const memories = loadNyxMemories(session.workingDir);
                checks.push({ label: '.nyx.md memory', status: memories.length ? memories.map((m) => path.basename(path.dirname(m.source)) + '/' + path.basename(m.source)).join(', ') : 'none — use /init', ok: memories.length > 0 });
                // MCP
                const mcpSrv = mcpRef.current.getStatus();
                checks.push({ label: 'MCP servers', status: mcpSrv.length ? mcpSrv.map((s) => `${s.name}(${s.connected ? '✓' : '✕'})`).join(' ') : 'none', ok: true });
                // Hooks
                const hookTotal = [...(hooksRef.current.PreToolUse ?? []), ...(hooksRef.current.PostToolUse ?? []), ...(hooksRef.current.Notification ?? [])].length;
                checks.push({ label: 'Hooks', status: hookTotal ? `${hookTotal} configured` : 'none (optional)', ok: true });
                // Plugins
                checks.push({ label: 'Plugins', status: pluginsRef.current.length ? `${pluginsRef.current.length} loaded` : 'none', ok: true });
                // Search index
                checks.push({ label: 'Search index', status: searchIndexRef.current ? `${searchIndexRef.current.files.length} files` : 'not built (run /index)', ok: !!searchIndexRef.current });
                const W = 22;
                const out = checks.map((c) => `  ${c.ok ? '✓' : '✕'} ${c.label.padEnd(W)} ${c.status}`).join('\n');
                sysMsg(`LocalCode Doctor\n\n${out}\n\nMode: ${session.approvalMode}  Steps: ${session.maxSteps}  Theme: ${session.theme ?? 'dark'}  Provider: ${PROVIDERS[session.provider].displayName}`);
                setMood('idle');
                return;
            }
            case '/memory': {
                trackCommand(cmd, args);
                const subCmd = args.trim().toLowerCase();
                if (subCmd === 'edit') {
                    const editor = process.env.EDITOR || (process.platform === 'darwin' ? 'nano' : 'nano');
                    const globalNyx = path.join(os.homedir(), '.nyx.md');
                    if (!fs.existsSync(globalNyx)) {
                        fs.writeFileSync(globalNyx, `# Nyx Global Memory\n\nAdd notes here that Nyx should always know about you.\n`, 'utf8');
                    }
                    execFile(editor, [globalNyx], (err) => {
                        if (err)
                            sysMsg(`Could not open editor: ${err.message}`, true);
                        else
                            sysMsg(`Saved. Restart LocalCode to reload memory.`);
                    });
                    sysMsg(`Opening ${globalNyx} in ${editor}…`);
                    return;
                }
                const memories = loadNyxMemories(session.workingDir);
                const lines = [
                    'Memory files (.nyx.md hierarchy):',
                    '',
                    `  ${memories.find((m) => m.source.includes(os.homedir())) ? '✓' : '·'} Global   ${path.join(os.homedir(), '.nyx.md')}${memories.find((m) => m.source.includes(os.homedir())) ? '' : '  (not found)'}`,
                    `  ${memories.find((m) => m.source.includes(session.workingDir)) ? '✓' : '·'} Project  ${path.join(session.workingDir, '.nyx.md')}${memories.find((m) => m.source.includes(session.workingDir)) ? '' : '  (not found — use /init)'}`,
                    '',
                    `Pinned context items: ${session.pinnedContext.length}`,
                    '',
                    'Commands:',
                    '  /memory edit   — edit global ~/.nyx.md',
                    '  /init          — generate project .nyx.md from codebase',
                ];
                sysMsg(lines.join('\n'));
                return;
            }
            case '/hooks': {
                trackCommand(cmd, args);
                const hooksPath = path.join(os.homedir(), '.localcode', 'hooks.json');
                const loaded = hooksRef.current;
                const total = [...(loaded.PreToolUse ?? []), ...(loaded.PostToolUse ?? []), ...(loaded.Notification ?? [])].length;
                if (!total) {
                    sysMsg(`No hooks configured.\n\n` +
                        `Create ${hooksPath} to add hooks:\n` +
                        `{\n` +
                        `  "PreToolUse": [{ "matcher": "write_file", "command": "echo writing $LC_TOOL_PATH" }],\n` +
                        `  "PostToolUse": [{ "matcher": "write_file", "command": "prettier --write \\"$LC_TOOL_PATH\\" 2>/dev/null" }],\n` +
                        `  "Notification": [{ "command": "say done" }]\n` +
                        `}\n\n` +
                        `Env vars: LC_TOOL_NAME, LC_TOOL_ARGS, LC_TOOL_OUTPUT, LC_TOOL_PATH`);
                }
                else {
                    const lines = [
                        `Hooks loaded from ${hooksPath}:`,
                        ...(loaded.PreToolUse ?? []).map((h) => `  PreToolUse   ${h.matcher ? `[${h.matcher}] ` : ''}→ ${h.command}`),
                        ...(loaded.PostToolUse ?? []).map((h) => `  PostToolUse  ${h.matcher ? `[${h.matcher}] ` : ''}→ ${h.command}`),
                        ...(loaded.Notification ?? []).map((h) => `  Notification → ${h.command}`),
                    ];
                    sysMsg(lines.join('\n'));
                }
                return;
            }
            case '/mcp': {
                trackCommand(cmd, args);
                const subParts = args.split(/\s+/);
                const sub = subParts[0]?.toLowerCase();
                const mcpArgs = subParts.slice(1).join(' ');
                if (!sub || sub === 'list') {
                    const status = mcpRef.current.getStatus();
                    if (!status.length) {
                        sysMsg('No MCP servers configured.\n\nAdd one:\n  /mcp add <name> stdio <command> [args...]\n  /mcp add <name> http <url>');
                    }
                    else {
                        const list = status
                            .map((s) => `  ${s.connected ? '✓' : '✕'} ${s.name}  (${s.transport})  ${s.toolCount} tools`)
                            .join('\n');
                        sysMsg(`MCP servers:\n${list}\n\nTools: /mcp tools`);
                    }
                    return;
                }
                if (sub === 'tools') {
                    const tools = mcpRef.current.getAllTools();
                    if (!tools.length) {
                        sysMsg('No MCP tools available. Connect a server first with /mcp add.');
                        return;
                    }
                    const list = tools
                        .map((t) => `  ${t.serverName}/${t.name}  —  ${t.description.slice(0, 60)}`)
                        .join('\n');
                    sysMsg(`MCP tools (${tools.length}):\n${list}`);
                    return;
                }
                if (sub === 'add') {
                    // /mcp add <name> stdio <command> [args...]
                    // /mcp add <name> http <url>
                    const [name, transport, ...rest] = mcpArgs.split(/\s+/);
                    if (!name || !transport || !rest.length) {
                        sysMsg('Usage:\n  /mcp add <name> stdio <command> [args...]\n  /mcp add <name> http <url>', true);
                        return;
                    }
                    if (transport !== 'stdio' && transport !== 'http') {
                        sysMsg(`Transport must be "stdio" or "http", got: ${transport}`, true);
                        return;
                    }
                    sysMsg(`Connecting to MCP server "${name}"…`);
                    setMood('thinking');
                    const config = transport === 'stdio'
                        ? { name, transport: 'stdio', command: rest[0], args: rest.slice(1) }
                        : { name, transport: 'http', url: rest[0] };
                    const err = await mcpRef.current.connect(config, (msg) => sysMsg(msg));
                    if (!err) {
                        const tools = mcpRef.current.getAllTools().filter((t) => t.serverName === name);
                        sysMsg(`Connected! ${tools.length} tools available from "${name}".`);
                        setMood('happy');
                    }
                    else {
                        setMood('error');
                    }
                    return;
                }
                if (sub === 'remove' || sub === 'rm') {
                    const name = mcpArgs.trim();
                    if (!name) {
                        sysMsg('Usage: /mcp remove <name>', true);
                        return;
                    }
                    mcpRef.current.disconnect(name);
                    sysMsg(`Removed MCP server "${name}".`);
                    return;
                }
                if (sub === 'connect') {
                    // Reconnect all saved servers
                    sysMsg('Connecting to all saved MCP servers…');
                    setMood('thinking');
                    await mcpRef.current.connectAll((msg) => sysMsg(msg));
                    setMood('idle');
                    return;
                }
                sysMsg('MCP commands:\n  /mcp list          — show servers\n  /mcp tools         — show all tools\n  /mcp add <n> stdio <cmd>  — add stdio server\n  /mcp add <n> http <url>   — add HTTP server\n  /mcp remove <n>    — remove server\n  /mcp connect       — reconnect all saved servers');
                return;
            }
            case '/cd': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg(`Current working directory: ${session.workingDir}\nUsage: /cd <path>`);
                    return;
                }
                const newDir = path.isAbsolute(args) ? args : path.join(session.workingDir, args);
                if (!fs.existsSync(newDir) || !fs.statSync(newDir).isDirectory()) {
                    sysMsg(`Not a directory: ${newDir}`, true);
                    return;
                }
                const resolved = path.resolve(newDir);
                executorRef.current = new ToolExecutor(resolved);
                setSession((s) => ({ ...s, workingDir: resolved }));
                sysMsg(`Working directory → ${resolved}`);
                return;
            }
            case '/ping': {
                trackCommand(cmd, args);
                const pingAll = args === 'all';
                const providersToPing = pingAll
                    ? Object.keys(PROVIDERS).filter(p => !PROVIDERS[p].requiresKey || session.apiKeys[p])
                    : [session.provider];
                if (pingAll) {
                    sysMsg(`Pinging ${providersToPing.length} configured providers…`);
                }
                else {
                    sysMsg(`Testing connection to ${PROVIDERS[session.provider].displayName}…`);
                }
                setMood('thinking');
                const pingResults = [];
                await Promise.all(providersToPing.map(async (p) => {
                    try {
                        const startMs = Date.now();
                        await streamProvider(p, session.apiKeys, PROVIDERS[p].defaultModel, [{ role: 'user', content: 'Reply with only: pong' }], () => { });
                        const ms = Date.now() - startMs;
                        pingResults.push(`  ✓  ${PROVIDERS[p].displayName.padEnd(10)}  ${ms}ms`);
                    }
                    catch (err) {
                        pingResults.push(`  ✕  ${PROVIDERS[p].displayName.padEnd(10)}  ${err instanceof Error ? err.message.slice(0, 50) : 'failed'}`);
                    }
                }));
                if (pingAll) {
                    sysMsg(`Ping results:\n${pingResults.join('\n')}`);
                }
                else {
                    sysMsg(pingResults[0] ?? '✕ No result');
                }
                setMood(pingResults.every(r => r.startsWith('  ✓')) ? 'happy' : 'error');
                return;
            }
            case '/ls': {
                trackCommand(cmd, args);
                const target = args || '.';
                const result = await executorRef.current.execute({ name: 'list_dir', args: { path: target, recursive: false } });
                sysMsg(result.success ? result.output : `Could not list: ${target}`);
                return;
            }
            case '/find': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /find <filename-pattern>  e.g. /find *.ts');
                    return;
                }
                const result = await executorRef.current.execute({ name: 'find_files', args: { pattern: args } });
                sysMsg(result.success && result.output.trim() ? result.output : `No files matching: ${args}`);
                return;
            }
            case '/update': {
                trackCommand(cmd, args);
                sysMsg('Checking for updates…');
                setMood('thinking');
                try {
                    const { execFile } = await import('child_process');
                    const checkUpdate = () => {
                        return new Promise((resolve) => {
                            execFile('npm', ['view', '@localcode/cli', 'version'], (err, stdout) => {
                                if (err) {
                                    resolve({ latest: '', current: pkg.version, needsUpdate: false });
                                    return;
                                }
                                const latest = stdout.trim();
                                resolve({ latest, current: pkg.version, needsUpdate: latest !== pkg.version });
                            });
                        });
                    };
                    const result = await checkUpdate();
                    if (result.needsUpdate) {
                        sysMsg(`Update available: ${result.current} → ${result.latest}\nRunning: npm install -g @localcode/cli@${result.latest}`);
                        await new Promise((resolve) => {
                            execFile('npm', ['install', '-g', `@localcode/cli@${result.latest}`], (err, stdout, stderr) => {
                                if (err) {
                                    sysMsg(`Update failed: ${stderr || err.message}`, true);
                                }
                                else {
                                    sysMsg(`✓ Updated to ${result.latest}. Restart Localcode to apply.`);
                                }
                                resolve();
                            });
                        });
                    }
                    else {
                        sysMsg(`Already on latest version (${result.current}).`);
                    }
                }
                catch (err) {
                    sysMsg(`Update check failed: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                setMood('idle');
                return;
            }
            case '/onboarding': {
                trackCommand(cmd, args);
                const steps = [
                    '1. Choose a provider: /provider ollama (free, local) or /provider openai/claude/groq',
                    '2. Set API keys if needed: /apikey <key> (or set env vars OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY)',
                    '3. Browse agents: /agents  or activate one: /agent <name>',
                    '4. Start coding: Just type your request!',
                    '',
                    'Quick commands:',
                    '  /help          Show all commands',
                    '  /agent         Browse 139 specialized agents',
                    '  /orchestrate   Run multi-agent pipeline',
                    '  /commit        Generate commit message',
                    '  /settings      Show current settings',
                    '  /update        Check for updates',
                ];
                sysMsg(steps.join('\n'));
                return;
            }
            case '/exit': {
                trackCommand(cmd, args);
                try {
                    saveSession(session);
                }
                catch (err) {
                    logger.error('Exit cleanup failed', { error: err instanceof Error ? err.message : String(err) });
                }
                exit();
                return;
            }
            case '/telemetry': {
                trackCommand(cmd, args);
                const tSub = args.toLowerCase();
                if (tSub === 'on') {
                    setTelemetryEnabled(true);
                    sysMsg('Telemetry enabled. Anonymous usage data will be collected.');
                    return;
                }
                if (tSub === 'off') {
                    setTelemetryEnabled(false);
                    sysMsg('Telemetry disabled. No data will be collected.');
                    return;
                }
                const cfg = getTelemetryConfig();
                sysMsg(`Telemetry Configuration\n` +
                    `  Enabled:     ${cfg.enabled ? 'yes' : 'no'}\n` +
                    `  AnonymousID: ${cfg.anonymousId}\n` +
                    `  Version:     ${cfg.version}\n` +
                    `  Platform:    ${cfg.platform}\n` +
                    `  Node:        ${cfg.nodeVersion}\n\n` +
                    `Usage: /telemetry on|off`);
                return;
            }
            case '/rate-limit': {
                trackCommand(cmd, args);
                const rl = rateLimiterRef.current;
                const stats = rl.getUsageStats();
                const costCheck = rl.checkCostLimit(session.sessionCost);
                sysMsg(`Rate Limit Status\n` +
                    `  Requests/min:    ${stats.requestsThisMinute} / 60\n` +
                    `  Tokens/hour:     ${stats.tokensThisHour.toLocaleString()} / 100,000\n` +
                    `  Tokens remaining: ${stats.hourRemaining.toLocaleString()}\n` +
                    `  Session cost:    $${session.sessionCost.toFixed(4)} ${costCheck.allowed ? '✓' : `⚠ ${costCheck.reason}`}\n\n` +
                    `Limits: 60 req/min, 100k tokens/hr, $10/session`);
                return;
            }
            case '/benchmarks': {
                trackCommand(cmd, args);
                sysMsg('Running benchmarks…');
                setMood('thinking');
                try {
                    const results = await runAllBenchmarks();
                    const report = results.map(r => formatBenchmark(r)).join('\n\n');
                    const reportPath = path.join(session.workingDir, 'benchmarks.md');
                    fs.writeFileSync(reportPath, generateBenchmarkReport(results), 'utf8');
                    sysMsg(`Benchmarks complete!\n\n${report}\n\nReport saved to ${reportPath}`);
                }
                catch (err) {
                    sysMsg(`Benchmarks failed: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                setMood('idle');
                return;
            }
            // ──────────────────────────────────────────────────────────────────────
            // v4: NUCLEAR FEATURES
            // ──────────────────────────────────────────────────────────────────────
            case '/budget': {
                trackCommand(cmd, args);
                if (!args || args === '') {
                    const limit = session.budgetLimit !== null ? `$${session.budgetLimit.toFixed(2)}` : 'none';
                    const fallback = session.budgetFallbackModel ?? PROVIDERS.ollama.defaultModel;
                    sysMsg(`Budget: limit=${limit}  spent=$${session.sessionCost.toFixed(4)}  fallback=${fallback}\nUsage: /budget 5.00 [fallback-model]  |  /budget off`);
                    return;
                }
                if (args === 'off') {
                    setSession((s) => ({ ...s, budgetLimit: null, budgetFallbackModel: null }));
                    sysMsg('Budget limit removed.');
                    return;
                }
                const budgetParts = args.split(/\s+/);
                const amount = parseFloat(budgetParts[0]);
                if (isNaN(amount) || amount <= 0) {
                    sysMsg('Usage: /budget <amount> [fallback-model]', true);
                    return;
                }
                const fallbackModel = budgetParts[1] ?? PROVIDERS.ollama.defaultModel;
                setSession((s) => ({ ...s, budgetLimit: amount, budgetFallbackModel: fallbackModel }));
                sysMsg(`Budget set: $${amount.toFixed(2)} — will switch to ${fallbackModel} when reached.`);
                return;
            }
            case '/routing': {
                trackCommand(cmd, args);
                if (!args || args === '') {
                    const r = session.modelRouting;
                    if (!r) {
                        sysMsg('No routing configured. Usage: /routing planning=<model> execution=<model> review=<model>  |  /routing clear');
                        return;
                    }
                    sysMsg(`Routing: planning=${r.planning ?? '(default)'}  execution=${r.execution ?? '(default)'}  review=${r.review ?? '(default)'}`);
                    return;
                }
                if (args === 'clear') {
                    setSession((s) => ({ ...s, modelRouting: null }));
                    sysMsg('Model routing cleared — using single model for all steps.');
                    return;
                }
                const routing = { planning: null, execution: null, review: null };
                for (const pair of args.split(/\s+/)) {
                    const [k, v] = pair.split('=');
                    if (k === 'planning' && v)
                        routing.planning = v;
                    else if (k === 'execution' && v)
                        routing.execution = v;
                    else if (k === 'review' && v)
                        routing.review = v;
                }
                setSession((s) => ({ ...s, modelRouting: routing }));
                sysMsg(`Routing configured: planning=${routing.planning ?? '(default)'}  execution=${routing.execution ?? '(default)'}  review=${routing.review ?? '(default)'}`);
                return;
            }
            case '/safe': {
                trackCommand(cmd, args);
                const safeArg = args.toLowerCase();
                const newSafe = safeArg === 'on' ? true : safeArg === 'off' ? false : !session.safeMode;
                setSession((s) => ({ ...s, safeMode: newSafe }));
                sysMsg(newSafe
                    ? '⊛  Safe mode ON — changes will be stashed before edits; reverted if tests fail.'
                    : '⊛  Safe mode OFF.');
                return;
            }
            case '/dna': {
                trackCommand(cmd, args);
                sysMsg('⌬  Analyzing git history to extract your coding DNA…');
                setMood('thinking');
                try {
                    const gitLog = await new Promise((res) => {
                        execFile('git', ['log', '-p', '--no-merges', '--since=90 days ago', '--', '*.ts', '*.tsx', '*.js', '*.py', '*.go', '*.rs'], { cwd: session.workingDir, timeout: 15000 }, (err, out) => res(err ? '' : out.slice(0, 14000)));
                    });
                    if (!gitLog.trim()) {
                        sysMsg('⌬  Not enough git history to extract DNA. Make some commits first.', true);
                        setMood('idle');
                        return;
                    }
                    const prompt = `Analyze this git diff history. Extract and summarize in a short markdown section (200 words max) the coding style patterns to give an AI coding assistant:\n- Naming conventions (variables, functions, files)\n- Comment style and density\n- Preferred patterns and idioms\n- Error handling approach\n- Test structure\n\nGit history:\n\`\`\`\n${gitLog}\n\`\`\`\n\nRespond with ONLY the markdown section, no preamble.`;
                    let dnaText = '';
                    const dnaId = addDisplay({ role: 'assistant', content: '', streaming: true });
                    await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: prompt }], (c) => { if (c.text) {
                        dnaText += c.text;
                        updateDisplay(dnaId, { content: dnaText, streaming: true });
                    } });
                    updateDisplay(dnaId, { content: dnaText, streaming: false });
                    setSession((s) => ({ ...s, dna: dnaText, pinnedContext: [`[Codebase DNA]\n${dnaText}`, ...s.pinnedContext.filter((p) => !p.startsWith('[Codebase DNA]'))] }));
                    sysMsg('⌬  DNA extracted and pinned to context. Nyx will now match your coding style.');
                }
                catch (err) {
                    sysMsg(`⌬  DNA failed: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                setMood('idle');
                return;
            }
            case '/chaos': {
                trackCommand(cmd, args);
                sysMsg('⚡  Chaos mode activated. Nyx will hunt for improvements unsolicited…');
                const chaosPersona = session.personas.find((p) => p.name === 'chaos-refactor');
                const chaosPrompt = chaosPersona?.prompt ?? '';
                await sendMessage(`${chaosPrompt}\n\nBegin your sweep of the codebase at: ${session.workingDir}`);
                return;
            }
            case '/evolve': {
                trackCommand(cmd, args);
                if (session.messages.length < 4) {
                    sysMsg('Need at least a few messages to evolve from.', true);
                    return;
                }
                sysMsg('↑  Analyzing session to extract learnings for .nyx.md…');
                setMood('thinking');
                const lastMsgs = session.messages.slice(-30).map((m) => `${m.role}: ${m.content.slice(0, 400)}`).join('\n\n');
                const evolvePrompt = `You are reviewing a coding assistant session. Identify patterns to remember:\n1. What approaches worked well and should be repeated\n2. What the user had to correct (anti-patterns to avoid)\n3. Project-specific conventions discovered\n\nOutput ONLY a concise markdown section (max 150 words) to append to a .nyx.md config file. Start with "## Evolved — ${new Date().toISOString().slice(0, 10)}"\n\nSession:\n${lastMsgs}`;
                let evolved = '';
                await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: evolvePrompt }], (c) => { if (c.text)
                    evolved += c.text; });
                if (evolved.trim()) {
                    const nyxPath = path.join(session.workingDir, '.nyx.md');
                    const existing = fs.existsSync(nyxPath) ? fs.readFileSync(nyxPath, 'utf8') : '';
                    fs.writeFileSync(nyxPath, `${existing}\n\n${evolved.trim()}\n`, 'utf8');
                    sysMsg(`↑  Appended learnings to .nyx.md`);
                    addDisplay({ role: 'assistant', content: evolved.trim(), streaming: false });
                }
                setMood('idle');
                return;
            }
            case '/swarm': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /swarm "task description" [N]  (N defaults to 3)', true);
                    return;
                }
                const swarmMatch = args.match(/^"([^"]+)"\s*(\d+)?$/) ?? args.match(/^(.+?)\s+(\d+)?$/);
                const swarmTask = swarmMatch?.[1]?.trim() ?? args;
                const swarmN = parseInt(swarmMatch?.[2] ?? '3', 10);
                sysMsg(`⇶  Spawning swarm of ${swarmN} parallel agents for: "${swarmTask}"`);
                setMood('thinking');
                setIsStreaming(true);
                try {
                    const results = await runSwarm(swarmTask, swarmN, {
                        provider: session.provider, apiKeys: session.apiKeys, model: session.model,
                        systemPrompt: session.systemPrompt, workingDir: session.workingDir,
                        maxStepsPerAgent: Math.ceil(session.maxSteps / swarmN),
                        onProgress: (t) => sysMsg(`⇶  Agent ${t.index + 1} done in ${(t.durationMs / 1000).toFixed(1)}s${t.error ? ' (error)' : ''}`),
                    });
                    const summary = results.map((r, i) => `### Agent ${i + 1}: ${r.subtask}\n${r.error ? `Error: ${r.error}` : r.output.slice(0, 500)}`).join('\n\n---\n\n');
                    addDisplay({ role: 'assistant', content: `## Swarm Complete\n\n${summary}`, streaming: false });
                }
                catch (err) {
                    sysMsg(`Swarm error: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                finally {
                    setIsStreaming(false);
                    setMood('idle');
                }
                return;
            }
            case '/test-loop': {
                trackCommand(cmd, args);
                const maxIter = parseInt(args || '5', 10);
                const testCmd = await detectTestCommand(session.workingDir);
                if (!testCmd) {
                    sysMsg('Could not detect test runner. Supported: npm test, vitest, jest, pytest, cargo test, go test.', true);
                    return;
                }
                sysMsg(`↻  Fix-until-green loop (max ${maxIter} iterations) using: ${testCmd}`);
                setMood('thinking');
                setIsStreaming(true);
                try {
                    const { passed, iterations } = await runTestLoop(testCmd, {
                        cwd: session.workingDir,
                        maxIterations: maxIter,
                        onIteration: (iter) => {
                            const icon = iter.passed ? '✓' : '✗';
                            sysMsg(`↻  Iteration ${iter.iteration}: ${icon} ${iter.passed ? 'PASS' : 'FAIL'} (${(iter.durationMs / 1000).toFixed(1)}s)`);
                        },
                    }, async (failures, iter) => {
                        await sendMessage(`Tests failed (iteration ${iter}). Fix the failures:\n\n${failures.slice(0, 3000)}`);
                    });
                    sysMsg(passed ? `✓  All tests passing after ${iterations} iteration${iterations > 1 ? 's' : ''}!` : `✗  Tests still failing after ${maxIter} iterations. Use /test-loop <N> with a higher number.`);
                }
                catch (err) {
                    sysMsg(`test-loop error: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                finally {
                    setIsStreaming(false);
                    setMood('idle');
                }
                return;
            }
            case '/autopilot': {
                trackCommand(cmd, args);
                const apArg = args.toLowerCase();
                if (apArg === 'off' || (apArg === '' && session.autopilotActive)) {
                    autopilotWatcherRef.current?.close();
                    autopilotWatcherRef.current = null;
                    setSession((s) => ({ ...s, autopilotActive: false }));
                    sysMsg('⬡  Autopilot stopped.');
                    return;
                }
                if (session.autopilotActive) {
                    sysMsg('⬡  Autopilot already running. Use /autopilot off to stop.');
                    return;
                }
                const apTestCmd = await detectTestCommand(session.workingDir);
                sysMsg(`⬡  Autopilot started. Watching ${session.workingDir} for changes${apTestCmd ? `, running: ${apTestCmd}` : ' (no test runner found, will commit on any change)'}…`);
                setSession((s) => ({ ...s, autopilotActive: true }));
                let apDebounce = null;
                autopilotWatcherRef.current = fs.watch(session.workingDir, { recursive: true }, (_event, filename) => {
                    if (!filename || filename.includes('.git') || filename.includes('node_modules'))
                        return;
                    if (apDebounce)
                        clearTimeout(apDebounce);
                    apDebounce = setTimeout(async () => {
                        try {
                            let shouldCommit = true;
                            if (apTestCmd) {
                                const { passed } = await import('../agents/testloop.js').then((m) => m.runTests(apTestCmd, session.workingDir));
                                shouldCommit = passed;
                                if (!passed) {
                                    sysMsg(`⬡  Autopilot: ${filename} changed, tests failed — not committing.`);
                                    return;
                                }
                            }
                            if (shouldCommit) {
                                const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
                                await executorRef.current.execute({ name: 'git_operation', args: { args: 'add -A' } });
                                const commitRes = await executorRef.current.execute({ name: 'git_operation', args: { args: `commit -m "autopilot: ${ts} — ${filename}"` } });
                                if (commitRes.success)
                                    sysMsg(`⬡  Autopilot: committed changes triggered by ${filename}`);
                            }
                        }
                        catch (err) {
                            logger.error('Non-critical operation failed', { error: err instanceof Error ? err.message : String(err) });
                        }
                    }, 2000);
                });
                return;
            }
            case '/benchmark': {
                trackCommand(cmd, args);
                if (!args) {
                    sysMsg('Usage: /benchmark "prompt to test across all providers"', true);
                    return;
                }
                const benchPrompt = args.replace(/^"|"$/g, '');
                const targets = buildTargets(session.apiKeys);
                if (targets.length === 0) {
                    sysMsg('No providers configured. Set API keys with /apikey first.', true);
                    return;
                }
                sysMsg(`⊞  Benchmarking "${benchPrompt.slice(0, 60)}…" across ${targets.length} provider(s)…`);
                setMood('thinking');
                setIsStreaming(true);
                const benchResults = [];
                try {
                    await runBenchmark(benchPrompt, targets, session.apiKeys, (r) => {
                        benchResults.push({ provider: r.provider, model: r.model, latencyMs: r.latencyMs, cost: r.estimatedCostUSD, preview: r.response.slice(0, 200) });
                        sysMsg(`⊞  ${r.provider}/${r.model}: ${(r.latencyMs / 1000).toFixed(2)}s  $${r.estimatedCostUSD.toFixed(5)}`);
                    });
                    const table = benchResults
                        .sort((a, b) => a.latencyMs - b.latencyMs)
                        .map((r, i) => `${i + 1}. **${r.provider}/${r.model}**  ${(r.latencyMs / 1000).toFixed(2)}s  $${r.cost.toFixed(5)}\n   > ${r.preview.replace(/\n/g, ' ').slice(0, 120)}`)
                        .join('\n\n');
                    addDisplay({ role: 'assistant', content: `## Benchmark Results\n\n${table}`, streaming: false });
                }
                catch (err) {
                    sysMsg(`Benchmark error: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                finally {
                    setIsStreaming(false);
                    setMood('idle');
                }
                return;
            }
            case '/privacy': {
                trackCommand(cmd, args);
                const log = session.providerCallLog;
                if (log.length === 0) {
                    sysMsg('No provider calls recorded this session.');
                    return;
                }
                const byProvider = new Map();
                for (const entry of log) {
                    const key = `${entry.provider}/${entry.model}`;
                    const cur = byProvider.get(key) ?? { calls: 0, tokens: 0, cost: 0 };
                    byProvider.set(key, {
                        calls: cur.calls + 1,
                        tokens: cur.tokens + entry.estimatedTokens,
                        cost: cur.cost + estimateCost(entry.model, Math.floor(entry.estimatedTokens * 0.7), Math.floor(entry.estimatedTokens * 0.3)),
                    });
                }
                const local = new Set(['ollama']);
                let report = `## Privacy Report — This Session\n\n`;
                for (const [key, stats] of byProvider) {
                    const isLocal = local.has(key.split('/')[0]);
                    report += `**${key}** ${isLocal ? '🔒 local' : '☁ cloud'}\n`;
                    report += `  Calls: ${stats.calls}  Tokens sent: ~${stats.tokens.toLocaleString()}  Est. cost: $${stats.cost.toFixed(5)}\n\n`;
                }
                const cloudKeys = [...byProvider.keys()].filter((k) => !local.has(k.split('/')[0]));
                if (cloudKeys.length === 0) {
                    report += `✓ All requests stayed local this session.`;
                }
                else {
                    report += `⚠  ${cloudKeys.length} cloud provider(s) received data: ${cloudKeys.join(', ')}`;
                }
                addDisplay({ role: 'assistant', content: report, streaming: false });
                return;
            }
            case '/share-state': {
                trackCommand(cmd, args);
                const stateExport = {
                    version: pkg.version,
                    exportedAt: new Date().toISOString(),
                    provider: session.provider,
                    model: session.model,
                    messages: session.messages,
                    checkpoints: session.checkpoints,
                    pinnedContext: session.pinnedContext,
                    systemPrompt: session.systemPrompt,
                    activePersona: session.activePersona,
                    workingDir: session.workingDir,
                };
                const outFile = args ? path.resolve(session.workingDir, args.endsWith('.json') ? args : `${args}.json`) : path.join(session.workingDir, `nyx-session-${Date.now()}.json`);
                try {
                    fs.writeFileSync(outFile, JSON.stringify(stateExport, null, 2), 'utf8');
                    sysMsg(`Session exported to ${outFile}. Share this file — recipient runs /share-state import <file> to restore.`);
                }
                catch (err) {
                    sysMsg(`Export failed: ${err instanceof Error ? err.message : String(err)}`, true);
                }
                return;
            }
            case '/agent': {
                trackCommand(cmd, args);
                if (!args) {
                    setShowAgentPicker(true);
                    setAgentPickerQuery('');
                    setAgentPickerSelectedIndex(0);
                    setInput('/agent ');
                    return;
                }
                const registry = getAgentRegistry();
                const agent = registry.getAgent(args.toLowerCase().replace(/[^a-z0-9-]/g, '')) ||
                    registry.searchAgents(args)[0];
                if (!agent) {
                    sysMsg(`Agent not found: "${args}". Use /agents to list all available agents.`, true);
                    return;
                }
                setActiveAgent(agent);
                const enhancedPrompt = `${session.systemPrompt}\n\n---\nActive Agent: ${agent.name}\n${agent.vibe ? `Vibe: ${agent.vibe}\n` : ''}${agent.prompt}`;
                setSession((s) => ({ ...s, systemPrompt: enhancedPrompt }));
                sysMsg(`🤖 Agent activated: ${agent.emoji || '🤖'} ${agent.name}\n${agent.description}\n${agent.vibe ? `Vibe: ${agent.vibe}` : ''}`);
                return;
            }
            case '/agents': {
                trackCommand(cmd, args);
                const registry = getAgentRegistry();
                if (args) {
                    const filtered = registry.searchAgents(args);
                    if (!filtered.length) {
                        sysMsg(`No agents found matching "${args}".`, true);
                        return;
                    }
                    const list = filtered.map((a) => `  ${a.emoji || '🤖'} ${a.name.padEnd(30)} ${a.description.slice(0, 50)}`).join('\n');
                    sysMsg(`Agents matching "${args}" (${filtered.length}):\n${list}\n\nUse /agent <name> to activate.`);
                    return;
                }
                let report = `🤖 Available Agents (${registry.allAgents.length} total):\n\n`;
                for (const cat of registry.categories) {
                    if (cat.agents.length === 0)
                        continue;
                    report += `${cat.emoji} ${cat.name.toUpperCase()} (${cat.agents.length}):\n`;
                    for (const agent of cat.agents.slice(0, 10)) {
                        report += `  ${agent.emoji || '🤖'} ${agent.name.padEnd(30)} ${agent.description.slice(0, 40)}\n`;
                    }
                    if (cat.agents.length > 10)
                        report += `  ... and ${cat.agents.length - 10} more\n`;
                    report += '\n';
                }
                report += 'Use /agent <name> to activate an agent.\nUse /agents <query> to search.';
                addDisplay({ role: 'assistant', content: report, streaming: false });
                return;
            }
            case '/orchestrate': {
                trackCommand(cmd, args);
                const parts = args.split(/\s+/);
                const task = parts.slice(0, -1).join(' ') || args;
                const mode = (parts[parts.length - 1]?.toLowerCase() || 'sprint');
                const orchestrator = getOrchestrator();
                const agents = orchestrator.getAvailableAgents();
                const primaryAgent = agents.find(a => a.id.includes('architect') || a.id.includes('senior')) || agents[0];
                const supportingAgents = agents.slice(1, 6).map(a => a.id);
                sysMsg(`🎛️ Starting NEXUS ${mode.toUpperCase()} orchestration...\nTask: ${task}\nPrimary Agent: ${primaryAgent?.name}\nSupporting: ${supportingAgents.length} agents`);
                setIsStreaming(true);
                setMood('thinking');
                orchestrator.runOrchestration({
                    mode,
                    primaryAgent: primaryAgent?.id || 'unknown',
                    supportingAgents,
                    maxRetries: 3,
                    qualityGates: true,
                }, task, session.provider, session.apiKeys, session.model, session.workingDir, session.systemPrompt, session.maxSteps).then((state) => {
                    const status = `🎛️ Orchestration ${state.qualityGatePassed ? '✅ COMPLETE' : '⚠️ NEEDS WORK'}\nPhase: ${state.phase}\nCompleted: ${state.completedTasks.length}\nFailed: ${state.failedTasks.length}\nDuration: ${((Date.now() - state.startTime) / 1000).toFixed(1)}s`;
                    sysMsg(status);
                    setIsStreaming(false);
                    setMood('idle');
                    // Show synthesis if available
                    const synthesis = state.completedTasks.find(t => t.agentId === 'synthesis');
                    if (synthesis) {
                        addDisplay({ role: 'assistant', content: `## 🎛️ NEXUS Synthesis\n\n${synthesis.output}`, streaming: false });
                    }
                    // Show all task results
                    for (const t of state.completedTasks.filter(t => t.agentId !== 'synthesis')) {
                        addDisplay({
                            role: 'assistant',
                            content: `## ${t.agentName}\n\n${t.output.slice(0, 2000)}${t.output.length > 2000 ? '\n\n... (truncated)' : ''}`,
                            streaming: false,
                        });
                    }
                }).catch((err) => {
                    sysMsg(`Orchestration failed: ${err instanceof Error ? err.message : String(err)}`, true);
                    setIsStreaming(false);
                    setMood('error');
                });
                return;
            }
            case '/nexus': {
                trackCommand(cmd, args);
                const parts = args.split(/\s+/);
                const task = parts.slice(0, -1).join(' ') || args;
                const mode = (parts[parts.length - 1]?.toLowerCase() || 'full');
                const orchestrator = getOrchestrator();
                const allAgents = orchestrator.getAvailableAgents();
                const phases = mode === 'full'
                    ? ['Phase 0: Discovery', 'Phase 1: Strategy', 'Phase 2: Foundation', 'Phase 3: Build', 'Phase 4: Hardening', 'Phase 5: Launch', 'Phase 6: Operate']
                    : mode === 'sprint'
                        ? ['Phase 1: Strategy', 'Phase 2: Foundation', 'Phase 3: Build', 'Phase 4: Hardening']
                        : ['Phase 3: Build'];
                let report = `🌐 NEXUS ${mode.toUpperCase()} Pipeline Activated\n\n`;
                report += `Task: ${task}\n`;
                report += `Phases: ${phases.length}\n`;
                report += `Available Agents: ${allAgents.length}\n\n`;
                report += `Pipeline:\n`;
                for (let i = 0; i < phases.length; i++) {
                    report += `  ${i + 1}. ${phases[i]}\n`;
                }
                report += `\nQuality gates enforced between each phase.\nDev↔QA loops running for all implementation tasks.\n`;
                addDisplay({ role: 'assistant', content: report, streaming: false });
                setIsStreaming(true);
                setMood('thinking');
                orchestrator.runOrchestration({
                    mode,
                    primaryAgent: allAgents.find(a => a.id.includes('orchestrator'))?.id || allAgents[0]?.id || 'unknown',
                    supportingAgents: allAgents.slice(0, 6).map(a => a.id),
                    maxRetries: 3,
                    qualityGates: true,
                }, task, session.provider, session.apiKeys, session.model, session.workingDir, session.systemPrompt, session.maxSteps).then((state) => {
                    const status = `🌐 NEXUS Pipeline ${state.qualityGatePassed ? '✅ COMPLETE' : '⚠️ NEEDS WORK'}\nPhase: ${state.phase}\nCompleted: ${state.completedTasks.length}\nFailed: ${state.failedTasks.length}\nDuration: ${((Date.now() - state.startTime) / 1000).toFixed(1)}s`;
                    sysMsg(status);
                    setIsStreaming(false);
                    setMood('idle');
                    const synthesis = state.completedTasks.find(t => t.agentId === 'synthesis');
                    if (synthesis) {
                        addDisplay({ role: 'assistant', content: `## 🌐 NEXUS Synthesis\n\n${synthesis.output}`, streaming: false });
                    }
                }).catch((err) => {
                    sysMsg(`NEXUS pipeline failed: ${err instanceof Error ? err.message : String(err)}`, true);
                    setIsStreaming(false);
                    setMood('error');
                });
                return;
            }
            default:
                sysMsg(`Unknown command: ${cmd}. Type / to see all commands.`, true);
        }
    }, [session, sysMsg, addDisplay, updateDisplay, exit, sendMessage, isStreaming]);
    // ── Input handling ────────────────────────────────────────────────────────────
    const handleInputChange = useCallback((val) => {
        setInput(val);
        if (val.startsWith('/agent ')) {
            const query = val.slice(7);
            setAgentPickerQuery(query);
            setShowAgentPicker(true);
            setShowPicker(false);
            setAgentPickerSelectedIndex(0);
        }
        else if (val.startsWith('/')) {
            const query = val.slice(1);
            setPickerQuery(query);
            setShowPicker(true);
            setShowAgentPicker(false);
            setPickerSelectedIndex(0);
        }
        else {
            setShowPicker(false);
            setShowAgentPicker(false);
            setPickerQuery('');
            setAgentPickerQuery('');
        }
    }, []);
    const handleSubmit = useCallback(async (val) => {
        // If in multiline mode, Enter appends to buffer (don't submit)
        if (isMultiline) {
            setMultilineBuffer((prev) => [...prev, input]);
            setInput('');
            return;
        }
        const v = val.trim();
        if (!v)
            return;
        if (showPicker) {
            // Select the highlighted command from filtered list
            const qLower = pickerQuery.toLowerCase();
            const filtered = qLower
                ? SLASH_COMMANDS.filter((c) => c.name.startsWith(qLower) || c.description.toLowerCase().includes(qLower) || c.trigger.includes(qLower))
                : SLASH_COMMANDS;
            const selected = filtered[Math.min(pickerSelectedIndex, filtered.length - 1)];
            if (selected) {
                setInput('');
                setShowPicker(false);
                setPickerQuery('');
                await handleSlashCommand(selected.trigger);
                return;
            }
        }
        if (v.startsWith('/')) {
            setShowPicker(false);
            setPickerQuery('');
            await handleSlashCommand(v);
            return;
        }
        await sendMessage(v);
    }, [isMultiline, input, showPicker, pickerQuery, pickerSelectedIndex, handleSlashCommand, sendMessage]);
    useInput((inputChar, key) => {
        // Permission prompt input
        if (pendingPermission) {
            if (inputChar === 'y')
                pendingPermission.resolve(true, false);
            else if (inputChar === 'a')
                pendingPermission.resolve(true, true);
            else if (inputChar === 'n')
                pendingPermission.resolve(false, false);
            return;
        }
        // Pending test fix prompt
        if (pendingTestFix !== null) {
            if (inputChar === 'y' || inputChar === 'Y') {
                const testOutput = pendingTestFix;
                setPendingTestFix(null);
                sendMessage(`Tests failed. Please fix the following test failures:\n\n${testOutput.slice(0, 4000)}`);
            }
            else {
                setPendingTestFix(null);
            }
            return;
        }
        // Ctrl+E — toggle multiline mode
        if (key.ctrl && inputChar === 'e' && !isStreaming && !pendingPermission) {
            if (isMultiline) {
                // Exit multiline, discard buffer
                setIsMultiline(false);
                setMultilineBuffer([]);
                setInput('');
                sysMsg('Multiline mode cancelled.');
            }
            else {
                setIsMultiline(true);
                setMultilineBuffer([]);
                sysMsg('Multiline mode — Enter adds line, Ctrl+D sends, Ctrl+E cancels.');
            }
            return;
        }
        // Ctrl+D in multiline — submit
        if (key.ctrl && inputChar === 'd' && isMultiline && !isStreaming) {
            const fullText = [...multilineBuffer, input].join('\n').trim();
            if (fullText) {
                setIsMultiline(false);
                setMultilineBuffer([]);
                setInput('');
                sendMessage(fullText);
            }
            return;
        }
        // Escape — cancel streaming or close picker
        if (key.escape) {
            if (isStreaming) {
                abortRef.current?.abort();
                return;
            }
            if (showPicker) {
                setShowPicker(false);
                setInput('');
                return;
            }
        }
        // Picker navigation
        if (showPicker) {
            const filtered = pickerQuery
                ? SLASH_COMMANDS.filter((c) => c.name.startsWith(pickerQuery) || c.description.toLowerCase().includes(pickerQuery))
                : SLASH_COMMANDS;
            if (key.upArrow) {
                setPickerSelectedIndex((i) => Math.max(0, i - 1));
                return;
            }
            if (key.downArrow) {
                setPickerSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
                return;
            }
            if (key.return) {
                const selected = filtered[pickerSelectedIndex];
                if (selected) {
                    setInput('');
                    setShowPicker(false);
                    handleSlashCommand(selected.trigger);
                }
                return;
            }
        }
        // Shell history navigation (only when not in picker)
        if (!showPicker) {
            if (key.upArrow && !isStreaming) {
                const newIndex = Math.min(historyIndex + 1, history.length - 1);
                setHistoryIndex(newIndex);
                setInput(history[newIndex] ?? '');
                return;
            }
            if (key.downArrow && !isStreaming) {
                const newIndex = Math.max(historyIndex - 1, -1);
                setHistoryIndex(newIndex);
                setInput(newIndex === -1 ? '' : history[newIndex]);
                return;
            }
        }
        if (key.ctrl && inputChar === 'c') {
            try {
                saveSession(session);
            }
            catch (err) {
                logger.error('Exit cleanup failed', { error: err instanceof Error ? err.message : String(err) });
            }
            exit();
        }
    });
    // ── Render ────────────────────────────────────────────────────────────────────
    const termHeight = stdout?.rows ?? 24;
    const maxMessages = Math.max(5, termHeight - 12);
    const borderColor = isStreaming ? 'gray' : isMultiline ? theme.tool : theme.border;
    return (React.createElement(ErrorBoundary, { onExit: exit },
        React.createElement(Box, { flexDirection: "column", height: termHeight },
            React.createElement(NyxHeader, { mood: mood, provider: session.provider, model: session.model, workingDir: session.workingDir, tokenCount: estimateTokens(session.messages), approvalMode: session.approvalMode, persona: session.activePersona, sessionCost: session.sessionCost, version: pkg.version, liveTokens: isStreaming ? streamingTokens : undefined }),
            React.createElement(Box, { flexDirection: "column", flexGrow: 1, overflowY: "hidden" }, displayMessages.slice(-maxMessages).map((msg) => (React.createElement(MessageRow, { key: msg.id, msg: msg, spinnerFrame: spinnerFrame, theme: theme })))),
            pendingPermission && (React.createElement(PermissionPrompt, { toolCall: pendingPermission.toolCall })),
            showPicker && (React.createElement(CommandPicker, { query: pickerQuery, selectedIndex: pickerSelectedIndex, onSelect: (cmd) => {
                    setInput('');
                    setShowPicker(false);
                    handleSlashCommand(cmd.trigger);
                }, onDismiss: () => { setShowPicker(false); setInput(''); } })),
            showAgentPicker && (() => {
                const registry = getAgentRegistry();
                return (React.createElement(AgentPicker, { categories: registry.categories, allAgents: registry.allAgents, query: agentPickerQuery, selectedIndex: agentPickerSelectedIndex, onSelect: (agent) => {
                        setActiveAgent(agent);
                        const enhancedPrompt = `${session.systemPrompt}\n\n---\nActive Agent: ${agent.name}\n${agent.vibe ? `Vibe: ${agent.vibe}\n` : ''}${agent.prompt}`;
                        setSession((s) => ({ ...s, systemPrompt: enhancedPrompt }));
                        setShowAgentPicker(false);
                        setInput('');
                        sysMsg(`🤖 Agent activated: ${agent.emoji || '🤖'} ${agent.name}\n${agent.description}`);
                    }, onDismiss: () => { setShowAgentPicker(false); setInput(''); } }));
            })(),
            React.createElement(Box, { borderStyle: "round", borderColor: borderColor, paddingX: 1, flexDirection: "row" },
                React.createElement(Text, { color: borderColor }, isStreaming ? `${SPINNER_FRAMES[spinnerFrame]} ` : isMultiline ? '¶ ' : '❯ '),
                isMultiline ? (React.createElement(Box, { flexDirection: "column" },
                    multilineBuffer.map((line, i) => (React.createElement(Box, { key: i, flexDirection: "row" },
                        React.createElement(Text, { color: "gray", dimColor: true },
                            String(i + 1).padStart(2, ' '),
                            " \u2502 "),
                        React.createElement(Text, { color: "white", wrap: "wrap" }, line)))),
                    React.createElement(Box, { flexDirection: "row" },
                        React.createElement(Text, { color: "gray", dimColor: true },
                            String(multilineBuffer.length + 1).padStart(2, ' '),
                            " \u2502 "),
                        React.createElement(TextInput, { value: input, onChange: handleInputChange, onSubmit: handleSubmit, placeholder: "\u2026" })),
                    React.createElement(Text, { color: "gray", dimColor: true }, "  ctrl+d send  ctrl+e cancel"))) : isStreaming ? (React.createElement(Text, { color: "gray", dimColor: true }, "Generating\u2026")) : (React.createElement(TextInput, { value: input, onChange: handleInputChange, onSubmit: handleSubmit, placeholder: "Message Nyx\u2026  (/ for commands)" }))),
            React.createElement(Box, { flexDirection: "row", justifyContent: "space-between" },
                React.createElement(Text, { color: "gray", dimColor: true }, '  ctrl+c exit  esc cancel  ctrl+e multiline  / commands  @file context  ↑↓ history'),
                input.length > 50 && (React.createElement(Text, { color: input.length > 2000 ? 'yellow' : 'gray', dimColor: true }, `${input.length}c  `))))));
}
function MessageRow({ msg, spinnerFrame, theme, }) {
    const roleColors = {
        user: theme.primary,
        assistant: theme.accent,
        system: theme.system,
        tool: theme.tool,
    };
    const roleIcons = {
        user: '❯ ',
        assistant: '◈ ',
        system: '· ',
        tool: msg.streaming ? `${SPINNER_FRAMES[spinnerFrame]} ` : '⟳ ',
    };
    const color = msg.isError ? theme.error : roleColors[msg.role] ?? 'white';
    const icon = roleIcons[msg.role] ?? '  ';
    // Render assistant messages with markdown
    if (msg.role === 'assistant' && msg.content) {
        return (React.createElement(Box, { flexDirection: "row", marginBottom: 0 },
            React.createElement(Text, { color: theme.accent }, icon),
            React.createElement(Box, { flexGrow: 1, flexDirection: "column" },
                React.createElement(MarkdownText, { content: msg.content, streaming: msg.streaming }))));
    }
    const timeStr = msg.timestamp
        ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        : null;
    // Tool calls — show as compact inline box (truncated, max 200 chars shown)
    if (msg.role === 'tool') {
        const displayContent = msg.content;
        return (React.createElement(Box, { flexDirection: "row", marginBottom: 0 },
            React.createElement(Text, { color: theme.tool, dimColor: true }, icon),
            React.createElement(Text, { color: msg.isError ? theme.error : theme.tool, dimColor: !msg.isError, wrap: "wrap" },
                displayContent,
                msg.streaming && React.createElement(Text, { color: "gray" }, " \u258C")),
            timeStr && React.createElement(Text, { color: "gray", dimColor: true },
                "  ",
                timeStr)));
    }
    return (React.createElement(Box, { flexDirection: "row", marginBottom: 0 },
        React.createElement(Text, { color: color, dimColor: msg.role === 'system' }, icon),
        React.createElement(Box, { flexGrow: 1, flexWrap: "wrap" },
            React.createElement(Text, { color: color, dimColor: msg.role === 'system', wrap: "wrap" },
                msg.content,
                msg.streaming && React.createElement(Text, { color: "gray" }, " \u258C"))),
        timeStr && msg.role === 'system' && React.createElement(Text, { color: "gray", dimColor: true },
            "  ",
            timeStr)));
}
//# sourceMappingURL=App.js.map