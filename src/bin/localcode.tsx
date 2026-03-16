#!/usr/bin/env node
// src/bin/localcode.tsx

import React, { useState } from 'react';
import { render } from 'ink';
import { App } from '../ui/App.js';
import { Setup } from '../ui/Setup.js';
import { loadSession, isFirstRun } from '../sessions/manager.js';
import { SessionState } from '../core/types.js';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { version: string };

const args = process.argv.slice(2);
const showHelp    = args.includes('--help')    || args.includes('-h');
const showVersion = args.includes('--version') || args.includes('-v');
const skipSetup   = args.includes('--yes');

if (showHelp) {
  console.log(`
@localcode/cli — Local AI coding assistant

USAGE
  localcode [options]

OPTIONS
  --help, -h      Show this help
  --version, -v   Show version
  --yes           Skip first-run setup (use saved config or defaults)

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
  /persona        Switch Nyx persona (pair-programmer, senior-engineer, etc.)

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
  /init           Generate .nyx.md project config
  /doctor         Health check — providers, tools, git, memory
  /memory         Show and manage .nyx.md memory files
  /hooks          Show configured hooks
  /mcp            Manage MCP servers

  Navigation
  /cd             Change working directory
  /ls             List directory contents
  /find           Find files by name pattern (e.g. /find *.ts)
  /search         Search file contents (e.g. /search TODO)
  /ping           Test provider connectivity and latency

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
  ~/.nyx.md              Global memory — always loaded
  <project>/.nyx.md     Project memory — loaded when cwd matches

HOOKS
  ~/.localcode/hooks.json   PreToolUse / PostToolUse / Notification hooks

EXAMPLES
  localcode
  localcode --yes
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
    return <Setup onComplete={(s) => setSession(s)} />;
  }

  return <App initialState={session} />;
}

// ── Launch ────────────────────────────────────────────────────────────────────

const { waitUntilExit } = render(
  React.createElement(Root),
  { exitOnCtrlC: false },
);

waitUntilExit()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
