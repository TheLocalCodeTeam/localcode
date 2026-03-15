// src/providers/client.ts
// Unified streaming client for Ollama, Claude, OpenAI, Groq

import { Provider, ProviderConfig, Message, ToolCall, PROVIDERS } from '../core/types.js';

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  text?: string;
  toolCall?: ToolCall;
  error?: string;
}

export type ChunkCallback = (chunk: StreamChunk) => void;

// ─── Tool definitions (sent to the model) ─────────────────────────────────────

const TOOLS_DEFINITION = [
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file (creates or overwrites)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_file',
    description: 'Replace a specific string in a file with new content',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to patch' },
        old_str: { type: 'string', description: 'Exact string to replace' },
        new_str: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'run_shell',
    description: 'Run a shell command and return stdout/stderr',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories at a path',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        recursive: { type: 'boolean', description: 'List recursively' },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_operation',
    description: 'Run a git command',
    parameters: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'Git arguments (e.g. "status", "diff HEAD")' },
      },
      required: ['args'],
    },
  },
];

// ─── Ollama client ─────────────────────────────────────────────────────────────

async function streamOllama(
  config: ProviderConfig,
  model: string,
  messages: Message[],
  onChunk: ChunkCallback,
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      tools: TOOLS_DEFINITION,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    onChunk({ type: 'error', error: `Ollama error ${res.status}: ${text}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const msg = obj.message;
        if (!msg) continue;

        if (msg.content) {
          onChunk({ type: 'text', text: msg.content });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            onChunk({
              type: 'tool_call',
              toolCall: {
                name: tc.function.name,
                args: tc.function.arguments ?? {},
              },
            });
          }
        }
        if (obj.done) {
          onChunk({ type: 'done' });
        }
      } catch {
        // Malformed JSON line — skip
      }
    }
  }
}

// ─── Anthropic (Claude) client ────────────────────────────────────────────────

async function streamClaude(
  config: ProviderConfig,
  model: string,
  messages: Message[],
  onChunk: ChunkCallback,
): Promise<void> {
  const apiKey = config.apiKey;
  if (!apiKey) {
    onChunk({ type: 'error', error: 'No Anthropic API key set. Use /apikey sk-ant-...' });
    return;
  }

  // Convert tools to Anthropic format
  const claudeTools = TOOLS_DEFINITION.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const res = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8096,
      messages,
      tools: claudeTools,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    onChunk({ type: 'error', error: `Claude error ${res.status}: ${text}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentToolName = '';
  let currentToolInput = '';
  let inToolUse = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') { onChunk({ type: 'done' }); continue; }
        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
            inToolUse = true;
            currentToolName = ev.content_block.name;
            currentToolInput = '';
          } else if (ev.type === 'content_block_delta') {
            if (inToolUse && ev.delta?.type === 'input_json_delta') {
              currentToolInput += ev.delta.partial_json ?? '';
            } else if (ev.delta?.type === 'text_delta') {
              onChunk({ type: 'text', text: ev.delta.text });
            }
          } else if (ev.type === 'content_block_stop' && inToolUse) {
            try {
              const args = JSON.parse(currentToolInput || '{}');
              onChunk({ type: 'tool_call', toolCall: { name: currentToolName, args } });
            } catch {
              onChunk({ type: 'tool_call', toolCall: { name: currentToolName, args: {} } });
            }
            inToolUse = false;
          } else if (ev.type === 'message_stop') {
            onChunk({ type: 'done' });
          }
        } catch {
          // skip
        }
      }
    }
  }
}

// ─── OpenAI-compatible client (OpenAI + Groq) ────────────────────────────────

