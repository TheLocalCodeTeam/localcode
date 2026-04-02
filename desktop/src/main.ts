import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let localcodeProcess: ChildProcess | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: {
      color: '#000000',
      symbolColor: '#ededed',
      height: 40,
    },
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
    icon: join(__dirname, '..', 'build', 'icon.png'),
  });

  mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Localcode',
      submenu: [
        { label: 'About Localcode', click: () => dialog.showMessageBox({ title: 'Localcode', message: 'Localcode v4.0.0\nAI Coding Agent by TheAlxLabs' }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Agent',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-session') },
        { label: 'Activate Agent', accelerator: 'CmdOrCtrl+Shift+A', click: () => mainWindow?.webContents.send('activate-agent') },
        { label: 'Orchestrate', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('orchestrate') },
        { type: 'separator' },
        { label: 'Clear Session', accelerator: 'CmdOrCtrl+Shift+K', click: () => mainWindow?.webContents.send('clear-session') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/thealxlabs/localcode#readme') },
        { label: 'GitHub', click: () => shell.openExternal('https://github.com/thealxlabs/localcode') },
        { type: 'separator' },
        { label: 'Report Issue', click: () => shell.openExternal('https://github.com/thealxlabs/localcode/issues') },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

function startLocalcodeBackend(): void {
  const localcodePath = process.env.LOCALCODE_PATH || 'localcode';
  localcodeProcess = spawn(localcodePath, ['--headless', '--json'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  localcodeProcess.stdout?.on('data', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('localcode-output', data.toString());
    }
  });

  localcodeProcess.stderr?.on('data', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('localcode-error', data.toString());
    }
  });

  localcodeProcess.on('close', (code) => {
    console.log(`Localcode backend exited with code ${code}`);
  });
}

app.whenReady().then(() => {
  createWindow();
  startLocalcodeBackend();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (localcodeProcess) {
    localcodeProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (localcodeProcess) {
    localcodeProcess.kill();
  }
});

// IPC handlers
ipcMain.handle('send-message', async (_event, message: string) => {
  if (localcodeProcess && localcodeProcess.stdin) {
    localcodeProcess.stdin.write(JSON.stringify({ type: 'message', content: message }) + '\n');
    return { success: true };
  }
  return { success: false, error: 'Backend not running' };
});

ipcMain.handle('get-version', async () => {
  return { version: '4.0.0', electron: process.versions.electron };
});

ipcMain.handle('open-external', async (_event, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Project Directory',
  });
  return result.filePaths[0] || null;
});
