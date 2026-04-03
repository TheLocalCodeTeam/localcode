// src/telemetry/index.ts
// Anonymous usage telemetry with crash reporting

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../core/logger.js';

const TELEMETRY_FILE = path.join(os.homedir(), '.localcode', 'telemetry.json');

export interface TelemetryEvent {
  type: 'command' | 'error' | 'session_start' | 'session_end' | 'tool_use' | 'agent_dispatch' | 'provider_switch';
  data: Record<string, unknown>;
  timestamp: number;
  sessionId: string;
}

export interface TelemetryConfig {
  enabled: boolean;
  anonymousId: string;
  version: string;
  platform: string;
  nodeVersion: string;
}

let config: TelemetryConfig | null = null;
let eventQueue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function loadConfig(): TelemetryConfig {
  if (config) return config;
  try {
    if (fs.existsSync(TELEMETRY_FILE)) {
      config = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf8'));
    } else {
      config = {
        enabled: true,
        anonymousId: generateId(),
        version: process.env.npm_package_version || '4.0.0',
        platform: process.platform,
        nodeVersion: process.versions.node,
      };
      fs.mkdirSync(path.dirname(TELEMETRY_FILE), { recursive: true });
      fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(config, null, 2));
    }
  } catch {
    config = {
      enabled: false,
      anonymousId: 'unknown',
      version: '4.0.0',
      platform: process.platform,
      nodeVersion: process.versions.node,
    };
  }
  return config as TelemetryConfig;
}

function generateId(): string {
  return 'lc_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function sanitizeEvent(event: TelemetryEvent): TelemetryEvent {
  // Remove any PII or sensitive data
  const sanitized = { ...event };
  const safeData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.data)) {
    // Skip anything that might contain file contents, API keys, or personal info
    if (key.includes('key') || key.includes('secret') || key.includes('password') || key.includes('token')) continue;
    if (typeof value === 'string' && value.length > 500) continue; // Skip large strings (likely file contents)
    safeData[key] = value;
  }
  sanitized.data = safeData;
  return sanitized;
}

export function trackEvent(event: Omit<TelemetryEvent, 'timestamp' | 'sessionId'>): void {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const fullEvent: TelemetryEvent = {
    ...event,
    timestamp: Date.now(),
    sessionId: event.data.sessionId as string || 'unknown',
  };

  const sanitized = sanitizeEvent(fullEvent);
  eventQueue.push(sanitized);

  // Flush every 30 seconds or when queue reaches 50 events
  if (eventQueue.length >= 50) {
    flushEvents();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushEvents, 30000);
  }
}

export function trackCommand(command: string, args: string): void {
  trackEvent({
    type: 'command',
    data: { command, args: args.slice(0, 100) },
  });
}

export function trackError(error: Error, context: Record<string, unknown> = {}): void {
  trackEvent({
    type: 'error',
    data: {
      name: error.name,
      message: error.message.slice(0, 500),
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      ...context,
    },
  });
  logger.error('Error tracked', { name: error.name, message: error.message });
}

export function trackToolUse(toolName: string, success: boolean, durationMs: number): void {
  trackEvent({
    type: 'tool_use',
    data: { tool: toolName, success, durationMs },
  });
}

export function trackAgentDispatch(agentId: string, taskLength: number): void {
  trackEvent({
    type: 'agent_dispatch',
    data: { agentId, taskLength },
  });
}

export function trackProviderSwitch(provider: string): void {
  trackEvent({
    type: 'provider_switch',
    data: { provider },
  });
}

export function trackSessionStart(provider: string, model: string): void {
  trackEvent({
    type: 'session_start',
    data: { provider, model },
  });
}

export function trackSessionEnd(durationMs: number, messageCount: number, toolCalls: number): void {
  trackEvent({
    type: 'session_end',
    data: { durationMs, messageCount, toolCalls },
  });
}

function flushEvents(): void {
  if (eventQueue.length === 0) return;

  const eventsToFlush = [...eventQueue];
  eventQueue = [];
  flushTimer = null;

  // Write to local log file for now (can be extended to send to remote server)
  try {
    const logFile = path.join(os.homedir(), '.localcode', 'telemetry.log');
    for (const event of eventsToFlush) {
      fs.appendFileSync(logFile, JSON.stringify(event) + '\n');
    }
    logger.info('Telemetry flushed', { count: eventsToFlush.length });
  } catch (err) {
    logger.warn('Failed to flush telemetry', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function flushTelemetry(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushEvents();
}

export function getTelemetryConfig(): TelemetryConfig {
  return loadConfig()!;
}

export function setTelemetryEnabled(enabled: boolean): void {
  const cfg = loadConfig();
  cfg.enabled = enabled;
  try {
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(cfg, null, 2));
    config = cfg;
  } catch { /* ok */ }
}

// Flush on process exit
process.on('beforeExit', () => {
  flushTelemetry();
});
