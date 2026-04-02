import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Settings Manager', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localcode-settings-'));
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('should load default settings when no config exists', async () => {
    const { loadSettings } = await import('../src/settings/manager.js');
    const settings = loadSettings();
    expect(settings.provider.provider).toBe('ollama');
    expect(settings.agentDispatch.enabled).toBe(true);
  });

  it('should save and load settings', async () => {
    const { loadSettings, saveSettings, setSetting, getSetting } = await import('../src/settings/manager.js');

    const settings = loadSettings();
    settings.provider.model = 'test-model';
    saveSettings(settings);

    const loaded = loadSettings();
    expect(loaded.provider.model).toBe('test-model');
  });

  it('should handle getSetting with dot paths', async () => {
    const { getSetting, setSetting } = await import('../src/settings/manager.js');

    setSetting('provider.model', 'new-model');
    expect(getSetting('provider.model')).toBe('new-model');
  });

  it('should handle corrupt settings gracefully', async () => {
    const { loadSettings } = await import('../src/settings/manager.js');
    const settingsDir = path.join(os.homedir(), '.localcode');
    if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), 'not json', 'utf8');

    const settings = loadSettings();
    expect(settings.provider.provider).toBe('ollama');
  });
});
