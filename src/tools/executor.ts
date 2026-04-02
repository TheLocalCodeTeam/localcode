// src/tools/executor.ts
// Executes tool calls made by the model

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { ToolCall, ToolResult, FileDiff } from '../core/types.js';
import { logger } from '../core/logger.js';

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

    // Enforce blocked commands
    const blockedPatterns = [
      'rm -rf /',
      'rm -rf /*',
      'mkfs',
      'dd if=',
      'shutdown',
      'reboot',
      'curl * | sh',
      'curl *|sh',
      'wget * | sh',
      'wget *|sh',
      ':(){:|:&};:',
      'chmod -R 777 /',
      'chmod -R 777 /*',
      '> /dev/sda',
      '> /dev/disk',
    ];

    const cmdLower = args.command.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const pattern of blockedPatterns) {
      const normalizedPattern = pattern.toLowerCase().replace(/\s+/g, ' ');
      if (cmdLower.includes(normalizedPattern) || cmdLower.includes(normalizedPattern.replace(' ', ''))) {
        return Promise.resolve({ success: false, output: `Blocked: command contains dangerous pattern "${pattern}"` });
      }
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
    const grepArgs = [
      '--recursive',
      '--line-number',
      '--with-filename',
      '--exclude-dir=node_modules',
      '--exclude-dir=.git',
      '--exclude-dir=dist',
      '--exclude-dir=.next',
      ...(args.case_insensitive ? ['--ignore-case'] : []),
      args.pattern,
      searchPath,
    ];
    return new Promise((resolve) => {
      execFile('grep', grepArgs, { timeout: 15000 }, (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code !== '1' && Number((err as NodeJS.ErrnoException).code) !== 1 && !stdout) {
          resolve({ success: false, output: stderr || err.message });
        } else {
          const out = stdout.trim();
          // Make paths relative for readability
          const relative = out.split('\n').map((line) => {
            const abs2 = line.split(':')[0];
            if (abs2 && path.isAbsolute(abs2)) {
              return line.replace(abs2, path.relative(this.workingDir, abs2));
            }
            return line;
          }).join('\n');
          resolve({ success: true, output: relative || 'No matches found' });
        }
      });
    });
  }

  private findFiles(args: { pattern: string; path?: string }): Promise<ToolResult> {
    const searchDir = args.path ? this.resolvePath(args.path) : this.workingDir;
    const findArgs = [
      searchDir,
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.git/*',
      '-not', '-path', '*/dist/*',
      '-name', args.pattern,
    ];
    return new Promise((resolve) => {
      execFile('find', findArgs, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ success: false, output: stderr || err.message });
        } else {
          const results = stdout.trim().split('\n').filter(Boolean)
            .map((p) => path.relative(this.workingDir, p))
            .join('\n');
          resolve({ success: true, output: results || 'No files found' });
        }
      });
    });
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

    // Simple unified diff: find changed regions with 3-line context
    const CONTEXT = 3;
    let i = 0;
    let j = 0;
    const changes: Array<{ type: '-' | '+' | ' '; line: string }> = [];

    // LCS-lite: line by line comparison collecting changes
    while (i < beforeLines.length || j < afterLines.length) {
      if (i < beforeLines.length && j < afterLines.length && beforeLines[i] === afterLines[j]) {
        changes.push({ type: ' ', line: beforeLines[i] });
        i++; j++;
      } else if (j < afterLines.length && (i >= beforeLines.length || beforeLines[i] !== afterLines[j])) {
        changes.push({ type: '+', line: afterLines[j] });
        j++;
      } else {
        changes.push({ type: '-', line: beforeLines[i] });
        i++;
      }
    }

    // Group into hunks with context
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

    return hunks.join('\n');
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
