// src/ui/App.tsx
// Main TUI application — Claude Code inspired

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { version: string };

import {
  SessionState,
  NyxMood,
  Provider,
  PROVIDERS,
  SLASH_COMMANDS,
  SlashCommand,
  Message,
  ToolCall,
  DEFAULT_PERSONAS,
  DEFAULT_SYSTEM_PROMPT,
  ApprovalMode,
} from '../core/types.js';
import { NyxHeader } from './NyxHeader.js';
import { CommandPicker } from './CommandPicker.js';
import { PermissionPrompt, needsApproval } from './PermissionPrompt.js';
import { MarkdownText } from './MarkdownText.js';
import { runAgent, streamProvider, StreamChunk, listModels, estimateCost, BUILTIN_TOOLS } from '../providers/client.js';
import { ToolExecutor } from '../tools/executor.js';
import { McpManager } from '../mcp/manager.js';
import {
  saveSession,
  createCheckpoint,
  restoreCheckpoint,
  estimateTokens,
  loadNyxMemories,
  loadHooks,
  HooksConfig,
} from '../sessions/manager.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  streaming?: boolean;
  isError?: boolean;
  toolName?: string;
  timestamp?: number;
}

interface PendingPermission {
  toolCall: ToolCall;
  resolve: (allowed: boolean, allowAll?: boolean) => void;
}

// ─── App ──────────────────────────────────────────────────────────────────────

interface AppProps {
  initialState: SessionState;
}

