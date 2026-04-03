// src/types/common.ts
// Common types shared across domains

export type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto';

export type NyxMood = 'idle' | 'thinking' | 'happy' | 'error' | 'waiting';

export interface ModelRouting {
  planning: string | null;    // model used for first 1-2 steps
  execution: string | null;   // model used for middle steps
  review: string | null;      // model used for last step
}

export interface ProviderCallEntry {
  provider: string;
  model: string;
  estimatedTokens: number;
  timestamp: number;
}
