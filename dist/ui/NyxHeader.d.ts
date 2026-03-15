import React from 'react';
import { NyxMood, Provider } from '../core/types.js';
interface NyxHeaderProps {
    mood: NyxMood;
    provider: Provider;
    model: string;
    workingDir: string;
    tokenCount: number;
    allowAll: boolean;
    persona: string | null;
    sessionCost: number;
}
export declare function NyxHeader({ mood, provider, model, workingDir, tokenCount, allowAll, persona, sessionCost, }: NyxHeaderProps): React.ReactElement;
export {};
//# sourceMappingURL=NyxHeader.d.ts.map