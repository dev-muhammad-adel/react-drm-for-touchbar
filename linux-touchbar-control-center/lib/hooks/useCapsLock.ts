import { useEffect, useState } from 'react';
import { readFileSync, readdirSync } from 'fs';

// Caps Lock has no D-Bus/compositor-level API worth relying on — the kernel's
// own LED sysfs interface is the most portable source (works the same under
// niri/Wayland/console, no X11/XKB dependency). Directory name varies by
// keyboard (e.g. "input1::capslock"), so scan for it rather than hardcode.

let ledPath: string | null | undefined;

function findLed(): string | null {
  if (ledPath !== undefined) return ledPath;
  try {
    const dir = readdirSync('/sys/class/leds').find(d => d.endsWith('::capslock'));
    ledPath = dir ? `/sys/class/leds/${dir}/brightness` : null;
  } catch {
    ledPath = null;
  }
  return ledPath;
}

function readCapsLock(): boolean {
  const path = findLed();
  if (!path) return false;
  try { return readFileSync(path, 'utf8').trim() !== '0'; }
  catch { return false; }
}

const POLL_MS = 500;

/** Whether Caps Lock is currently on. Always false if the LED can't be found. */
export function useCapsLock(): boolean {
  const [on, setOn] = useState(() => readCapsLock());

  useEffect(() => {
    const id = setInterval(() => setOn(readCapsLock()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return on;
}
