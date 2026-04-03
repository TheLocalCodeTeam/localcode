import React from 'react';
import { NyxMood, Provider, ApprovalMode } from '../types/index.js';
interface NyxHeaderProps {
    mood: NyxMood;
    provider: Provider;
    model: string;
    workingDir: string;
    tokenCount: number;
    approvalMode: ApprovalMode;
    persona: string | null;
    sessionCost: number;
    version?: string;
    maxTokens?: number;
    liveTokens?: number;
}
export declare function NyxHeader({ mood, provider, model, workingDir, tokenCount, approvalMode, persona, sessionCost, version, maxTokens, liveTokens, }: NyxHeaderProps): React.ReactElement;
export {};
//# sourceMappingURL=NyxHeader.d.ts.map