// src/providers/client.ts
// Unified streaming + agent loop client for Ollama, Claude, OpenAI, Groq
import { PROVIDERS } from '../core/types.js';
import { logger } from '../core/logger.js';
// ─── Retry helper ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 8000]; // exponential backoff with jitter
export async function retryWithBackoff(fn, context, signal) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (signal?.aborted)
            throw new Error('Cancelled.');
        try {
            return await fn();
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt] + Math.random() * 1000;
                logger.warn(`${context} failed, retrying (attempt ${attempt + 1}/${MAX_RETRIES})`, { error: lastError.message, delay });
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError || new Error(`${context} failed after ${MAX_RETRIES + 1} attempts`);
}
// ─── Built-in tool definitions ─────────────────────────────────────────────────
export const BUILTIN_TOOLS = [
    {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'File path to read' } },
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
        description: 'Replace a specific string in a file with new content. old_str must be unique in the file.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path to patch' },
                old_str: { type: 'string', description: 'Exact string to replace (must appear exactly once)' },
                new_str: { type: 'string', description: 'Replacement string' },
            },
            required: ['path', 'old_str', 'new_str'],
        },
    },
    {
        name: 'delete_file',
        description: 'Delete a file',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'File path to delete' } },
            required: ['path'],
        },
    },
    {
        name: 'move_file',
        description: 'Move or rename a file',
        parameters: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'Source file path' },
                destination: { type: 'string', description: 'Destination file path' },
            },
            required: ['source', 'destination'],
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
        name: 'search_files',
        description: 'Search file contents using a regex or string pattern (like grep -rn). Excludes node_modules, .git, dist.',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Search pattern (regex or string)' },
                path: { type: 'string', description: 'Directory to search in (optional, defaults to working directory)' },
                case_insensitive: { type: 'boolean', description: 'Case-insensitive search' },
            },
            required: ['pattern'],
        },
    },
    {
        name: 'find_files',
        description: 'Find files by name pattern (like find -name). Supports wildcards e.g. "*.ts", "*.test.*"',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Filename pattern with optional wildcards e.g. "*.ts"' },
                path: { type: 'string', description: 'Directory to search in (optional)' },
            },
            required: ['pattern'],
        },
    },
    {
        name: 'git_operation',
        description: 'Run a git command',
        parameters: {
            type: 'object',
            properties: {
                args: { type: 'string', description: 'Git arguments (e.g. "status", "diff HEAD", "log --oneline -10")' },
            },
            required: ['args'],
        },
    },
];
/**
 * Resolve which model to use for a given step number.
 * planning = step 0, review = last step, execution = everything in between.
 */
