import { logger } from '../core/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionState, Checkpoint, Provider, Message, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONAS } from '../types/index.js';
import { PROVIDERS } from '../types/index.js';

const SESSION_DIR = path.join(os.homedir(), '.localcode');
const STATE_FILE  = path.join(SESSION_DIR, 'session.json');
const SESSIONS_DIR = path.join(SESSION_DIR, 'sessions');

function ensureDir(): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function ensureSessionsDir(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export interface HookEntry {
  matcher?: string;  // tool name or regex pattern; if absent, matches all
  command: string;
}

export interface HooksConfig {
  PreToolUse?: HookEntry[];
  PostToolUse?: HookEntry[];
  Notification?: HookEntry[];
}

export function loadHooks(): HooksConfig {
  const hooksPath = path.join(SESSION_DIR, 'hooks.json');
  if (!fs.existsSync(hooksPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(hooksPath, 'utf8')) as HooksConfig;
  } catch {
    return {};
  }
}

// ── History ───────────────────────────────────────────────────────────────────

const HISTORY_FILE = path.join(SESSION_DIR, 'history.json');
const MAX_HISTORY = 200;

export function saveHistory(entries: string[]): void {
  try {
    ensureDir();
    const toSave = entries.slice(0, MAX_HISTORY);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) { logger.error('Session operation failed', { error: err instanceof Error ? err.message : String(err) }); }
}

export function loadHistory(): string[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) as string[];
  } catch {
    return [];
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface PromptTemplate {
  name: string;
  prompt: string;
  description: string;
}

const TEMPLATES_FILE = path.join(SESSION_DIR, 'templates.json');

export function loadTemplates(): PromptTemplate[] {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) return [];
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')) as PromptTemplate[];
  } catch {
    return [];
  }
}

export function saveTemplates(templates: PromptTemplate[]): void {
  try {
    ensureDir();
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf8');
  } catch (err) { logger.error('Session operation failed', { error: err instanceof Error ? err.message : String(err) }); }
}

// ── Aliases ───────────────────────────────────────────────────────────────────

const ALIASES_FILE = path.join(SESSION_DIR, 'aliases.json');

export function loadAliases(): Record<string, string> {
  try {
    if (!fs.existsSync(ALIASES_FILE)) return {};
    return JSON.parse(fs.readFileSync(ALIASES_FILE, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveAliases(aliases: Record<string, string>): void {
  try {
    ensureDir();
    fs.writeFileSync(ALIASES_FILE, JSON.stringify(aliases, null, 2), 'utf8');
  } catch (err) { logger.error('Session operation failed', { error: err instanceof Error ? err.message : String(err) }); }
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface NyxMemory {
  source: string;   // file path
  content: string;
}

/** Load .nyx.md files from the global home dir and the project working dir. */
export function loadNyxMemories(workingDir: string): NyxMemory[] {
  const memories: NyxMemory[] = [];

  // 1. Global memory: ~/.nyx.md
  const globalPath = path.join(os.homedir(), '.nyx.md');
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, 'utf8').trim();
      if (content) memories.push({ source: globalPath, content });
    } catch { /* ok */ }
  }

  // 2. Project memory: <workingDir>/.nyx.md
  const projectPath = path.join(workingDir, '.nyx.md');
  if (fs.existsSync(projectPath) && projectPath !== globalPath) {
    try {
      const content = fs.readFileSync(projectPath, 'utf8').trim();
      if (content) memories.push({ source: projectPath, content });
    } catch { /* ok */ }
  }

  return memories;
}

/** @deprecated use loadNyxMemories */
export function loadNyxMd(workingDir: string): string | null {
  const memories = loadNyxMemories(workingDir);
  return memories.length > 0 ? memories.map((m) => m.content).join('\n\n') : null;
}

export function loadSession(): SessionState {
  ensureDir();

  const apiKeys: Partial<Record<Provider, string>> = {};
  if (process.env.ANTHROPIC_API_KEY) apiKeys.claude = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY)    apiKeys.openai = process.env.OPENAI_API_KEY;
  if (process.env.GROQ_API_KEY)      apiKeys.groq   = process.env.GROQ_API_KEY;

  const defaults: SessionState = {
    provider: 'ollama',
    model: PROVIDERS.ollama.defaultModel,
    messages: [],
    checkpoints: [],
    approvalMode: 'auto-edit',
    workingDir: process.cwd(),
    apiKeys,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    personas: DEFAULT_PERSONAS,
    activePersona: 'pair-programmer',
    pinnedContext: [],
    autoCheckpoint: true,
    maxSteps: 20,
    sessionCost: 0,
    lastAssistantMessage: '',
    theme: 'dark',
    // v4 defaults
    modelRouting: null,
    budgetLimit: null,
    budgetFallbackModel: null,
    safeMode: false,
    autopilotActive: false,
    providerCallLog: [],
    dna: null,
  };

  if (!fs.existsSync(STATE_FILE)) return defaults;

  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<SessionState>;
    return {
      ...defaults,
      ...saved,
      apiKeys: { ...saved.apiKeys, ...apiKeys },
      // Never restore live-session state
      messages: [],
      sessionCost: 0,
      lastAssistantMessage: '',
    };
  } catch {
    return defaults;
  }
}

