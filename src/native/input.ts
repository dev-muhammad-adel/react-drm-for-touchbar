import fs from 'fs';
import path from 'path';

function loadNative(): {
  TouchReader: new (devicePath: string) => NativeTouchReader;
  KeyInjector: new () => NativeKeyInjector;
} {
  const candidates = [
    path.join(__dirname, '../../build/Release/drm_backend.node'),
    path.join(__dirname, '../../build/Debug/drm_backend.node'),
  ];
  for (const p of candidates) {
    try { return require(p); } catch (_) { /* try next */ }
  }
  throw new Error('react-drm: native addon not found — run npm run build:native');
}

interface NativeTouchReader {
  // Callback receives (type, rawX, rawY): type 0=start 1=move 2=end
  start(callback: (type: number, x: number, y: number) => void): void;
  stop(): void;
}

interface NativeKeyInjector {
  pressKey(keycode: number): void;
}

// F1=59 … F9=67
export const FKEY_CODES = [59, 60, 61, 62, 63, 64, 65, 66, 67] as const;

// Touch Bar raw axis ranges
const TOUCH_MAX_X = 32767;
const TOUCH_MAX_Y = 127;

// Logical display size (after rotation)
const DISPLAY_W = 2008;
const DISPLAY_H = 60;

function resolveTouchDevicePath(devicePath?: string): string {
  if (devicePath) return devicePath;

  const envPath = process.env.REACT_DRM_TOUCH_DEVICE_PATH ?? process.env.TOUCH_DEVICE_PATH;
  if (envPath) return envPath;

  try {
    const inputDevices = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    const blocks = inputDevices.trim().split(/\n\n+/);

    for (const block of blocks) {
      if (!/Touch Bar Display Touchpad|Touch Bar/i.test(block)) continue;
      const match = block.match(/Handlers=.*\b(event\d+)\b/);
      if (match) return `/dev/input/${match[1]}`;
    }
  } catch (_) {
    // Fall back below.
  }

  return '/dev/input/event9';
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

  constructor(devicePath?: string) {
    const native = loadNative();
    this.handle = new native.TouchReader(resolveTouchDevicePath(devicePath));
  }

  /**
   * Backward-compatible tap handler — fires only on touch-down.
   * Callback receives touch position in logical display coordinates (0..W-1, 0..H-1).
   */
  start(onTap: (x: number, y: number) => void): void {
    this.handle.start((type: number, rawX: number, rawY: number) => {
      if (type !== 0) return; // only fire on start (tap)
      const x = Math.round(rawX * (DISPLAY_W - 1) / TOUCH_MAX_X);
      const y = Math.round(rawY * (DISPLAY_H - 1) / TOUCH_MAX_Y);
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

    this.handle.start((type: number, rawX: number, rawY: number) => {
      const x = Math.round(rawX * (DISPLAY_W - 1) / TOUCH_MAX_X);
      const y = Math.round(rawY * (DISPLAY_H - 1) / TOUCH_MAX_Y);

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
    this.handle.stop();
  }
}

export class KeyInjector {
  private handle: NativeKeyInjector;

  constructor() {
    const native = loadNative();
    this.handle = new native.KeyInjector();
  }

  pressF(n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): void {
    this.handle.pressKey(FKEY_CODES[n - 1]);
  }

  pressIndex(idx: number): void {
    this.handle.pressKey(FKEY_CODES[idx]);
  }
}
