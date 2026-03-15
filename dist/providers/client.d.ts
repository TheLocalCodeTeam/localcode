import { Provider, Message, ToolCall } from '../core/types.js';
export interface StreamChunk {
    type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
    text?: string;
    toolCall?: ToolCall;
    error?: string;
}
export type ChunkCallback = (chunk: StreamChunk) => void;
export declare function estimateCost(model: string, inputTokens: number, outputTokens: number): number;
export declare function streamProvider(provider: Provider, apiKeys: Partial<Record<Provider, string>>, model: string, messages: Message[], onChunk: ChunkCallback, systemPrompt?: string): Promise<void>;
export declare function listModels(provider: Provider, apiKeys: Partial<Record<Provider, string>>): Promise<string[]>;
//# sourceMappingURL=client.d.ts.map