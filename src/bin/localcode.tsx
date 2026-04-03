#!/usr/bin/env node
// src/bin/localcode.tsx

import React, { useState } from 'react';
import { render } from 'ink';
import { App } from '../ui/App.js';
import { Setup } from '../ui/Setup.js';
import { loadSession, isFirstRun } from '../sessions/manager.js';
import { SessionState } from '../core/types.js';
import { createRequire } from 'module';
import { trackSessionStart, trackSessionEnd, flushTelemetry, trackError } from '../telemetry/index.js';
import { runAllBenchmarks, formatBenchmark, generateBenchmarkReport } from '../benchmarks/index.js';
import * as fs from 'fs';
import * as path from 'path';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { version: string };

const args = process.argv.slice(2);
const showHelp    = args.includes('--help')    || args.includes('-h');
const showVersion = args.includes('--version') || args.includes('-v');
const skipSetup   = args.includes('--yes');
const runBenchmarks = args.includes('--benchmarks') || args.includes('--bench');

if (runBenchmarks) {
  console.log('Running Localcode benchmarks...\n');
  runAllBenchmarks().then(results => {
    for (const r of results) {
      console.log(formatBenchmark(r));
      console.log('');
    }
    const report = generateBenchmarkReport(results);
    const reportPath = path.join(process.cwd(), 'benchmarks.md');
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`Report saved to ${reportPath}`);
    process.exit(0);
  }).catch(err => {
    console.error('Benchmark failed:', err.message);
    process.exit(1);
  });
}

if (showHelp) {
  console.log(`
@localcode/cli v${pkg.version} — Local AI coding assistant

USAGE
  localcode [options]

OPTIONS
  --help, -h          Show this help
  --version, -v       Show version
  --yes               Skip first-run setup
  --benchmarks, --bench  Run performance benchmarks

SLASH COMMANDS (inside the app)
  /               Open command picker (searchable)

  Session
  /clear          Clear conversation history
  /compact        Summarize & compress conversation
  /checkpoint     Save a checkpoint
  /restore        Restore a checkpoint
  /retry          Regenerate last response
  /copy           Copy last response to clipboard
  /export         Export conversation to markdown
  /undo           Undo last file change
  /status         Show session info
  /exit           Exit

  Approval & Agent
  /mode           Set approval mode: suggest / auto-edit / full-auto
  /allowall       Cycle approval mode
  /steps          Set max agent steps per response (default: 20)

  System & Personas
  /sys            View or set system prompt
  /persona        Switch Nyx persona

  Context
  /context        Add file or folder to context (@path also works inline)
  /pin            Pin context that survives /compact
  /unpin          Remove pinned context
  /todo           Extract todo list from conversation
  /web            Search the web and inject results
  /open           Open a file in your editor
  /diff           Show session file changes (unified diff)

  Git
  /commit         AI-generated git commit
  /review         AI code review of current changes

  Providers & Models
  /provider       Switch AI provider (ollama, claude, openai, groq)
  /apikey         Set API key for current provider
  /model          Change model
  /models         List available models for current provider
  /cost           Show estimated session cost

  Tools & Memory
  /init           Generate .localcode.md project config
  /doctor         Health check — providers, tools, git, memory
  /memory         Show and manage .localcode.md memory files
  /hooks          Show configured hooks
  /mcp            Manage MCP servers
  /benchmarks     Run performance benchmarks

  Navigation
  /cd             Change working directory
  /ls             List directory contents
  /find           Find files by name pattern (e.g. /find *.ts)
  /search         Search file contents (e.g. /search TODO)
  /ping           Test provider connectivity and latency

  Agents
  /agent          Browse and activate specialized agents
  /agents         List all 139 agents by category
  /orchestrate    Run multi-agent NEXUS pipeline
  /nexus          Full NEXUS pipeline orchestration
  /swarm          Parallel agent swarm
  /test-loop      Auto-fix failing tests

MULTILINE INPUT
  Ctrl+E         Toggle multiline mode
  Enter          Add line (in multiline mode)
  Ctrl+D         Submit multiline input
  Escape         Cancel in-flight request

CONTEXT INJECTION
  @file.ts        Inject file contents inline in your message
  @src/           Inject directory tree inline

ENV VARS
  ANTHROPIC_API_KEY   Auto-loaded for Claude provider
  OPENAI_API_KEY      Auto-loaded for OpenAI provider
  GROQ_API_KEY        Auto-loaded for Groq provider

MEMORY FILES
  ~/.localcode.md              Global memory — always loaded
  <project>/.localcode.md     Project memory — loaded when cwd matches

HOOKS
  ~/.localcode/hooks.json   PreToolUse / PostToolUse / Notification hooks

EXAMPLES
  localcode
  localcode --yes
  localcode --benchmarks
  ANTHROPIC_API_KEY=sk-ant-xxx localcode
`);
  process.exit(0);
}

if (showVersion) {
  console.log(pkg.version);
  process.exit(0);
}

// ── Root component — handles setup → app transition ──────────────────────────

function Root(): React.ReactElement {
  const firstRun = !skipSetup && isFirstRun();
  const [session, setSession] = useState<SessionState | null>(
    firstRun ? null : loadSession()
  );

  if (!session) {
    return <Setup onComplete={(s) => {
      trackSessionStart(s.provider, s.model);
      setSession(s);
    }} />;
  }

  // Track session start
  React.useEffect(() => {
    trackSessionStart(session.provider, session.model);
    return () => {
      trackSessionEnd(Date.now() - (session as any).startTime, session.messages.length, 0);
      flushTelemetry();
    };
  }, []);

  return <App initialState={session} />;
}

// ── Launch ────────────────────────────────────────────────────────────────────

const { waitUntilExit } = render(
  React.createElement(Root),
  { exitOnCtrlC: false },
);

waitUntilExit()
  .then(() => {
    try {
      const { saveSession, loadSession } = require('../sessions/manager.js');
      saveSession(loadSession());
      flushTelemetry();
    } catch { /* exit regardless */ }
    process.exit(0);
  })
  .catch((err) => {
    trackError(err instanceof Error ? err : new Error(String(err)), { context: 'exit' });
    flushTelemetry();
    process.exit(1);
  });

process.on('beforeExit', () => {
  try {
    const { saveSession, loadSession } = require('../sessions/manager.js');
    saveSession(loadSession());
    flushTelemetry();
  } catch { /* non-critical */ }
});

process.on('uncaughtException', (err) => {
  trackError(err, { context: 'uncaughtException' });
  flushTelemetry();
});

process.on('unhandledRejection', (reason) => {
  trackError(reason instanceof Error ? reason : new Error(String(reason)), { context: 'unhandledRejection' });
  flushTelemetry();
});
