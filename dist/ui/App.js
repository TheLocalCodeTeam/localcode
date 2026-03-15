// src/ui/App.tsx
// Main TUI application — Claude Code inspired
import React, { useState, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PROVIDERS, SLASH_COMMANDS, } from '../core/types.js';
import { NyxHeader } from './NyxHeader.js';
import { CommandPicker } from './CommandPicker.js';
import { PermissionPrompt, needsPermission } from './PermissionPrompt.js';
import { streamProvider, listModels, estimateCost } from '../providers/client.js';
import { ToolExecutor } from '../tools/executor.js';
import { saveSession, createCheckpoint, restoreCheckpoint, estimateTokens, } from '../sessions/manager.js';
export function App({ initialState }) {
    const { exit } = useApp();
    const { stdout } = useStdout();
    // ── State ────────────────────────────────────────────────────────────────────
    const [session, setSession] = useState(initialState);
    const [displayMessages, setDisplayMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [mood, setMood] = useState('idle');
    const [showPicker, setShowPicker] = useState(false);
    const [pickerQuery, setPickerQuery] = useState('');
    const [pickerSelectedIndex, setPickerSelectedIndex] = useState(0);
    const [pendingPermission, setPendingPermission] = useState(null);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const executorRef = useRef(new ToolExecutor(initialState.workingDir));
    const streamingIdRef = useRef(null);
    // Compute filtered commands for picker
    const q = pickerQuery.toLowerCase();
    const filteredCommands = q
        ? SLASH_COMMANDS.filter((c) => c.name.startsWith(q) || c.description.toLowerCase().includes(q))
        : SLASH_COMMANDS;
    // ── Helpers ──────────────────────────────────────────────────────────────────
    const addDisplay = useCallback((msg) => {
        const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        setDisplayMessages((prev) => [...prev, { ...msg, id }]);
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
    // ── Slash command handler ─────────────────────────────────────────────────────
    const handleSlashCommand = useCallback(async (raw) => {
        const parts = raw.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');
        switch (cmd) {
            case '/help': {
                setShowPicker(true);
                setPickerQuery('');
                setPickerSelectedIndex(0);
                setInput('/');
                return;
            }
            case '/clear': {
                setDisplayMessages([]);
                setSession((s) => ({ ...s, messages: [] }));
                setMood('idle');
                sysMsg('Conversation cleared.');
                return;
            }
            case '/provider': {
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
                if (!args) {
                    sysMsg(`Current model: ${session.model}\nUsage: /model <model-name>`);
                    return;
                }
                setSession((s) => ({ ...s, model: args }));
                sysMsg(`Model set to: ${args}`);
                return;
            }
            case '/checkpoint': {
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
            case '/commit': {
                setMood('thinking');
                sysMsg('Generating commit message…');
                try {
                    const stdout = await new Promise((res, rej) => {
                        exec('git diff --staged', { cwd: session.workingDir }, (err, out) => {
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
                    exec(`git commit -m "${fullMsg.replace(/"/g, '\\"')}"`, { cwd: session.workingDir }, (err, out) => {
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
            case '/diff': {
                const files = executorRef.current.getSessionFiles();
                const paths = Object.keys(files);
                if (!paths.length) {
                    sysMsg('No files modified in this session.');
                    return;
                }
                sysMsg(`Files modified this session:\n${paths.map((p) => `  ± ${p}`).join('\n')}`);
                return;
            }
            case '/context': {
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
                setSession((s) => ({ ...s, allowAllTools: !s.allowAllTools }));
                sysMsg(`Tool permissions: ${!session.allowAllTools ? 'all allowed (no prompts)' : 'per-call prompts restored'}`);
                return;
            }
            case '/compact': {
                if (!session.messages.length) {
                    sysMsg('No conversation to compact.');
                    return;
                }
                sysMsg('Compacting conversation…');
                setMood('thinking');
                const prompt = `Summarize the following conversation in 3-5 concise sentences, preserving key decisions, code context, and goals:\n\n${session.messages.map((m) => `${m.role}: ${m.content.slice(0, 500)}`).join('\n\n')}`;
                let summary = '';
                await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: prompt }], (chunk) => { if (chunk.text)
                    summary += chunk.text; });
                const summaryMsg = { role: 'system', content: `[Compacted conversation summary]\n${summary}` };
                setSession((s) => ({ ...s, messages: [summaryMsg] }));
                setDisplayMessages([]);
                sysMsg(`Conversation compacted. Summary:\n${summary}`);
                setMood('idle');
                return;
            }
            case '/status': {
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
                    `AllowAll  ${session.allowAllTools ? 'yes' : 'no'}`);
                return;
            }
            case '/sys': {
                if (!args) {
                    sysMsg(`System prompt:\n\n${session.systemPrompt}\n\nPersona: ${session.activePersona ?? 'custom'}\nUsage: /sys <new prompt>`);
                    return;
                }
                setSession((s) => ({ ...s, systemPrompt: args, activePersona: null }));
                sysMsg(`System prompt updated (${args.length} chars). Persona set to custom.`);
                return;
            }
            case '/persona': {
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
                if (!session.lastAssistantMessage) {
                    sysMsg('No response to copy yet.');
                    return;
                }
                try {
                    // Use pbcopy on Mac, xclip/xsel on Linux
                    const clipCmd = process.platform === 'darwin'
                        ? `echo ${JSON.stringify(session.lastAssistantMessage)} | pbcopy`
                        : `echo ${JSON.stringify(session.lastAssistantMessage)} | xclip -selection clipboard 2>/dev/null || echo ${JSON.stringify(session.lastAssistantMessage)} | xsel --clipboard --input`;
                    await new Promise((res, rej) => {
                        exec(clipCmd, (err) => err ? rej(err) : res());
                    });
                    sysMsg(`Copied ${session.lastAssistantMessage.length} chars to clipboard.`);
                }
                catch {
                    sysMsg('Clipboard not available. Here is the last response:\n\n' + session.lastAssistantMessage);
                }
                return;
            }
            case '/export': {
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
            case '/undo': {
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
                if (!args) {
                    sysMsg('Usage: /web <search query>');
                    return;
                }
                sysMsg(`Searching: "${args}"…`);
                setMood('thinking');
                try {
                    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(args)}`;
                    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const text = await res.text();
                    // Extract visible text snippets from results
                    const snippets = [...text.matchAll(/class="result__snippet"[^>]*>([^<]{20,300})</g)]
                        .slice(0, 5)
                        .map((m, i) => `${i + 1}. ${m[1].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim()}`);
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
                    sysMsg('Web search failed. Check your connection.', true);
                }
                setMood('idle');
                return;
            }
            case '/open': {
                if (!args) {
                    sysMsg('Usage: /open <file>');
                    return;
                }
                const editor = process.env.EDITOR || (process.platform === 'darwin' ? 'open' : 'xdg-open');
                exec(`${editor} ${JSON.stringify(args)}`, { cwd: session.workingDir }, (err) => {
                    if (err)
                        sysMsg(`Could not open: ${err.message}`, true);
                    else
                        sysMsg(`Opened ${args} in ${editor}`);
                });
                return;
            }
            case '/models': {
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
            case '/exit': {
                saveSession(session);
                exit();
                return;
            }
            default:
                sysMsg(`Unknown command: ${cmd}. Type / to see all commands.`, true);
        }
    }, [session, sysMsg, addDisplay, exit]);
    // ── Main send handler ─────────────────────────────────────────────────────────
    const sendMessage = useCallback(async (text) => {
        if (!text.trim() || isStreaming)
            return;
        // Add to history
        setHistory((h) => [text, ...h.slice(0, 99)]);
        setHistoryIndex(-1);
        setInput('');
        // Handle @context syntax inline
        let processedText = text;
        const atMatches = text.match(/@[\w./\\-]+/g) ?? [];
        for (const match of atMatches) {
            const p = match.slice(1);
            const result = await executorRef.current.execute({ name: 'read_file', args: { path: p } });
            if (result.success) {
                processedText = processedText.replace(match, `\n\`\`\`${p}\n${result.output}\n\`\`\``);
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
        // Create streaming display message
        const streamId = addDisplay({ role: 'assistant', content: '', streaming: true });
        streamingIdRef.current = streamId;
        let accumulated = '';
        // We need the current session state
        const currentSession = session;
        const run = async () => {
            // Build context: pinned items prepended as a system-style user message
            const pinnedMsg = currentSession.pinnedContext.length
                ? [{ role: 'user', content: `[Pinned context — always relevant]\n${currentSession.pinnedContext.join('\n')}` }]
                : [];
            const msgs = [...pinnedMsg, ...currentSession.messages, userMsg];
            await streamProvider(currentSession.provider, currentSession.apiKeys, currentSession.model, msgs, async (chunk) => {
                switch (chunk.type) {
                    case 'text':
                        accumulated += chunk.text ?? '';
                        updateDisplay(streamId, { content: accumulated, streaming: true });
                        break;
                    case 'tool_call': {
                        const toolCall = chunk.toolCall;
                        updateDisplay(streamId, { content: accumulated, streaming: false });
                        const toolDisplayId = addDisplay({
                            role: 'tool',
                            content: `${toolCall.name}(${Object.entries(toolCall.args)
                                .slice(0, 2)
                                .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
                                .join(', ')})`,
                            toolName: toolCall.name,
                            streaming: true,
                        });
                        // Permission check
                        let allowed = currentSession.allowAllTools;
                        let allowAll = false;
                        if (!allowed && needsPermission(toolCall)) {
                            setMood('waiting');
                            const perm = await requestPermission(toolCall);
                            allowed = perm.allowed;
                            allowAll = perm.allowAll;
                            if (allowAll) {
                                setSession((s) => ({ ...s, allowAllTools: true }));
                            }
                            setMood('thinking');
                        }
                        else {
                            allowed = true;
                        }
                        if (!allowed) {
                            updateDisplay(toolDisplayId, { content: `${toolCall.name} — denied`, streaming: false, isError: true });
                            break;
                        }
                        // Execute
                        const result = await executorRef.current.execute(toolCall);
                        updateDisplay(toolDisplayId, {
                            content: `${toolCall.name} → ${result.success ? result.output.slice(0, 120) : '✕ ' + result.output}`,
                            streaming: false,
                            isError: !result.success,
                        });
                        // Show diff if present
                        if (result.diff) {
                            addDisplay({
                                role: 'system',
                                content: `  ${result.diff.path}  +${result.diff.additions} -${result.diff.deletions}`,
                            });
                        }
                        // Feed result back to model context
                        const toolResultMsg = {
                            role: 'user',
                            content: `Tool result for ${toolCall.name}:\n${result.output.slice(0, 4000)}`,
                        };
                        msgs.push(toolResultMsg);
                        break;
                    }
                    case 'done':
                        updateDisplay(streamId, { streaming: false });
                        if (accumulated.trim()) {
                            const inputTokens = Math.ceil(msgs.reduce((a, m) => a + m.content.length, 0) / 4);
                            const outputTokens = Math.ceil(accumulated.length / 4);
                            const cost = estimateCost(currentSession.model, inputTokens, outputTokens);
                            setSession((s) => {
                                const newMessages = [
                                    ...s.messages,
                                    userMsg,
                                    { role: 'assistant', content: accumulated },
                                ];
                                // Auto-checkpoint every 20 messages
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
                                if (shouldCheckpoint) {
                                    setTimeout(() => sysMsg(`Auto-checkpoint saved at ${newMessages.length} messages.`), 100);
                                }
                                return {
                                    ...s,
                                    messages: newMessages,
                                    lastAssistantMessage: accumulated,
                                    sessionCost: s.sessionCost + cost,
                                    checkpoints,
                                };
                            });
                        }
                        break;
                    case 'error':
                        updateDisplay(streamId, {
                            content: chunk.error ?? 'Unknown error',
                            streaming: false,
                            isError: true,
                        });
                        setMood('error');
                        break;
                }
            }, currentSession.systemPrompt);
        };
        try {
            await run();
        }
        catch (err) {
            updateDisplay(streamId, {
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                streaming: false,
                isError: true,
            });
            setMood('error');
        }
        finally {
            setIsStreaming(false);
            setMood((m) => (m === 'thinking' || m === 'waiting' ? 'idle' : m));
        }
    }, [isStreaming, session, addDisplay, updateDisplay, requestPermission]);
    // ── Input handling ────────────────────────────────────────────────────────────
    const handleInputChange = useCallback((val) => {
        setInput(val);
        if (val.startsWith('/')) {
            const query = val.slice(1); // empty string when just "/"
            setPickerQuery(query);
            setShowPicker(true);
            setPickerSelectedIndex(0);
        }
        else {
            setShowPicker(false);
            setPickerQuery('');
        }
    }, []);
    const handleSubmit = useCallback(async (val) => {
        const v = val.trim();
        if (!v)
            return;
        if (showPicker) {
            // Select the highlighted command from filtered list
            const q = pickerQuery.toLowerCase();
            const filtered = q
                ? SLASH_COMMANDS.filter((c) => c.name.startsWith(q) || c.description.toLowerCase().includes(q) || c.trigger.includes(q))
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
    }, [showPicker, pickerQuery, pickerSelectedIndex, handleSlashCommand, sendMessage]);
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
            if (key.escape) {
                setShowPicker(false);
                setInput('');
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
            saveSession(session);
            exit();
        }
    });
    // ── Render ────────────────────────────────────────────────────────────────────
    const termHeight = stdout?.rows ?? 24;
    const maxMessages = Math.max(5, termHeight - 12);
    return (React.createElement(Box, { flexDirection: "column", height: termHeight },
        React.createElement(NyxHeader, { mood: mood, provider: session.provider, model: session.model, workingDir: session.workingDir, tokenCount: estimateTokens(session.messages), allowAll: session.allowAllTools, persona: session.activePersona, sessionCost: session.sessionCost }),
        React.createElement(Box, { flexDirection: "column", flexGrow: 1, overflowY: "hidden" }, displayMessages.slice(-maxMessages).map((msg) => (React.createElement(MessageRow, { key: msg.id, msg: msg })))),
        pendingPermission && (React.createElement(PermissionPrompt, { toolCall: pendingPermission.toolCall })),
        showPicker && (React.createElement(CommandPicker, { query: pickerQuery, selectedIndex: pickerSelectedIndex, onSelect: (cmd) => {
                setInput('');
                setShowPicker(false);
                handleSlashCommand(cmd.trigger);
            }, onDismiss: () => { setShowPicker(false); setInput(''); } })),
        React.createElement(Box, { borderStyle: "round", borderColor: isStreaming ? 'gray' : 'yellowBright', paddingX: 1, flexDirection: "row" },
            React.createElement(Text, { color: isStreaming ? 'gray' : 'yellowBright' }, isStreaming ? '⟳ ' : '❯ '),
            isStreaming ? (React.createElement(Text, { color: "gray", dimColor: true }, "Generating\u2026")) : (React.createElement(TextInput, { value: input, onChange: handleInputChange, onSubmit: handleSubmit, placeholder: "Message Nyx\u2026  (/ for commands)" }))),
        React.createElement(Box, null,
            React.createElement(Text, { color: "gray", dimColor: true }, '  ctrl+c exit  / commands  @file context  ↑↓ history'))));
}
// ─── Message row component ─────────────────────────────────────────────────────
function MessageRow({ msg }) {
    const roleColors = {
        user: 'yellowBright',
        assistant: 'white',
        system: 'gray',
        tool: 'cyan',
    };
    const roleIcons = {
        user: '❯ ',
        assistant: '◈ ',
        system: '· ',
        tool: '⟳ ',
    };
    const color = msg.isError ? 'red' : roleColors[msg.role] ?? 'white';
    return (React.createElement(Box, { flexDirection: "row", marginBottom: 0 },
        React.createElement(Text, { color: color, dimColor: msg.role === 'system' }, roleIcons[msg.role] ?? '  '),
        React.createElement(Box, { flexGrow: 1, flexWrap: "wrap" },
            React.createElement(Text, { color: color, dimColor: msg.role === 'system' },
                msg.content,
                msg.streaming && React.createElement(Text, { color: "gray" }, " \u258C")))));
}
//# sourceMappingURL=App.js.map