export function resolveModelForStep(step, maxSteps, routing, defaultModel) {
    if (!routing)
        return defaultModel;
    if (step === 0 && routing.planning)
        return routing.planning;
    if (step >= maxSteps - 1 && routing.review)
        return routing.review;
    if (routing.execution)
        return routing.execution;
    return defaultModel;
}
// ─── Ollama agent ─────────────────────────────────────────────────────────────
async function runOllamaAgent(config, model, messages, onChunk, agentCfg, systemPrompt, signal) {
    const history = [];
    if (systemPrompt)
        history.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
        const entry = { role: m.role, content: m.content };
        if (m.images && m.images.length > 0) {
            entry.images = m.images.map((img) => img.base64);
        }
        history.push(entry);
    }
    const tools = agentCfg.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    for (let step = 0; step < agentCfg.maxSteps; step++) {
        const stepModel = resolveModelForStep(step, agentCfg.maxSteps, agentCfg.routing, model);
        if (signal?.aborted) {
            await onChunk({ type: 'error', error: 'Cancelled.' });
            return;
        }
        await onChunk({ type: 'agent_step', step, maxSteps: agentCfg.maxSteps });
        const res = await retryWithBackoff(async () => {
            const r = await fetch(`${config.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: stepModel, messages: history, stream: true, tools }),
                signal,
            });
            if (!r.ok || !r.body) {
                throw new Error(`Ollama error ${r.status}: ${await r.text()}`);
            }
            return r;
        }, 'Ollama chat request', signal);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let assistantText = '';
        const toolCalls = [];
        while (true) {
            if (signal?.aborted) {
                reader.cancel();
                await onChunk({ type: 'error', error: 'Cancelled.' });
                return;
            }
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const obj = JSON.parse(line);
                    const msg = obj.message;
                    if (!msg)
                        continue;
                    if (msg.content) {
                        assistantText += msg.content;
                        await onChunk({ type: 'text', text: msg.content });
                    }
                    if (msg.tool_calls) {
                        for (const tc of msg.tool_calls) {
                            toolCalls.push({ name: tc.function.name, args: tc.function.arguments ?? {} });
                        }
                    }
                }
                catch { /* skip */ }
            }
        }
        history.push({ role: 'assistant', content: assistantText });
        if (!toolCalls.length) {
            await onChunk({ type: 'done' });
            return;
        }
        for (const toolCall of toolCalls) {
            if (signal?.aborted) {
                await onChunk({ type: 'error', error: 'Cancelled.' });
                return;
            }
            const perm = await agentCfg.onToolCall(toolCall, step);
            if (!perm.allowed) {
                history.push({ role: 'tool', content: `Tool call denied by user: ${toolCall.name}` });
                continue;
            }
            const result = await agentCfg.executeTool(toolCall);
            agentCfg.onToolResult(toolCall, result.output, result.diff);
            history.push({ role: 'tool', content: result.output.slice(0, 8000) });
        }
    }
    await onChunk({ type: 'error', error: `Agent reached max steps (${agentCfg.maxSteps}). Use /steps <n> to increase.` });
}
// ─── Claude agent ──────────────────────────────────────────────────────────────
async function runClaudeAgent(config, model, messages, onChunk, agentCfg, systemPrompt, signal) {
    if (!config.apiKey) {
        await onChunk({ type: 'error', error: 'No Anthropic API key. Use /apikey sk-ant-...' });
        return;
    }
    const claudeTools = agentCfg.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
    const history = messages.map((m) => {
        if (m.images && m.images.length > 0) {
            // Build content array with image blocks + text
            const contentArr = m.images.map((img) => ({
                type: 'image',
                source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
            }));
            contentArr.push({ type: 'text', text: m.content });
            return { role: m.role === 'assistant' ? 'assistant' : 'user', content: contentArr };
        }
        return {
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
        };
    });
    for (let step = 0; step < agentCfg.maxSteps; step++) {
        const stepModel = resolveModelForStep(step, agentCfg.maxSteps, agentCfg.routing, model);
        if (signal?.aborted) {
            await onChunk({ type: 'error', error: 'Cancelled.' });
            return;
        }
        await onChunk({ type: 'agent_step', step, maxSteps: agentCfg.maxSteps });
        const res = await fetch(`${config.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: stepModel,
                max_tokens: 8096,
                system: systemPrompt,
                messages: history,
                tools: claudeTools,
                stream: true,
            }),
            signal,
        });
        if (!res.ok || !res.body) {
            await onChunk({ type: 'error', error: `Claude error ${res.status}: ${await res.text()}` });
            return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let assistantText = '';
        const toolUses = [];
        let currentToolId = '';
        let currentToolName = '';
        let currentToolInput = '';
        let stopReason = '';
        while (true) {
            if (signal?.aborted) {
                reader.cancel();
                await onChunk({ type: 'error', error: 'Cancelled.' });
                return;
            }
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const raw = line.slice(6).trim();
                if (raw === '[DONE]')
                    continue;
                try {
                    const ev = JSON.parse(raw);
                    if (ev.type === 'content_block_start') {
                        if (ev.content_block?.type === 'tool_use') {
                            currentToolId = ev.content_block.id;
                            currentToolName = ev.content_block.name;
                            currentToolInput = '';
                        }
                    }
                    else if (ev.type === 'content_block_delta') {
                        if (ev.delta?.type === 'text_delta') {
                            assistantText += ev.delta.text;
                            await onChunk({ type: 'text', text: ev.delta.text });
                        }
                        else if (ev.delta?.type === 'input_json_delta') {
                            currentToolInput += ev.delta.partial_json ?? '';
                        }
                    }
                    else if (ev.type === 'content_block_stop' && currentToolName) {
                        toolUses.push({ id: currentToolId, name: currentToolName, input: currentToolInput });
                        currentToolName = '';
                    }
                    else if (ev.type === 'message_delta') {
                        stopReason = ev.delta?.stop_reason ?? '';
                    }
                }
                catch { /* skip */ }
            }
        }
        const assistantContent = [];
        if (assistantText)
            assistantContent.push({ type: 'text', text: assistantText });
        for (const tu of toolUses) {
            try {
                assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: JSON.parse(tu.input || '{}') });
            }
            catch {
                assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: {} });
            }
        }
        history.push({ role: 'assistant', content: assistantContent });
        if (!toolUses.length) {
            await onChunk({ type: 'done' });
            return;
        }
        const toolResults = [];
        for (const tu of toolUses) {
            if (signal?.aborted) {
                await onChunk({ type: 'error', error: 'Cancelled.' });
                return;
            }
            let parsedInput = {};
            try {
                parsedInput = JSON.parse(tu.input || '{}');
            }
            catch { /* ok */ }
            const toolCall = { name: tu.name, args: parsedInput };
            const perm = await agentCfg.onToolCall(toolCall, step);
            let resultContent = 'Tool call denied by user.';
            if (perm.allowed) {
                const result = await agentCfg.executeTool(toolCall);
                agentCfg.onToolResult(toolCall, result.output, result.diff);
                resultContent = result.output.slice(0, 8000);
            }
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: resultContent });
        }
        history.push({ role: 'user', content: toolResults });
    }
    await onChunk({ type: 'error', error: `Agent reached max steps (${agentCfg.maxSteps}).` });
}
// ─── OpenAI-compatible agent (OpenAI + Groq) ─────────────────────────────────
async function runOpenAIAgent(baseUrl, apiKey, model, messages, onChunk, agentCfg, providerName, systemPrompt, signal) {
    if (!apiKey) {
        await onChunk({ type: 'error', error: `No ${providerName} API key. Use /apikey ...` });
        return;
    }
    const oaiTools = agentCfg.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const history = [];
    if (systemPrompt)
        history.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
        if (m.images && m.images.length > 0) {
            // Build content array with image_url blocks + text
            const contentArr = m.images.map((img) => ({
                type: 'image_url',
                image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
            }));
            contentArr.push({ type: 'text', text: m.content });
            history.push({ role: m.role, content: contentArr });
        }
        else {
            history.push({ role: m.role, content: m.content });
        }
    }
    for (let step = 0; step < agentCfg.maxSteps; step++) {
        const stepModel = resolveModelForStep(step, agentCfg.maxSteps, agentCfg.routing, model);
        if (signal?.aborted) {
            await onChunk({ type: 'error', error: 'Cancelled.' });
            return;
        }
        await onChunk({ type: 'agent_step', step, maxSteps: agentCfg.maxSteps });
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: stepModel, messages: history, tools: oaiTools, tool_choice: 'auto', stream: true }),
            signal,
        });
        if (!res.ok || !res.body) {
            await onChunk({ type: 'error', error: `${providerName} error ${res.status}: ${await res.text()}` });
            return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let assistantText = '';
        const tcAccum = {};
        let finishReason = '';
        while (true) {
            if (signal?.aborted) {
                reader.cancel();
                await onChunk({ type: 'error', error: 'Cancelled.' });
                return;
            }
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const raw = line.slice(6).trim();
                if (raw === '[DONE]')
                    continue;
                try {
                    const ev = JSON.parse(raw);
                    const delta = ev.choices?.[0]?.delta;
                    finishReason = ev.choices?.[0]?.finish_reason ?? finishReason;
                    if (!delta)
                        continue;
                    if (delta.content) {
                        assistantText += delta.content;
                        await onChunk({ type: 'text', text: delta.content });
                    }
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!tcAccum[idx])
                                tcAccum[idx] = { id: tc.id ?? '', name: '', args: '' };
                            if (tc.id)
                                tcAccum[idx].id = tc.id;
                            if (tc.function?.name)
                                tcAccum[idx].name += tc.function.name;
                            if (tc.function?.arguments)
                                tcAccum[idx].args += tc.function.arguments;
                        }
                    }
                }
                catch { /* skip */ }
            }
        }
        const toolCalls = Object.values(tcAccum);
        const assistantMsg = { role: 'assistant', content: assistantText || null };
        if (toolCalls.length) {
            assistantMsg.tool_calls = toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.args },
            }));
        }
        history.push(assistantMsg);
        if (!toolCalls.length || finishReason === 'stop') {
            await onChunk({ type: 'done' });
            return;
        }
        for (const tc of toolCalls) {
            if (signal?.aborted) {
                await onChunk({ type: 'error', error: 'Cancelled.' });
                return;
            }
            let args = {};
            try {
                args = JSON.parse(tc.args || '{}');
            }
            catch { /* ok */ }
            const toolCall = { name: tc.name, args };
            const perm = await agentCfg.onToolCall(toolCall, step);
            let resultContent = 'Tool call denied by user.';
            if (perm.allowed) {
                const result = await agentCfg.executeTool(toolCall);
                agentCfg.onToolResult(toolCall, result.output, result.diff);
                resultContent = result.output.slice(0, 8000);
            }
            history.push({ role: 'tool', content: resultContent, tool_call_id: tc.id });
        }
    }
    await onChunk({ type: 'error', error: `Agent reached max steps (${agentCfg.maxSteps}).` });
}
// ─── Public API ───────────────────────────────────────────────────────────────
export async function runAgent(provider, apiKeys, model, messages, onChunk, agentCfg, systemPrompt, signal) {
    const config = { ...PROVIDERS[provider], apiKey: apiKeys[provider] };
    switch (provider) {
        case 'ollama':
            return runOllamaAgent(config, model, messages, onChunk, agentCfg, systemPrompt, signal);
        case 'claude':
            return runClaudeAgent(config, model, messages, onChunk, agentCfg, systemPrompt, signal);
        case 'openai':
            return runOpenAIAgent(config.baseUrl, config.apiKey ?? '', model, messages, onChunk, agentCfg, 'OpenAI', systemPrompt, signal);
        case 'groq':
            return runOpenAIAgent(config.baseUrl, config.apiKey ?? '', model, messages, onChunk, agentCfg, 'Groq', systemPrompt, signal);
    }
}
export async function streamProvider(provider, apiKeys, model, messages, onChunk, systemPrompt) {
    return runAgent(provider, apiKeys, model, messages, onChunk, {
        maxSteps: 1,
        tools: BUILTIN_TOOLS,
        onToolCall: async () => ({ allowed: true, allowAll: false }),
        onToolResult: () => { },
        executeTool: async () => ({ success: false, output: 'Tool calls disabled in single-turn mode' }),
    }, systemPrompt);
}
// ─── Token cost estimates ─────────────────────────────────────────────────────
const COST_PER_1M = {
    'claude-sonnet-4-5': { in: 3, out: 15 },
    'claude-sonnet-4-6': { in: 3, out: 15 },
    'claude-opus-4-5': { in: 15, out: 75 },
    'claude-opus-4-6': { in: 15, out: 75 },
    'claude-haiku-4-5': { in: 0.25, out: 1.25 },
    'claude-haiku-4-5-20251001': { in: 0.25, out: 1.25 },
    'gpt-4o': { in: 2.5, out: 10 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
    'gpt-4.1': { in: 2.0, out: 8.0 },
    'gpt-4.1-mini': { in: 0.4, out: 1.6 },
    'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
    'mixtral-8x7b-32768': { in: 0.24, out: 0.24 },
};
export function estimateCost(model, inputTokens, outputTokens) {
    // Try exact match first, then prefix match (e.g. "claude-sonnet-4-5" matches "claude-sonnet-4-5-20251022")
    const rates = COST_PER_1M[model]
        ?? Object.entries(COST_PER_1M).find(([k]) => model.startsWith(k))?.[1];
    if (!rates)
        return 0;
    return (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
}
export async function listModels(provider, apiKeys) {
    try {
        if (provider === 'ollama') {
            const res = await fetch('http://localhost:11434/api/tags');
            if (!res.ok)
                return [];
            const data = await res.json();
            return data.models.map((m) => m.name);
        }
        if (provider === 'openai') {
            const key = apiKeys.openai;
            if (!key)
                return [];
            const res = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${key}` },
            });
            if (!res.ok)
                return [];
            const data = await res.json();
            return data.data.map((m) => m.id).filter((id) => id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3')).sort();
        }
        if (provider === 'groq') {
            const key = apiKeys.groq;
            if (!key)
                return [];
            const res = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { Authorization: `Bearer ${key}` },
            });
            if (!res.ok)
                return [];
            const data = await res.json();
            return data.data.map((m) => m.id).sort();
        }
        if (provider === 'claude') {
            return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001'];
        }
        return [];
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=client.js.map