import { describe, it, expect } from 'vitest';

describe('Auto-Dispatch — Behavioral', () => {
  describe('analyzeTaskForAgents', () => {
    it('should dispatch agents for security tasks', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('Fix the security vulnerability in auth', agents);
      expect(result.shouldDispatch).toBe(true);
    });

    it('should dispatch agents for database tasks', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('Optimize the database queries', agents);
      expect(result.shouldDispatch).toBe(true);
    });

    it('should dispatch agents for frontend tasks', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('Fix the UI CSS layout', agents);
      expect(result.shouldDispatch).toBe(true);
    });

    it('should not dispatch for empty tasks', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('', agents);
      expect(result.shouldDispatch).toBe(false);
    });

    it('should limit agents to 5', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('Fix security vulnerability optimize database refactor frontend deploy infrastructure', agents);
      expect(result.selectedAgents.length).toBeLessThanOrEqual(5);
    });

    it('should deduplicate agents', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('security security security', agents);
      const uniqueIds = new Set(result.selectedAgents.map(a => a.agent.id));
      expect(uniqueIds.size).toBe(result.selectedAgents.length);
    });
  });

  describe('autoDispatchAgents', () => {
    it('should respect disabled setting', async () => {
      const { autoDispatchAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const settings = { agentDispatch: { enabled: false } };
      const result = await autoDispatchAgents('test', 'ollama', {}, 'qwen2.5', process.cwd(), settings as any, '', []);
      expect(result).toBe('');
    });

    it('should return empty for non-matching tasks', async () => {
      const { autoDispatchAgents } = await import('../src/agents/autoDispatch.js');
      const settings = { agentDispatch: { enabled: true } };
      const result = await autoDispatchAgents('xyznonexistent123', 'ollama', {}, 'qwen2.5', process.cwd(), settings as any, '', []);
      expect(result).toBe('');
    });
  });
});

describe('Auto-Dispatch — Technical', () => {
  describe('keyword matching', () => {
    it('should match case-insensitive keywords', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('SECURITY VULNERABILITY', agents);
      expect(result.selectedAgents.length).toBeGreaterThan(0);
    });

    it('should match partial keywords', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('I need to optimize', agents);
      expect(result.shouldDispatch).toBe(true);
    });
  });

  describe('priority scoring', () => {
    it('should score longer keyword matches higher', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('authentication', agents);
      if (result.selectedAgents.length > 1) {
        expect(result.selectedAgents[0].priority).toBeGreaterThanOrEqual(result.selectedAgents[1].priority);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle tasks with special characters', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const result = analyzeTaskForAgents('Fix the bug! @#$%', agents);
      expect(Array.isArray(result.selectedAgents)).toBe(true);
    });

    it('should handle very long tasks', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const { getAgentRegistry } = await import('../src/agents/registry/loader.js');
      const agents = getAgentRegistry().allAgents;
      const longTask = 'security '.repeat(1000);
      const result = analyzeTaskForAgents(longTask, agents);
      expect(result.selectedAgents.length).toBeLessThanOrEqual(5);
    });

    it('should handle empty agent list', async () => {
      const { analyzeTaskForAgents } = await import('../src/agents/autoDispatch.js');
      const result = analyzeTaskForAgents('security', []);
      expect(result.shouldDispatch).toBe(false);
    });
  });
});
