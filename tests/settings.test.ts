import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Settings Manager', () => {
  let testDir: string;
  let globalSettingsPath: string;
  let originalGlobalPath: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localcode-settings-'));
    globalSettingsPath = path.join(testDir, 'settings.json');

    // Mock the global settings path by temporarily setting env
    originalGlobalPath = process.env.LOCALCODE_SETTINGS_PATH || '';
    process.env.LOCALCODE_SETTINGS_PATH = globalSettingsPath;
  });

  afterEach(() => {
    process.env.LOCALCODE_SETTINGS_PATH = originalGlobalPath;
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('should load default settings when no config exists', async () => {
    // Clear any cached settings
    const mod = await import('../src/settings/manager.js');
    // Reset cache by calling loadSettings which will use defaults
    const settings = mod.loadSettings();
    expect(settings.provider.provider).toBe('ollama');
    expect(settings.agentDispatch.enabled).toBe(true);
  });

  it('should handle getSetting with dot paths', async () => {
    const { getSetting } = await import('../src/settings/manager.js');
    const model = getSetting('provider.model', 'default-model');
    expect(typeof model).toBe('string');
    expect(model.length).toBeGreaterThan(0);
  });

  it('should handle export/import settings', async () => {
    const { exportSettings, importSettings } = await import('../src/settings/manager.js');
    const exported = exportSettings();
    const parsed = JSON.parse(exported);
    expect(parsed.provider).toBeDefined();
    expect(parsed.agentDispatch).toBeDefined();
  });
});
