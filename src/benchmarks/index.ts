// src/benchmarks/index.ts
// Performance benchmarks for Localcode

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface BenchmarkResult {
  name: string;
  durationMs: number;
  memoryMB: number;
  iterations: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function getMemoryUsageMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function calculatePercentile(sorted: number[], percentile: number): number {
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export async function runBenchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = 100,
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  const startMemory = getMemoryUsageMB();

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    durations.push(Number(end - start) / 1_000_000); // Convert to ms
  }

  const endMemory = getMemoryUsageMB();
  const sorted = [...durations].sort((a, b) => a - b);
  const totalDuration = durations.reduce((a, b) => a + b, 0);

  return {
    name,
    durationMs: Math.round(totalDuration),
    memoryMB: Math.round((endMemory - startMemory) * 100) / 100,
    iterations,
    avgMs: Math.round(totalDuration / iterations * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    p50Ms: Math.round(calculatePercentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(calculatePercentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(calculatePercentile(sorted, 99) * 100) / 100,
  };
}

export function formatBenchmark(result: BenchmarkResult): string {
  return [
    `Benchmark: ${result.name}`,
    `  Iterations: ${result.iterations}`,
    `  Total: ${result.durationMs}ms`,
    `  Memory: ${result.memoryMB}MB`,
    `  Avg: ${result.avgMs}ms`,
    `  Min: ${result.minMs}ms`,
    `  Max: ${result.maxMs}ms`,
    `  P50: ${result.p50Ms}ms`,
    `  P95: ${result.p95Ms}ms`,
    `  P99: ${result.p99Ms}ms`,
  ].join('\n');
}

export async function runAllBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // File read benchmark
  const testFile = path.join(os.tmpdir(), 'lc-bench-test.txt');
  fs.writeFileSync(testFile, 'x'.repeat(10000), 'utf8');
  results.push(await runBenchmark('File read (10KB)', () => {
    fs.readFileSync(testFile, 'utf8');
  }));

  // File write benchmark
  results.push(await runBenchmark('File write (10KB)', () => {
    fs.writeFileSync(testFile, 'x'.repeat(10000), 'utf8');
  }));

  // JSON parse benchmark
  const jsonData = JSON.stringify({ a: 1, b: 'test', c: [1, 2, 3] });
  results.push(await runBenchmark('JSON parse', () => {
    JSON.parse(jsonData);
  }));

  // String operations benchmark
  results.push(await runBenchmark('String operations', () => {
    const s = 'hello world';
    s.toUpperCase();
    s.toLowerCase();
    s.trim();
    s.replace(/o/g, '0');
    s.split(' ');
  }));

  // Array operations benchmark
  results.push(await runBenchmark('Array operations', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    arr.filter(x => x > 500);
    arr.map(x => x * 2);
    arr.reduce((a, b) => a + b, 0);
    arr.sort((a, b) => b - a);
  }));

  // Regex benchmark
  results.push(await runBenchmark('Regex match', () => {
    /function\s+(\w+)\s*\(/.test('function hello() {');
  }));

  // Path resolution benchmark
  results.push(await runBenchmark('Path resolution', () => {
    path.join('/a', 'b', 'c', 'd.txt');
    path.resolve('/a', 'b', '../c');
    path.normalize('/a//b/../c');
  }));

  // Cleanup
  try { fs.unlinkSync(testFile); } catch { /* ok */ }

  return results;
}

export function generateBenchmarkReport(results: BenchmarkResult[]): string {
  let report = '# Localcode Performance Benchmarks\n\n';
  report += `Date: ${new Date().toISOString()}\n`;
  report += `Platform: ${process.platform} ${process.arch}\n`;
  report += `Node: ${process.versions.node}\n\n`;

  report += '| Benchmark | Avg (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Min (ms) | Max (ms) |\n';
  report += '|-----------|----------|----------|----------|----------|----------|----------|\n';

  for (const r of results) {
    report += `| ${r.name} | ${r.avgMs} | ${r.p50Ms} | ${r.p95Ms} | ${r.p99Ms} | ${r.minMs} | ${r.maxMs} |\n`;
  }

  report += '\n## Memory Usage\n\n';
  for (const r of results) {
    report += `- ${r.name}: ${r.memoryMB}MB\n`;
  }

  return report;
}
