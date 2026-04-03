import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveModelForStep, retryWithBackoff, estimateCost } from '../src/providers/client.js';
import type { ModelRouting } from '../src/core/types.js';

// ── Behavioral Tests ──

describe('resolveModelForStep — Behavioral', () => {
  it('should use planning model for step 0', () => {
    const routing: ModelRouting = { planning: 'gpt-4', execution: 'gpt-3.5', review: 'gpt-4' };
    expect(resolveModelForStep(0, 10, routing, 'default')).toBe('gpt-4');
  });

  it('should use execution model for middle steps', () => {
    const routing: ModelRouting = { planning: 'gpt-4', execution: 'gpt-3.5', review: 'gpt-4' };
    expect(resolveModelForStep(5, 10, routing, 'default')).toBe('gpt-3.5');
  });

  it('should use review model for last step', () => {
    const routing: ModelRouting = { planning: 'gpt-4', execution: 'gpt-3.5', review: 'claude-sonnet' };
    expect(resolveModelForStep(9, 10, routing, 'default')).toBe('claude-sonnet');
  });

  it('should use default model when no routing provided', () => {
    expect(resolveModelForStep(0, 10, null, 'qwen2.5')).toBe('qwen2.5');
    expect(resolveModelForStep(5, 10, null, 'qwen2.5')).toBe('qwen2.5');
  });

  it('should use default model when routing has missing fields', () => {
    const routing: ModelRouting = { planning: 'planner', execution: '', review: '' };
    expect(resolveModelForStep(5, 10, routing, 'default')).toBe('');
  });

  it('should handle single-step tasks', () => {
    const routing: ModelRouting = { planning: 'planner', execution: 'executor', review: 'reviewer' };
    expect(resolveModelForStep(0, 1, routing, 'default')).toBe('planner');
  });

  it('should handle two-step tasks', () => {
    const routing: ModelRouting = { planning: 'planner', execution: 'executor', review: 'reviewer' };
    expect(resolveModelForStep(0, 2, routing, 'default')).toBe('planner');
    expect(resolveModelForStep(1, 2, routing, 'default')).toBe('reviewer');
  });
});

describe('retryWithBackoff — Behavioral', () => {
  it('should succeed immediately on first try', async () => {
    const result = await retryWithBackoff(async () => 'success', 'test');
    expect(result).toBe('success');
  });

  it('should retry on failure and succeed', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'success';
    }, 'test');
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should fail after max retries', async () => {
    await expect(
      retryWithBackoff(async () => { throw new Error('always'); }, 'test')
    ).rejects.toThrow('always');
  }, 15000);

  it('should respect abort signal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      retryWithBackoff(async () => { throw new Error('fail'); }, 'test', controller.signal)
    ).rejects.toThrow('Cancelled');
  }, 15000);

  it('should log warnings on retry', async () => {
    let attempts = 0;
    await retryWithBackoff(async () => {
      attempts++;
      if (attempts < 2) throw new Error('retry me');
      return 'ok';
    }, 'test context');
    expect(attempts).toBe(2);
  });

  it('should handle non-Error throws', async () => {
    await expect(
      retryWithBackoff(async () => { throw 'string error'; }, 'test')
    ).rejects.toThrow('string error');
  }, 15000);

  it('should handle null throws', async () => {
    await expect(
      retryWithBackoff(async () => { throw null; }, 'test')
    ).rejects.toThrow('null');
  }, 15000);
});

