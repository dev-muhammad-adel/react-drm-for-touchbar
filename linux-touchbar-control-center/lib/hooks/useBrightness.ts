import { useAtom } from 'jotai';
import { displayBrightnessAtom } from '@/store/brightness';
import { applyBrightness, readBrightness, DISPLAY_DEVICE } from '@/lib/services/brightness';
import { execFile, execFileSync } from 'child_process';

export { readBrightness, DISPLAY_DEVICE, KEYBOARD_DEVICE } from '@/lib/services/brightness';

/** Finger-px of horizontal travel that swings brightness across its full 0–1 range. */
export const TRACK_W = 700;

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Manual slider adjustment owns the backlight from now on — like macOS, a
// manual change turns automatic (ambient) brightness OFF. Otherwise gsd-power
// recomputes the backlight from the ambient sensor ~1 s after every drag and
// the slider snaps back (verified live: a direct sysfs write was overridden
// by the daemon two seconds later).
// idle-dim is part of the same fight: GNOME's idle dim/undim cycle stores its
// own base level and re-asserts it on the next activity transition. With both
// off, a direct write stays stable (verified live: 463 after 8 s).
let autoBrightnessHandled = false;
function disableGnomeAutoBrightness(): void {
  if (autoBrightnessHandled) return;
  autoBrightnessHandled = true;
  try {
    const cur = execFileSync('gsettings', ['get', 'org.gnome.settings-daemon.plugins.power', 'ambient-enabled'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (cur === 'true') {
      execFile('gsettings', ['set', 'org.gnome.settings-daemon.plugins.power', 'ambient-enabled', 'false'], () => {});
    }
    execFile('gsettings', ['set', 'org.gnome.settings-daemon.plugins.power', 'idle-dim', 'false'], () => {});
  } catch { /* gsettings unavailable — nothing to disable */ }
}

/**
 * Live display brightness plus a writer to the backlight device. Shared via
 * `displayBrightnessAtom` so the brightness slider layer and the splitted
 * layer's brightness button (long-press-and-drag) stay in sync regardless of
 * which one is driving the change.
 */
export function useDisplayBrightnessControl() {
  const [brightness, setAtomValue] = useAtom(displayBrightnessAtom);

  function setBrightness(v: number) {
    const clamped = clamp01(v);
    disableGnomeAutoBrightness();
    setAtomValue(clamped);
    applyBrightness(DISPLAY_DEVICE, clamped, 1);
  }

  // Reflects a value already applied externally (another app, a hardware
  // key) — updates local/shared state only, no write-back to the device.
  // Accepts an updater so callers can dead-band against the previous value
  // (e.g. a poll loop that only wants to react to a real change).
  function syncBrightness(v: number | ((prev: number) => number)) {
    setAtomValue(prev => clamp01(typeof v === 'function' ? v(prev) : v));
  }

  return { brightness, setBrightness, syncBrightness };
}
