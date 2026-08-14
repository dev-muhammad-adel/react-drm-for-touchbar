import { KEY } from 'react-drm';

/** code -> KEY constant name (e.g. 56 -> "LEFTALT"), for reading arrays back as named refs. */
export const CODE_TO_KEY_NAME: ReadonlyMap<number, string> = new Map(
  Object.entries(KEY).map(([name, code]) => [code, name]),
);

/**
 * Chromium's KeyboardEvent.code is physical-key-based, same category as Linux
 * evdev codes (just a different naming scheme) — this table translates a
 * captured browser keypress into the matching KEY constant name.
 */
export const DOM_CODE_TO_KEY_NAME: Readonly<Record<string, string>> = {
  AltLeft: 'LEFTALT',
  ControlLeft: 'LEFTCTRL',
  ShiftLeft: 'LEFTSHIFT',
  Tab: 'TAB',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGEUP',
  PageDown: 'PAGEDOWN',
  Backquote: 'GRAVE',
  Backspace: 'BACKSPACE',
  Enter: 'ENTER',
  Escape: 'ESC',
  F5: 'F5',
  F10: 'F10',
  F11: 'F11',
  Comma: 'KEY_COMMA',
  KeyB: 'KEY_B',
  KeyF: 'KEY_F',
  KeyH: 'KEY_H',
  KeyP: 'KEY_P',
  KeyR: 'KEY_R',
  KeyS: 'KEY_S',
  KeyT: 'KEY_T',
  KeyW: 'KEY_W',
  KeyZ: 'KEY_Z',
};

/** Resolve a captured DOM KeyboardEvent.code to a KEY constant name, if known. */
export function keyNameForDomCode(domCode: string): string | null {
  return DOM_CODE_TO_KEY_NAME[domCode] ?? null;
}
