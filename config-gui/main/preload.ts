import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('configApi', {
  read: () => ipcRenderer.invoke('config:read'),
  write: (changes: unknown) => ipcRenderer.invoke('config:write', changes),
  restart: () => ipcRenderer.invoke('config:restart'),
  locate: () => ipcRenderer.invoke('config:locate'),
  meta: () => ipcRenderer.invoke('config:meta'),
  resolveIcon: (name: string) => ipcRenderer.invoke('icon:resolve', name),
  setIconTheme: (theme: string | null) => ipcRenderer.invoke('icon:setTheme', theme),
  listApps: () => ipcRenderer.invoke('apps:list'),
  listIconThemes: () => ipcRenderer.invoke('icon:themes'),
});

contextBridge.exposeInMainWorld('windowApi', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  close: () => ipcRenderer.send('window:close'),
});
