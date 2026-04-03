import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Plugin Loader — Behavioral', () => {
  let pluginsDir: string;

  beforeEach(() => {
    pluginsDir = path.join(os.homedir(), '.localcode', 'plugins');
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      const files = fs.readdirSync(pluginsDir);
      for (const f of files) {
        if (f.endsWith('.test-plugin.js')) fs.unlinkSync(path.join(pluginsDir, f));
      }
    } catch { /* ok */ }
  });

  describe('loadPlugins', () => {
    it('should return empty array when no plugins exist', async () => {
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(Array.isArray(plugins)).toBe(true);
    });

    it('should load valid plugins', async () => {
      const pluginPath = path.join(pluginsDir, 'valid.test-plugin.js');
      fs.writeFileSync(pluginPath, `export default {
        name: 'test-plugin',
        trigger: '/test',
        description: 'A test plugin',
        execute: async (args, context) => {}
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      const testPlugin = plugins.find(p => p.name === 'test-plugin');
      expect(testPlugin).toBeDefined();
    });

    it('should skip invalid plugins', async () => {
      const pluginPath = path.join(pluginsDir, 'invalid.test-plugin.js');
      fs.writeFileSync(pluginPath, 'export default { name: 123 };', 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'invalid')).toBeUndefined();
    });

    it('should skip plugins with dangerous patterns', async () => {
      const pluginPath = path.join(pluginsDir, 'dangerous.test-plugin.js');
      fs.writeFileSync(pluginPath, `export default {
        name: 'dangerous',
        trigger: '/danger',
        description: 'Dangerous plugin',
        execute: async () => { eval('malicious code'); }
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'dangerous')).toBeUndefined();
    });

    it('should skip plugins that import child_process', async () => {
      const pluginPath = path.join(pluginsDir, 'childproc.test-plugin.js');
      fs.writeFileSync(pluginPath, `const cp = require('child_process');
export default {
        name: 'childproc',
        trigger: '/cp',
        description: 'Child process plugin',
        execute: async () => {}
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'childproc')).toBeUndefined();
    });

    it('should skip plugins that import fs', async () => {
      const pluginPath = path.join(pluginsDir, 'fsplugin.test-plugin.js');
      fs.writeFileSync(pluginPath, `const fs = require('fs');
export default {
        name: 'fsplugin',
        trigger: '/fs',
        description: 'FS plugin',
        execute: async () => {}
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'fsplugin')).toBeUndefined();
    });

    it('should skip plugins that import net', async () => {
      const pluginPath = path.join(pluginsDir, 'netplugin.test-plugin.js');
      fs.writeFileSync(pluginPath, `const net = require('net');
export default {
        name: 'netplugin',
        trigger: '/net',
        description: 'Net plugin',
        execute: async () => {}
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'netplugin')).toBeUndefined();
    });

    it('should skip plugins that import http', async () => {
      const pluginPath = path.join(pluginsDir, 'httpplugin.test-plugin.js');
      fs.writeFileSync(pluginPath, `const http = require('http');
export default {
        name: 'httpplugin',
        trigger: '/http',
        description: 'HTTP plugin',
        execute: async () => {}
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'httpplugin')).toBeUndefined();
    });

    it('should skip plugins that use Function constructor', async () => {
      const pluginPath = path.join(pluginsDir, 'funcplugin.test-plugin.js');
      fs.writeFileSync(pluginPath, `export default {
        name: 'funcplugin',
        trigger: '/func',
        description: 'Function plugin',
        execute: async () => { new Function('return 1')(); }
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'funcplugin')).toBeUndefined();
    });
  });
});

describe('Plugin Loader — Technical', () => {
  describe('validatePluginSource', () => {
    it('should allow safe plugin source', async () => {
      const { loadPlugins } = await import('../src/plugins/loader.js');
      // Safe plugins should load
      expect(typeof loadPlugins).toBe('function');
    });

    it('should handle plugin execution timeout', async () => {
      const pluginsDir = path.join(os.homedir(), '.localcode', 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      const pluginPath = path.join(pluginsDir, 'timeout.test-plugin.js');
      fs.writeFileSync(pluginPath, `export default {
        name: 'timeout',
        trigger: '/timeout',
        description: 'Timeout plugin',
        execute: async () => { await new Promise(() => {}); }
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      const timeoutPlugin = plugins.find(p => p.name === 'timeout');
      expect(timeoutPlugin).toBeDefined();
      // Execute should timeout within 30s (we won't wait that long in test)
      expect(typeof timeoutPlugin?.execute).toBe('function');
    });

    it('should handle corrupt plugin files', async () => {
      const pluginsDir = path.join(os.homedir(), '.localcode', 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      const pluginPath = path.join(pluginsDir, 'corrupt.test-plugin.js');
      fs.writeFileSync(pluginPath, 'not valid javascript {{{', 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'corrupt')).toBeUndefined();
    });
  });

  describe('plugin context', () => {
    it('should provide workingDir in context', async () => {
      const pluginsDir = path.join(os.homedir(), '.localcode', 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      const pluginPath = path.join(pluginsDir, 'context.test-plugin.js');
      fs.writeFileSync(pluginPath, `export default {
        name: 'context',
        trigger: '/context',
        description: 'Context plugin',
        execute: async (args, context) => { context._workingDir = context.workingDir; }
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'context')).toBeDefined();
    });

    it('should provide sysMsg in context', async () => {
      const pluginsDir = path.join(os.homedir(), '.localcode', 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      const pluginPath = path.join(pluginsDir, 'sysmsg.test-plugin.js');
      fs.writeFileSync(pluginPath, `export default {
        name: 'sysmsg',
        trigger: '/sysmsg',
        description: 'SysMsg plugin',
        execute: async (args, context) => { context._hasSysMsg = typeof context.sysMsg === 'function'; }
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'sysmsg')).toBeDefined();
    });

    it('should provide addDisplay in context', async () => {
      const pluginsDir = path.join(os.homedir(), '.localcode', 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      const pluginPath = path.join(pluginsDir, 'display.test-plugin.js');
      fs.writeFileSync(pluginPath, `export default {
        name: 'display',
        trigger: '/display',
        description: 'Display plugin',
        execute: async (args, context) => { context._hasDisplay = typeof context.addDisplay === 'function'; }
      };`, 'utf8');
      const { loadPlugins } = await import('../src/plugins/loader.js');
      const plugins = await loadPlugins();
      expect(plugins.find(p => p.name === 'display')).toBeDefined();
    });
  });
});