export function App({ initialState }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // ── State ────────────────────────────────────────────────────────────────────
  const [session, setSession] = useState<SessionState>(initialState);
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [mood, setMood] = useState<NyxMood>('idle');
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerSelectedIndex, setPickerSelectedIndex] = useState(0);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isMultiline, setIsMultiline] = useState(false);
  const [multilineBuffer, setMultilineBuffer] = useState<string[]>([]);

  const executorRef    = useRef<ToolExecutor>(new ToolExecutor(initialState.workingDir));
  const mcpRef         = useRef<McpManager>(new McpManager());
  const streamingIdRef = useRef<string | null>(null);
  const abortRef       = useRef<AbortController | null>(null);
  const hooksRef       = useRef<HooksConfig>(loadHooks());

  // Load .nyx.md memory hierarchy on mount (global + project)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute filtered commands for picker
  const q = pickerQuery.toLowerCase();
  const filteredCommands = q
    ? SLASH_COMMANDS.filter(
        (c) => c.name.startsWith(q) || c.description.toLowerCase().includes(q),
      )
    : SLASH_COMMANDS;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const addDisplay = useCallback((msg: Omit<DisplayMessage, 'id' | 'timestamp'>): string => {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setDisplayMessages((prev) => [...prev, { ...msg, id, timestamp: Date.now() }]);
    return id;
  }, []);

  const updateDisplay = useCallback((id: string, patch: Partial<DisplayMessage>): void => {
    setDisplayMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }, []);

  const sysMsg = useCallback((text: string, isError = false): void => {
    addDisplay({ role: 'system', content: text, isError });
  }, [addDisplay]);

  // Ask for permission — returns a Promise that resolves when user presses y/n/a
  const requestPermission = useCallback((toolCall: ToolCall): Promise<{ allowed: boolean; allowAll: boolean }> => {
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

  const runHooks = useCallback(async (
    event: 'PreToolUse' | 'PostToolUse' | 'Notification',
    toolCall?: ToolCall,
    output?: string,
  ): Promise<void> => {
    const hooks = hooksRef.current[event] ?? [];
    for (const hook of hooks) {
      if (hook.matcher && toolCall && !toolCall.name.includes(hook.matcher) && !new RegExp(hook.matcher).test(toolCall.name)) continue;
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        LC_TOOL_NAME: toolCall?.name ?? '',
        LC_TOOL_ARGS: toolCall ? JSON.stringify(toolCall.args) : '',
        LC_TOOL_OUTPUT: output ?? '',
        LC_TOOL_PATH: (toolCall?.args as any)?.path ?? (toolCall?.args as any)?.source ?? '',
      };
      try {
        await new Promise<void>((resolve) => {
          execFile('sh', ['-c', hook.command], { env, timeout: 10000 }, () => resolve());
        });
      } catch { /* hooks never block the agent */ }
    }
  }, []);

  // ── Slash command handler ─────────────────────────────────────────────────────

  const handleSlashCommand = useCallback(async (raw: string): Promise<void> => {
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
        const provider = args.toLowerCase() as Provider;
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

      case '/review': {
        setMood('thinking');
        sysMsg('Running code review…');
        try {
          // Prefer staged diff, fall back to working tree diff
          const staged = await new Promise<string>((res, rej) => {
            execFile('git', ['diff', '--staged'], { cwd: session.workingDir }, (err, out) => err ? rej(err) : res(out));
          });
          const diff = staged.trim() || await new Promise<string>((res, rej) => {
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
          await streamProvider(
            session.provider, session.apiKeys, session.model,
            [{ role: 'user', content: prompt }],
            (chunk) => { if (chunk.text) { review += chunk.text; updateDisplay(reviewId, { content: review, streaming: true }); } },
            session.systemPrompt,
          );
          updateDisplay(reviewId, { content: review, streaming: false });
          setSession((s) => ({ ...s, lastAssistantMessage: review }));
        } catch (err) {
          sysMsg(`Review failed: ${err instanceof Error ? err.message : String(err)}`, true);
          setMood('error');
        }
        setMood('idle');
        return;
      }

      case '/commit': {
        setMood('thinking');
        sysMsg('Generating commit message…');
        try {
          const stdout = await new Promise<string>((res, rej) => {
            execFile('git', ['diff', '--staged'], { cwd: session.workingDir }, (err, out) => {
              if (err) rej(err); else res(out);
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
          await streamProvider(
            session.provider,
            session.apiKeys,
            session.model,
            [{ role: 'user', content: prompt }],
            (chunk) => { if (chunk.text) commitMsg += chunk.text; },
          );
          commitMsg = commitMsg.trim().split('\n')[0];
          const fullMsg = `${commitMsg}\n\nCo-authored-by: Nyx <nyx@thealxlabs.ca>`;
          execFile('git', ['commit', '-m', fullMsg], { cwd: session.workingDir },
            (err) => {
              if (err) { sysMsg(`Commit failed: ${err.message}`, true); setMood('error'); }
              else { sysMsg(`Committed: ${commitMsg}`); setMood('happy'); }
            },
          );
        } catch (err) {
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
          } else {
            sysMsg(`  ${filePath}  (unchanged)`);
          }
        }
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
          const contextMsg: Message = { role: 'user', content: `Context for ${args}:\n\`\`\`\n${fileResult.output}\n\`\`\`` };
          setSession((s) => ({ ...s, messages: [...s.messages, contextMsg] }));
          sysMsg(`Added ${args} to context (${fileResult.output.split('\n').length} lines)`);
        } else {
          const contextMsg: Message = { role: 'user', content: `Directory contents of ${args}:\n${result.output}` };
          setSession((s) => ({ ...s, messages: [...s.messages, contextMsg] }));
          sysMsg(`Added directory ${args} to context`);
        }
        return;
      }

      case '/allowall': {
        // Cycle through modes: suggest → auto-edit → full-auto → suggest
        setSession((s) => {
          const current = s.approvalMode;
          const next: ApprovalMode =
            current === 'suggest' ? 'auto-edit' :
            current === 'auto-edit' ? 'full-auto' : 'suggest';
          sysMsg(`Approval mode: ${next}`);
          return { ...s, approvalMode: next };
        });
        return;
      }

      case '/mode': {
        if (!args) {
          sysMsg(
            `Current mode: ${session.approvalMode}\n\n` +
            `  suggest    — prompt before every write, delete, shell, or git op\n` +
            `  auto-edit  — file edits auto-approved; only shell needs approval\n` +
            `  full-auto  — everything runs without prompting\n\n` +
            `Usage: /mode <suggest|auto-edit|full-auto>`,
          );
          return;
        }
        if (!['suggest', 'auto-edit', 'full-auto'].includes(args)) {
          sysMsg(`Unknown mode: ${args}. Options: suggest, auto-edit, full-auto`, true);
          return;
        }
        setSession((s) => ({ ...s, approvalMode: args as ApprovalMode }));
        sysMsg(`Approval mode set to: ${args}`);
        return;
      }

      case '/steps': {
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
        if (!session.messages.length) {
          sysMsg('No conversation to compact.');
          return;
        }
        sysMsg('Compacting conversation…');
        setMood('thinking');
        const prompt = `Summarize the following conversation in 3-5 concise sentences, preserving key decisions, code context, and goals:\n\n${session.messages.map((m) => `${m.role}: ${m.content.slice(0, 500)}`).join('\n\n')}`;
        let summary = '';
        await streamProvider(
          session.provider,
          session.apiKeys,
          session.model,
          [{ role: 'user', content: prompt }],
          (chunk) => { if (chunk.text) summary += chunk.text; },
        );
        const summaryMsg: Message = { role: 'system', content: `[Compacted conversation summary]\n${summary}` };
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
        sysMsg(
          `Provider  ${provider.displayName}\n` +
          `Model     ${session.model}\n` +
          `API key   ${hasKey}\n` +
          `Messages  ${session.messages.length}\n` +
          `~Tokens   ${tokens.toLocaleString()}\n` +
          `Checkpts  ${cps}\n` +
          `CWD       ${session.workingDir}\n` +
          `Mode      ${session.approvalMode}`,
        );
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
        if (!lastUser) { sysMsg('No user message to retry.', true); return; }
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
          // Pass content via stdin to avoid any shell expansion of the message content
          const content = session.lastAssistantMessage;
          if (process.platform === 'darwin') {
            execFileSync('pbcopy', [], { input: content, encoding: 'utf8' });
          } else if (process.platform === 'win32') {
            execFileSync('clip', [], { input: content, encoding: 'utf8' });
          } else {
            // Linux — try xclip, then xsel, then wl-clipboard (Wayland)
            try {
              execFileSync('xclip', ['-selection', 'clipboard'], { input: content, encoding: 'utf8' });
            } catch {
              try {
                execFileSync('xsel', ['--clipboard', '--input'], { input: content, encoding: 'utf8' });
              } catch {
                execFileSync('wl-copy', [], { input: content, encoding: 'utf8' });
              }
            }
          }
          sysMsg(`Copied ${session.lastAssistantMessage.length} chars to clipboard.`);
        } catch {
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
        } else {
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
        await streamProvider(session.provider, session.apiKeys, session.model, [{ role: 'user', content: todoPrompt }], (c) => { if (c.text) todos += c.text; });
        sysMsg(`Todos:\n${todos.trim()}`);
        setMood('idle');
        return;
      }

      case '/web': {
        if (!args) { sysMsg('Usage: /web <search query>'); return; }
        sysMsg(`Searching: "${args}"…`);
        setMood('thinking');
        try {
          const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(args)}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          let text: string;
          try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
            if (!res.ok) {
              sysMsg(`Web search failed: server returned ${res.status}`, true);
              setMood('idle');
              return;
            }
            text = await res.text();
          } finally {
            clearTimeout(timeoutId);
          }
          // Extract visible text snippets from results
          const snippets = [...text.matchAll(/class="result__snippet"[^>]*>([^<]{20,300})</g)]
            .slice(0, 5)
            .map((m, i) => `${i + 1}. ${m[1].replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').trim()}`);
          if (!snippets.length) {
            sysMsg('No results found. Try a different query.');
            setMood('idle');
            return;
          }
          const contextText = `Web search results for "${args}":\n\n${snippets.join('\n\n')}`;
          const webMsg: Message = { role: 'user', content: contextText };
          setSession((s) => ({ ...s, messages: [...s.messages, webMsg] }));
          sysMsg(`Added ${snippets.length} search results to context.`);
        } catch {
          sysMsg('Web search failed. Check your connection.', true);
        }
        setMood('idle');
        return;
      }

      case '/open': {
        if (!args) { sysMsg('Usage: /open <file>'); return; }
        const editor = process.env.EDITOR || (process.platform === 'darwin' ? 'open' : 'xdg-open');
        execFile(editor, [args], { cwd: session.workingDir }, (err) => {
          if (err) sysMsg(`Could not open: ${err.message}`, true);
          else sysMsg(`Opened ${args} in ${editor}`);
        });
        return;
      }

      case '/models': {
        sysMsg(`Fetching models for ${PROVIDERS[session.provider].displayName}…`);
        setMood('thinking');
        const models = await listModels(session.provider, session.apiKeys);
        if (!models.length) {
          sysMsg('No models found. Make sure your API key is set and the provider is reachable.', true);
        } else {
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
        } else {
          sysMsg(`Provider: ${provider.displayName}\nModel: ${session.model}\n~Tokens this session: ${tokens.toLocaleString()}\nEstimated cost: $${cost.toFixed(6)} USD`);
        }
        return;
      }

      case '/init': {
        sysMsg('Analyzing project…');
        setMood('thinking');
        try {
          // Gather project signals
          const signals: string[] = [];
          const tryRead = (f: string) => { try { return fs.readFileSync(path.join(session.workingDir, f), 'utf8').slice(0, 500); } catch { return null; } };
          const pkg     = tryRead('package.json');
          const cargo   = tryRead('Cargo.toml');
          const pyproj  = tryRead('pyproject.toml');
          const gomod   = tryRead('go.mod');
          const readme  = tryRead('README.md') ?? tryRead('README');
          if (pkg)    signals.push(`package.json:\n${pkg}`);
          if (cargo)  signals.push(`Cargo.toml:\n${cargo}`);
          if (pyproj) signals.push(`pyproject.toml:\n${pyproj}`);
          if (gomod)  signals.push(`go.mod:\n${gomod}`);
          if (readme) signals.push(`README:\n${readme}`);

          const dirResult = await executorRef.current.execute({ name: 'list_dir', args: { path: '.', recursive: true } });
          signals.push(`Directory structure:\n${dirResult.output.slice(0, 1000)}`);

          const prompt = `Generate a .nyx.md project configuration file for an AI coding assistant named Nyx.\n\nBased on this project info:\n${signals.join('\n\n')}\n\nThe .nyx.md should include:\n1. A brief description of what this project does\n2. Key technologies, frameworks, and conventions\n3. Important files and their purpose\n4. How to run tests and build\n5. Any gotchas or things the AI should know\n\nFormat it as clean markdown. Be concise and specific. This will be injected into every AI request.`;

          const initId = addDisplay({ role: 'assistant', content: '', streaming: true });
          let content = '';
          await streamProvider(
            session.provider, session.apiKeys, session.model,
            [{ role: 'user', content: prompt }],
            (chunk) => { if (chunk.text) { content += chunk.text; updateDisplay(initId, { content, streaming: true }); } },
          );
          updateDisplay(initId, { content, streaming: false });

          const nyxMdPath = path.join(session.workingDir, '.nyx.md');
          fs.writeFileSync(nyxMdPath, content.trim(), 'utf8');
          sysMsg(`.nyx.md created at ${nyxMdPath}\nRestart or run /memory to reload.`);
          setMood('happy');
        } catch (err) {
          sysMsg(`Init failed: ${err instanceof Error ? err.message : String(err)}`, true);
          setMood('error');
        }
        return;
      }

      case '/doctor': {
        setMood('thinking');
        const checks: Array<{ label: string; status: string; ok: boolean }> = [];

        // Node.js
        checks.push({ label: 'Node.js', status: process.version, ok: true });

        // Ollama
        try {
          const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json() as { models: Array<{ name: string }> };
            checks.push({ label: 'Ollama', status: `running — ${data.models.length} model${data.models.length !== 1 ? 's' : ''}`, ok: true });
          } else {
            checks.push({ label: 'Ollama', status: 'reachable but returned error', ok: false });
          }
        } catch {
          checks.push({ label: 'Ollama', status: 'not running (start with: ollama serve)', ok: false });
        }

        // API keys
        for (const [p, cfg] of Object.entries(PROVIDERS)) {
          if (cfg.requiresKey) {
            const has = !!session.apiKeys[p as Provider];
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

        const W = 22;
        const out = checks.map((c) => `  ${c.ok ? '✓' : '✕'} ${c.label.padEnd(W)} ${c.status}`).join('\n');
        sysMsg(`LocalCode Doctor\n\n${out}\n\nMode: ${session.approvalMode}  Steps: ${session.maxSteps}  Provider: ${PROVIDERS[session.provider].displayName}`);
        setMood('idle');
        return;
      }

      case '/memory': {
        const subCmd = args.trim().toLowerCase();

        if (subCmd === 'edit') {
          const editor = process.env.EDITOR || (process.platform === 'darwin' ? 'nano' : 'nano');
          const globalNyx = path.join(os.homedir(), '.nyx.md');
          if (!fs.existsSync(globalNyx)) {
            fs.writeFileSync(globalNyx, `# Nyx Global Memory\n\nAdd notes here that Nyx should always know about you.\n`, 'utf8');
          }
          execFile(editor, [globalNyx], (err) => {
            if (err) sysMsg(`Could not open editor: ${err.message}`, true);
            else sysMsg(`Saved. Restart LocalCode to reload memory.`);
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
        const hooksPath = path.join(os.homedir(), '.localcode', 'hooks.json');
        const loaded = hooksRef.current;
        const total = [...(loaded.PreToolUse ?? []), ...(loaded.PostToolUse ?? []), ...(loaded.Notification ?? [])].length;
        if (!total) {
          sysMsg(
            `No hooks configured.\n\n` +
            `Create ${hooksPath} to add hooks:\n` +
            `{\n` +
            `  "PreToolUse": [{ "matcher": "write_file", "command": "echo writing $LC_TOOL_PATH" }],\n` +
            `  "PostToolUse": [{ "matcher": "write_file", "command": "prettier --write \\"$LC_TOOL_PATH\\" 2>/dev/null" }],\n` +
            `  "Notification": [{ "command": "say done" }]\n` +
            `}\n\n` +
            `Env vars: LC_TOOL_NAME, LC_TOOL_ARGS, LC_TOOL_OUTPUT, LC_TOOL_PATH`,
          );
        } else {
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
        const subParts = args.split(/\s+/);
        const sub = subParts[0]?.toLowerCase();
        const mcpArgs = subParts.slice(1).join(' ');

        if (!sub || sub === 'list') {
          const status = mcpRef.current.getStatus();
          if (!status.length) {
            sysMsg('No MCP servers configured.\n\nAdd one:\n  /mcp add <name> stdio <command> [args...]\n  /mcp add <name> http <url>');
          } else {
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
            ? { name, transport: 'stdio' as const, command: rest[0], args: rest.slice(1) }
            : { name, transport: 'http' as const, url: rest[0] };

          const err = await mcpRef.current.connect(config, (msg) => sysMsg(msg));
          if (!err) {
            const tools = mcpRef.current.getAllTools().filter((t) => t.serverName === name);
            sysMsg(`Connected! ${tools.length} tools available from "${name}".`);
            setMood('happy');
          } else {
            setMood('error');
          }
          return;
        }

        if (sub === 'remove' || sub === 'rm') {
          const name = mcpArgs.trim();
          if (!name) { sysMsg('Usage: /mcp remove <name>', true); return; }
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
        sysMsg(`Testing connection to ${PROVIDERS[session.provider].displayName}…`);
        setMood('thinking');
        try {
          const startMs = Date.now();
          await streamProvider(
            session.provider,
            session.apiKeys,
            session.model,
            [{ role: 'user', content: 'Reply with only: pong' }],
            () => {},
          );
          const ms = Date.now() - startMs;
          sysMsg(`✓ ${PROVIDERS[session.provider].displayName} responded in ${ms}ms  (model: ${session.model})`);
          setMood('happy');
        } catch (err) {
          sysMsg(`✕ Connection failed: ${err instanceof Error ? err.message : String(err)}`, true);
          setMood('error');
        }
        return;
      }

      case '/search': {
        if (!args) { sysMsg('Usage: /search <pattern>  — search file contents in working dir'); return; }
        sysMsg(`Searching for "${args}"…`);
        const result = await executorRef.current.execute({ name: 'search_files', args: { pattern: args, path: '.' } });
        sysMsg(result.success && result.output.trim() ? result.output : `No matches found for: ${args}`);
        return;
      }

      case '/ls': {
        const target = args || '.';
        const result = await executorRef.current.execute({ name: 'list_dir', args: { path: target, recursive: false } });
        sysMsg(result.success ? result.output : `Could not list: ${target}`);
        return;
      }

      case '/find': {
        if (!args) { sysMsg('Usage: /find <filename-pattern>  e.g. /find *.ts'); return; }
        const result = await executorRef.current.execute({ name: 'find_files', args: { pattern: args } });
        sysMsg(result.success && result.output.trim() ? result.output : `No files matching: ${args}`);
        return;
      }

      case '/exit': {
        try { saveSession(session); } catch { /* exit regardless */ }
        exit();
        return;
      }

      default:
        sysMsg(`Unknown command: ${cmd}. Type / to see all commands.`, true);
    }
  }, [session, sysMsg, addDisplay, exit]);

  // ── Main send handler ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    if (!text.trim() || isStreaming) return;

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
      } else {
        sysMsg(`@context warning: could not read "${p}" — ${result.output}`, true);
        processedText = processedText.replace(match, `[file not found: ${p}]`);
      }
    }

    const userMsg: Message = { role: 'user', content: processedText };
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

    // Abort controller — cancelled by Escape key
    const controller = new AbortController();
    abortRef.current = controller;

    // Snapshot session for this run
    const currentSession = session;

    const run = async (): Promise<void> => {
      const pinnedMsg: Message[] = currentSession.pinnedContext.length
        ? [{ role: 'user', content: `[Pinned context — always relevant]\n${currentSession.pinnedContext.join('\n')}` }]
        : [];

      const msgs: Message[] = [...pinnedMsg, ...currentSession.messages, userMsg];

      // Merge built-in tools with MCP tools
      const mcpToolDefs = mcpRef.current.getToolDefinitions();
      const allTools = [...BUILTIN_TOOLS, ...mcpToolDefs];

      await runAgent(
        currentSession.provider,
        currentSession.apiKeys,
        currentSession.model,
        msgs,
        async (chunk: StreamChunk) => {
          if (controller.signal.aborted) return;
          switch (chunk.type) {
            case 'agent_step':
              if ((chunk.step ?? 0) > 0) {
                // Show step indicator after first iteration
                addDisplay({
                  role: 'system',
                  content: `⟳  Step ${(chunk.step ?? 0) + 1}/${chunk.maxSteps}`,
                });
              }
              break;

            case 'text':
              accumulated += chunk.text ?? '';
              updateDisplay(streamId, { content: accumulated, streaming: true });
              break;

            case 'done':
              updateDisplay(streamId, { streaming: false });
              if (accumulated.trim()) {
                const inputTokens = Math.ceil(msgs.reduce((a, m) => a + m.content.length, 0) / 4);
                const outputTokens = Math.ceil(accumulated.length / 4);
                const cost = estimateCost(currentSession.model, inputTokens, outputTokens);
                setSession((s) => {
                  // s.messages already contains userMsg (added before run() was called)
                  const newMessages = [
                    ...s.messages,
                    { role: 'assistant' as const, content: accumulated },
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
                  if (shouldCheckpoint) setTimeout(() => sysMsg(`Auto-checkpoint saved.`), 100);
                  const next = {
                    ...s,
                    messages: newMessages,
                    lastAssistantMessage: accumulated,
                    sessionCost: s.sessionCost + cost,
                    checkpoints,
                  };
                  // Auto-save after every AI response
                  setTimeout(() => { try { saveSession(next); } catch { /* non-critical */ } }, 0);
                  return next;
                });
              }
              break;

            case 'error':
              updateDisplay(streamId, { content: chunk.error ?? 'Unknown error', streaming: false, isError: true });
              setMood('error');
              break;
          }
        },
        {
          maxSteps: currentSession.maxSteps,
          tools: allTools,
          onToolCall: async (toolCall: ToolCall) => {
            if (needsApproval(toolCall, currentSession.approvalMode)) {
              setMood('waiting');
              const perm = await requestPermission(toolCall);
              if (perm.allowAll) setSession((s) => ({ ...s, approvalMode: 'full-auto' }));
              setMood('thinking');
              return perm;
            }
            return { allowed: true, allowAll: false };
          },
          onToolResult: (toolCall: ToolCall, output: string, diff?: unknown) => {
            addDisplay({
              role: 'tool',
              content: `${toolCall.name} → ${output.slice(0, 300)}`,
              toolName: toolCall.name,
              streaming: false,
            });
            if (diff && typeof diff === 'object' && 'additions' in (diff as object)) {
              const d = diff as { path: string; additions: number; deletions: number };
              addDisplay({ role: 'system', content: `  ${d.path}  +${d.additions} -${d.deletions}` });
            }
          },
          executeTool: async (toolCall: ToolCall) => {
            await runHooks('PreToolUse', toolCall);

            let result: { success: boolean; output: string };
            if (mcpRef.current.isMcpTool(toolCall.name)) {
              const r = await mcpRef.current.callTool(toolCall.name, toolCall.args as Record<string, unknown>);
              result = { success: r.success, output: r.output };
            } else {
              result = await executorRef.current.execute(toolCall);
            }

            await runHooks('PostToolUse', toolCall, result.output);
            return result;
          },
        },
        currentSession.systemPrompt,
        controller.signal,
      );
    };

    try {
      await run();
    } catch (err) {
      updateDisplay(streamId, {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        streaming: false,
        isError: true,
      });
      setMood('error');
    } finally {
      setIsStreaming(false);
      setMood((m) => (m === 'thinking' || m === 'waiting' ? 'idle' : m));
      runHooks('Notification');
    }
  }, [isStreaming, session, addDisplay, updateDisplay, requestPermission, runHooks]);

  // ── Input handling ────────────────────────────────────────────────────────────

  const handleInputChange = useCallback((val: string): void => {
    setInput(val);

    if (val.startsWith('/')) {
      const query = val.slice(1); // empty string when just "/"
      setPickerQuery(query);
      setShowPicker(true);
      setPickerSelectedIndex(0);
    } else {
      setShowPicker(false);
      setPickerQuery('');
    }
  }, []);

  const handleSubmit = useCallback(async (val: string): Promise<void> => {
    // If in multiline mode, Enter appends to buffer (don't submit)
    if (isMultiline) {
      setMultilineBuffer((prev) => [...prev, input]);
      setInput('');
      return;
    }

    const v = val.trim();
    if (!v) return;

    if (showPicker) {
      // Select the highlighted command from filtered list
      const q = pickerQuery.toLowerCase();
      const filtered = q
        ? SLASH_COMMANDS.filter(
            (c) => c.name.startsWith(q) || c.description.toLowerCase().includes(q) || c.trigger.includes(q),
          )
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
      if (inputChar === 'y') pendingPermission.resolve(true, false);
      else if (inputChar === 'a') pendingPermission.resolve(true, true);
      else if (inputChar === 'n') pendingPermission.resolve(false, false);
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
      } else {
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
        ? SLASH_COMMANDS.filter(
            (c) => c.name.startsWith(pickerQuery) || c.description.toLowerCase().includes(pickerQuery),
          )
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
      try { saveSession(session); } catch { /* exit regardless */ }
      exit();
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  const termHeight = stdout?.rows ?? 24;
  const maxMessages = Math.max(5, termHeight - 12);

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header */}
      <NyxHeader
        mood={mood}
        provider={session.provider}
        model={session.model}
        workingDir={session.workingDir}
        tokenCount={estimateTokens(session.messages)}
        approvalMode={session.approvalMode}
        persona={session.activePersona}
        sessionCost={session.sessionCost}
        version={pkg.version}
      />

      {/* Message log — show last N messages */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {displayMessages.slice(-maxMessages).map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}
      </Box>

      {/* Permission prompt */}
      {pendingPermission && (
        <PermissionPrompt toolCall={pendingPermission.toolCall} />
      )}

      {/* Command picker */}
      {showPicker && (
        <CommandPicker
          query={pickerQuery}
          selectedIndex={pickerSelectedIndex}
          onSelect={(cmd) => {
            setInput('');
            setShowPicker(false);
            handleSlashCommand(cmd.trigger);
          }}
          onDismiss={() => { setShowPicker(false); setInput(''); }}
        />
      )}

      {/* Input area */}
      <Box
        borderStyle="round"
        borderColor={isStreaming ? 'gray' : isMultiline ? 'cyan' : 'yellowBright'}
        paddingX={1}
        flexDirection="row"
      >
        <Text color={isStreaming ? 'gray' : isMultiline ? 'cyan' : 'yellowBright'}>
          {isStreaming ? '⟳ ' : isMultiline ? '¶ ' : '❯ '}
        </Text>
        {isMultiline ? (
          <Box flexDirection="column">
            {multilineBuffer.map((line, i) => (
              <Box key={i} flexDirection="row">
                <Text color="gray" dimColor>{String(i + 1).padStart(2, ' ')} │ </Text>
                <Text color="white">{line}</Text>
              </Box>
            ))}
            <Box flexDirection="row">
              <Text color="gray" dimColor>{String(multilineBuffer.length + 1).padStart(2, ' ')} │ </Text>
              <TextInput value={input} onChange={handleInputChange} onSubmit={handleSubmit} placeholder="…" />
            </Box>
            <Text color="gray" dimColor>  ctrl+d send  ctrl+e cancel</Text>
          </Box>
        ) : isStreaming ? (
          <Text color="gray" dimColor>Generating…</Text>
        ) : (
          <TextInput
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder="Message Nyx…  (/ for commands)"
          />
        )}
      </Box>

      {/* Footer hint */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="gray" dimColor>
          {'  ctrl+c exit  esc cancel  ctrl+e multiline  / commands  @file context  ↑↓ history'}
        </Text>
        {input.length > 50 && (
          <Text color={input.length > 2000 ? 'yellow' : 'gray'} dimColor>
            {`${input.length}c  `}
          </Text>
        )}
      </Box>
    </Box>
  );
}

// ─── Message row component ─────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: DisplayMessage }): React.ReactElement {
  const roleColors: Record<string, string> = {
    user: 'yellowBright',
    assistant: 'white',
    system: 'gray',
    tool: 'cyan',
  };

  const roleIcons: Record<string, string> = {
    user: '❯ ',
    assistant: '◈ ',
    system: '· ',
    tool: '⟳ ',
  };

  const color = msg.isError ? 'red' : roleColors[msg.role] ?? 'white';
  const icon = roleIcons[msg.role] ?? '  ';

  // Render assistant messages with markdown
  if (msg.role === 'assistant' && msg.content) {
    return (
      <Box flexDirection="row" marginBottom={0}>
        <Text color="white">{icon}</Text>
        <Box flexGrow={1} flexDirection="column">
          <MarkdownText content={msg.content} streaming={msg.streaming} />
        </Box>
      </Box>
    );
  }

  const timeStr = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : null;

  // Tool calls — show as compact inline box
  if (msg.role === 'tool') {
    return (
      <Box flexDirection="row" marginBottom={0}>
        <Text color="cyan" dimColor>{icon}</Text>
        <Text color={msg.isError ? 'red' : 'cyan'} dimColor={!msg.isError}>
          {msg.content}
          {msg.streaming && <Text color="gray"> ▌</Text>}
        </Text>
        {timeStr && <Text color="gray" dimColor>  {timeStr}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="row" marginBottom={0}>
      <Text color={color} dimColor={msg.role === 'system'}>
        {icon}
      </Text>
      <Box flexGrow={1} flexWrap="wrap">
        <Text color={color} dimColor={msg.role === 'system'}>
          {msg.content}
          {msg.streaming && <Text color="gray"> ▌</Text>}
        </Text>
      </Box>
      {timeStr && msg.role === 'system' && <Text color="gray" dimColor>  {timeStr}</Text>}
    </Box>
  );
}
