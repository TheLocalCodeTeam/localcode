export type Provider = 'ollama' | 'claude' | 'openai' | 'groq';
export interface ProviderConfig {
    name: Provider;
    displayName: string;
    baseUrl: string;
    defaultModel: string;
    apiKey?: string;
    color: string;
    requiresKey: boolean;
}
export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}
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
export interface Checkpoint {
    id: string;
    label: string;
    timestamp: number;
    messages: Message[];
    files: Record<string, string>;
}
export interface Persona {
    name: string;
    prompt: string;
}
export interface SessionState {
    provider: Provider;
    model: string;
    messages: Message[];
    checkpoints: Checkpoint[];
    allowAllTools: boolean;
    workingDir: string;
    apiKeys: Partial<Record<Provider, string>>;
    systemPrompt: string;
    personas: Persona[];
    activePersona: string | null;
    pinnedContext: string[];
    autoCheckpoint: boolean;
    sessionCost: number;
    lastAssistantMessage: string;
}
export declare const DEFAULT_SYSTEM_PROMPT = "You are Nyx, an AI coding assistant built into LocalCode \u2014 a terminal tool made by TheAlxLabs.\n\nYou are a friendly pair programmer who explains things as you go. When you write or edit code, briefly explain what you changed and why. When something is complex, break it down. Be direct and concise \u2014 no fluff \u2014 but always friendly.\n\nYou have access to tools: read_file, write_file, patch_file, run_shell, list_dir, git_operation. Use them proactively. Before editing a file you haven't read yet, read it first. When you run shell commands, explain what they do.\n\nNever refuse to help with code. If something is risky, warn the user and ask \u2014 don't just refuse.\n\nThe user is a developer. Treat them like one.";
export declare const DEFAULT_PERSONAS: Persona[];
export interface SlashCommand {
    name: string;
    trigger: string;
    icon: string;
    description: string;
    detail?: string;
    usage?: string;
    category: 'session' | 'context' | 'git' | 'tools' | 'providers';
}
export type NyxMood = 'idle' | 'thinking' | 'happy' | 'error' | 'waiting';
export declare const PROVIDERS: Record<Provider, ProviderConfig>;
export declare const SLASH_COMMANDS: SlashCommand[];
//# sourceMappingURL=types.d.ts.map