// src/agents/agentSpawner.ts
// Real independent agent spawning system

import type { Provider, Message, ToolCall } from '../types/index.js';
import { runAgent, AgentConfig, BUILTIN_TOOLS, streamProvider } from '../providers/client.js';
import { ToolExecutor } from '../tools/executor.js';
import { getAgentRegistry } from './registry/loader.js';
import { logger } from '../core/logger.js';

export interface SpawnedAgent {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  errors: string[];
  startTime: number;
  endTime?: number;
  toolCalls: number;
  tokensUsed: number;
  abortController: AbortController;
}

export interface AgentSpawnConfig {
  agentId: string;
  task: string;
  provider: Provider;
  apiKeys: Partial<Record<Provider, string>>;
  model: string;
  workingDir: string;
  systemPrompt?: string;
  maxSteps?: number;
  timeout?: number;
  onProgress?: (agentId: string, chunk: string) => void;
  onComplete?: (agent: SpawnedAgent) => void;
}

const activeAgents = new Map<string, SpawnedAgent>();

/**
 * Spawn an independent agent with its own tool executor, conversation state, and abort controller.
 * The agent runs in the background and reports progress via callbacks.
 */
export async function spawnAgent(config: AgentSpawnConfig): Promise<SpawnedAgent> {
  const registry = getAgentRegistry();
  const agentDef = registry.getAgent(config.agentId);

  if (!agentDef) {
    const agent: SpawnedAgent = {
      id: config.agentId,
      name: config.agentId,
      status: 'failed',
      output: '',
      errors: [`Agent "${config.agentId}" not found in registry`],
      startTime: Date.now(),
      toolCalls: 0,
      tokensUsed: 0,
      abortController: new AbortController(),
    };
    activeAgents.set(agent.id, agent);
    config.onComplete?.(agent);
    return agent;
  }

  const agent: SpawnedAgent = {
    id: config.agentId,
    name: agentDef.name,
    status: 'running',
    output: '',
    errors: [],
    startTime: Date.now(),
    toolCalls: 0,
    tokensUsed: 0,
    abortController: new AbortController(),
  };

  activeAgents.set(agent.id, agent);
  logger.info('Agent spawned', { id: agent.id, name: agent.name, task: config.task.slice(0, 100) });

  // Create independent tool executor for this agent
  const executor = new ToolExecutor(config.workingDir);

  // Build the agent's system prompt
  const systemPrompt = [
    config.systemPrompt || '',
    `--- Active Agent: ${agentDef.name} ---`,
    agentDef.vibe ? `Vibe: ${agentDef.vibe}` : '',
    agentDef.prompt,
    `--- Task: ${config.task} ---`,
  ].filter(Boolean).join('\n\n');

  const messages: Message[] = [
    { role: 'user', content: config.task },
  ];

  const agentCfg: AgentConfig = {
    maxSteps: config.maxSteps ?? 20,
    tools: BUILTIN_TOOLS,
    onToolCall: async () => ({ allowed: true, allowAll: false }),
    onToolResult: (_tc: ToolCall, result: string) => {
      agent.toolCalls++;
      agent.output += `[tool:${_tc.name}] ${result.slice(0, 500)}\n`;
      config.onProgress?.(agent.id, `Tool: ${_tc.name} → ${result.slice(0, 100)}`);
    },
    executeTool: async (toolCall: ToolCall) => executor.execute(toolCall),
  };

  // Run with timeout
  const timeout = config.timeout ?? 300000; // 5 minutes default
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Agent timed out after ${timeout / 1000}s`)), timeout);
  });

  try {
    await Promise.race([
      runAgent(
        config.provider,
        config.apiKeys,
        config.model,
        messages,
        (chunk) => {
          if (chunk.text) {
            agent.output += chunk.text;
            agent.tokensUsed += Math.ceil(chunk.text.length / 4);
            config.onProgress?.(agent.id, chunk.text);
          }
        },
        agentCfg,
        systemPrompt,
        agent.abortController.signal,
      ),
      timeoutPromise,
    ]);

    agent.status = 'completed';
    agent.endTime = Date.now();
    logger.info('Agent completed', {
      id: agent.id,
      name: agent.name,
      duration: agent.endTime - agent.startTime,
      toolCalls: agent.toolCalls,
      tokensUsed: agent.tokensUsed,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('Cancelled')) {
      agent.status = 'cancelled';
    } else if (errorMsg.includes('timed out')) {
      agent.status = 'failed';
      agent.errors.push(errorMsg);
    } else {
      agent.status = 'failed';
      agent.errors.push(errorMsg);
    }
    agent.endTime = Date.now();
    logger.warn('Agent failed', { id: agent.id, name: agent.name, error: errorMsg });
  }

  config.onComplete?.(agent);
  return agent;
}

/**
 * Cancel a running agent
 */
export function cancelAgent(agentId: string): boolean {
  const agent = activeAgents.get(agentId);
  if (!agent || agent.status !== 'running') return false;
  agent.abortController.abort();
  agent.status = 'cancelled';
  agent.endTime = Date.now();
  logger.info('Agent cancelled', { id: agentId });
  return true;
}

/**
 * Get status of all active agents
 */
export function getActiveAgents(): Array<{
  id: string;
  name: string;
  status: string;
  toolCalls: number;
  duration: number;
  outputLength: number;
}> {
  const result: Array<{ id: string; name: string; status: string; toolCalls: number; duration: number; outputLength: number }> = [];
  for (const agent of activeAgents.values()) {
    result.push({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      toolCalls: agent.toolCalls,
      duration: (agent.endTime ?? Date.now()) - agent.startTime,
      outputLength: agent.output.length,
    });
  }
  return result;
}

/**
 * Get output of a specific agent
 */
export function getAgentOutput(agentId: string): SpawnedAgent | undefined {
  return activeAgents.get(agentId);
}

/**
 * Clean up completed agents older than 1 hour
 */
export function cleanupOldAgents(maxAge = 3600000): void {
  const now = Date.now();
  for (const [id, agent] of activeAgents.entries()) {
    if (agent.status !== 'running' && agent.endTime && (now - agent.endTime) > maxAge) {
      activeAgents.delete(id);
    }
  }
}

/**
 * Spawn multiple agents in parallel with a concurrency limit
 */
export async function spawnAgents(
  configs: AgentSpawnConfig[],
  concurrency = 5,
): Promise<SpawnedAgent[]> {
  const results: SpawnedAgent[] = [];
  const queue = [...configs];

  const worker = async () => {
    while (queue.length > 0) {
      const config = queue.shift()!;
      const agent = await spawnAgent(config);
      results.push(agent);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, configs.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
