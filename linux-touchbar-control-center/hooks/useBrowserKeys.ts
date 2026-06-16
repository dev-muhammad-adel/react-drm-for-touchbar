import { keys } from '../services/keyInjector';
import { execFile } from 'child_process';
import { browserKeysFor } from '../config';

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

export function useBrowserKeys(windowClass: string) {
  const km = browserKeysFor(windowClass);
  return {
    back:     combo(windowClass, km.back),
    forward:  combo(windowClass, km.forward),
    reload:   combo(windowClass, km.reload),
    home:     combo(windowClass, km.home),
    newTab:   combo(windowClass, km.newTab),
    closeTab: combo(windowClass, km.closeTab),
    nextTab:  combo(windowClass, km.nextTab),
    prevTab:  combo(windowClass, km.prevTab),
  };
}
