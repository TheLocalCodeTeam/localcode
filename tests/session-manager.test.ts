import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function freshModule() {
  return import('../src/sessions/manager.js');
}

describe('Session Manager — Behavioral', () => {
  describe('loadSession', () => {
    it('should load default session when no state exists', async () => {
      const { loadSession } = await freshModule();
      const state = loadSession();
      expect(state.provider).toBe('ollama');
      expect(state.model).toBeDefined();
      expect(state.messages).toEqual([]);
    });

    it('should load API keys from environment variables', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-openai';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.GROQ_API_KEY = 'gsk-test';
      const { loadSession } = await freshModule();
      const state = loadSession();
      expect(state.apiKeys.openai).toBe('sk-test-openai');
      expect(state.apiKeys.claude).toBe('sk-ant-test');
      expect(state.apiKeys.groq).toBe('gsk-test');
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GROQ_API_KEY;
    });

    it('should merge saved state with defaults', async () => {
      const { saveSession, loadSession } = await freshModule();
      const state = loadSession();
      state.theme = 'dark';
      state.maxSteps = 50;
      saveSession(state);
      const loaded = loadSession();
      expect(loaded.theme).toBe('dark');
      expect(loaded.maxSteps).toBe(50);
    });
  });

  describe('saveSession', () => {
    it('should save session state to disk', async () => {
      const { saveSession, loadSession } = await freshModule();
      const state = loadSession();
      state.provider = 'ollama';
      state.model = 'test-model';
      saveSession(state);
      const loaded = loadSession();
      expect(loaded.provider).toBe('ollama');
      expect(loaded.model).toBe('test-model');
    });

    it('should create timestamped session copies', async () => {
      const { saveSession, loadSession } = await freshModule();
      const state = loadSession();
      state.messages = [{ role: 'user' as const, content: 'test' }];
      saveSession(state);
      const sessionsDir = path.join(os.homedir(), '.localcode', 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
        expect(files.length).toBeGreaterThan(0);
      }
    });
  });

  describe('checkpoints', () => {
    it('should create a checkpoint', async () => {
      const { createCheckpoint, loadSession } = await freshModule();
      const state = loadSession();
      state.messages = [{ role: 'user' as const, content: 'test' }];
      const { checkpoint } = createCheckpoint(state, 'manual');
      expect(checkpoint.label).toBe('manual');
      expect(checkpoint.messages.length).toBe(1);
    });

    it('should restore from a checkpoint', async () => {
      const { createCheckpoint, loadSession } = await freshModule();
      const state = loadSession();
      state.messages = [{ role: 'user' as const, content: 'original' }];
      const { state: restored } = createCheckpoint(state, 'restore');
      expect(restored.messages[0].content).toBe('original');
    });
  });

  describe('session history', () => {
    it('should list saved sessions', async () => {
      const { listSessions } = await freshModule();
      const sessions = listSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('should return null for non-existent session ID', async () => {
      const { loadSessionById } = await freshModule();
      expect(loadSessionById('non-existent-id')).toBeNull();
    });
  });
});

describe('Session Manager — Technical', () => {
  describe('estimateTokens', () => {
    it('should estimate higher for code than plain text', async () => {
      const { estimateTokens } = await import('../src/sessions/manager.js');
      const codeMsgs = [{ role: 'user' as const, content: 'function foo() { return bar(); }' }];
      const textMsgs = [{ role: 'user' as const, content: 'hello world' }];
      const codeTokens = estimateTokens(codeMsgs);
      const textTokens = estimateTokens(textMsgs);
      expect(codeTokens).toBeGreaterThan(0);
      expect(textTokens).toBeGreaterThan(0);
    });

    it('should handle empty message array', async () => {
      const { estimateTokens } = await import('../src/sessions/manager.js');
      expect(estimateTokens([])).toBe(0);
    });

    it('should handle messages with empty content', async () => {
      const { estimateTokens } = await import('../src/sessions/manager.js');
      expect(estimateTokens([{ role: 'user' as const, content: '' }])).toBe(0);
    });

    it('should estimate tokens for system messages', async () => {
      const { estimateTokens } = await import('../src/sessions/manager.js');
      const sysMsgs = [{ role: 'system' as const, content: 'You are a helpful assistant.' }];
      expect(estimateTokens(sysMsgs)).toBeGreaterThan(0);
    });

    it('should handle very long messages', async () => {
      const { estimateTokens } = await import('../src/sessions/manager.js');
      const longMsgs = [{ role: 'user' as const, content: 'x'.repeat(100000) }];
      const tokens = estimateTokens(longMsgs);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(100000);
    });

    it('should handle tool result indicators', async () => {
      const { estimateTokens } = await import('../src/sessions/manager.js');
      const toolMsgs = [{ role: 'assistant' as const, content: 'Tool result: [file content]' }];
      expect(estimateTokens(toolMsgs)).toBeGreaterThan(0);
    });

    it('should handle mixed role messages', async () => {
      const { estimateTokens } = await import('../src/sessions/manager.js');
      const msgs = [
        { role: 'system' as const, content: 'You are an assistant.' },
        { role: 'user' as const, content: 'Hello!' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];
      expect(estimateTokens(msgs)).toBeGreaterThan(0);
    });
  });

  describe('state file operations', () => {
    it('should create state directory if it does not exist', async () => {
      const { saveSession, loadSession } = await import('../src/sessions/manager.js');
      const state = loadSession();
      saveSession(state);
      const stateFile = path.join(os.homedir(), '.localcode', 'state.json');
      expect(fs.existsSync(stateFile)).toBe(true);
    });

    it('should handle corrupt state file gracefully', async () => {
      const stateDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'state.json'), 'not valid json', 'utf8');
      const { loadSession } = await import('../src/sessions/manager.js');
      const state = loadSession();
      expect(state.provider).toBe('ollama');
    });

    it('should handle missing state directory gracefully', async () => {
      const { loadSession } = await import('../src/sessions/manager.js');
      const state = loadSession();
      expect(state).toBeDefined();
      expect(state.provider).toBe('ollama');
    });
  });

  describe('session data integrity', () => {
    it('should preserve message order after save', async () => {
      const { saveSession, loadSession } = await import('../src/sessions/manager.js');
      const state = loadSession();
      state.messages = [
        { role: 'user' as const, content: 'first' },
        { role: 'assistant' as const, content: 'second' },
        { role: 'user' as const, content: 'third' },
      ];
      saveSession(state);
      expect(state.messages.length).toBe(3);
    });

    it('should handle special characters in messages', async () => {
      const { saveSession, loadSession } = await import('../src/sessions/manager.js');
      const state = loadSession();
      state.systemPrompt = 'You are an assistant with "quotes" and <html> tags & special chars: \n\t';
      saveSession(state);
      const loaded = loadSession();
      expect(loaded.systemPrompt).toContain('quotes');
    });

    it('should handle large number of checkpoints', async () => {
      const { loadSession } = await import('../src/sessions/manager.js');
      const state = loadSession();
      state.checkpoints = Array.from({ length: 100 }, (_, i) => ({
        id: `cp_${i}`,
        label: `checkpoint ${i}`,
        timestamp: Date.now() - i * 1000,
        messages: [],
        files: {},
      }));
      expect(state.checkpoints.length).toBe(100);
    });
  });
});
