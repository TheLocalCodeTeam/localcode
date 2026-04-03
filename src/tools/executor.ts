// src/tools/executor.ts
// Executes tool calls made by the model

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { ToolCall, ToolResult, FileDiff } from '../core/types.js';
import { logger } from '../core/logger.js';
import { withFileLock } from '../core/lock.js';
import { checkCommandSafety, getSecuritySummary, runSafeCommand } from '../security/index.js';
import { RateLimiter, createRateLimiter } from '../rate-limit/index.js';
import { formatDiffForTerminal, getDiffSummary } from '../diff/index.js';

function buildDiff(filePath: string, before: string, after: string): FileDiff {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let additions = 0;
  let deletions = 0;

  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  for (const l of afterLines) if (!beforeSet.has(l)) additions++;
  for (const l of beforeLines) if (!afterSet.has(l)) deletions++;

  return { path: filePath, before, after, additions, deletions };
}

export class ToolExecutor {
  private workingDir: string;
  private sessionFiles: Record<string, string> = {}; // path -> original content before first edit
  private changeHistory: Array<{ path: string; before: string }> = [];

  constructor(workingDir: string) {
    this.workingDir = path.resolve(workingDir);
  }

  async execute(tool: ToolCall): Promise<ToolResult> {
    logger.debug('Executing tool', { tool: tool.name });
    try {
      const result = await (async () => {
        switch (tool.name) {
          case 'read_file':    return this.readFile(tool.args as { path: string });
          case 'write_file':   return this.writeFile(tool.args as { path: string; content: string });
          case 'patch_file':   return this.patchFile(tool.args as { path: string; old_str: string; new_str: string });
          case 'delete_file':  return this.deleteFile(tool.args as { path: string });
          case 'move_file':    return this.moveFile(tool.args as { source: string; destination: string });
          case 'run_shell':    return this.runShell(tool.args as { command: string; cwd?: string });
          case 'list_dir':     return this.listDir(tool.args as { path: string; recursive?: boolean });
          case 'search_files': return this.searchFiles(tool.args as { pattern: string; path?: string; case_insensitive?: boolean });
          case 'find_files':   return this.findFiles(tool.args as { pattern: string; path?: string });
          case 'git_operation': return this.gitOperation(tool.args as { args: string });
          default:
            return { success: false, output: `Unknown tool: ${tool.name}` };
        }
      })();
      logger.debug('Tool execution complete', { tool: tool.name, success: result.success });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Tool execution failed', { tool: tool.name, error: msg });
      return { success: false, output: `Tool error: ${msg}` };
    }
  }

  private resolvePath(p: string): string {
    const resolved = path.isAbsolute(p) ? path.normalize(p) : path.resolve(this.workingDir, p);
    if (!resolved.startsWith(this.workingDir + path.sep) && resolved !== this.workingDir) {
      throw new Error(`Path denied: "${p}" is outside working directory`);
    }
    return resolved;
  }

  private readFile(args: { path: string }): ToolResult {
    const abs = this.resolvePath(args.path);
    if (!fs.existsSync(abs)) {
      return { success: false, output: `File not found: ${args.path}` };
    }
    const content = fs.readFileSync(abs, 'utf8');
    return { success: true, output: content };
  }

  private writeFile(args: { path: string; content: string }): ToolResult {
    const abs = this.resolvePath(args.path);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';

    if (!this.sessionFiles[abs]) this.sessionFiles[abs] = before;
    this.changeHistory.push({ path: abs, before });

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, args.content, 'utf8');