export function saveSession(state: SessionState): void {
  ensureDir();
  const toSave: Partial<SessionState> = {
    provider:             state.provider,
    model:                state.model,
    checkpoints:          state.checkpoints,
    approvalMode:         state.approvalMode,
    workingDir:           state.workingDir,
    apiKeys:              state.apiKeys,
    systemPrompt:         state.systemPrompt,
    personas:             state.personas,
    activePersona:        state.activePersona,
    pinnedContext:        state.pinnedContext,
    autoCheckpoint:       state.autoCheckpoint,
    maxSteps:             state.maxSteps,
    theme:                state.theme,
    // v4 — persisted
    modelRouting:         state.modelRouting,
    budgetLimit:          state.budgetLimit,
    budgetFallbackModel:  state.budgetFallbackModel,
    safeMode:             state.safeMode,
    dna:                  state.dna,
    // autopilotActive and providerCallLog intentionally NOT persisted
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf8');

  // Also save a timestamped copy if there are messages
  if (state.messages.length > 0) {
    try {
      ensureSessionsDir();
      const cwdSlug = state.workingDir.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
      const timestamp = Date.now();
      const sessionId = `session_${timestamp}_${cwdSlug}`;
      const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
      const sessionData = {
        id: sessionId,
        timestamp,
        cwd: state.workingDir,
        messageCount: state.messages.length,
        provider: state.provider,
        model: state.model,
        messages: state.messages,
        checkpoints: state.checkpoints,
      };
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf8');

      // Keep only last 50 sessions
      const files = fs.readdirSync(SESSIONS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ f, mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const { f } of files.slice(50)) {
        try { fs.unlinkSync(path.join(SESSIONS_DIR, f)); } catch { /* ok */ }
      }
    } catch (err) { logger.error('Session operation failed', { error: err instanceof Error ? err.message : String(err) }); }
  }
}

// ── Session history browser ───────────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  timestamp: number;
  cwd: string;
  messageCount: number;
  provider: string;
  model: string;
}

export function listSessions(): SessionSummary[] {
  try {
    ensureSessionsDir();
    return fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8')) as SessionSummary & { messages?: unknown[] };
          return {
            id: data.id,
            timestamp: data.timestamp,
            cwd: data.cwd,
            messageCount: data.messageCount ?? (Array.isArray(data.messages) ? data.messages.length : 0),
            provider: data.provider,
            model: data.model,
          };
        } catch {
          return null;
        }
      })
      .filter((s): s is SessionSummary => s !== null)
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

export function loadSessionById(id: string): SessionState | null {
  try {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      messages: Message[];
      checkpoints?: Checkpoint[];
      provider?: Provider;
      model?: string;
      cwd?: string;
    };
    const base = loadSession();
    return {
      ...base,
      messages: data.messages ?? [],
      checkpoints: data.checkpoints ?? [],
      provider: (data.provider ?? base.provider) as Provider,
      model: data.model ?? base.model,
      workingDir: data.cwd ?? base.workingDir,
    };
  } catch {
    return null;
  }
}

export function createCheckpoint(
  state: SessionState,
  label: string,
): { state: SessionState; checkpoint: Checkpoint } {
  const checkpoint: Checkpoint = {
    id: `cp_${Date.now()}`,
    label,
    timestamp: Date.now(),
    messages: [...state.messages],
    files: {}, // populated by the caller with session file snapshots
  };

  const updatedState: SessionState = {
    ...state,
    checkpoints: [...state.checkpoints, checkpoint],
  };

  return { state: updatedState, checkpoint };
}

export function restoreCheckpoint(
  state: SessionState,
  checkpointId: string,
): SessionState | null {
  const cp = state.checkpoints.find((c) => c.id === checkpointId);
  if (!cp) return null;

  return {
    ...state,
    messages: [...cp.messages],
  };
}

export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    const isCode = m.content.includes('```') || m.content.includes('{') || m.content.includes('(') || m.content.includes('import ');
    const isToolResult = m.content.startsWith('Tool result') || m.content.startsWith('[');
    const charsPerToken = isCode ? 3 : 4;
    const baseTokens = Math.ceil(m.content.length / charsPerToken);
    total += baseTokens;
    if (isToolResult) total += 50;
    if (m.role === 'system') total += Math.ceil(baseTokens * 0.07);
  }
  return total;
}

export function isFirstRun(): boolean {
  return !fs.existsSync(STATE_FILE);
}
