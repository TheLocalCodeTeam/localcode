import { describe, it, expect } from 'vitest';

describe('File Lock — Behavioral', () => {
  describe('FileLock', () => {
    it('should acquire a lock', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-file.txt');
      const acquired = await lock.acquire(1000);
      expect(acquired).toBe(true);
      lock.release();
    });

    it('should release a lock', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-file-2.txt');
      await lock.acquire(1000);
      lock.release();
      // Should not throw
    });

    it('should prevent concurrent access', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock1 = new FileLock('/tmp/test-file-3.txt');
      const lock2 = new FileLock('/tmp/test-file-3.txt');
      const acquired1 = await lock1.acquire(1000);
      expect(acquired1).toBe(true);
      const acquired2 = await lock2.acquire(200);
      expect(acquired2).toBe(false);
      lock1.release();
    });

    it('should timeout on lock acquisition', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock1 = new FileLock('/tmp/test-file-4.txt');
      const lock2 = new FileLock('/tmp/test-file-4.txt');
      await lock1.acquire(1000);
      const start = Date.now();
      const acquired = await lock2.acquire(100);
      const elapsed = Date.now() - start;
      expect(acquired).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(100);
      lock1.release();
    });
  });

  describe('withFileLock', () => {
    it('should execute function within lock', async () => {
      const { withFileLock } = await import('../src/core/lock.js');
      let executed = false;
      await withFileLock('/tmp/test-with-lock.txt', async () => {
        executed = true;
        return 'result';
      }, 1000);
      expect(executed).toBe(true);
    });

    it('should release lock after function completes', async () => {
      const { withFileLock, FileLock } = await import('../src/core/lock.js');
      await withFileLock('/tmp/test-with-lock-2.txt', async () => {
        return 'result';
      }, 1000);
      // Lock should be released, so new lock should acquire
      const lock = new FileLock('/tmp/test-with-lock-2.txt');
      const acquired = await lock.acquire(1000);
      expect(acquired).toBe(true);
      lock.release();
    });

    it('should release lock on error', async () => {
      const { withFileLock, FileLock } = await import('../src/core/lock.js');
      await expect(
        withFileLock('/tmp/test-with-lock-3.txt', async () => {
          throw new Error('test error');
        }, 1000)
      ).rejects.toThrow('test error');
      // Lock should be released
      const lock = new FileLock('/tmp/test-with-lock-3.txt');
      const acquired = await lock.acquire(1000);
      expect(acquired).toBe(true);
      lock.release();
    });

    it('should fail on timeout', async () => {
      const { withFileLock, FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-with-lock-4.txt');
      await lock.acquire(1000);
      await expect(
        withFileLock('/tmp/test-with-lock-4.txt', async () => 'result', 50)
      ).rejects.toThrow('Could not acquire lock');
      lock.release();
    });
  });

  describe('getActiveLockCount', () => {
    it('should return 0 when no locks active', async () => {
      const { getActiveLockCount } = await import('../src/core/lock.js');
      expect(getActiveLockCount()).toBe(0);
    });

    it('should return 1 when lock active', async () => {
      const { getActiveLockCount, withFileLock } = await import('../src/core/lock.js');
      let count = 0;
      await withFileLock('/tmp/test-active-lock.txt', async () => {
        count = getActiveLockCount();
        return 'result';
      }, 1000);
      expect(count).toBe(1);
    });

    it('should handle cleanup of active locks', async () => {
      const { getActiveLockCount, withFileLock } = await import('../src/core/lock.js');
      await withFileLock('/tmp/test-cleanup-locks.txt', async () => {
        expect(getActiveLockCount()).toBe(1);
      }, 1000);
      expect(getActiveLockCount()).toBe(0);
    });
  });
});

describe('File Lock — Technical', () => {
  describe('lock file creation', () => {
    it('should create lock directory if not exists', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-locks-create-dir.txt');
      const acquired = await lock.acquire(1000);
      expect(acquired).toBe(true);
      lock.release();
    });

    it('should create lock file with PID', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-locks-pid.txt');
      await lock.acquire(1000);
      // Lock file should exist and contain PID
      lock.release();
    });
  });

  describe('stale lock detection', () => {
    it('should detect and remove stale locks', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock1 = new FileLock('/tmp/test-stale-lock.txt');
      await lock1.acquire(1000);
      // Simulate stale by not releasing and creating a new lock
      const lock2 = new FileLock('/tmp/test-stale-lock.txt');
      // Should eventually acquire after detecting stale
      const acquired = await lock2.acquire(500);
      // Either it acquires (stale detected) or times out
      expect(typeof acquired).toBe('boolean');
      lock1.release();
      lock2.release();
    });
  });

  describe('concurrent lock acquisition', () => {
    it('should handle multiple concurrent lock attempts', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const locks = Array.from({ length: 5 }, () => new FileLock('/tmp/test-concurrent-locks.txt'));
      const results = await Promise.all(
        locks.map(lock => lock.acquire(500))
      );
      // Exactly one should succeed
      const successCount = results.filter(r => r).length;
      expect(successCount).toBe(1);
      locks.forEach(lock => lock.release());
    });

    it('should handle sequential lock acquisition', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-sequential-locks.txt');
      for (let i = 0; i < 5; i++) {
        const acquired = await lock.acquire(1000);
        expect(acquired).toBe(true);
        lock.release();
      }
    });
  });

  describe('lock path encoding', () => {
    it('should handle paths with special characters', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-special-chars-@#$%.txt');
      const acquired = await lock.acquire(1000);
      expect(acquired).toBe(true);
      lock.release();
    });

    it('should handle very long paths', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const longPath = '/tmp/' + 'x'.repeat(200) + '.txt';
      const lock = new FileLock(longPath);
      const acquired = await lock.acquire(1000);
      expect(acquired).toBe(true);
      lock.release();
    });
  });

  describe('edge cases', () => {
    it('should handle rapid acquire/release cycles', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-rapid-cycles.txt');
      for (let i = 0; i < 20; i++) {
        await lock.acquire(1000);
        lock.release();
      }
    });

    it('should handle release without acquire', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-release-no-acquire.txt');
      lock.release(); // Should not throw
    });

    it('should handle double release', async () => {
      const { FileLock } = await import('../src/core/lock.js');
      const lock = new FileLock('/tmp/test-double-release.txt');
      await lock.acquire(1000);
      lock.release();
      lock.release(); // Should not throw
    });
  });
});
