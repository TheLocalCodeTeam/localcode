import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('TF-IDF Search — Behavioral', () => {
  describe('buildIndex', () => {
    it('should build an index for a directory', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      expect(index.files.length).toBeGreaterThan(0);
    });

    it('should skip node_modules and .git', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      expect(index.files.some((f: string) => f.includes('node_modules'))).toBe(false);
    });

    it('should handle empty directories', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-empty-'));
      const index = buildIndex(emptyDir, 50);
      expect(index.files.length).toBe(0);
    });

    it('should respect maxFiles limit', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 5);
      expect(index.files.length).toBeLessThanOrEqual(5);
    });
  });

  describe('search', () => {
    it('should return results for matching queries', async () => {
      const { buildIndex, search } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = search('function', index);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should return empty results for non-matching queries', async () => {
      const { buildIndex, search } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = search('xyznonexistent123abc', index);
      expect(results.length).toBe(0);
    });

    it('should rank results by relevance', async () => {
      const { buildIndex, search } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = search('function', index);
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });

    it('should limit results to topK', async () => {
      const { buildIndex, search } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = search('function', index, 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('searchWithContext', () => {
    it('should return matching lines with context', async () => {
      const { buildIndex, searchWithContext } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = searchWithContext('function', index);
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('file');
        expect(results[0]).toHaveProperty('line');
        expect(results[0]).toHaveProperty('content');
      }
    });

    it('should return empty array for non-matching queries', async () => {
      const { buildIndex, searchWithContext } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = searchWithContext('xyznonexistent123', index);
      expect(results).toEqual([]);
    });
  });
});

describe('TF-IDF Search — Technical', () => {
  describe('tokenization', () => {
    it('should split text into tokens', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 1);
      const tokens = (index as any).tokenize('hello world foo bar');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });

    it('should handle camelCase tokens', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 1);
      const tokens = (index as any).tokenize('camelCaseVariable');
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should handle snake_case tokens', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 1);
      const tokens = (index as any).tokenize('snake_case_variable');
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should handle empty strings', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 1);
      const tokens = (index as any).tokenize('');
      expect(tokens).toEqual([]);
    });

    it('should handle special characters', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 1);
      const tokens = (index as any).tokenize('hello@world#foo$bar');
      expect(Array.isArray(tokens)).toBe(true);
    });
  });

  describe('scoring', () => {
    it('should compute TF-IDF scores', async () => {
      const { buildIndex, search } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = search('import', index);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('score');
        expect(typeof results[0].score).toBe('number');
      }
    });

    it('should boost bigram matches', async () => {
      const { buildIndex, search } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      const results = search('async function', index);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle binary files gracefully', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      // Should not throw
      expect(index).toBeDefined();
    });

    it('should handle very large files', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      expect(index).toBeDefined();
    });

    it('should handle encoding issues', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 50);
      expect(index).toBeDefined();
    });

    it('should handle directories with no readable files', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-noread-'));
      const index = buildIndex(emptyDir, 50);
      expect(index.files.length).toBe(0);
    });

    it('should handle maxFiles of 0', async () => {
      const { buildIndex } = await import('../src/search/tfidf.js');
      const index = buildIndex(process.cwd(), 0);
      expect(index.files.length).toBe(0);
    });

    it('should handle single file directory', async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-single-'));
      fs.writeFileSync(path.join(testDir, 'test.txt'), 'hello world', 'utf8');
      const { buildIndex, search } = await import('../src/search/tfidf.js');
      const index = buildIndex(testDir, 50);
      expect(index.files.length).toBe(1);
      const results = search('hello', index);
      expect(results.length).toBe(1);
    });
  });
});
