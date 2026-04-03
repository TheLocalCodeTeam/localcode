// src/types/providers.ts
// Provider and model related types

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
  images?: Array<{ base64: string; mimeType: string }>;
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  ollama: {
    name: 'ollama',
    displayName: 'Ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'qwen2.5-coder:7b',
    color: 'gray',
    requiresKey: false,
  },
  claude: {
    name: 'claude',
    displayName: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    color: 'orange',
    requiresKey: true,
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o',
    color: 'green',
    requiresKey: true,
  },
  groq: {
    name: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai',
    defaultModel: 'llama-3.3-70b-versatile',
    color: 'red',
    requiresKey: true,
  },
};
