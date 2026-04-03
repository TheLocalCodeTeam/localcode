// src/security/index.ts
// Security audit and sandboxing for shell commands

import { execFile } from 'child_process';

export interface SecurityCheck {
  passed: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  command?: string;
}

// Comprehensive list of blocked commands and patterns
const BLOCKED_COMMANDS = [
  // Filesystem destruction
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~',
  'rm -rf $HOME',
  'mkfs',
  'mkfs.',
  'dd if=',
  'dd of=',
  '> /dev/sda',
  '> /dev/disk',

  // System control
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  'systemctl poweroff',
  'systemctl reboot',

  // Privilege escalation
  'chmod -R 777 /',
  'chmod -R 777 /*',
  'chmod -R 777 ~',
  'chmod -R 777 $HOME',
  'chown -R',
  'sudo',
  'su -',

  // Network attacks
  'curl * | sh',
  'curl *|sh',
  'curl * | bash',
  'curl *|bash',
  'wget * | sh',
  'wget *|sh',
  'wget * | bash',
  'wget *|bash',

  // Fork bombs
  ':(){:|:&};:',
  'forkbomb',

  // Data exfiltration
  'scp * @',
  'rsync * @',
  'nc -l',
  'ncat -l',
  'socat',

  // Process manipulation
  'kill -9 1',
  'kill -9 -1',
  'killall',
  'pkill -9',
];

// Patterns that require additional scrutiny
const SUSPICIOUS_PATTERNS = [
  /eval\s*\(/,
  /exec\s*\(/,
  /system\s*\(/,
  /`[^`]*`/,
  /\$\([^)]*\)/,
  /\/etc\/(passwd|shadow|hosts|sudoers)/,
  /\.ssh\//,
  /\.env/,
  /AWS_SECRET/,
  /PRIVATE_KEY/,
  /password/i,
  /secret/i,
  /token/i,
];

/**
 * Check if a command is safe to execute.
 */
export function checkCommandSafety(command: string): SecurityCheck[] {
  const checks: SecurityCheck[] = [];
  const normalizedCommand = command.toLowerCase().replace(/\s+/g, ' ').trim();

  // Check blocked commands
  for (const blocked of BLOCKED_COMMANDS) {
    const normalizedBlocked = blocked.toLowerCase().replace(/\s+/g, ' ');
    // Handle wildcard patterns
    if (normalizedBlocked.includes('*')) {
      const pattern = normalizedBlocked.replace(/\*/g, '.*');
      if (new RegExp(pattern).test(normalizedCommand)) {
        checks.push({
          passed: false,
          severity: 'critical',
          message: `Command matches blocked pattern: "${blocked}"`,
          command,
        });
      }
    } else if (normalizedCommand.includes(normalizedBlocked)) {
      checks.push({
        passed: false,
        severity: 'critical',
        message: `Command contains blocked pattern: "${blocked}"`,
        command,
      });
    }
  }

  // Check suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(command)) {
      checks.push({
        passed: false,
        severity: 'high',
        message: `Command contains suspicious pattern: ${pattern.source}`,
        command,
      });
    }
  }

  // Check command length (very long commands might be obfuscated)
  if (command.length > 10000) {
    checks.push({
      passed: false,
      severity: 'medium',
      message: 'Command is unusually long (>10KB), possible obfuscation',
      command: command.slice(0, 100) + '...',
    });
  }

  // Check for encoded content
  if (/base64\s+-d/.test(command) || /\\x[0-9a-f]{2}/.test(command)) {
    checks.push({
      passed: false,
      severity: 'high',
      message: 'Command contains encoded content',
      command,
    });
  }

  // If no issues found, command is safe
  if (checks.length === 0) {
    checks.push({
      passed: true,
      severity: 'low',
      message: 'Command passed security checks',
      command,
    });
  }

  return checks;
}

/**
 * Check if a command is safe (convenience method).
 */
export function isCommandSafe(command: string): boolean {
  const checks = checkCommandSafety(command);
  return checks.every(c => c.passed);
}

/**
 * Get a summary of security checks.
 */
export function getSecuritySummary(command: string): string {
  const checks = checkCommandSafety(command);
  const failed = checks.filter(c => !c.passed);
  const critical = failed.filter(c => c.severity === 'critical');
  const high = failed.filter(c => c.severity === 'high');

  if (critical.length > 0) {
    return `BLOCKED: ${critical.length} critical issue(s) found`;
  }
  if (high.length > 0) {
    return `WARNING: ${high.length} high-severity issue(s) found`;
  }
  if (failed.length > 0) {
    return `CAUTION: ${failed.length} issue(s) found`;
  }
  return 'SAFE: Command passed all security checks';
}

/**
 * Run a command with security checks.
 */
export function runSafeCommand(
  command: string,
  cwd: string,
  timeout: number = 30000,
): Promise<{ success: boolean; output: string; checks: SecurityCheck[] }> {
  const checks = checkCommandSafety(command);
  const isSafe = checks.every(c => c.passed);

  if (!isSafe) {
    const criticalIssues = checks.filter(c => !c.passed).map(c => c.message).join('; ');
    return Promise.resolve({
      success: false,
      output: `Command blocked by security check: ${criticalIssues}`,
      checks,
    });
  }

  return new Promise((resolve) => {
    execFile('sh', ['-c', command], { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (err) {
        resolve({ success: false, output: output || err.message, checks });
      } else {
        resolve({ success: true, output: output || '(no output)', checks });
      }
    });
  });
}
