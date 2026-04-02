# Localcode

> The open-source AI coding agent that runs locally. 139 specialized agents, multi-agent orchestration, full tool execution, and VS Code integration.

<div align="center">

[![Build](https://github.com/thealxlabs/localcode/actions/workflows/ci.yml/badge.svg)](https://github.com/thealxlabs/localcode/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@localcode/cli.svg)](https://www.npmjs.com/package/@localcode/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0-green.svg)](https://nodejs.org/)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-007ACC.svg)](https://marketplace.visualstudio.com/items?itemName=thealxlabs.localcode)

</div>

---

## Table of Contents

- [What is Localcode?](#what-is-localcode)
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Providers](#providers)
- [Agents](#agents)
- [Commands](#commands)
- [Tools](#tools)
- [Multi-Agent Orchestration](#multi-agent-orchestration)
- [VS Code Extension](#vs-code-extension)
- [Settings](#settings)
- [Plugins](#plugins)
- [MCP Servers](#mcp-servers)
- [Memory System](#memory-system)
- [Git Integration](#git-integration)
- [Hooks](#hooks)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## What is Localcode?

Localcode is a full-featured AI coding agent that runs in your terminal. It connects to any LLM provider (local or cloud), reads your codebase, edits files, runs commands, and iterates until the job is done. It comes with **139 specialized agents** across engineering, design, testing, security, DevOps, and more — each with deep domain expertise.

Unlike cloud-only coding assistants, Localcode:
- **Runs locally** with Ollama — your code never leaves your machine
- **Auto-dispatches agents** based on task context — no manual switching
- **Orchestrates multi-agent pipelines** with quality gates and retries
- **Integrates with VS Code** — chat panel, inline edits, completions
- **Supports any provider** — Ollama, OpenAI, Anthropic, Groq, OpenRouter, custom

## Features

### Core
- **Real agent loop** — reads files, edits, runs tests, iterates automatically
- **10 built-in tools** — read/write/patch/delete/move files, shell, search, find, list, git
- **@-mentions** — inject file context inline with `@file.ts`
- **Permission system** — ask/allow/deny per tool and command pattern
- **Checkpoints** — auto-save session state every 20 messages
- **Model routing** — use different models for planning, execution, and review
- **Budget guard** — auto-switches to local model when budget is hit
- **Safe mode** — git stash before edits, auto-revert on test failure

### Agents
- **139 specialized agents** — engineering, design, testing, security, DevOps, marketing, product, and more
- **Auto-dispatch** — agents activate automatically based on task keywords (configurable)
- **Multi-agent orchestration** — NEXUS pipeline with 7 phases, quality gates, and Dev↔QA loops
- **Agent picker** — search and activate any agent with `/agent`

### IDE Integration
- **VS Code extension** — chat panel, agent view, session stats, inline edits, completions
- **14 commands** — chat, inline edit, generate, explain, fix, review, test, commit, and more
- **Keybindings** — `Cmd+L` for chat, `Cmd+K` for inline edit, `Cmd+Shift+A` for agents
- **Status bar** — live status, token count, cost estimate, active agent

### Extensibility
- **Plugins** — drop `.js` files in `~/.localcode/plugins/` to add custom commands
- **MCP servers** — connect external tools via Model Context Protocol
- **Hooks** — PreToolUse and PostToolUse hooks for custom logic
- **Custom agents** — add your own agents in `~/.localcode/agents/`

---

## Quick Start

```bash
# Install
npm install -g @localcode/cli

# Run with Ollama (local, no API key needed)
localcode

# Run with a specific provider
localcode --provider openai --model gpt-4o
localcode --provider claude --model claude-sonnet-4-20250514
localcode --provider groq --model llama-3.3-70b-versatile

# Auto-accept tool calls (hands-free mode)
localcode --yes

# Set a working directory
localcode /path/to/project
```

---

## Installation

### Prerequisites

- **Node.js** 18.0 or later
- **Ollama** (optional, for local models) — [ollama.com](https://ollama.com)

### Install from npm

```bash
npm install -g @localcode/cli
```

### Install from source

```bash
git clone https://github.com/thealxlabs/localcode.git
cd localcode
npm install
npm run build
npm link
```

### Install VS Code extension

```bash
cd extensions/vscode
npm install
npm run compile
npm run package
code --install-extension localcode-4.0.0.vsix
```

---

## Configuration

Localcode uses `~/.localcode/settings.json` for global config and `.localcode/settings.json` for project-specific config.

```json
{
  "provider": {
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "baseUrl": "http://localhost:11434",
    "temperature": 0.3,
    "maxTokens": 8192
  },
  "agentDispatch": {
    "enabled": true,
    "requireApproval": false,
    "maxConcurrentAgents": 5,
    "dispatchStrategy": "smart",
    "qualityGate": true,
    "maxRetries": 3
  },
  "permissions": {
    "fileEdit": "allow",
    "fileWrite": "allow",
    "bash": "allow"
  },
  "session": {
    "autoSave": true,
    "autoCompact": true,
    "compactThreshold": 50
  },
  "git": {
    "enabled": true,
    "autoCommit": false,
    "autoStash": false
  },
  "memory": {
    "enabled": true,
    "autoExtract": true,
    "persistentMemory": true
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (auto-loaded) |
| `ANTHROPIC_API_KEY` | Anthropic API key (auto-loaded) |
| `GROQ_API_KEY` | Groq API key (auto-loaded) |
| `LOCALCODE_PROVIDER` | Default provider override |
| `LOCALCODE_MODEL` | Default model override |
| `LOCALCODE_WORKDIR` | Default working directory |

---

## Providers

Localcode supports any OpenAI-compatible API endpoint.

| Provider | Setup | Local? |
|----------|-------|--------|
| **Ollama** | `localcode --provider ollama` | Yes |
| **OpenAI** | Set `OPENAI_API_KEY` | Cloud |
| **Anthropic** | Set `ANTHROPIC_API_KEY` | Cloud |
| **Groq** | Set `GROQ_API_KEY` | Cloud |
| **OpenRouter** | Set `OPENROUTER_API_KEY` | Cloud |
| **Custom** | Set `baseUrl` in settings | Depends |

Switch providers mid-session:
```
/provider ollama
/provider openai
/provider claude
/provider groq
```

---

## Agents

Localcode comes with **139 specialized agents** organized by division:

### Engineering (30+ agents)
- **AI Engineer** — ML model integration, training pipelines
- **Senior Developer** — Complex feature implementation, architecture decisions
- **Software Architect** — System design, microservices, scalability
- **Backend Architect** — API design, database optimization, server architecture
- **Frontend Developer** — React, Vue, Angular, CSS, responsive design
- **Database Optimizer** — Query optimization, indexing, schema design

### Testing (10+ agents)
- **API Tester** — Endpoint testing, contract validation
- **Test Results Analyzer** — Test output parsing, failure triage
- **Reality Checker** — Verify assumptions, validate implementations

### Security (8+ agents)
- **Security Engineer** — Vulnerability assessment, secure coding
- **Threat Detection** — Attack surface analysis, exploit prevention
- **Compliance Auditor** — Regulatory compliance, security standards

### DevOps & Infrastructure (10+ agents)
- **DevOps Automator** — CI/CD pipelines, containerization
- **SRE** — Site reliability, monitoring, incident response
- **Infrastructure Maintainer** — Cloud infrastructure, scaling

### Design, Marketing, Product, and more

### Using Agents

```
/agent                    # Browse and activate agents (interactive picker)
/agent ai-engineer        # Activate a specific agent
/agents                   # List all agents by category
/agents security          # Search agents by keyword
```

### Auto-Dispatch

Agents are automatically dispatched based on task context. No permission needed by default (configurable in settings).

```
User: "Fix the authentication bug"
→ Auto-dispatches: security-engineer, backend-architect, testing-reality-checker

User: "Optimize the database queries"
→ Auto-dispatches: database-optimizer, performance-benchmarker
```

---

## Commands

Type `/` to see all available commands. Key commands:

| Command | Description |
|---------|-------------|
| `/help` | Show command picker |
| `/clear` | Clear conversation |
| `/model <name>` | Switch model |
| `/provider <name>` | Switch provider |
| `/agent` | Browse and activate agents |
| `/agents` | List all agents |
| `/orchestrate` | Run multi-agent pipeline |
| `/nexus` | Full NEXUS pipeline |
| `/swarm <n>` | Parallel agent swarm |
| `/test-loop` | Auto-fix failing tests |
| `/benchmark` | Run build/test benchmarks |
| `/commit` | Generate commit message |
| `/diff` | Show unstaged changes |
| `/checkpoint` | Save session checkpoint |
| `/persona <name>` | Switch persona |
| `/theme <name>` | Switch theme |
| `/settings` | Show current settings |
| `/privacy` | Show provider usage report |
| `/search <pattern>` | Search file contents |
| `/ping` | Test provider connectivity |

---

## Tools

Localcode has 10 built-in tools that the agent uses autonomously:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with line numbers |
| `write_file` | Create or overwrite a file |
| `patch_file` | Edit part of a file (old_str → new_str) |
| `delete_file` | Delete a file |
| `move_file` | Move/rename a file |
| `run_shell` | Run any shell command |
| `list_dir` | List directory contents (recursive) |
| `search_files` | Grep-like search across the project |
| `find_files` | Find files by name pattern |
| `git_operation` | Run git commands |

---

## Multi-Agent Orchestration

### NEXUS Pipeline

The NEXUS system coordinates multiple agents through a structured pipeline:

```
/nexus "build a SaaS platform" full
```

**Full Mode** (7 phases):
1. **Discovery** — Requirements gathering, competitive analysis
2. **Strategy** — Architecture decisions, technology selection
3. **Foundation** — Project scaffolding, CI/CD setup
4. **Build** — Core implementation with parallel agents
5. **Hardening** — Security audit, performance optimization, testing
6. **Launch** — Deployment, documentation, monitoring
7. **Operate** — Ongoing maintenance, incident response

**Sprint Mode** (4 phases): Strategy → Foundation → Build → Hardening

**Micro Mode** (1 phase): Build only

### Orchestration

```
/orchestrate "refactor the auth system" sprint
/orchestrate "add dark mode" micro
```

Features:
- **Quality gates** between each phase
- **Dev↔QA loops** for all implementation tasks
- **Parallel execution** with configurable batch sizes
- **Automatic retries** for failed tasks
- **Synthesis** of all agent outputs into a coherent result

---

## VS Code Extension

The VS Code extension provides:

### Views
- **Chat Panel** — Full conversation interface with streaming
- **Agent View** — Browse and activate 139 agents
- **Session View** — Live stats (tokens, cost, duration)

### Commands
- `Cmd+L` — Open chat
- `Cmd+K` — Inline edit (select code, describe changes)
- `Cmd+Shift+A` — Activate agent

### Right-Click Menu
- Inline Edit, Generate Code, Explain Code, Fix Issues, Review Code, Generate Tests

### Status Bar
- Live status indicator, token count, cost estimate, active agent

---

## Settings

All settings are configurable via:
- `~/.localcode/settings.json` (global)
- `.localcode/settings.json` (project)
- VS Code Settings UI (`@ext:thealxlabs.localcode`)

See [Configuration](#configuration) for the full schema.

---

## Plugins

Create custom commands by dropping `.js` files in `~/.localcode/plugins/`:

```javascript
export default {
  name: 'my-plugin',
  trigger: '/mycommand',
  description: 'Does something useful',
  async execute(args, context) {
    context.addDisplay({ role: 'assistant', content: `Hello ${args}!` });
  }
};
```

---

## MCP Servers

Connect external tools via Model Context Protocol:

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
      }
    }
  }
}
```

---

## Memory System

Localcode maintains persistent memory across sessions:

- **Global memory** — `~/.localcode.md` — Always loaded
- **Project memory** — `<project>/.localcode.md` — Loaded when cwd matches
- **Auto-extraction** — Patterns, conventions, and style guides are automatically extracted from your code

---

## Git Integration

```
/commit              # Generate commit message from diff
/diff                # Show unstaged changes
/blame <file>        # Show git blame
/log                 # Show recent commits
/branch              # List branches
```

**Safe Mode**: Enable `safeMode: true` in settings to automatically stash before edits and revert if tests fail.

---

## Hooks

Custom logic that runs before/after tool use:

```json
{
  "PreToolUse": [{
    "matcher": "run_shell",
    "hooks": [{ "type": "command", "command": "echo 'Running: $COMMAND'" }]
  }],
  "PostToolUse": [{
    "matcher": "write_file",
    "hooks": [{ "type": "command", "command": "prettier --write $FILE_PATH" }]
  }]
}
```

---

## Architecture

```
localcode/
├── src/
│   ├── bin/localcode.tsx          # CLI entry point
│   ├── core/types.ts              # Core types, themes, commands
│   ├── providers/client.ts        # LLM provider abstraction
│   ├── tools/executor.ts          # Tool execution engine
│   ├── agents/                    # Agent system
│   │   ├── registry/              # Agent loading & discovery
│   │   ├── orchestrator.ts        # Multi-agent orchestration
│   │   ├── autoDispatch.ts        # Automatic agent dispatch
│   │   ├── swarm.ts               # Parallel agent swarm
│   │   └── testloop.ts            # Auto-fix failing tests
│   ├── sessions/manager.ts        # Session persistence, checkpoints
│   ├── mcp/manager.ts             # MCP server management
│   ├── plugins/loader.ts          # Plugin loading
│   ├── search/tfidf.js            # TF-IDF search
│   ├── settings/                  # Settings system
│   └── ui/                        # Terminal UI
│       ├── App.tsx                # Main TUI component
│       ├── CommandPicker.tsx      # Command palette
│       ├── AgentPicker.tsx        # Agent browser
│       └── ...
├── extensions/vscode/             # VS Code extension
├── .github/                       # GitHub workflows & templates
├── dist/                          # Compiled output
└── package.json
```

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Security

See [SECURITY.md](SECURITY.md) for our security policy.

To report a vulnerability, email security@thealxlabs.com.

---

## License

MIT — See [LICENSE](LICENSE) for details.

Built with ❤️ by [TheAlxLabs](https://github.com/thealxlabs)
