// src/core/logger.ts
// Simple structured logging framework

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_DIR = join(homedir(), '.localcode', 'logs');
const LOG_FILE = join(LOG_DIR, `localcode-${new Date().toISOString().slice(0, 10)}.log`);

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatLog(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context || {}),
  };
  return JSON.stringify(entry);
}

function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, formatLog(level, message, context) + '\n');
  } catch {
    // If logging fails, silently skip — don't crash the app
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    writeLog('debug', message, context);
  },
  info: (message: string, context?: Record<string, unknown>) => {
    writeLog('info', message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    writeLog('warn', message, context);
  },
  error: (message: string, context?: Record<string, unknown>) => {
    writeLog('error', message, context);
  },
};
