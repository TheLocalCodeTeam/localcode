import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('localcode', {
  sendMessage: (message: string) => ipcRenderer.invoke('send-message', message),
  getVersion: () => ipcRenderer.invoke('get-version'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  onOutput: (callback: (data: string) => void) => {
    ipcRenderer.on('localcode-output', (_event, data) => callback(data));
  },
  onError: (callback: (data: string) => void) => {
    ipcRenderer.on('localcode-error', (_event, data) => callback(data));
  },
  onNewSession: (callback: () => void) => {
    ipcRenderer.on('new-session', () => callback());
  },
  onActivateAgent: (callback: () => void) => {
    ipcRenderer.on('activate-agent', () => callback());
  },
  onOrchestrate: (callback: () => void) => {
    ipcRenderer.on('orchestrate', () => callback());
  },
  onClearSession: (callback: () => void) => {
    ipcRenderer.on('clear-session', () => callback());
  },
});
