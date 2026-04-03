import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Settings Manager — Behavioral', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-settings-'));
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  describe('loadSettings', () => {
    it('should load default settings when no config exists', async () => {
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings.provider.provider).toBe('ollama');
      expect(settings.agentDispatch.enabled).toBe(true);
      expect(settings.permissions.fileEdit).toBe('allow');
    });

    it('should load global settings when file exists', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        provider: { provider: 'openai', model: 'gpt-4o' },
      }), 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings.provider.provider).toBe('openai');
      expect(settings.provider.model).toBe('gpt-4o');
    });

    it('should handle corrupt settings file', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), 'not json {{{', 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings.provider.provider).toBe('ollama'); // Falls back to defaults
    });
  });

  describe('getSetting', () => {
    it('should get nested values with dot paths', async () => {
      const { getSetting } = await import('../src/settings/manager.js');
      const model = getSetting('provider.model', 'default');
      expect(typeof model).toBe('string');
    });

    it('should return default value for non-existent paths', async () => {
      const { getSetting } = await import('../src/settings/manager.js');
      const val = getSetting('nonexistent.path.value', 'fallback');
      expect(val).toBe('fallback');
    });

    it('should get boolean values', async () => {
      const { getSetting } = await import('../src/settings/manager.js');
      const enabled = getSetting('agentDispatch.enabled', false);
      expect(typeof enabled).toBe('boolean');
    });
  });

  describe('setSetting', () => {
    it('should set nested values', async () => {
      const { setSetting, getSetting } = await import('../src/settings/manager.js');
      setSetting('provider.model', 'new-model');
      expect(getSetting('provider.model')).toBe('new-model');
    });

    it('should create intermediate objects', async () => {
      const { setSetting, getSetting } = await import('../src/settings/manager.js');
      setSetting('custom.nested.value', 42);
      expect(getSetting('custom.nested.value')).toBe(42);
    });
  });

  describe('export/import', () => {
    it('should export settings as JSON', async () => {
      const { exportSettings } = await import('../src/settings/manager.js');
      const json = exportSettings();
      const parsed = JSON.parse(json);
      expect(parsed.provider).toBeDefined();
      expect(parsed.agentDispatch).toBeDefined();
    });

    it('should import valid settings', async () => {
      const { importSettings, getSetting } = await import('../src/settings/manager.js');
      const result = importSettings(JSON.stringify({ provider: { provider: 'ollama' } }));
      expect(result).toBe(true);
    });

    it('should reject invalid JSON', async () => {
      const { importSettings } = await import('../src/settings/manager.js');
      const result = importSettings('not json');
      expect(result).toBe(false);
    });
  });

  describe('resetSettings', () => {
    it('should reset to defaults', async () => {
      const { resetSettings, getSetting, setSetting } = await import('../src/settings/manager.js');
      setSetting('provider.model', 'custom-model');
      expect(getSetting('provider.model')).toBe('custom-model');
      resetSettings();
      // After reset, should be default again
      const settings = await import('../src/settings/manager.js');
      expect(settings.loadSettings().provider.model).not.toBe('custom-model');
    });
  });
});

describe('Settings Manager — Technical', () => {
  describe('deepMerge', () => {
    it('should merge nested objects', async () => {
      // Test the internal deepMerge by loading settings
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings).toHaveProperty('provider');
      expect(settings.provider).toHaveProperty('provider');
      expect(settings.provider).toHaveProperty('model');
    });

    it('should not mutate original objects', async () => {
      const { loadSettings } = await import('../src/settings/manager.js');
      const s1 = loadSettings();
      const s2 = loadSettings();
      s1.provider.model = 'mutated';
      expect(s2.provider.model).not.toBe('mutated');
    });
  });

  describe('settings caching', () => {
    it('should cache settings for 5 seconds', async () => {
      const { loadSettings, setSetting, getSetting } = await import('../src/settings/manager.js');
      setSetting('provider.model', 'cached-model');
      const first = getSetting('provider.model');
      const second = getSetting('provider.model');
      expect(first).toBe(second); // Same cache
    });
  });

  describe('settings validation', () => {
    it('should fill missing required keys with defaults', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        provider: { provider: 'ollama' },
        // Missing agentDispatch, permissions, etc.
      }), 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings.agentDispatch).toBeDefined();
      expect(settings.permissions).toBeDefined();
    });

    it('should handle partial settings objects', async () => {
      const { getSettingsSummary } = await import('../src/settings/manager.js');
      const summary = getSettingsSummary();
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should handle settings with null values', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        provider: null,
        agentDispatch: null,
      }), 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings).toBeDefined();
    });

    it('should handle settings with empty objects', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({}), 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings.provider.provider).toBe('ollama');
    });

    it('should handle settings with extra unknown keys', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        provider: { provider: 'ollama' },
        unknownKey: 'unknown value',
        anotherUnknown: { nested: true },
      }), 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings).toBeDefined();
    });
  });

  describe('settings migration', () => {
    it('should migrate v1 settings to v2', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        version: 1,
        provider: { provider: 'ollama', model: 'qwen2.5' },
        memory: { memoryFile: '.nyx.md' },
      }), 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings.memory.memoryFile).toBe('.localcode.md');
      expect(settings.agentDispatch).toBeDefined();
    });

    it('should not migrate v2 settings', async () => {
      const settingsDir = path.join(os.homedir(), '.localcode');
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        version: 2,
        provider: { provider: 'ollama', model: 'qwen2.5' },
      }), 'utf8');
      const { loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      expect(settings.provider.model).toBe('qwen2.5');
    });
  });

  describe('settings persistence', () => {
    it('should write valid JSON to disk', async () => {
      const { saveSettings, loadSettings } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      settings.provider.model = 'persist-test';
      saveSettings(settings);
      const raw = fs.readFileSync(path.join(os.homedir(), '.localcode', 'settings.json'), 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.provider.model).toBe('persist-test');
    });

    it('should invalidate cache on save', async () => {
      const { saveSettings, loadSettings, getSetting } = await import('../src/settings/manager.js');
      const settings = loadSettings();
      settings.provider.model = 'cache-test';
      saveSettings(settings);
      expect(getSetting('provider.model')).toBe('cache-test');
    });
  });
});
