import { useEffect, useContext, useRef } from 'react';
import { KeyboardContext, resolveKeyCode } from 'react-drm';
import type { KeyId } from 'react-drm';

export interface KeyGestureHandlers {
  /** Two quick presses within `doubleMs`. */
  onDoublePress?: () => void;
  /** Key held for at least `longMs`. */
  onLongPress?: () => void;
}

export interface KeyGestureOptions {
  doubleMs?: number; // max gap between the two presses of a double-press
  longMs?: number;   // hold duration that counts as a long-press
}

/**
 * Detect double-press and long-press gestures on a single physical key, read
 * from the shared KeyboardReader. Handlers are kept in a ref so they can change
 * without re-subscribing. Pass `key === undefined` to disable.
 */
export function useKeyGesture(
  key: KeyId | undefined,
  handlers: KeyGestureHandlers,
  { doubleMs = 350, longMs = 500 }: KeyGestureOptions = {},
): void {
  const reader = useContext(KeyboardContext);
  const hRef = useRef(handlers);
  hRef.current = handlers;

  useEffect(() => {
    if (!reader || key === undefined) return;
    const code = resolveKeyCode(key);

    let lastUpAt = 0;
    let longTimer: ReturnType<typeof setTimeout> | null = null;
    let longFired = false;
    const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } };

    const off = reader.onKey((c, v) => {
      if (c !== code) return;
      if (v === 1) {                       // key down
        longFired = false;
        clearLong();
        longTimer = setTimeout(() => { longFired = true; hRef.current.onLongPress?.(); }, longMs);
      } else if (v === 0) {                // key up
        clearLong();
        if (longFired) { lastUpAt = 0; return; } // already handled as a long-press
        const now = Date.now();
        if (now - lastUpAt <= doubleMs) { lastUpAt = 0; hRef.current.onDoublePress?.(); }
        else { lastUpAt = now; }
      }
      // v === 2 (auto-repeat) ignored
    });

    return () => { clearLong(); off(); };
  }, [reader, key === undefined ? '' : (typeof key === 'number' ? key : key.toString().toLowerCase()), doubleMs, longMs]);
}