async function streamOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  onChunk: ChunkCallback,
  providerName: string,
): Promise<void> {
  if (!apiKey) {
    onChunk({ type: 'error', error: `No ${providerName} API key set. Use /apikey ...` });
    return;
  }

  const openaiTools = TOOLS_DEFINITION.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: openaiTools,
      tool_choice: 'auto',
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    onChunk({ type: 'error', error: `${providerName} error ${res.status}: ${text}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Track partial tool calls (can arrive across multiple chunks)
  const toolCallAccumulators: Record<number, { name: string; args: string }> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') { onChunk({ type: 'done' }); continue; }
      try {
        const ev = JSON.parse(raw);
        const delta = ev.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          onChunk({ type: 'text', text: delta.content });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulators[idx]) {
              toolCallAccumulators[idx] = { name: tc.function?.name ?? '', args: '' };
            }
            if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCallAccumulators[idx].args += tc.function.arguments;
          }
        }

        // Flush complete tool calls when finish_reason is tool_calls
        if (ev.choices?.[0]?.finish_reason === 'tool_calls') {
          for (const acc of Object.values(toolCallAccumulators)) {
            try {
              const args = JSON.parse(acc.args || '{}');
              onChunk({ type: 'tool_call', toolCall: { name: acc.name, args } });
            } catch {
              onChunk({ type: 'tool_call', toolCall: { name: acc.name, args: {} } });
            }
          }
          onChunk({ type: 'done' });
        }
      } catch {
        // skip
      }
    }
  }
}

// ─── Unified entrypoint ───────────────────────────────────────────────────────

// ─── Token cost estimates (per 1M tokens, USD) ────────────────────────────────

const COST_PER_1M: Partial<Record<string, { in: number; out: number }>> = {
  'claude-sonnet-4-5':         { in: 3,    out: 15 },
  'claude-opus-4-5':           { in: 15,   out: 75 },
  'claude-haiku-4-5':          { in: 0.25, out: 1.25 },
  'gpt-4o':                    { in: 2.5,  out: 10 },
  'gpt-4o-mini':               { in: 0.15, out: 0.6 },
  'llama-3.3-70b-versatile':   { in: 0.59, out: 0.79 },
  'mixtral-8x7b-32768':        { in: 0.24, out: 0.24 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1M[model];
  if (!rates) return 0;
  return (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
}

export async function streamProvider(
  provider: Provider,
  apiKeys: Partial<Record<Provider, string>>,
  model: string,
  messages: Message[],
  onChunk: ChunkCallback,
  systemPrompt?: string,
): Promise<void> {
  const config = { ...PROVIDERS[provider], apiKey: apiKeys[provider] };

  // Prepend system prompt as first message if provided
  const msgsWithSys: Message[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  switch (provider) {
    case 'ollama':
      return streamOllama(config, model, msgsWithSys, onChunk);
    case 'claude':
      return streamClaude(config, model, msgsWithSys, onChunk);
    case 'openai':
      return streamOpenAICompat(
        config.baseUrl, config.apiKey ?? '', model, msgsWithSys, onChunk, 'OpenAI',
      );
    case 'groq':
      return streamOpenAICompat(
        config.baseUrl, config.apiKey ?? '', model, msgsWithSys, onChunk, 'Groq',
      );
  }
}

// ─── Model listing ─────────────────────────────────────────────────────────────

export async function listModels(
  provider: Provider,
  apiKeys: Partial<Record<Provider, string>>,
): Promise<string[]> {
  try {
    if (provider === 'ollama') {
      const res = await fetch('http://localhost:11434/api/tags');
      if (!res.ok) return [];
      const data = await res.json() as { models: Array<{ name: string }> };
      return data.models.map((m) => m.name);
    }
    if (provider === 'openai') {
      const key = apiKeys.openai;
      if (!key) return [];
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: Array<{ id: string }> };
      return data.data.map((m) => m.id).filter((id) => id.startsWith('gpt')).sort();
    }
    if (provider === 'groq') {
      const key = apiKeys.groq;
      if (!key) return [];
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: Array<{ id: string }> };
      return data.data.map((m) => m.id).sort();
    }
    if (provider === 'claude') {
      // Anthropic doesn't have a public list endpoint — return known models
      return [
        'claude-opus-4-5',
        'claude-sonnet-4-5',
        'claude-haiku-4-5-20251001',
      ];
    }
    return [];
  } catch {
    return [];
  }
}
