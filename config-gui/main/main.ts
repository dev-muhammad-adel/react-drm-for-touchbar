import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  defaultConfigPaths, ensureConfigExists, readConfig, writeConfig, restartService,
} from './configEngine';
import type { ConfigData, ConfigPaths } from './configEngine';
import { pathToFileURL } from 'node:url';
import { KEY, appIconSource, setIconTheme } from 'react-drm';
import { ICON_CHOICES } from './iconList';
import { DOM_CODE_TO_KEY_NAME } from './keyNames';
import { listDesktopApps } from './desktopApps';
import { listIconThemes } from './iconThemes';

let currentPaths: ConfigPaths = defaultConfigPaths(process.env.REACT_DRM_REPO_DIR);

function findRepoDir(): string | null {
  // install.sh's convention. If it's not there, the user needs to locate it manually.
  return fs.existsSync(currentPaths.blueprintPath) ? path.dirname(currentPaths.blueprintPath) : null;
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Tiling WMs (niri, Hyprland — both explicitly supported by this project)
  // honor a window's requested size when they let it float rather than
  // tiling it, so request half the screen instead of a fixed pixel size
  // that'd look tiny on a 4K display or cramped on a small one.
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.round(screenW / 2),
    height: Math.round(screenH / 2),
    minWidth: 760,
    minHeight: 560,
    center: true,
    title: 'Touch Bar Config',
    frame: false,
    backgroundColor: '#0d0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => { mainWindow = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggleMaximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

ipcMain.handle('config:read', (): { data?: ConfigData; error?: string; repoFound: boolean } => {
  const repoFound = findRepoDir() !== null;
  if (!repoFound) return { repoFound: false };
  try {
    ensureConfigExists(currentPaths);
    return { data: readConfig(currentPaths.configPath), repoFound: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), repoFound: true };
  }
});

ipcMain.handle('config:write', (_event, changes: ConfigData): { ok: boolean; error?: string } => {
  try {
    writeConfig(currentPaths.configPath, changes);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('config:restart', () => restartService());

ipcMain.handle('config:locate', async (): Promise<{ found: boolean }> => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined as never, {
    title: 'Select the linux-touchbar-control-center folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { found: findRepoDir() !== null };
  currentPaths = defaultConfigPaths(result.filePaths[0]);
  return { found: findRepoDir() !== null };
});

ipcMain.handle('icon:resolve', (_event, name: string): string | null => {
  const file = appIconSource(name);
  return file ? pathToFileURL(file).toString() : null;
});

// Lets the live Dock preview reflect whatever icon theme is currently picked
// in the (possibly unsaved) form, not just whatever was auto-detected at app
// startup — appIconSource resolves against this module-level override until
// it's changed again, same mechanism the real touchbar app uses in
// configLoader.ts, just driven live from the renderer instead of once at boot.
ipcMain.handle('icon:setTheme', (_event, theme: string | null) => {
  setIconTheme(theme);
});

ipcMain.handle('apps:list', () => listDesktopApps());

ipcMain.handle('icon:themes', () => listIconThemes());

ipcMain.handle('config:meta', () => ({
  iconChoices: ICON_CHOICES,
  domCodeToKeyName: DOM_CODE_TO_KEY_NAME,
  keyNames: KEY as Record<string, number>,
}));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
