import { Provider, Message, ToolCall, ModelRouting } from '../core/types.js';
export declare function retryWithBackoff<T>(fn: () => Promise<T>, context: string, signal?: AbortSignal): Promise<T>;
export interface StreamChunk {
    type: 'text' | 'tool_call' | 'tool_result' | 'agent_step' | 'done' | 'error';
    text?: string;
    toolCall?: ToolCall;
    error?: string;
    step?: number;
    maxSteps?: number;
}
export type ChunkCallback = (chunk: StreamChunk) => Promise<void> | void;
export declare const BUILTIN_TOOLS: ToolDef[];
export interface ToolDef {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
export interface AgentConfig {
    maxSteps: number;
    tools: ToolDef[];
    onToolCall: (toolCall: ToolCall, step: number) => Promise<{
        allowed: boolean;
        allowAll: boolean;
    }>;
    onToolResult: (toolCall: ToolCall, result: string, diff?: unknown) => void;
    executeTool: (toolCall: ToolCall) => Promise<{
        success: boolean;
        output: string;
        diff?: unknown;
    }>;
    routing?: ModelRouting | null;
}
/**
 * Resolve which model to use for a given step number.
 * planning = step 0, review = last step, execution = everything in between.
 */
export declare function resolveModelForStep(step: number, maxSteps: number, routing: ModelRouting | null | undefined, defaultModel: string): string;
export declare function runAgent(provider: Provider, apiKeys: Partial<Record<Provider, string>>, model: string, messages: Message[], onChunk: ChunkCallback, agentCfg: AgentConfig, systemPrompt?: string, signal?: AbortSignal): Promise<void>;
export declare function streamProvider(provider: Provider, apiKeys: Partial<Record<Provider, string>>, model: string, messages: Message[], onChunk: ChunkCallback, systemPrompt?: string): Promise<void>;
export declare function estimateCost(model: string, inputTokens: number, outputTokens: number): number;
export declare function listModels(provider: Provider, apiKeys: Partial<Record<Provider, string>>): Promise<string[]>;
//# sourceMappingURL=client.d.ts.map