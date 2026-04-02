// src/core/lock.ts
// File locking for concurrent agent operations

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

const LOCK_DIR = path.join(homedir(), '.localcode', 'locks');

function ensureLockDir() {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
}

function lockFile(filePath: string): string {
  return path.join(LOCK_DIR, Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_') + '.lock');
}

export class FileLock {
  private lockPath: string;
  private acquired = false;

  constructor(filePath: string) {
    ensureLockDir();
    this.lockPath = lockFile(filePath);
  }

  async acquire(timeout = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
        this.acquired = true;
        return true;
      } catch {
        // Lock exists, check if it's stale
        try {
          const pid = parseInt(fs.readFileSync(this.lockPath, 'utf8'), 10);
          // Check if process is still running
          process.kill(pid, 0);
        } catch {
          // Process dead, remove stale lock
          try { fs.unlinkSync(this.lockPath); } catch { /* ok */ }
        }
        await new Promise(r => setTimeout(r, 100));
      }
    }
    return false;
  }

  release(): void {
    if (this.acquired) {
      try { fs.unlinkSync(this.lockPath); } catch { /* ok */ }
      this.acquired = false;
    }
  }
}

// Simple lock manager for tracking all active locks
const activeLocks = new Map<string, FileLock>();

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>, timeout = 10000): Promise<T> {
  const lock = new FileLock(filePath);
  const acquired = await lock.acquire(timeout);
  if (!acquired) {
    throw new Error(`Could not acquire lock for ${filePath} after ${timeout}ms`);
  }
  activeLocks.set(filePath, lock);
  try {
    return await fn();
  } finally {
    lock.release();
    activeLocks.delete(filePath);
  }
}

export function getActiveLockCount(): number {
  return activeLocks.size;
}
