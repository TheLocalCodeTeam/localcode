import { SessionState, Checkpoint, Message } from '../types/index.js';
export interface HookEntry {
    matcher?: string;
    command: string;
}
export interface HooksConfig {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    Notification?: HookEntry[];
}
export declare function loadHooks(): HooksConfig;
export declare function saveHistory(entries: string[]): void;
export declare function loadHistory(): string[];
export interface PromptTemplate {
    name: string;
    prompt: string;
    description: string;
}
export declare function loadTemplates(): PromptTemplate[];
export declare function saveTemplates(templates: PromptTemplate[]): void;
export declare function loadAliases(): Record<string, string>;
export declare function saveAliases(aliases: Record<string, string>): void;
export interface NyxMemory {
    source: string;
    content: string;
}
/** Load .nyx.md files from the global home dir and the project working dir. */
export declare function loadNyxMemories(workingDir: string): NyxMemory[];
/** @deprecated use loadNyxMemories */
export declare function loadNyxMd(workingDir: string): string | null;
export declare function loadSession(): SessionState;
export declare function saveSession(state: SessionState): void;
export interface SessionSummary {
    id: string;
    timestamp: number;
    cwd: string;
    messageCount: number;
    provider: string;
    model: string;
}
export declare function listSessions(): SessionSummary[];
export declare function loadSessionById(id: string): SessionState | null;
export declare function createCheckpoint(state: SessionState, label: string): {
    state: SessionState;
    checkpoint: Checkpoint;
};
export declare function restoreCheckpoint(state: SessionState, checkpointId: string): SessionState | null;
export declare function estimateTokens(messages: Message[]): number;
export declare function isFirstRun(): boolean;
//# sourceMappingURL=manager.d.ts.map