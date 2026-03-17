import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the shell command used to launch LocalCode. */
function getLaunchCommand(): string {
  const config = vscode.workspace.getConfiguration('localcode');
  const useNpx = config.get<boolean>('useNpx', false);
  if (useNpx) {
    return 'npx @localcode/cli';
  }
  return config.get<string>('command', 'localcode');
}

/**
 * Return the best working directory for the terminal.
 * Priority: active editor file's folder → first workspace folder → home dir.
 */
function getWorkingDirectory(uri?: vscode.Uri): string {
  if (uri) {
    const stat = fs.statSync(uri.fsPath, { throwIfNoEntry: false });
    if (stat) {
      return stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
    }
  }

  const editor = vscode.window.activeTextEditor;
  if (editor && !editor.document.isUntitled) {
    return path.dirname(editor.document.uri.fsPath);
  }

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }

  return os.homedir();
}

/**
 * Find an existing "Nyx" terminal or create a new one.
 * If `forceNew` is true a fresh terminal is always created (useful when the
 * cwd must differ from the existing one).
 */
function getOrCreateTerminal(cwd: string, forceNew = false): vscode.Terminal {
  if (!forceNew) {
    const existing = vscode.window.terminals.find((t) => t.name === 'Nyx');
    if (existing) {
      return existing;
    }
  }

  return vscode.window.createTerminal({
    name: 'Nyx',
    cwd,
  });
}

/**
 * Open a Nyx terminal in `cwd`, start LocalCode, then optionally send a
 * follow-up command string once the process is running.
 *
 * Because LocalCode is an interactive TUI we cannot reliably detect when it
 * has fully started before sending text. A small delay of ~600 ms is the
 * pragmatic solution used by many terminal-driving extensions.
 */
async function openLocalCode(
  cwd: string,
  followUpCommand?: string,
  forceNew = false
): Promise<void> {
  const cmd = getLaunchCommand();
  const terminal = getOrCreateTerminal(cwd, forceNew);
  terminal.show(true);

  if (followUpCommand) {
    // Start LocalCode then send the slash command after a short delay so the
    // TUI has time to initialise before receiving input.
    terminal.sendText(cmd);
    await delay(650);
    terminal.sendText(followUpCommand);
  } else {
    terminal.sendText(cmd);
  }
}

/** Write text to a temp file and return its path. */
function writeTempFile(content: string, ext: string = '.txt'): string {
  const tmpPath = path.join(os.tmpdir(), `nyx-context-${Date.now()}${ext}`);
  fs.writeFileSync(tmpPath, content, 'utf8');
  return tmpPath;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Extension entry points
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // ── 1. localcode.open ────────────────────────────────────────────────────
  const openCmd = vscode.commands.registerCommand('localcode.open', async () => {
    const cwd = getWorkingDirectory();
    await openLocalCode(cwd);
  });

  // ── 2. localcode.askAboutSelection ───────────────────────────────────────
  const askAboutSelectionCmd = vscode.commands.registerCommand(
    'localcode.askAboutSelection',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('LocalCode: No active editor found.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('LocalCode: No text selected.');
        return;
      }

      const selectedText = editor.document.getText(selection);
      const fileExt = path.extname(editor.document.fileName) || '.txt';

      // Write the selected snippet to a temp file so LocalCode can read it.
      const tmpFile = writeTempFile(selectedText, fileExt);
      const cwd = getWorkingDirectory();

      // Open LocalCode and send a /explain command pointing at the temp file.
      // This gives users immediate context without having to type anything.
      await openLocalCode(cwd, `/explain ${tmpFile}`, false);
    }
  );

  // ── 3. localcode.askAboutFile ─────────────────────────────────────────────
  const askAboutFileCmd = vscode.commands.registerCommand(
    'localcode.askAboutFile',
    async (uri?: vscode.Uri) => {
      // `uri` is provided when triggered from the explorer context menu.
      // Fall back to the active editor when triggered from the editor context menu.
      const filePath = uri
        ? uri.fsPath
        : vscode.window.activeTextEditor?.document.uri.fsPath;

      if (!filePath) {
        vscode.window.showWarningMessage('LocalCode: No file is currently open.');
        return;
      }

      const cwd = path.dirname(filePath);
      // Force a new terminal so cwd is set to the file's directory.
      await openLocalCode(cwd, undefined, true);
    }
  );

  // ── 4. localcode.explainSelection ────────────────────────────────────────
  const explainSelectionCmd = vscode.commands.registerCommand(
    'localcode.explainSelection',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('LocalCode: No active editor found.');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const selection = editor.selection;
      const cwd = getWorkingDirectory();

      if (!selection.isEmpty) {
        // Write selection to a temp file and run /explain on it.
        const selectedText = editor.document.getText(selection);
        const fileExt = path.extname(filePath) || '.txt';
        const tmpFile = writeTempFile(selectedText, fileExt);
        await openLocalCode(cwd, `/explain ${tmpFile}`, false);
      } else {
        // No selection — explain the whole file.
        await openLocalCode(cwd, `/explain ${filePath}`, false);
      }
    }
  );

  // ── 5. localcode.reviewChanges ────────────────────────────────────────────
  const reviewChangesCmd = vscode.commands.registerCommand(
    'localcode.reviewChanges',
    async () => {
      const cwd = getWorkingDirectory();
      await openLocalCode(cwd, '/review', false);
    }
  );

  // ── 6. localcode.runTests ─────────────────────────────────────────────────
  const runTestsCmd = vscode.commands.registerCommand(
    'localcode.runTests',
    async () => {
      const cwd = getWorkingDirectory();
      await openLocalCode(cwd, '/test', false);
    }
  );

  // ── Status bar item ───────────────────────────────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = '⬡ Nyx';
  statusBarItem.tooltip = 'Open LocalCode — Nyx AI assistant';
  statusBarItem.command = 'localcode.open';
  statusBarItem.show();

  // ── Register all disposables ──────────────────────────────────────────────
  context.subscriptions.push(
    openCmd,
    askAboutSelectionCmd,
    askAboutFileCmd,
    explainSelectionCmd,
    reviewChangesCmd,
    runTestsCmd,
    statusBarItem
  );
}

export function deactivate(): void {
  // Nothing to clean up — VS Code disposes subscriptions automatically.
}
