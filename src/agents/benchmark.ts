// src/agents/benchmark.ts
// Run the same prompt across all configured providers and compare results.

import { Provider, PROVIDERS } from '../types/index.js';
import { streamProvider, estimateCost } from '../providers/client.js';

export interface BenchmarkResult {
  provider: Provider;
  model: string;
  response: string;
  latencyMs: number;
  estimatedCostUSD: number;
  outputTokens: number;
}

export interface BenchmarkTarget {
  provider: Provider;
  model: string;
  apiKey?: string;
}

/**
 * Run the same prompt against multiple providers in parallel.
 * Calls onResult as each provider finishes (not all at end).
 */
export async function runBenchmark(
  prompt: string,
  targets: BenchmarkTarget[],
  apiKeys: Partial<Record<Provider, string>>,
  onResult: (result: BenchmarkResult) => void,
): Promise<BenchmarkResult[]> {
  const results = await Promise.all(
    targets.map(async (target): Promise<BenchmarkResult> => {
      const start = Date.now();
      let response = '';

      try {
        await streamProvider(
          target.provider,
          { ...apiKeys, ...(target.apiKey ? { [target.provider]: target.apiKey } : {}) },
          target.model,
          [{ role: 'user', content: prompt }],
          (chunk) => { if (chunk.text) response += chunk.text; },
        );
      } catch (err) {
        response = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      const latencyMs = Date.now() - start;
      const outputTokens = Math.ceil(response.length / 4);
      const inputTokens  = Math.ceil(prompt.length / 4);
      const estimatedCostUSD = estimateCost(target.model, inputTokens, outputTokens);

      const result: BenchmarkResult = {
        provider: target.provider,
        model: target.model,
        response: response.trim(),
        latencyMs,
        estimatedCostUSD,
        outputTokens,
      };

      onResult(result);
      return result;
    }),
  );

  return results.sort((a, b) => a.latencyMs - b.latencyMs);
}

/** Build benchmark targets from current API keys — includes all configured providers. */
export function buildTargets(
  apiKeys: Partial<Record<Provider, string>>,
): BenchmarkTarget[] {
  const targets: BenchmarkTarget[] = [];

  // Always include Ollama (local, free)
  targets.push({ provider: 'ollama', model: PROVIDERS.ollama.defaultModel });

  if (apiKeys.claude) targets.push({ provider: 'claude', model: PROVIDERS.claude.defaultModel });
  if (apiKeys.openai) targets.push({ provider: 'openai', model: PROVIDERS.openai.defaultModel });
  if (apiKeys.groq)   targets.push({ provider: 'groq',   model: PROVIDERS.groq.defaultModel });

  return targets;
}
