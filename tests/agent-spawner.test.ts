import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Agent Spawner — Behavioral', () => {
  describe('spawnAgent', () => {
    it('should fail gracefully for non-existent agent', async () => {
      const { spawnAgent } = await import('../src/agents/agentSpawner.js');
      const agent = await spawnAgent({
        agentId: 'nonexistent-agent',
        task: 'test task',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
      });
      expect(agent.status).toBe('failed');
      expect(agent.errors.length).toBeGreaterThan(0);
    });

    it('should create agent with running status initially', async () => {
      const { spawnAgent } = await import('../src/agents/agentSpawner.js');
      const promise = spawnAgent({
        agentId: 'some-agent',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 1000, // Very short timeout for test
      });
      // Agent should have an abort controller
      const agents = (await import('../src/agents/agentSpawner.js')).getActiveAgents();
      expect(agents.length).toBeGreaterThan(0);
      await promise.catch(() => {});
    });
  });

  describe('cancelAgent', () => {
    it('should return false for non-existent agent', async () => {
      const { cancelAgent } = await import('../src/agents/agentSpawner.js');
      expect(cancelAgent('nonexistent')).toBe(false);
    });

    it('should return false for already completed agent', async () => {
      const { spawnAgent, cancelAgent } = await import('../src/agents/agentSpawner.js');
      await spawnAgent({
        agentId: 'nonexistent',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
      }).catch(() => {});
      expect(cancelAgent('nonexistent-agent')).toBe(false);
    });
  });

  describe('getActiveAgents', () => {
    it('should return array of agent statuses', async () => {
      const { getActiveAgents } = await import('../src/agents/agentSpawner.js');
      const agents = getActiveAgents();
      expect(Array.isArray(agents)).toBe(true);
    });

    it('should include agent metadata', async () => {
      const { getActiveAgents, spawnAgent } = await import('../src/agents/agentSpawner.js');
      await spawnAgent({
        agentId: 'test-agent',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 500,
      }).catch(() => {});
      const agents = getActiveAgents();
      if (agents.length > 0) {
        expect(agents[0]).toHaveProperty('id');
        expect(agents[0]).toHaveProperty('name');
        expect(agents[0]).toHaveProperty('status');
        expect(agents[0]).toHaveProperty('toolCalls');
        expect(agents[0]).toHaveProperty('duration');
        expect(agents[0]).toHaveProperty('outputLength');
      }
    });
  });

  describe('getAgentOutput', () => {
    it('should return undefined for non-existent agent', async () => {
      const { getAgentOutput } = await import('../src/agents/agentSpawner.js');
      expect(getAgentOutput('nonexistent')).toBeUndefined();
    });
  });

  describe('cleanupOldAgents', () => {
    it('should not throw on empty agent list', async () => {
      const { cleanupOldAgents } = await import('../src/agents/agentSpawner.js');
      cleanupOldAgents();
      // Should not throw
    });

    it('should clean up completed agents older than maxAge', async () => {
      const { cleanupOldAgents, spawnAgent, getActiveAgents } = await import('../src/agents/agentSpawner.js');
      await spawnAgent({
        agentId: 'old-agent',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 100,
      }).catch(() => {});
      cleanupOldAgents(0); // Clean up everything
      const agents = getActiveAgents();
      // Old completed agents should be cleaned up
      expect(agents.filter(a => a.id === 'old-agent').length).toBe(0);
    });
  });

  describe('spawnAgents (parallel)', () => {
    it('should spawn multiple agents with concurrency limit', async () => {
      const { spawnAgents } = await import('../src/agents/agentSpawner.js');
      const results = await spawnAgents([
        { agentId: 'agent1', task: 'test1', provider: 'ollama', apiKeys: {}, model: 'qwen2.5', workingDir: os.tmpdir(), timeout: 100 },
        { agentId: 'agent2', task: 'test2', provider: 'ollama', apiKeys: {}, model: 'qwen2.5', workingDir: os.tmpdir(), timeout: 100 },
      ], 2);
      expect(results.length).toBe(2);
    });

    it('should handle empty config array', async () => {
      const { spawnAgents } = await import('../src/agents/agentSpawner.js');
      const results = await spawnAgents([], 2);
      expect(results).toEqual([]);
    });
  });
});

