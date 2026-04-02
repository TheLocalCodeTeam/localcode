// src/settings/manager.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Settings } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';
import { logger } from '../core/logger.js';

const GLOBAL_CONFIG_DIR = join(homedir(), '.localcode');
const GLOBAL_SETTINGS_PATH = join(GLOBAL_CONFIG_DIR, 'settings.json');
const PROJECT_SETTINGS_PATHS = ['.localcode/settings.json', 'localcode.json', '.localcoderc'];

// Cached settings to avoid re-reading from disk on every call
let cachedSettings: Settings | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 seconds

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object') {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function validateSettings(settings: unknown): Settings {
  if (!settings || typeof settings !== 'object') return { ...DEFAULT_SETTINGS };
  const s = settings as Record<string, unknown>;
  // Ensure required top-level keys exist
  const required = ['provider', 'agentDispatch', 'permissions', 'ui', 'session', 'tools', 'git', 'memory', 'analytics', 'mcp'];
  for (const key of required) {
    if (!(key in s)) s[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
  }
  return s as unknown as Settings;
}

export function loadSettings(): Settings {
  // Use cache if fresh
  const now = Date.now();
  if (cachedSettings && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedSettings;
  }

  let settings = { ...DEFAULT_SETTINGS };

  // Load global settings
  if (existsSync(GLOBAL_SETTINGS_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8'));
      settings = deepMerge(settings, validateSettings(raw)) as Settings;
    } catch (err) {
      logger.warn('Corrupt global settings file, using defaults', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Load project settings (first found wins)
  for (const relPath of PROJECT_SETTINGS_PATHS) {
    const fullPath = join(process.cwd(), relPath);
    if (existsSync(fullPath)) {
      try {
        const raw = JSON.parse(readFileSync(fullPath, 'utf-8'));
        settings = deepMerge(settings, validateSettings(raw)) as Settings;
        break;
      } catch {
        logger.warn('Corrupt project settings file, skipping', { path: fullPath });
      }
    }
  }

  // Update cache
  cachedSettings = settings;
  cacheTimestamp = now;
  return settings;
}

export function saveSettings(settings: Settings, scope: 'global' | 'project' = 'global'): boolean {
  try {
    let filePath: string;
    if (scope === 'global') {
      if (!existsSync(GLOBAL_CONFIG_DIR)) mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
      filePath = GLOBAL_SETTINGS_PATH;
    } else {
      const dir = join(process.cwd(), '.localcode');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      filePath = join(dir, 'settings.json');
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    // Invalidate cache
    cachedSettings = null;
    cacheTimestamp = 0;
    logger.info('Settings saved', { scope, path: filePath });
    return true;
  } catch (err) {
    logger.error('Failed to save settings', { scope, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export function getSetting<T>(path: string, defaultValue?: T): T {
  const settings = loadSettings();
  const parts = path.split('.');
  let current: unknown = settings;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return defaultValue as T;
    }
  }
  return (current ?? defaultValue) as T;
}

export function setSetting(path: string, value: unknown, scope: 'global' | 'project' = 'global'): boolean {
  const settings = loadSettings();
  const parts = path.split('.');
  let current: Record<string, unknown> = settings as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return saveSettings(settings, scope);
}

export function resetSettings(scope: 'global' | 'project' = 'global'): boolean {
  return saveSettings(DEFAULT_SETTINGS, scope);
}

export function exportSettings(): string {
  return JSON.stringify(loadSettings(), null, 2);
}

export function importSettings(json: string, scope: 'global' | 'project' = 'global'): boolean {
  try {
    const parsed = JSON.parse(json);
    return saveSettings(validateSettings(parsed), scope);
  } catch (err) {
    logger.error('Failed to import settings', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export function getSettingsSummary(): string {
  const s = loadSettings();
  const budget = s.agentDispatch?.budgetLimit ?? 0;
  return [
    `Provider: ${s.provider?.provider ?? 'unknown'}/${s.provider?.model ?? 'unknown'}`,
    `Auto Agent Dispatch: ${s.agentDispatch?.enabled ? 'ON' : 'OFF'} (${s.agentDispatch?.dispatchStrategy ?? 'smart'})`,
    `Require Approval: ${s.agentDispatch?.requireApproval ? 'YES' : 'NO'}`,
    `Max Concurrent Agents: ${s.agentDispatch?.maxConcurrentAgents ?? 5}`,
    `Budget Limit: $${budget.toFixed(2)}`,
    `Quality Gates: ${s.agentDispatch?.qualityGate ? 'ON' : 'OFF'}`,
    `Permissions: edit=${s.permissions?.fileEdit ?? 'ask'} write=${s.permissions?.fileWrite ?? 'ask'} bash=${s.permissions?.bash ?? 'ask'}`,
    `Theme: ${s.ui?.theme?.name ?? 'dark'}`,
    `Auto-Save: ${s.session?.autoSave ? `${s.session.autoSaveInterval}s` : 'OFF'}`,
    `Auto-Compact: ${s.session?.autoCompact ? `>${s.session.compactThreshold} msgs` : 'OFF'}`,
    `Git: ${s.git?.enabled ? (s.git.autoCommit ? 'auto-commit' : 'enabled') : 'disabled'}`,
    `Memory: ${s.memory?.enabled ? (s.memory.autoExtract ? 'auto-extract' : 'enabled') : 'disabled'}`,
    `MCP: ${s.mcp?.enabled ? `${Object.keys(s.mcp.servers ?? {}).length} servers` : 'disabled'}`,
  ].join('\n');
}
