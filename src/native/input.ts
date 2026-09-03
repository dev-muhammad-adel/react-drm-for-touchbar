import fs from 'fs';
import { loadAddon } from './load-addon';
import { createLogger } from '../logger';

const log = createLogger('touch');

interface InputAddon {
  TouchReader: new (devicePath: string) => NativeTouchReader;
  KeyInjector: new () => NativeKeyInjector;
}

function loadNative(): InputAddon {
  return loadAddon() as InputAddon;
}

interface NativeTouchReader {
  // Callback receives (type, rawX, rawY): type 0=start 1=move 2=end
  start(callback: (type: number, x: number, y: number) => void): void;
  stop(): void;
}

interface NativeKeyInjector {
  keyDown(keycode: number): void;
  keyUp(keycode: number): void;
  pressKey(keycode: number): void;
  pressCombo(keycodes: number[]): void;
}

// F1=59 … F12=88
export const FKEY_CODES = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88] as const;

export const KEY = {
  // Esc
  ESC: 1,
  // Digits 0-9
  KEY_0: 11, KEY_1: 2, KEY_2: 3, KEY_3: 4, KEY_4: 5,
  KEY_5: 6, KEY_6: 7, KEY_7: 8, KEY_8: 9, KEY_9: 10,
  // Row punctuation
  MINUS: 12, EQUAL: 13, BACKSPACE: 14, TAB: 15,
  LEFTBRACE: 26, RIGHTBRACE: 27, BACKSLASH: 43, GRAVE: 41,
  SEMICOLON: 39, APOSTROPHE: 40, COMMA: 51, DOT: 52, SLASH: 53,
  SPACE: 57,
  // Letters
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36,
  K: 37, L: 38, M: 50, N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20,
  U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
  // Enter
  ENTER: 28,
  // Modifiers
  LEFTCTRL: 29, RIGHTCTRL: 97, LEFTALT: 56, RIGHTALT: 100,
  LEFTSHIFT: 42, RIGHTSHIFT: 54, LEFTMETA: 125, RIGHTMETA: 126,
  COMPOSE: 127, CAPSLOCK: 58, SCROLLLOCK: 70, NUMLOCK: 69,
  // Function keys
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66,
  F9: 67, F10: 68, F11: 87, F12: 88, F13: 183, F14: 184, F15: 185,
  F16: 186, F17: 187, F18: 188, F19: 189, F20: 190, F21: 191, F22: 192,
  F23: 193, F24: 194,
  // Numpad
  KP0: 82, KP1: 79, KP2: 80, KP3: 81, KP4: 75, KP5: 76, KP6: 77, KP7: 71,
  KP8: 72, KP9: 73, KPENTER: 96, KPSLASH: 98, KPASTERISK: 55, KPMINUS: 74,
  KPPLUS: 78, KPDOT: 83, KPCOMMA: 121, KPEQUAL: 117,
  // Print / nav / editing
  SYSRQ: 99, PRINT: 99, HOME: 102, END: 107, UP: 103, DOWN: 108,
  LEFT: 105, RIGHT: 106, PAGEUP: 104, PAGEDOWN: 109, INSERT: 110,
  DELETE: 111, PAUSE: 119,
  // Media / playback
  MUTE: 113, VOLUMEDOWN: 114, VOLUMEUP: 115, POWER: 116,
  PLAYPAUSE: 164, NEXTSONG: 163, PREVIOUSSONG: 165, STOPCD: 166,
  PLAY: 207, STOP: 128, RECORD: 167, REWIND: 168, FASTFORWARD: 208,
  PLAYCD: 200, PAUSECD: 201, CLOSECD: 160, EJECTCD: 161, EJECTCLOSECD: 162,
  BASSBOOST: 209,
  // System / display / keyboard light
  BRIGHTNESSDOWN: 224, BRIGHTNESSUP: 225, SWITCHVIDEOMODE: 227,
  MEDIA: 226, KBDILLUMTOGGLE: 228, KBDILLUMDOWN: 229, KBDILLUMUP: 230,
  MICMUTE: 248, SLEEP: 142, WAKEUP: 143, SUSPEND: 205,
  // Apps / internet
  WWW: 150, HOMEPAGE: 172, MAIL: 155, BOOKMARKS: 156, CALC: 140,
  COMPUTER: 157, BACK: 158, FORWARD: 159, REFRESH: 173, SEARCH: 217,
  PHONE: 169, CHAT: 216, CONNECT: 218, ALL_APPLICATIONS: 204,
  CYCLEWINDOWS: 154, FILE: 144, DOCUMENTS: 235,
  // Editing
  CUT: 137, COPY: 133, PASTE: 135, UNDO: 131, REDO: 182, FIND: 136,
  OPEN: 134, NEW: 181, CLOSE: 206, HELP: 138, MENU: 139, AGAIN: 129,
  PROPS: 130, FRONT: 132,
  // Misc / devices
  CAMERA: 212, SOUND: 213, BATTERY: 236, BLUETOOTH: 237, WLAN: 238,
  RFKILL: 247, WWAN: 246, EMAIL: 215, SEND: 231, REPLY: 232, SAVE: 234,
  SCROLLUP: 177, SCROLLDOWN: 178, YEN: 124, MACRO: 112, MOVE: 175, EDIT: 176,
  EXIT: 174, ROTATE_DISPLAY: 153,
  // Back-compat aliases
  KEY_B: 48, KEY_COMMA: 51, KEY_F: 33, KEY_H: 35, KEY_P: 25, KEY_R: 19,
  KEY_S: 31, KEY_T: 20, KEY_W: 17, KEY_Z: 44,
} as const;

