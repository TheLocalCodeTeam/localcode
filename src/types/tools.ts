// src/types/tools.ts
// Tool-related types

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  diff?: FileDiff;
}

export interface FileDiff {
  path: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}
