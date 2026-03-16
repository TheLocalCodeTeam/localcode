import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionState, Checkpoint, Provider, Message, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONAS } from '../core/types.js';
import { PROVIDERS } from '../core/types.js';

const SESSION_DIR = path.join(os.homedir(), '.localcode');
const STATE_FILE  = path.join(SESSION_DIR, 'session.json');

function ensureDir(): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
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
    approvalMode: 'suggest',
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
    provider:       state.provider,
    model:          state.model,
    checkpoints:    state.checkpoints,
    approvalMode:   state.approvalMode,
    workingDir:     state.workingDir,
    apiKeys:        state.apiKeys,
    systemPrompt:   state.systemPrompt,
    personas:       state.personas,
    activePersona:  state.activePersona,
    pinnedContext:  state.pinnedContext,
    autoCheckpoint: state.autoCheckpoint,
    maxSteps:       state.maxSteps,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf8');
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
  // Rough estimate: 1 token ≈ 4 chars
  const total = messages.reduce((acc, m) => acc + m.content.length, 0);
  return Math.ceil(total / 4);
}

export function isFirstRun(): boolean {
  return !fs.existsSync(STATE_FILE);
}
