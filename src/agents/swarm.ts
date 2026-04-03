import { logger } from '../core/logger.js';
// src/agents/swarm.ts
// Parallel agent swarm — splits a task into N subtasks and runs them concurrently.

import { Provider, ToolCall } from '../types/index.js';
import { runAgent, AgentConfig, BUILTIN_TOOLS, streamProvider } from '../providers/client.js';
import { ToolExecutor } from '../tools/executor.js';

export interface SwarmTask {
  index: number;
  subtask: string;
  output: string;
  error?: string;
  durationMs: number;
}

export interface SwarmOptions {
  provider: Provider;
  apiKeys: Partial<Record<Provider, string>>;
  model: string;
  systemPrompt: string;
  workingDir: string;
  maxStepsPerAgent: number;
  onProgress: (task: SwarmTask) => void;
}

/**
 * Decompose a task into N subtasks using the model, then run each in parallel.
 */
export async function runSwarm(
  task: string,
  n: number,
  opts: SwarmOptions,
): Promise<SwarmTask[]> {
  const decomposePrompt =
    `Decompose the following task into exactly ${n} independent subtasks that can be worked on in parallel.\n` +
    `Each subtask should be self-contained and actionable.\n` +
    `Reply with ONLY a JSON array of strings, no explanation. Example: ["subtask 1", "subtask 2"]\n\n` +
    `Task: ${task}`;

  let subtasks: string[] = [];
  let raw = '';
  await streamProvider(
    opts.provider, opts.apiKeys, opts.model,
    [{ role: 'user', content: decomposePrompt }],
    (chunk) => { if (chunk.text) raw += chunk.text; },
    opts.systemPrompt,
  );

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) subtasks = JSON.parse(match[0]) as string[];
  } catch (err) { logger.warn('Task decomposition fallback', { error: err instanceof Error ? err.message : String(err) }); }

  if (!subtasks.length || subtasks.length < 2) {
    subtasks = raw.split('\n').map((l) => l.replace(/^[\d.\-\s]+/, '').trim()).filter(Boolean).slice(0, n);
    if (!subtasks.length) subtasks = [task];
  }

  const results = await Promise.all(
    subtasks.map(async (subtask, index): Promise<SwarmTask> => {
      const start = Date.now();
      const executor = new ToolExecutor(opts.workingDir);
      let output = '';
      let error: string | undefined;

      const agentCfg: AgentConfig = {
        maxSteps: opts.maxStepsPerAgent,
        tools: BUILTIN_TOOLS,
        onToolCall: async () => ({ allowed: true, allowAll: false }),
        onToolResult: (_tc: ToolCall, result: string) => { output += `[tool] ${result.slice(0, 200)}\n`; },
        executeTool: async (toolCall: ToolCall) => executor.execute(toolCall),
      };

      try {
        await runAgent(
          opts.provider, opts.apiKeys, opts.model,
          [{ role: 'user', content: subtask }],
          (chunk) => { if (chunk.text) output += chunk.text; },
          agentCfg,
          opts.systemPrompt,
        );
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      const result: SwarmTask = {
        index,
        subtask,
        output: output.trim(),
        error,
        durationMs: Date.now() - start,
      };

      opts.onProgress(result);
      return result;
    }),
  );

  return results;
}