    const diff = buildDiff(abs, before, args.content);
    return { success: true, output: `Written: ${args.path}`, diff };
  }

  private patchFile(args: { path: string; old_str: string; new_str: string }): ToolResult {
    const abs = this.resolvePath(args.path);
    if (!fs.existsSync(abs)) {
      return { success: false, output: `File not found: ${args.path}` };
    }

    const before = fs.readFileSync(abs, 'utf8');
    if (!before.includes(args.old_str)) {
      return { success: false, output: `old_str not found in ${args.path}` };
    }

    // Count occurrences — ambiguous patch is an error
    let count = 0;
    let idx = 0;
    while ((idx = before.indexOf(args.old_str, idx)) !== -1) { count++; idx += args.old_str.length; }
    if (count > 1) {
      return { success: false, output: `old_str appears ${count} times in ${args.path} — make it more specific` };
    }

    if (!this.sessionFiles[abs]) this.sessionFiles[abs] = before;
    this.changeHistory.push({ path: abs, before });

    // Use replacer fn to prevent $& / $` / $' / $1 substitution in new_str
    const after = before.replace(args.old_str, () => args.new_str);
    fs.writeFileSync(abs, after, 'utf8');

    const diff = buildDiff(abs, before, after);
    return { success: true, output: `Patched: ${args.path}`, diff };
  }

  private deleteFile(args: { path: string }): ToolResult {
    const abs = this.resolvePath(args.path);
    if (!fs.existsSync(abs)) {
      return { success: false, output: `File not found: ${args.path}` };
    }
    const before = fs.readFileSync(abs, 'utf8');
    if (!this.sessionFiles[abs]) this.sessionFiles[abs] = before;
    this.changeHistory.push({ path: abs, before });
    fs.rmSync(abs, { recursive: false });
    return { success: true, output: `Deleted: ${args.path}` };
  }

  private moveFile(args: { source: string; destination: string }): ToolResult {
    const src = this.resolvePath(args.source);
    const dest = this.resolvePath(args.destination);
    if (!fs.existsSync(src)) {
      return { success: false, output: `Source not found: ${args.source}` };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return { success: true, output: `Moved: ${args.source} → ${args.destination}` };
  }

  private runShell(args: { command: string; cwd?: string }): Promise<ToolResult> {
    const cwd = args.cwd ? this.resolvePath(args.cwd) : this.workingDir;

    // Run comprehensive security check
    const securityResult = checkCommandSafety(args.command);
    const isSafe = securityResult.every(c => c.passed);

    if (!isSafe) {
      const criticalIssues = securityResult.filter(c => !c.passed).map(c => c.message).join('; ');
      logger.warn('Blocked dangerous command', { command: args.command.slice(0, 200), issues: criticalIssues });
      return Promise.resolve({ success: false, output: `Security check failed: ${criticalIssues}` });
    }

    return new Promise((resolve) => {
      execFile('sh', ['-c', args.command], { cwd, timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (err) {
          resolve({ success: false, output: output || err.message });
        } else {
          resolve({ success: true, output: output || '(no output)' });
        }
      });
    });
  }

  private listDir(args: { path: string; recursive?: boolean }): ToolResult {
    const abs = this.resolvePath(args.path);
    if (!fs.existsSync(abs)) {
      return { success: false, output: `Path not found: ${args.path}` };
    }

    const walk = (dir: string, prefix = ''): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const result: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        result.push(`${prefix}${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`);
        if (args.recursive && entry.isDirectory()) {
          result.push(...walk(path.join(dir, entry.name), prefix + '  '));
        }
      }
      return result;
    };

    return { success: true, output: walk(abs).join('\n') };
  }

  private searchFiles(args: { pattern: string; path?: string; case_insensitive?: boolean }): Promise<ToolResult> {
    const searchPath = args.path ? this.resolvePath(args.path) : this.workingDir;

    // Cross-platform search: use native Node.js fs on all platforms
    const searchRecursive = (dir: string, pattern: RegExp): Array<{ file: string; line: number; content: string }> => {
      const results: Array<{ file: string; line: number; content: string }> = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') continue;
          if (entry.isDirectory()) {
            results.push(...searchRecursive(fullPath, pattern));
          } else if (entry.isFile()) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (pattern.test(lines[i])) {
                  const relPath = path.relative(this.workingDir, fullPath);
                  results.push({ file: relPath, line: i + 1, content: lines[i].trim() });
                  pattern.lastIndex = 0; // Reset regex
                }
              }
            } catch {
              // Skip binary/unreadable files
            }
          }
        }
      } catch { /* skip inaccessible dirs */ }
      return results;
    };

    try {
      const flags = args.case_insensitive ? 'i' : '';
      const regex = new RegExp(args.pattern, flags);
      const results = searchRecursive(searchPath, regex);
      if (results.length === 0) {
        return Promise.resolve({ success: true, output: 'No matches found' });
      }
      const output = results.slice(0, 100).map(r => `${r.file}:${r.line}: ${r.content}`).join('\n');
      const truncated = results.length > 100 ? `\n\n... and ${results.length - 100} more results` : '';
      return Promise.resolve({ success: true, output: output + truncated });
    } catch (err) {
      return Promise.resolve({ success: false, output: `Search failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private findFiles(args: { pattern: string; path?: string }): Promise<ToolResult> {
    const searchDir = args.path ? this.resolvePath(args.path) : this.workingDir;

    // Cross-platform file finding: use native Node.js fs on all platforms
    const findRecursive = (dir: string, pattern: string): string[] => {
      const results: string[] = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') continue;
          if (entry.isDirectory()) {
            results.push(...findRecursive(fullPath, pattern));
          } else if (entry.isFile() || entry.isSymbolicLink()) {
            // Support glob-like patterns: *.ts, *.test.*, etc.
            const globRegex = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
            if (new RegExp(`^${globRegex}$`).test(entry.name)) {
              results.push(path.relative(this.workingDir, fullPath));
            }
          }
        }
      } catch { /* skip inaccessible dirs */ }
      return results;
    };

    try {
      const results = findRecursive(searchDir, args.pattern);
      if (results.length === 0) {
        return Promise.resolve({ success: true, output: 'No files found' });
      }
      return Promise.resolve({ success: true, output: results.slice(0, 100).join('\n') + (results.length > 100 ? `\n\n... and ${results.length - 100} more` : '') });
    } catch (err) {
      return Promise.resolve({ success: false, output: `Find failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private gitOperation(args: { args: string }): Promise<ToolResult> {
    const gitArgs = args.args.trim().split(/\s+/).filter(Boolean);
    return new Promise((resolve) => {
      execFile('git', gitArgs, { cwd: this.workingDir, timeout: 30000 }, (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (err) {
          resolve({ success: false, output: output || err.message });
        } else {
          resolve({ success: true, output: output || '(no output)' });
        }
      });
    });
  }

  getSessionFiles(): Record<string, string> {
    return this.sessionFiles;
  }

  undoLastChange(): string | null {
    const last = this.changeHistory.pop();
    if (!last) return null;
    fs.writeFileSync(last.path, last.before, 'utf8');
    return last.path;
  }

  // Build a unified diff between original and current content for a file
  unifiedDiff(filePath: string): string | null {
    const before = this.sessionFiles[filePath];
    if (before === undefined) return null;

    const after = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    if (before === after) return null;

    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const relPath = path.relative(this.workingDir, filePath);

    const hunks: string[] = [`--- a/${relPath}`, `+++ b/${relPath}`];

    // Proper LCS-based diff
    const lcs = this.computeLCS(beforeLines, afterLines);
    const changes = this.lcsToChanges(beforeLines, afterLines, lcs);

    // Group into hunks with 3 lines of context
    const CONTEXT = 3;
    let k = 0;
    while (k < changes.length) {
      if (changes[k].type !== ' ') {
        const start = Math.max(0, k - CONTEXT);
        let end = k;
        while (end < changes.length && (changes[end].type !== ' ' || end - k < CONTEXT)) end++;
        end = Math.min(changes.length - 1, end + CONTEXT);

        const hunkLines = changes.slice(start, end + 1);
        const oldStart = changes.slice(0, start).filter((c) => c.type !== '+').length + 1;
        const newStart = changes.slice(0, start).filter((c) => c.type !== '-').length + 1;
        const oldCount = hunkLines.filter((c) => c.type !== '+').length;
        const newCount = hunkLines.filter((c) => c.type !== '-').length;

        hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
        for (const c of hunkLines) {
          hunks.push(`${c.type}${c.line}`);
        }
        k = end + 1;
      } else {
        k++;
      }
    }

    return hunks.length > 2 ? hunks.join('\n') : null;
  }

  // Proper LCS using dynamic programming (optimized for typical file sizes)
  private computeLCS(a: string[], b: string[]): Array<{ aIdx: number; bIdx: number }> {
    const m = a.length;
    const n = b.length;

    // For very large files, fall back to simple line-by-line
    if (m > 500 || n > 500) {
      return this.computeLCSFallback(a, b);
    }

    // Build DP table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find LCS
    const result: Array<{ aIdx: number; bIdx: number }> = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift({ aIdx: i - 1, bIdx: j - 1 });
        i--; j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    return result;
  }

  private computeLCSFallback(a: string[], b: string[]): Array<{ aIdx: number; bIdx: number }> {
    // Simple line-by-line matching for large files
    const result: Array<{ aIdx: number; bIdx: number }> = [];
    const bUsed = new Set<number>();
    let bi = 0;
    for (let ai = 0; ai < a.length; ai++) {
      while (bi < b.length && (bUsed.has(bi) || a[ai] !== b[bi])) bi++;
      if (bi < b.length && a[ai] === b[bi]) {
        result.push({ aIdx: ai, bIdx: bi });
        bUsed.add(bi);
        bi++;
      }
    }
    return result;
  }

  private lcsToChanges(
    a: string[], b: string[],
    lcs: Array<{ aIdx: number; bIdx: number }>,
  ): Array<{ type: '-' | '+' | ' '; line: string }> {
    const changes: Array<{ type: '-' | '+' | ' '; line: string }> = [];
    let ai = 0, bi = 0, li = 0;

    while (ai < a.length || bi < b.length) {
      if (li < lcs.length && ai === lcs[li].aIdx && bi === lcs[li].bIdx) {
        // Matched line
        changes.push({ type: ' ', line: a[ai] });
        ai++; bi++; li++;
      } else if (li < lcs.length && ai < lcs[li].aIdx) {
        // Deleted lines (in a but not in LCS)
        changes.push({ type: '-', line: a[ai] });
        ai++;
      } else if (li < lcs.length && bi < lcs[li].bIdx) {
        // Added lines (in b but not in LCS)
        changes.push({ type: '+', line: b[bi] });
        bi++;
      } else if (ai < a.length) {
        changes.push({ type: '-', line: a[ai] });
        ai++;
      } else if (bi < b.length) {
        changes.push({ type: '+', line: b[bi] });
        bi++;
      } else {
        break;
      }
    }
    return changes;
  }

  /**
   * Clear tracked session files to free memory.
   * Call this after a session is saved or compacted.
   */
  clearSessionFiles(): void {
    const count = Object.keys(this.sessionFiles).length;
    this.sessionFiles = {};
    this.changeHistory = [];
    logger.info('Cleared session files', { count });
  }

  /**
   * Get the number of tracked session files.
   */
  getSessionFileCount(): number {
    return Object.keys(this.sessionFiles).length;
  }
}
