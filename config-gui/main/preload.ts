import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('configApi', {
  read: () => ipcRenderer.invoke('config:read'),
  write: (changes: unknown) => ipcRenderer.invoke('config:write', changes),
  restart: () => ipcRenderer.invoke('config:restart'),
  locate: () => ipcRenderer.invoke('config:locate'),
  meta: () => ipcRenderer.invoke('config:meta'),
  resolveIcon: (name: string) => ipcRenderer.invoke('icon:resolve', name),
  listApps: () => ipcRenderer.invoke('apps:list'),
});

contextBridge.exposeInMainWorld('windowApi', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  close: () => ipcRenderer.send('window:close'),
});
