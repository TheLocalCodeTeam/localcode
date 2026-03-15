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
    allowAllTools: false,
    workingDir: process.cwd(),
    apiKeys,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    personas: DEFAULT_PERSONAS,
    activePersona: 'pair-programmer',
    pinnedContext: [],
    autoCheckpoint: true,
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
      allowAllTools: false,
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
    workingDir:     state.workingDir,
    apiKeys:        state.apiKeys,
    systemPrompt:   state.systemPrompt,
    personas:       state.personas,
    activePersona:  state.activePersona,
    pinnedContext:  state.pinnedContext,
    autoCheckpoint: state.autoCheckpoint,
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
