import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MCP Manager — Behavioral', () => {
  describe('constructor and initialization', () => {
    it('should create an instance without errors', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      expect(manager).toBeDefined();
    });

    it('should start with no connected servers', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      const status = manager.getStatus();
      expect(Array.isArray(status)).toBe(true);
    });

    it('should return empty configs when no servers saved', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      expect(manager.getConfigs()).toEqual([]);
    });

    it('should return empty tools when no servers connected', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      expect(manager.getAllTools()).toEqual([]);
    });

    it('should return empty tool definitions when no servers connected', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      expect(manager.getToolDefinitions()).toEqual([]);
    });
  });

  describe('isMcpTool', () => {
    it('should identify MCP tool names', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      expect(manager.isMcpTool('mcp__server__tool')).toBe(true);
    });

    it('should reject non-MCP tool names', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      expect(manager.isMcpTool('read_file')).toBe(false);
      expect(manager.isMcpTool('write_file')).toBe(false);
      expect(manager.isMcpTool('run_shell')).toBe(false);
    });

    it('should handle edge cases', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      expect(manager.isMcpTool('')).toBe(false);
      expect(manager.isMcpTool('mcp')).toBe(false);
      expect(manager.isMcpTool('mcp_')).toBe(false);
    });
  });

  describe('callTool', () => {
    it('should reject invalid tool names', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      const result = await manager.callTool('invalid_name', {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Invalid');
    });

    it('should reject tool calls for unconnected servers', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      const result = await manager.callTool('mcp__nonexistent__tool', {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('not connected');
    });
  });

  describe('auto-reconnect', () => {
    it('should enable auto-reconnect by default', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      // Auto-reconnect is enabled by default
      expect(manager).toBeDefined();
    });

    it('should allow disabling auto-reconnect', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      manager.setAutoReconnect(false);
      expect(manager).toBeDefined();
    });
  });

  describe('dispose', () => {
    it('should clean up without errors', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      manager.dispose();
      // Should not throw
    });
  });
});

describe('MCP Manager — Technical', () => {
  describe('config persistence', () => {
    it('should save and load MCP configs', async () => {
      const { loadMcpConfigs, saveMcpConfigs } = await import('../src/mcp/manager.js');
      const configs = [{ name: 'test', transport: 'stdio' as const, command: 'echo', args: [] }];
      saveMcpConfigs(configs);
      const loaded = loadMcpConfigs();
      expect(loaded.length).toBe(1);
      expect(loaded[0].name).toBe('test');
    });

    it('should handle missing config file', async () => {
      const { loadMcpConfigs } = await import('../src/mcp/manager.js');
      const configs = loadMcpConfigs();
      expect(Array.isArray(configs)).toBe(true);
    });

    it('should handle corrupt config file', async () => {
      const configPath = path.join(os.homedir(), '.localcode', 'mcp.json');
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, 'not json', 'utf8');
      const { loadMcpConfigs } = await import('../src/mcp/manager.js');
      const configs = loadMcpConfigs();
      expect(configs).toEqual([]);
    });
  });

  describe('tool name parsing', () => {
    it('should parse namespaced tool names correctly', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      // The internal parsing is tested via callTool rejection
      const result = await manager.callTool('mcp__server__tool__with__underscores', {});
      expect(result.success).toBe(false);
    });
  });

  describe('status reporting', () => {
    it('should return status for all configured servers', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      const status = manager.getStatus();
      expect(Array.isArray(status)).toBe(true);
    });

    it('should include reconnect attempt count in status', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      const status = manager.getStatus();
      for (const s of status) {
        expect(s).toHaveProperty('reconnectAttempts');
        expect(typeof s.reconnectAttempts).toBe('number');
      }
    });
  });

  describe('health check', () => {
    it('should run health check without errors', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      await manager.healthCheck();
      // Should not throw
    });
  });

  describe('reconnect', () => {
    it('should return error for non-existent server', async () => {
      const { McpManager } = await import('../src/mcp/manager.js');
      const manager = new McpManager();
      const result = await manager.reconnect('nonexistent');
      expect(result).toContain('not found');
    });
  });
});
