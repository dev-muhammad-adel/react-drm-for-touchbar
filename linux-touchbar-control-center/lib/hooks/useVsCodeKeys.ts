import { keys } from '@/lib/services/keyInjector';
import { execFile } from 'child_process';
import { vscodeKeysFor } from '@/lib/utils/configLoader';

function focusWindow(windowClass: string): void {
  if (process.env.WAYLAND_DISPLAY) {
    execFile('hyprctl', ['dispatch', 'focuswindow', `class:${windowClass}`], () => {});
  } else {
    execFile('xdotool', ['search', '--class', windowClass, 'windowfocus'], () => {});
  }
}

function combo(windowClass: string, keycodes: number[]): () => void {
  return () => {
    focusWindow(windowClass);
    setTimeout(() => keys.pressCombo(keycodes), 80);
  };
}

export function useVsCodeKeys(windowClass: string) {
  const km = vscodeKeysFor(windowClass);
  return {
    back:            combo(windowClass, km.back),
    forward:         combo(windowClass, km.forward),
    prevEditor:      combo(windowClass, km.prevEditor),
    nextEditor:      combo(windowClass, km.nextEditor),
    toggleSidebar:   combo(windowClass, km.toggleSidebar),
    toggleTerminal:  combo(windowClass, km.toggleTerminal),
    run:             combo(windowClass, km.run),
    stop:            combo(windowClass, km.stop),
    stepOver:        combo(windowClass, km.stepOver),
    stepInto:        combo(windowClass, km.stepInto),
    stepOut:         combo(windowClass, km.stepOut),
    undo:            combo(windowClass, km.undo),
    redo:            combo(windowClass, km.redo),
    find:            combo(windowClass, km.find),
    replace:         combo(windowClass, km.replace),
    commandPalette:  combo(windowClass, km.commandPalette),
    settings:        combo(windowClass, km.settings),
  };
}
