// src/types/index.ts
// Re-export all types from domain-specific files

export type { Provider, ProviderConfig, Message } from './providers.js';
export { PROVIDERS } from './providers.js';

export type { ToolCall, ToolResult, FileDiff } from './tools.js';

export type { ApprovalMode, NyxMood, ModelRouting, ProviderCallEntry } from './common.js';

export type {
  Checkpoint,
  Persona,
  ThemeName,
  Theme,
  SessionState,
} from './sessions.js';
export { THEMES, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONAS } from './sessions.js';

export type { SlashCommand } from './commands.js';
export { SLASH_COMMANDS } from './commands.js';
