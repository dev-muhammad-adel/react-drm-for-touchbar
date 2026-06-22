import { loadAddon } from './load-addon';

interface KeyboardAddon {
  KeyboardReader: new (devicePath: string) => NativeKeyboardReader;
  findKeyboardDevice:  () => string;
  findKeyboardDevices: () => string[];
  findPointerDevices:  () => string[];
  findLidDevice:       () => string;
}

function loadNative(): KeyboardAddon {
  return loadAddon() as KeyboardAddon;
}

interface NativeKeyboardReader {
  start(callback: (code: number, value: number) => void): void;
  stop(): void;
  isAlive(): boolean;
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
  // Letters (digit strings like '3' resolve as raw keycodes, not key names)
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
  a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50,
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

export function findKeyboardDevices(): string[] { return loadNative().findKeyboardDevices(); }
export function findPointerDevices(): string[]  { return loadNative().findPointerDevices(); }
export function findLidDevice(): string         { return loadNative().findLidDevice(); }

// Delay between reconnect attempts. After an apple-bce resume the keyboard node
// can take a few seconds to re-enumerate, so retry on the same 3s cadence as the
// touch reader rather than hammering the open.
const RECONNECT_DELAY_MS = 3000;

export class KeyboardReader {
  private handle: NativeKeyboardReader;
  private listeners = new Set<(code: number, value: number) => void>();
  private readonly explicitPath?: string;
  private stopped = false;
  private suspended = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentPath = '';

  constructor(devicePath?: string) {
    this.explicitPath = devicePath;
    this.handle = this.openHandle();
    this.startHandle();
  }

  private openHandle(): NativeKeyboardReader {
    const native = loadNative();
    const path = this.explicitPath ?? native.findKeyboardDevice();
    this.currentPath = path;
    return new native.KeyboardReader(path);
  }

  get devicePath(): string { return this.currentPath; }

  private startHandle(): void {
    this.handle.start((code, value) => {
      if (code === -1) {
        this.scheduleReconnect(RECONNECT_DELAY_MS);
        return;
      }
      // Guard each listener: this runs inside the native ThreadSafeFunction
      // callback, so an uncaught throw here propagates to native as a fatal
      // uncaught exception and aborts the whole process. Contain + log instead.
      this.listeners.forEach(l => {
        try { l(code, value); }
        catch (e) { console.error('[react-drm] keyboard listener threw:', e); }
      });
    });
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopped || this.suspended || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || this.suspended) return;
      try {
        this.handle = this.openHandle();
        this.startHandle();
      } catch (_) {
        // Device not back yet (or path changed) — keep retrying.
        this.scheduleReconnect(RECONNECT_DELAY_MS);
      }
    }, delayMs);
  }

  /**
   * Force a fresh device open and resume event delivery.
   * Useful after system suspend/resume when evdev nodes re-enumerate.
   */
  reconnect(): void {
    if (this.stopped) return;
    try { this.handle.stop(); } catch (_) { /* stale handle */ }
    this.scheduleReconnect(0);
  }

  /**
   * Release the device fd before system sleep, keeping listeners intact.
   * Called while the device is still alive (on the logind sleep signal), so the
   * close is clean — we never hold an fd across the apple-bce teardown and so
   * never depend on a stale-fd POLLHUP firing on resume. Pair with resume().
   */
  suspend(): void {
    if (this.stopped || this.suspended) return;
    this.suspended = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.handle.stop(); } catch (_) { /* already gone */ }
    console.log(`[react-drm] keyboard: released ${this.currentPath} for sleep`);
  }

  /**
   * Re-open the device fd after resume. If the keyboard hasn't finished
   * re-enumerating yet, falls back to the normal retry loop.
   */
  resume(): void {
    if (this.stopped || !this.suspended) return;
    this.suspended = false;
    try {
      this.handle = this.openHandle();
      this.startHandle();
      console.log(`[react-drm] keyboard: reopened ${this.currentPath} after resume`);
    } catch (_) {
      console.warn(`[react-drm] keyboard: not back yet after resume, retrying in ${RECONNECT_DELAY_MS}ms`);
      this.scheduleReconnect(RECONNECT_DELAY_MS);
    }
  }

  isAlive(): boolean {
    if (this.stopped) return false;
    try { return this.handle.isAlive(); } catch (_) { return false; }
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
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.handle.stop();
    this.listeners.clear();
  }
}
