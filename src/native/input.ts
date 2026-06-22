import fs from 'fs';
import { loadAddon } from './load-addon';

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
  pressKey(keycode: number): void;
  pressCombo(keycodes: number[]): void;
}

// F1=59 … F12=88
export const FKEY_CODES = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88] as const;

export const KEY = {
  MUTE:          113,
  VOLUMEDOWN:    114,
  VOLUMEUP:      115,
  NEXTSONG:      163,
  PLAYPAUSE:     164,
  PREVIOUSSONG:  165,
  LEFTMETA:      125,
  SEARCH:        217,
  BRIGHTNESSDOWN:224,
  BRIGHTNESSUP:  225,
  KBDILLUMDOWN:  229,
  KBDILLUMUP:    230,
  MICMUTE:       248,
  // Modifiers
  LEFTCTRL:       29,
  LEFTALT:        56,
  LEFTSHIFT:      42,
  // Navigation
  TAB:            15,
  LEFT:          105,
  RIGHT:         106,
  UP:            103,
  DOWN:          108,
  HOME:          102,
  ENTER:          28,
  ESC:             1,
  BACKSPACE:      14,
  // Letters used in browser combos
  KEY_R:          19,
  KEY_T:          20,
  KEY_W:          17,
} as const;

// Touch Bar raw axis ranges
const TOUCH_MAX_X = 32767;
const TOUCH_MAX_Y = 127;

// Fallback logical display size (after rotation) for the T2 Touch Bar, used
// only when the caller doesn't supply the real DRM display dimensions. The
// renderer passes display.width/height so touch tracks the auto-detected mode.
const DEFAULT_DISPLAY_W = 2008;
const DEFAULT_DISPLAY_H = 60;

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
        console.error('[react-drm] touch handler threw:', e);
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

  pressKey(code: number): void {
    this.handle.pressKey(code);
  }

  pressCombo(keycodes: number[]): void {
    this.handle.pressCombo(keycodes);
  }
}