// Touch Bar raw axis ranges
const TOUCH_MAX_X = 32767;
const TOUCH_MAX_Y = 127;

// Fallback logical display size (after rotation) for the T2 Touch Bar, used
// only when the caller doesn't supply the real DRM display dimensions. The
// renderer passes display.width/height so touch tracks the auto-detected mode.
export const DEFAULT_DISPLAY_W = 2008;
export const DEFAULT_DISPLAY_H = 60;

function resolveTouchDevicePath(devicePath?: string): string {
  if (devicePath) return devicePath;

  const envPath = process.env.REACT_DRM_TOUCH_DEVICE_PATH ?? process.env.TOUCH_DEVICE_PATH;
  if (envPath) return envPath;

  try {
    const inputDevices = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    const blocks = inputDevices.trim().split(/\n\n+/);

    // Known Touch Bar input names across MacBook models:
    //   "Apple Inc. Touch Bar Display Touchpad"  — T2 MacBook Pro 2018-2021
    //   "MacBookPro17,1 Touch Bar"               — M1 MacBook Pro 13" 2020
    //   "Mac14,7 Touch Bar"                      — M2 MacBook Pro 13" 2022
    // All contain "Touch Bar", so one pattern covers all models.
    for (const block of blocks) {
      if (!/Touch Bar/i.test(block)) continue;
      const match = block.match(/Handlers=.*\b(event\d+)\b/);
      if (match) return `/dev/input/${match[1]}`;
    }
  } catch (e) {
    throw new Error(`react-drm: failed to read /proc/bus/input/devices: ${e}`);
  }

  throw new Error(
    'react-drm: Touch Bar touchpad not found in /proc/bus/input/devices.\n' +
    'Is appletbdrm loaded? Try: lsmod | grep apple'
  );
}

/**
 * The auto-detected Touch Bar device path, or null if not found. Uses the same
 * resolver TouchReader does, exposed so callers (e.g. the pointer activity
 * watcher) can exclude the Touch Bar from their own device lists without
 * re-implementing the detection or guessing by udev tag.
 */
export function getTouchDevicePath(): string | null {
  try { return resolveTouchDevicePath(); } catch { return null; }
}

export interface TouchReaderOptions {
  /** Override the input device path. Defaults to auto-detect. */
  devicePath?: string;
  /**
   * Logical display size (post-rotation) used to scale raw touch axes into
   * pixel coordinates. Defaults to the T2 Touch Bar's 2008×60 when omitted.
   * Pass the DrmDisplay's width/height so touch tracks the detected mode.
   */
  width?: number;
  height?: number;
}

export interface GestureOptions {
  onTouchStart?: (x: number, y: number) => void;
  onTouchMove?:  (x: number, y: number) => void;
  onTouchEnd?:   (x: number, y: number) => void;
  /** Fired when the finger slides left a distance >= swipeThreshold. */
  onSwipeLeft?:  (startX: number, endX: number, y: number) => void;
  /** Fired when the finger slides right a distance >= swipeThreshold. */
  onSwipeRight?: (startX: number, endX: number, y: number) => void;
  /** Minimum horizontal pixel travel to count as a swipe. Default: 80. */
  swipeThreshold?: number;
}

