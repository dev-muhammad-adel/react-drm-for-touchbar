import { useAtom } from 'jotai';
import { displayBrightnessAtom } from '@/store/brightness';
import { applyBrightness, readBrightness, DISPLAY_DEVICE } from '@/lib/services/brightness';

export { readBrightness, DISPLAY_DEVICE, KEYBOARD_DEVICE } from '@/lib/services/brightness';

/** Finger-px of horizontal travel that swings brightness across its full 0–1 range. */
export const TRACK_W = 700;

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
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
