# LocalCode — Nyx AI (VS Code Extension)

Bring **Nyx**, the LocalCode AI coding assistant, directly into VS Code. Every command opens LocalCode in the integrated terminal — no browser, no cloud lock-in, just your preferred model running locally or via API.

---

## Requirements

| Requirement | Details |
|---|---|
| Node.js | 18 or later |
| LocalCode | `npm install -g @localcode/cli` **or** enable npx mode in settings |
| VS Code | 1.85.0 or later |

---

## Installation

1. Install LocalCode globally (recommended):
   ```bash
   npm install -g @localcode/cli
   ```
   Or enable **npx mode** in the extension settings if you prefer not to install globally.

2. Install this extension from the VS Code Marketplace or by loading the `.vsix` file.

---

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). Search for **LocalCode** to see the full list.

| Command | Description |
|---|---|
| `LocalCode: Open` | Open Nyx in the integrated terminal |
| `LocalCode: Ask Nyx about selection` | Pass selected code to Nyx for analysis |
| `LocalCode: Ask Nyx about this file` | Open Nyx in the current file's directory |
| `LocalCode: Explain with Nyx` | Run `/explain` on the selected code (or full file) |
| `LocalCode: Review changes` | Run `/review` to review pending git changes |
| `LocalCode: Run tests with Nyx` | Run `/test` to generate or execute tests |

---

## Keybindings

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+L` (Windows / Linux) | Open LocalCode |
| `Cmd+Shift+L` (Mac) | Open LocalCode |

---

## Context Menus

### Editor right-click (on selected text)
- **Ask Nyx about this** — sends selected code to Nyx
- **Explain with Nyx** — runs `/explain` on the selection

### Editor right-click (no selection)
- **Ask Nyx about this file** — opens Nyx in the file's folder

### Explorer right-click (on a file)
- **Ask Nyx about this file** — opens Nyx in the file's folder

---

## Status Bar

A persistent **⬡ Nyx** button appears on the left side of the VS Code status bar. Click it at any time to open LocalCode.

---

## Configuration

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for **LocalCode**.

| Setting | Type | Default | Description |
|---|---|---|---|
| `localcode.command` | string | `"localcode"` | The shell command used to launch LocalCode. Change this if your binary is installed under a different name or path. |
| `localcode.useNpx` | boolean | `false` | When enabled, LocalCode is launched via `npx @localcode/cli` instead of the globally installed command. Useful in environments where a global install is not possible. |

### Example: `settings.json`
```json
{
  "localcode.useNpx": true
}
```

---

## How it works

Each command opens (or reuses) an integrated terminal named **Nyx** and runs the LocalCode CLI in the relevant working directory. Slash commands (`/explain`, `/review`, `/test`, etc.) are sent to the running TUI automatically after a short initialisation delay.

When you invoke **Ask Nyx about selection** or **Explain with Nyx**, the selected code is written to a temporary file which is passed as an argument — keeping your clipboard untouched.

---

## LocalCode slash commands (reference)

LocalCode ships with 30+ slash commands. Some highlights:

| Command | Description |
|---|---|
| `/explain <file>` | Explain a file or snippet |
| `/review` | Review staged/unstaged git changes |
| `/test` | Generate or run tests |
| `/commit` | Generate a commit message and commit |
| `/diff` | Show and summarise a diff |
| `/git` | Run git operations with AI guidance |
| `/image` | Analyse an image |
| `/watch` | Watch a file for changes |
| `/share` | Share a snippet |

Run `/help` inside LocalCode to see the full list.

---

## License

MIT — see the [LocalCode repository](https://github.com/thealxlabs/localcode) for details.
