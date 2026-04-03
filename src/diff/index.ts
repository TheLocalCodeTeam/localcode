// src/diff/index.ts
// Proper diff visualization with green/red highlighting

export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  line: string;
  oldLine?: number;
  newLine?: number;
}

export interface FileDiff {
  path: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

/**
 * Parse a unified diff string into structured diff data.
 */
export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diff.split('\n');
  let currentFile: FileDiff | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('--- a/')) {
      // Skip old file line
      continue;
    } else if (line.startsWith('+++ b/')) {
      const path = line.slice(6);
      currentFile = { path, lines: [], additions: 0, deletions: 0 };
      files.push(currentFile);
      oldLine = 0;
      newLine = 0;
    } else if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLine = parseInt(match[1], 10) - 1;
        newLine = parseInt(match[2], 10) - 1;
      }
    } else if (currentFile) {
      if (line.startsWith('+')) {
        newLine++;
        currentFile.lines.push({ type: 'added', line: line.slice(1), newLine });
        currentFile.additions++;
      } else if (line.startsWith('-')) {
        oldLine++;
        currentFile.lines.push({ type: 'removed', line: line.slice(1), oldLine });
        currentFile.deletions++;
      } else if (line.startsWith(' ')) {
        oldLine++;
        newLine++;
        currentFile.lines.push({ type: 'context', line: line.slice(1), oldLine, newLine });
      }
    }
  }

  return files;
}

/**
 * Format a diff for terminal display with ANSI colors.
 */
export function formatDiffForTerminal(diff: string): string {
  const lines = diff.split('\n');
  return lines.map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `\x1b[32m${line}\x1b[0m`; // Green
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      return `\x1b[31m${line}\x1b[0m`; // Red
    } else if (line.startsWith('@@')) {
      return `\x1b[36m${line}\x1b[0m`; // Cyan
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      return `\x1b[90m${line}\x1b[0m`; // Gray
    }
    return line;
  }).join('\n');
}

/**
 * Generate a simple inline diff showing changes.
 */
export function generateInlineDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const result: string[] = [];

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const beforeLine = beforeLines[i] ?? '';
    const afterLine = afterLines[i] ?? '';

    if (beforeLine === afterLine) {
      result.push(`  ${beforeLine}`);
    } else {
      if (beforeLine) result.push(`- ${beforeLine}`);
      if (afterLine) result.push(`+ ${afterLine}`);
    }
  }

  return result.join('\n');
}

/**
 * Get a summary of changes from a diff.
 */
export function getDiffSummary(diff: string): string {
  const files = parseUnifiedDiff(diff);
  if (files.length === 0) return 'No changes';

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const fileCount = files.length;

  const parts: string[] = [];
  parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''} changed`);
  if (totalAdditions > 0) parts.push(`+${totalAdditions}`);
  if (totalDeletions > 0) parts.push(`-${totalDeletions}`);

  return parts.join(', ');
}
