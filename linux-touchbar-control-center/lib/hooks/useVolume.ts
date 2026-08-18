import { useRef } from 'react';
import { useAtom } from 'jotai';
import { volumeAtom } from '@/store/volume';
import { applyVolume } from '@/lib/services/volume';

export { readVolume } from '@/lib/services/volume';

/** Finger-px of horizontal travel that swings volume across its full 0–1 range. */
export const TRACK_W = 700;

export function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Live volume plus a debounced writer to the audio backend. Shared via
 * `volumeAtom` so the audio slider layer and the splitted layer's volume
 * button (long-press-and-drag) stay in sync regardless of which one is
 * driving the change.
 */
export function useVolumeControl() {
  const [vol, setVol] = useAtom(volumeAtom);
  const busyRef = useRef(false);
  const queuedRef = useRef<number | null>(null);

  function flush() {
    if (busyRef.current || queuedRef.current === null) return;
    const value = queuedRef.current;
    queuedRef.current = null;
    busyRef.current = true;
    applyVolume(value, () => {
      busyRef.current = false;
      flush();
    });
  }

  function setVolume(v: number) {
    const clamped = clampVolume(v);
    setVol(clamped);
    queuedRef.current = clamped;
    flush();
  }

  // Reflects a value already applied externally (keyboard shortcut, another
  // app) — updates local/shared state only, no write-back to the backend.
  function syncVolume(v: number) {
    setVol(clampVolume(v));
  }

  return { vol, setVolume, syncVolume };
}
