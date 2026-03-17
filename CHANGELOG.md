# Changelog

All notable changes to LocalCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.1.0] - 2026-03-16

### Added
- **Persistent input history** — last 200 entries saved to `~/.localcode/history.json`; survives restarts and is navigable with arrow keys
- **Braille spinner animation** — displayed during streaming responses and tool calls for clear visual feedback
- **Theme system** — four built-in themes (`dark`, `nord`, `monokai`, `light`) switchable at any time with `/theme`
- **Template system** — save and reuse prompt templates with `/template add`, `/template use`, `/template list`, `/template delete`; stored in `~/.localcode/templates.json`
- **Alias system** — define custom command shortcuts with `/alias <name> <command>`; stored in `~/.localcode/aliases.json`
- **`/explain`** — stream an AI explanation of any file or the last code snippet in the conversation
- **`/test`** — auto-detects and runs `jest`, `vitest`, `pytest`, `cargo test`, or `go test`; on failure, offers an AI-generated fix
- **`/share`** — exports the full conversation as a self-contained HTML file
- **Session history browser** — `/history [n]` lists and restores past sessions archived in `~/.localcode/sessions/`
- **`/git` panel** — interactive git panel with status, log, stash, and branch views; raw git commands also pass through
- **`/watch`** — watches a file with `fs.watch` and re-runs the last message automatically on every change
- **Auto-context injection** — on startup, automatically injects `git log` and `git status` into context when no `.nyx.md` project file is found
- **Multi-file diff summary** — after the agent edits multiple files, a grouped diff summary is shown
- **Collapsible tool output** — long tool outputs are truncated and expandable to keep the UI clean
- **Syntax highlighting** — code blocks receive keyword, string, number, and comment highlighting
- **Plugin system** — drop any `.js` file into `~/.localcode/plugins/` to register custom slash commands; manage with `/plugins`
- **`/image`** — vision input via base64 encoding, compatible with Claude, GPT-4o, and Ollama `llava`
- **Streaming token counter** — live `+N▌` token display in the header updates during streaming
- **TF-IDF semantic search** — `/index` builds a local search index of project files; `/search <query>` queries it
- **New QoL commands** — `/cd`, `/ls`, `/find`, `/ping` added for quick filesystem and network tasks
- **Dynamic version in header** — version number is read directly from `package.json` at runtime
- **Token progress bar** — visual progress bar in the header shows context window utilization
- **Message timestamps** — system messages and tool call messages now display a timestamp
- **Auto-save** — session is automatically saved to disk after every AI response
- **Input character counter** — footer displays a live character count while typing
- **Windows + Wayland clipboard support** — `/copy` now works on Windows (`clip.exe`) and Wayland (`wl-copy`)
- **Revamped website** — tabbed command browser, feature comparison table, plugin showcase, and terminal demo

### Changed
- Word wrap applied to all message text for improved readability on narrow terminals

---

## [3.0.0] - 2026-03-16

### Added
- **Markdown renderer** (`MarkdownText` component) — renders fenced code blocks, headers (`#`–`###`), ordered and unordered lists, bold text, and inline code in the terminal
- **Hooks system** — run shell scripts automatically on `PreToolUse`, `PostToolUse`, and `Notification` events; configured via `~/.localcode/hooks.json`
- **Three-tier approval mode** — `suggest` (default), `auto-edit`, and `full-auto`; switch at runtime with `/mode` or grant blanket approval with `/allowall`
- **AbortController integration** — pressing `Escape` cancels the current in-flight streaming request immediately
- **Memory hierarchy** — global memory in `~/.nyx.md` plus per-project memory in `<project>/.nyx.md`; manage with `/memory`
- **MCP (Model Context Protocol)** — connect external tool servers over `stdio` or HTTP transport; manage with `/mcp`
- **Multiline input** — toggle multiline editing mode with `Ctrl+E`; lines are numbered, submit with `Ctrl+D`
- **Unified diff** — `/diff` now shows a proper unified diff computed with a pure-JS LCS algorithm
- **New file tools** — `delete_file`, `move_file`, `search_files`, `find_files` added to the agent tool set
- **New slash commands** — `/review`, `/init`, `/doctor`, `/memory`, `/hooks`, `/mode`, `/steps`, `/sys`, `/persona`, `/pin`, `/unpin`, `/web`, `/export`, `/undo`, `/todo`, `/cost`, `/mcp`
- **Per-model cost table** — token cost estimates for Claude 4.6, GPT-4.1, and o3 shown via `/cost`
- **Configurable max steps** — `/steps <n>` sets the agent loop step limit; default is 20
- **Auto-checkpoint** — session checkpointed automatically every 20 messages
- **Polished `NyxHeader`** — dynamic mood-based colors and a `v3.0` version badge

### Security
- **Shell injection prevention** — all `exec()` calls replaced with `execFile()` to eliminate shell injection vectors
- **Path traversal protection** — tool executor now validates and rejects paths that escape the working directory

---

## [2.3.0] - 2025-01-01

### Added
- **Real multi-step agent loop** — the agent now executes tools across multiple reasoning steps rather than a single-shot response
- **MCP server support** — connect to MCP servers over `stdio` transport
- **Ollama provider** — local model support via Ollama
- **Claude SSE provider** — streaming support for Anthropic Claude models
- **OpenAI-compatible provider** — works with any OpenAI-compatible API endpoint
- **Tool set** — `read_file`, `write_file`, `patch_file`, `list_dir`, `run_shell`, `git_operation`
- **Session persistence** — sessions are saved to disk with checkpoint and restore support
- **`/commit`** — generates a conventional commit message using AI and commits staged changes
- **`/diff`** — shows a diff of all files modified during the current session
- **`/context`** — adds a file or folder to the active context window
- **Inline context injection** — `@file` and `@dir` syntax in any message injects file or directory contents inline

---

## [2.2.0] - 2024-12-01

### Added
- **Custom system prompt** — set a persistent system-level instruction with `/sys`
- **Personas** — five built-in personas: `pair-programmer`, `senior-engineer`, `rubber-duck`, `code-reviewer`, `minimal`; switch with `/persona`
- **13 new slash commands** — including `/compact`, `/status`, `/copy`, `/export`, `/undo`, `/retry`, `/models`, and more
- **Cost tracking** — `/cost` displays estimated token cost for the current session
- **Token estimation** — approximate token counts shown before and after messages

---

## [2.1.0] - 2024-11-01

### Added
- **First-run setup wizard** — interactive wizard on first launch guides the user through provider selection and API key entry
- **Searchable command picker** — `/` opens a fuzzy-searchable list of all available commands
- **Multi-provider support** — Ollama, Anthropic Claude, OpenAI, and Groq available from a single interface
- **API key management** — add, update, and remove provider API keys from within the app
- **Live provider and model switching** — change the active provider and model mid-session without restarting

---

## [1.0.0] - 2024-10-01

### Added
- Initial release
- Terminal UI built with [Ink](https://github.com/vadimdemedes/ink)
- Ollama support for local model inference
- Simple conversational chat interface
- Basic file tools: read and write files

[3.1.0]: https://github.com/alexanderthegreat/localcode/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/alexanderthegreat/localcode/compare/v2.3.0...v3.0.0
[2.3.0]: https://github.com/alexanderthegreat/localcode/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/alexanderthegreat/localcode/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/alexanderthegreat/localcode/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/alexanderthegreat/localcode/releases/tag/v1.0.0
