import fs from 'fs';
import path from 'path';

function loadNative(): { KeyboardReader: new (devicePath: string) => NativeKeyboardReader } {
  const candidates = [
    path.join(__dirname, '../../build/Release/drm_backend.node'),
    path.join(__dirname, '../../build/Debug/drm_backend.node'),
  ];
  for (const p of candidates) {
    try { return require(p); } catch (_) { /* try next */ }
  }
  throw new Error('react-drm: native addon not found — run npm run build:native');
}

interface NativeKeyboardReader {
  start(callback: (code: number, value: number) => void): void;
  stop(): void;
}

// Linux keycodes by name (from linux/input-event-codes.h)
export const KEY_NAMES: Record<string, number> = {
  // Special
  fn: 464, esc: 1, escape: 1, tab: 15, backspace: 14, enter: 28, space: 57,
  // Modifiers
  ctrl: 29, control: 29, lctrl: 29, rctrl: 97,
  shift: 42, lshift: 42, rshift: 54,
  alt: 56, lalt: 56, ralt: 100,
  meta: 125, super: 125, win: 125, lmeta: 125, rmeta: 126,
  // F-keys
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64,
  f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88,
  // Navigation
  up: 103, down: 108, left: 105, right: 106,
  home: 102, end: 107, pageup: 104, pagedown: 109,
  insert: 110, delete: 111,
  // Media
  mute: 113, volumedown: 114, volumeup: 115,
  nextsong: 163, playpause: 164, previoussong: 165,
  brightnessdown: 224, brightnessup: 225,
  kbdillumdown: 229, kbdillumup: 230,
  micmute: 248,
};

export type KeyId = number | string;

export function resolveKeyCode(key: KeyId): number {
  if (typeof key === 'number') return key;
  const n = Number(key);
  if (!isNaN(n)) return n;
  const found = KEY_NAMES[key.toLowerCase()];
  if (found === undefined) throw new Error(`react-drm: unknown key name "${key}"`);
  return found;
}

function findKeyboardDevice(): string {
  try {
    const data = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    for (const block of data.trim().split(/\n\n+/)) {
      // Must expose a 'kbd' handler (indicates real keyboard, not mice/joysticks)
      if (!/ kbd /.test(block)) continue;
      const m = block.match(/H:.*\b(event\d+)\b/);
      if (m) return `/dev/input/${m[1]}`;
    }
  } catch (_) { /* fall through */ }
  return '/dev/input/event0';
}

export class KeyboardReader {
  private handle: NativeKeyboardReader;
  private listeners = new Set<(code: number, value: number) => void>();

  constructor(devicePath?: string) {
    const native = loadNative();
    this.handle = new native.KeyboardReader(devicePath ?? findKeyboardDevice());
    this.handle.start((code, value) => {
      this.listeners.forEach(l => l(code, value));
    });
  }

  /** Subscribe to raw key events. Returns an unsubscribe function. */
  onKey(listener: (code: number, value: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to key pressed/released state for a specific key. Returns unsubscribe. */
  onKeyState(key: KeyId, listener: (pressed: boolean) => void): () => void {
    const code = resolveKeyCode(key);
    return this.onKey((c, v) => {
      if (c === code) listener(v !== 0); // 0=up, 1=down, 2=repeat (still held)
    });
  }

  stop(): void {
    this.handle.stop();
    this.listeners.clear();
  }
}