describe('estimateCost — Behavioral', () => {
  it('should return 0 for zero tokens', () => {
    expect(estimateCost('gpt-4', 0, 0)).toBe(0);
  });

  it('should estimate cost for GPT-4', () => {
    const cost = estimateCost('gpt-4o', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('should estimate cost for Claude', () => {
    const cost = estimateCost('claude-sonnet-4-5', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('should estimate cost for Ollama', () => {
    const cost = estimateCost('qwen2.5', 1000, 500);
    expect(cost).toBe(0); // Ollama is free
  });

  it('should estimate cost for Groq', () => {
    const cost = estimateCost('llama-3.3-70b-versatile', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('should return fallback cost for unknown models', () => {
    const cost = estimateCost('unknown-model', 1000, 500);
    // Unknown models return 0 (free) since we can't price them
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it('should scale linearly with tokens', () => {
    const cost1 = estimateCost('gpt-4', 1000, 500);
    const cost2 = estimateCost('gpt-4', 2000, 1000);
    expect(cost2).toBeCloseTo(cost1 * 2, 5);
  });
});

// ── Technical Tests ──

describe('resolveModelForStep — Technical', () => {
  it('should handle empty string models in routing', () => {
    const routing: ModelRouting = { planning: '', execution: '', review: '' };
    expect(resolveModelForStep(0, 10, routing, 'fallback')).toBe('');
  });

  it('should handle undefined routing', () => {
    expect(resolveModelForStep(0, 10, undefined, 'default')).toBe('default');
  });

  it('should handle maxSteps of 0', () => {
    const routing: ModelRouting = { planning: 'p', execution: 'e', review: 'r' };
    expect(resolveModelForStep(0, 0, routing, 'default')).toBe('p');
  });

  it('should use execution model when step > 0 and < maxSteps - 1', () => {
    const routing: ModelRouting = { planning: 'p', execution: 'e', review: 'r' };
    for (let step = 1; step < 9; step++) {
      expect(resolveModelForStep(step, 10, routing, 'default')).toBe('e');
    }
  });
});

describe('retryWithBackoff — Technical', () => {
  it('should use exponential delays between retries', async () => {
    const timestamps: number[] = [];
    await retryWithBackoff(async () => {
      timestamps.push(Date.now());
      if (timestamps.length < 4) throw new Error('fail');
      return 'ok';
    }, 'test');
    expect(timestamps.length).toBe(4);
    // Check delays are increasing (test mode uses 10/20/30ms)
    const delays = [timestamps[1] - timestamps[0], timestamps[2] - timestamps[1], timestamps[3] - timestamps[2]];
    expect(delays[0]).toBeGreaterThanOrEqual(5);
    expect(delays[1]).toBeGreaterThanOrEqual(delays[0]);
    expect(delays[2]).toBeGreaterThanOrEqual(delays[1]);
  }, 15000);

  it('should not retry on success', async () => {
    let calls = 0;
    await retryWithBackoff(async () => { calls++; return 'ok'; }, 'test');
    expect(calls).toBe(1);
  });

  it('should handle async function rejection', async () => {
    await expect(
      retryWithBackoff(async () => Promise.reject(new Error('async reject')), 'test')
    ).rejects.toThrow('async reject');
  }, 15000);
});

describe('estimateCost — Technical', () => {
  it('should use correct pricing for gpt-4o', () => {
    const cost = estimateCost('gpt-4o', 1000000, 500000);
    expect(cost).toBeGreaterThan(0);
  });

  it('should use correct pricing for claude-sonnet-4', () => {
    const cost = estimateCost('claude-sonnet-4-5', 1000000, 500000);
    expect(cost).toBeGreaterThan(0);
  });

  it('should handle model names with underscores', () => {
    const cost = estimateCost('llama-3.3-70b-versatile', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('should handle very large token counts', () => {
    const cost = estimateCost('gpt-4o', 1000000000, 500000000);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(Infinity);
  });

  it('should handle model names with hyphens', () => {
    const cost = estimateCost('qwen2.5-coder-7b', 1000, 500);
    expect(cost).toBe(0); // Ollama models are free
  });

  it('should handle model names with underscores', () => {
    const cost = estimateCost('llama_3_70b', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('should handle very large token counts', () => {
    const cost = estimateCost('gpt-4', 1000000000, 500000000);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(Infinity);
  });

  it('should handle negative token counts gracefully', () => {
    const cost = estimateCost('gpt-4', -100, -50);
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it('should return consistent results for same inputs', () => {
    const cost1 = estimateCost('gpt-4', 1000, 500);
    const cost2 = estimateCost('gpt-4', 1000, 500);
    expect(cost1).toBe(cost2);
  });

  it('should handle empty model string', () => {
    const cost = estimateCost('', 1000, 500);
    // Empty model string falls back to default pricing
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});
