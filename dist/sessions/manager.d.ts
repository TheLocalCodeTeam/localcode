import { SessionState, Checkpoint, Message } from '../core/types.js';
export declare function loadSession(): SessionState;
export declare function saveSession(state: SessionState): void;
export declare function createCheckpoint(state: SessionState, label: string): {
    state: SessionState;
    checkpoint: Checkpoint;
};
export declare function restoreCheckpoint(state: SessionState, checkpointId: string): SessionState | null;
export declare function estimateTokens(messages: Message[]): number;
export declare function isFirstRun(): boolean;
//# sourceMappingURL=manager.d.ts.map