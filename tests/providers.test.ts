import { describe, it, expect } from 'vitest';
import { resolveModelForStep } from '../src/providers/client.js';
import type { ModelRouting } from '../src/core/types.js';

describe('resolveModelForStep', () => {
  it('should return default model when no routing', () => {
    expect(resolveModelForStep(0, 10, null, 'default')).toBe('default');
  });

  it('should return planning model for step 0', () => {
    const routing: ModelRouting = {
      planning: 'planner',
      execution: 'executor',
      review: 'reviewer',
    };
    expect(resolveModelForStep(0, 10, routing, 'default')).toBe('planner');
  });

  it('should return review model for last step', () => {
    const routing: ModelRouting = {
      planning: 'planner',
      execution: 'executor',
      review: 'reviewer',
    };
    expect(resolveModelForStep(9, 10, routing, 'default')).toBe('reviewer');
  });

  it('should return execution model for middle steps', () => {
    const routing: ModelRouting = {
      planning: 'planner',
      execution: 'executor',
      review: 'reviewer',
    };
    expect(resolveModelForStep(5, 10, routing, 'default')).toBe('executor');
  });
});

describe('retryWithBackoff', () => {
  it('should succeed on first try', async () => {
    const { retryWithBackoff } = await import('../src/providers/client.js');
    const result = await retryWithBackoff(async () => 'success', 'test');
    expect(result).toBe('success');
  });

  it('should retry on failure', async () => {
    const { retryWithBackoff } = await import('../src/providers/client.js');
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
    const { retryWithBackoff } = await import('../src/providers/client.js');
    await expect(
      retryWithBackoff(async () => { throw new Error('always fail'); }, 'test')
    ).rejects.toThrow('always fail');
  }, 15000);
});
