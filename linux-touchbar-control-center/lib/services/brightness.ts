import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import { DISPLAY_BACKLIGHT_NAMES } from 'react-drm';

// Device names vary by hardware: the panel backlight is gmux_backlight on
// dual-GPU Macs but intel_backlight on single-GPU ones (e.g. 2020 13" Intel),
// and the keyboard LED is exposed as ':white:kbd_backlight'. Auto-detect instead
// of hardcoding so the sliders work across machines and don't spam "Device not
// found" from the poll loop. Display candidate list mirrors tiny-dfr's
// find_display_backlight().
function findDevice(base: string, match: (name: string) => boolean): string | null {
  try { return fs.readdirSync(base).find(match) ?? null; } catch { return null; }
}

export const DISPLAY_DEVICE  = findDevice('/sys/class/backlight', n => DISPLAY_BACKLIGHT_NAMES.some(c => n.includes(c)));
export const KEYBOARD_DEVICE = findDevice('/sys/class/leds', n => n.includes('kbd_backlight'));

// Direct sysfs fast path: /sys/class/backlight or /sys/class/leds, whichever
// exposes the device. Reading/writing sysfs is synchronous and ordered — no
// subprocess spawn latency, no process reordering. The udev rules grant group
// write for the panel backlight (gmux_backlight); when a device is not
// writable we fall back to brightnessctl below.
function sysfsPaths(device: string): { value: string; max: string } | null {
  for (const base of ['/sys/class/backlight', '/sys/class/leds']) {
    const value = `${base}/${device}/brightness`;
    const max = `${base}/${device}/max_brightness`;
    try {
      if (fs.existsSync(value) && fs.existsSync(max)) return { value, max };
    } catch { /* fall through to the other base */ }
  }
  return null;
}

export function readBrightness(device: string | null): number {
  if (!device) return 0.5;
  const p = sysfsPaths(device);
  if (p) {
    try {
      const cur = parseInt(fs.readFileSync(p.value, 'utf8'), 10);
      const max = parseInt(fs.readFileSync(p.max, 'utf8'), 10);
      if (max > 0) return Math.min(1, cur / max);
    } catch { /* fall back to brightnessctl below */ }
  }
  try {
    const cur = parseInt(execFileSync('brightnessctl', ['--device', device, 'get'], { encoding: 'utf8' }).trim());
    const max = parseInt(execFileSync('brightnessctl', ['--device', device, 'max'], { encoding: 'utf8' }).trim());
    return max > 0 ? Math.min(1, cur / max) : 0.5;
  } catch { return 0.5; }
}

// Latest-write-wins coalescing as a testable primitive: at most ONE write in
// flight; later calls replace the pending target instead of starting another
// write. A process-per-move storm reorders writes (the 500 ms poll then reads
// a stale value and snaps the slider back) — this is the fix for the
// "slider jumps back" behaviour. Tests: tests/brightness.test.ts.
export function createLatestWinsSetter(write: (value: number, done: () => void) => void): (value: number) => void {
  let pending: number | null = null;
  let inflight = false;
  return (value: number): void => {
    pending = value;
    if (inflight) return; // the in-flight write picks up `pending` when done
    const flush = (): void => {
      const next = pending;
      if (next === null) { inflight = false; return; }
      pending = null;
      inflight = true;
      write(next, () => {
        // Calls that arrived while this write ran updated `pending` — flush
        // them now, so the final value always matches the last move.
        if (pending !== null) flush();
        else inflight = false;
      });
    };
    flush();
  };
}

const setters = new Map<string, ReturnType<typeof createLatestWinsSetter>>();
const lastWriteAt = new Map<string, number>();

/** Timestamp of the last write to a device — the poll in the slider layer
 * dead-bands against it so a just-written value is not read back stale. */
export function getLastWriteAt(device: string | null): number {
  return device ? (lastWriteAt.get(device) ?? 0) : 0;
}

/** True while a write is still settling — the poll skips readback adoption. */
export function isWriteSettling(lastWriteAtMs: number, nowMs: number, windowMs = 1000): boolean {
  return nowMs - lastWriteAtMs <= windowMs;
}

export function applyBrightness(device: string | null, pct: number, minimumPct: number): void {
  if (!device) return;
  // Direct sysfs write when permitted: synchronous and ordered, no process —
  // the coalescing setter below only serves the brightnessctl fallback.
  const p = sysfsPaths(device);
  if (p) {
    lastWriteAt.set(device, Date.now());
    try {
      const max = parseInt(fs.readFileSync(p.max, 'utf8'), 10);
      if (max > 0) {
        const raw = Math.round(Math.max(minimumPct, Math.round(pct * 100)) * max / 100);
        fs.writeFileSync(p.value, String(raw));
        return;
      }
    } catch { /* not writable directly — brightnessctl fallback below */ }
  }
  lastWriteAt.set(device, Date.now());
  let setter = setters.get(device);
  if (!setter) {
    setter = createLatestWinsSetter((value, done) => {
      execFile('brightnessctl', ['--device', device, 'set', `${value}%`], () => done());
    });
    setters.set(device, setter);
  }
  setter(Math.max(minimumPct, Math.round(pct * 100)));
}