export class TouchReader {
  private handle: NativeTouchReader;
  private readonly explicitPath?: string;
  private readonly displayW: number;
  private readonly displayH: number;
  private stopped = false;

  // Accepts either a device-path string (legacy form) or an options object
  // carrying the real display dimensions.
  constructor(opts?: string | TouchReaderOptions) {
    const o: TouchReaderOptions = typeof opts === 'string' ? { devicePath: opts } : (opts ?? {});
    this.explicitPath = o.devicePath;
    this.displayW = o.width ?? DEFAULT_DISPLAY_W;
    this.displayH = o.height ?? DEFAULT_DISPLAY_H;
    this.handle = this.openHandle();
  }

  private openHandle(): NativeTouchReader {
    const native = loadNative();
    return new native.TouchReader(resolveTouchDevicePath(this.explicitPath));
  }

  // Wraps the native handle.start() — on disconnect (type=-1) reopens and restarts.
  private startHandle(callback: (type: number, rawX: number, rawY: number) => void): void {
    this.handle.start((type, rawX, rawY) => {
      if (type === -1) {
        this.scheduleReconnect(callback);
        return;
      }
      // This runs inside the native ThreadSafeFunction callback — an uncaught
      // throw from any touch/tap/swipe/app handler would propagate to native as
      // a fatal uncaught exception and abort the whole process. Contain + log.
      try {
        callback(type, rawX, rawY);
      } catch (e) {
        log.error('handler threw:', e);
      }
    });
  }

  private scheduleReconnect(callback: (type: number, rawX: number, rawY: number) => void): void {
    if (this.stopped) return;
    setTimeout(() => {
      if (this.stopped) return;
      try {
        this.handle = this.openHandle();
        this.startHandle(callback);
      } catch (_) {
        this.scheduleReconnect(callback); // device not back yet — try again in 1 s
      }
    }, 1000);
  }

  /**
   * Backward-compatible tap handler — fires only on touch-down.
   * Callback receives touch position in logical display coordinates (0..W-1, 0..H-1).
   */
  start(onTap: (x: number, y: number) => void): void {
    this.startHandle((type: number, rawX: number, rawY: number) => {
      if (type !== 0) return; // only fire on start (tap)
      const x = Math.round(rawX * (this.displayW - 1) / TOUCH_MAX_X);
      const y = Math.round(rawY * (this.displayH - 1) / TOUCH_MAX_Y);
      onTap(x, y);
    });
  }

  /**
   * Extended gesture handler — provides start, move, end events and
   * automatically detects left/right swipes.
   */
  startWithGestures(opts: GestureOptions): void {
    const threshold = opts.swipeThreshold ?? 80;
    let startX = 0, startY = 0;

    this.startHandle((type: number, rawX: number, rawY: number) => {
      const x = Math.round(rawX * (this.displayW - 1) / TOUCH_MAX_X);
      const y = Math.round(rawY * (this.displayH - 1) / TOUCH_MAX_Y);

      if (type === 0) {        // start
        startX = x; startY = y;
        opts.onTouchStart?.(x, y);
      } else if (type === 1) { // move
        opts.onTouchMove?.(x, y);
      } else if (type === 2) { // end
        opts.onTouchEnd?.(x, y);
        const dx = x - startX;
        if (Math.abs(dx) >= threshold) {
          if (dx < 0) opts.onSwipeLeft?.(startX, x, y);
          else        opts.onSwipeRight?.(startX, x, y);
        }
      }
    });
  }

  stop(): void {
    this.stopped = true;
    this.handle.stop();
  }
}

export class KeyInjector {
  private handle: NativeKeyInjector;

  constructor() {
    const native = loadNative();
    this.handle = new native.KeyInjector();
  }

  pressF(n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12): void {
    this.handle.pressKey(FKEY_CODES[n - 1]);
  }

  pressIndex(idx: number): void {
    this.handle.pressKey(FKEY_CODES[idx]);
  }

  keyDown(code: number): void {
    this.handle.keyDown(code);
  }

  keyUp(code: number): void {
    this.handle.keyUp(code);
  }

  pressKey(code: number): void {
    this.handle.pressKey(code);
  }

  pressCombo(keycodes: number[]): void {
    this.handle.pressCombo(keycodes);
  }
}
