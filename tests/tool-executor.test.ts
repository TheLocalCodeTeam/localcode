import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// We need to test the ToolExecutor class directly
// Since it's ESM, we'll test via the compiled output

describe('ToolExecutor', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localcode-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('should read a file', async () => {
    const testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'hello world', 'utf8');

    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);
    const result = await executor.execute({
      name: 'read_file',
      args: { path: 'test.txt' },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('should write a file', async () => {
    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);
    const result = await executor.execute({
      name: 'write_file',
      args: { path: 'new.txt', content: 'new content' },
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(testDir, 'new.txt'), 'utf8')).toBe('new content');
  });

  it('should patch a file', async () => {
    const testFile = path.join(testDir, 'patch.txt');
    fs.writeFileSync(testFile, 'line1\nline2\nline3\n', 'utf8');

    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);
    const result = await executor.execute({
      name: 'patch_file',
      args: { path: 'patch.txt', old_str: 'line2', new_str: 'modified' },
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf8')).toBe('line1\nmodified\nline3\n');
  });

  it('should delete a file', async () => {
    const testFile = path.join(testDir, 'delete.txt');
    fs.writeFileSync(testFile, 'delete me', 'utf8');

    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);
    const result = await executor.execute({
      name: 'delete_file',
      args: { path: 'delete.txt' },
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(testFile)).toBe(false);
  });

  it('should run shell commands', async () => {
    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);
    const result = await executor.execute({
      name: 'run_shell',
      args: { command: 'echo hello' },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('should block dangerous commands', async () => {
    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);

    const dangerous = ['rm -rf /', 'mkfs', 'dd if=/dev/zero', 'shutdown', 'reboot'];
    for (const cmd of dangerous) {
      const result = await executor.execute({
        name: 'run_shell',
        args: { command: cmd },
      });
      expect(result.success).toBe(false);
      expect(result.output).toContain('Blocked');
    }
  });

  it('should list directory', async () => {
    fs.mkdirSync(path.join(testDir, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'file.txt'), 'test', 'utf8');

    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);
    const result = await executor.execute({
      name: 'list_dir',
      args: { path: '.' },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('file.txt');
  });

  it('should prevent path traversal', async () => {
    const { ToolExecutor } = await import('../src/tools/executor.js');
    const executor = new ToolExecutor(testDir);
    const result = await executor.execute({
      name: 'read_file',
      args: { path: '../../../etc/passwd' },
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('outside');
  });
});
