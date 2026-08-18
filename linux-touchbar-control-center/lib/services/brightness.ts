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

export function readBrightness(device: string | null): number {
  if (!device) return 0.5;
  try {
    const cur = parseInt(execFileSync('brightnessctl', ['--device', device, 'get'], { encoding: 'utf8' }).trim());
    const max = parseInt(execFileSync('brightnessctl', ['--device', device, 'max'], { encoding: 'utf8' }).trim());
    return max > 0 ? Math.min(1, cur / max) : 0.5;
  } catch { return 0.5; }
}

export function applyBrightness(device: string | null, pct: number, minimumPct: number): void {
  if (!device) return;
  const value = Math.max(minimumPct, Math.round(pct * 100));
  execFile('brightnessctl', ['--device', device, 'set', `${value}%`], () => {});
}