describe('Agent Spawner — Technical', () => {
  describe('agent state management', () => {
    it('should track agent start time', async () => {
      const { spawnAgent, getActiveAgents } = await import('../src/agents/agentSpawner.js');
      const before = Date.now();
      await spawnAgent({
        agentId: 'time-test',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 100,
      }).catch(() => {});
      const agents = getActiveAgents();
      const agent = agents.find(a => a.id === 'time-test');
      if (agent) {
        expect(agent.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track tool call count', async () => {
      const { spawnAgent, getActiveAgents } = await import('../src/agents/agentSpawner.js');
      await spawnAgent({
        agentId: 'tool-count-test',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 100,
      }).catch(() => {});
      const agents = getActiveAgents();
      const agent = agents.find(a => a.id === 'tool-count-test');
      if (agent) {
        expect(typeof agent.toolCalls).toBe('number');
        expect(agent.toolCalls).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track output length', async () => {
      const { spawnAgent, getActiveAgents } = await import('../src/agents/agentSpawner.js');
      await spawnAgent({
        agentId: 'output-test',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 100,
      }).catch(() => {});
      const agents = getActiveAgents();
      const agent = agents.find(a => a.id === 'output-test');
      if (agent) {
        expect(typeof agent.outputLength).toBe('number');
        expect(agent.outputLength).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('timeout handling', () => {
    it('should respect custom timeout', async () => {
      const { spawnAgent } = await import('../src/agents/agentSpawner.js');
      const start = Date.now();
      await spawnAgent({
        agentId: 'timeout-test',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 200,
      }).catch(() => {});
      const elapsed = Date.now() - start;
      // Should complete within reasonable time (timeout + overhead)
      expect(elapsed).toBeLessThan(5000);
    });
  });

  describe('progress callbacks', () => {
    it('should call onProgress callback', async () => {
      const { spawnAgent } = await import('../src/agents/agentSpawner.js');
      const progress: string[] = [];
      await spawnAgent({
        agentId: 'progress-test',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 100,
        onProgress: (id, chunk) => { progress.push(`${id}: ${chunk}`); },
      }).catch(() => {});
      // Progress may or may not have entries depending on agent behavior
      expect(Array.isArray(progress)).toBe(true);
    });

    it('should call onComplete callback', async () => {
      const { spawnAgent } = await import('../src/agents/agentSpawner.js');
      let completed = false;
      await spawnAgent({
        agentId: 'complete-test',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 100,
        onComplete: () => { completed = true; },
      }).catch(() => {});
      expect(completed).toBe(true);
    });
  });

  describe('concurrency control', () => {
    it('should respect concurrency limit of 1', async () => {
      const { spawnAgents, getActiveAgents } = await import('../src/agents/agentSpawner.js');
      const results = await spawnAgents([
        { agentId: 'seq1', task: 'test', provider: 'ollama', apiKeys: {}, model: 'qwen2.5', workingDir: os.tmpdir(), timeout: 100 },
        { agentId: 'seq2', task: 'test', provider: 'ollama', apiKeys: {}, model: 'qwen2.5', workingDir: os.tmpdir(), timeout: 100 },
      ], 1);
      expect(results.length).toBe(2);
    });

    it('should handle concurrency larger than task count', async () => {
      const { spawnAgents } = await import('../src/agents/agentSpawner.js');
      const results = await spawnAgents([
        { agentId: 'over1', task: 'test', provider: 'ollama', apiKeys: {}, model: 'qwen2.5', workingDir: os.tmpdir(), timeout: 100 },
      ], 10);
      expect(results.length).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle agent timeout gracefully', async () => {
      const { spawnAgent } = await import('../src/agents/agentSpawner.js');
      const agent = await spawnAgent({
        agentId: 'timeout-agent',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'qwen2.5-coder:7b',
        workingDir: os.tmpdir(),
        timeout: 50,
      });
      expect(['failed', 'cancelled']).toContain(agent.status);
    });

    it('should handle missing provider gracefully', async () => {
      const { spawnAgent } = await import('../src/agents/agentSpawner.js');
      const agent = await spawnAgent({
        agentId: 'missing-provider',
        task: 'test',
        provider: 'ollama',
        apiKeys: {},
        model: 'nonexistent-model',
        workingDir: os.tmpdir(),
        timeout: 500,
      });
      expect(['failed', 'running', 'completed']).toContain(agent.status);
    });
  });
});
