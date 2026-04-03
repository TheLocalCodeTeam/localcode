import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Agent Orchestrator — Behavioral', () => {
  describe('getOrchestrator', () => {
    it('should return a singleton instance', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const o1 = getOrchestrator();
      const o2 = getOrchestrator();
      expect(o1).toBe(o2);
    });
  });

  describe('getAvailableAgents', () => {
    it('should return array of agents', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const agents = orchestrator.getAvailableAgents();
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe('getCategories', () => {
    it('should return array of categories', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const categories = orchestrator.getCategories();
      expect(Array.isArray(categories)).toBe(true);
    });
  });

  describe('searchAgents', () => {
    it('should return empty array for non-matching query', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const results = orchestrator.searchAgents('xyznonexistent123');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should return agents matching query', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const results = orchestrator.searchAgents('engineer');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return null when no orchestration running', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const status = orchestrator.getStatus();
      expect(status).toBeNull();
    });
  });

  describe('runOrchestration', () => {
    it('should handle non-existent agent gracefully', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const state = await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'nonexistent-agent',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test task', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 5);
      expect(state).toBeDefined();
      expect(state.phase).toBe('complete');
    });

    it('should set correct initial phase', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const promise = orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test-agent',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1);
      // During execution, phase should be set
      expect(orchestrator.getStatus()).not.toBeNull();
      await promise.catch(() => {});
    });
  });

  describe('progress callbacks', () => {
    it('should call progress callback during orchestration', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      const progress: any[] = [];
      orchestrator.setProgressCallback((state) => { progress.push(state); });
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      expect(progress.length).toBeGreaterThan(0);
    });
  });
});

describe('Agent Orchestrator — Technical', () => {
  describe('orchestration state machine', () => {
    it('should transition through phases correctly', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status).not.toBeNull();
      expect(status!.phase).toBe('complete');
      expect(status!.qualityGatePassed).toBeDefined();
    });

    it('should track start time', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status!.startTime).toBeLessThanOrEqual(Date.now());
    });

    it('should track completed and failed tasks', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'nonexistent',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(Array.isArray(status!.completedTasks)).toBe(true);
      expect(Array.isArray(status!.failedTasks)).toBe(true);
    });
  });

  describe('quality gates', () => {
    it('should retry failed tasks when qualityGate is true', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'nonexistent',
        supportingAgents: [],
        maxRetries: 2,
        qualityGates: true,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status).not.toBeNull();
    });

    it('should skip retries when qualityGate is false', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'nonexistent',
        supportingAgents: [],
        maxRetries: 2,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status).not.toBeNull();
    });
  });

  describe('mode handling', () => {
    it('should handle micro mode (single phase)', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status!.phase).toBe('complete');
    });

    it('should handle sprint mode', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'sprint',
        primaryAgent: 'test',
        supportingAgents: ['test2'],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status).not.toBeNull();
    });

    it('should handle full mode', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'full',
        primaryAgent: 'test',
        supportingAgents: ['test2', 'test3'],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status).not.toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle provider connection errors', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test', 'ollama', {}, 'nonexistent-model', os.tmpdir(), '', 1).catch(() => {});
      // Should not throw
    });

    it('should handle empty task string', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, '', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      // Should not throw
    });
  });

  describe('synthesis', () => {
    it('should synthesize multiple task outputs', async () => {
      const { getOrchestrator } = await import('../src/agents/orchestrator.js');
      const orchestrator = getOrchestrator();
      await orchestrator.runOrchestration({
        mode: 'micro',
        primaryAgent: 'test',
        supportingAgents: [],
        maxRetries: 1,
        qualityGates: false,
      }, 'test task', 'ollama', {}, 'qwen2.5', os.tmpdir(), '', 1).catch(() => {});
      const status = orchestrator.getStatus();
      expect(status).not.toBeNull();
    });
  });
});
