import { useState, useEffect, useContext } from 'react';
import { KeyboardContext } from './keyboard-context';
import { resolveKeyCode } from '../native/keyboard';
import type { KeyboardReader, KeyId } from '../native/keyboard';

/**
 * Returns true while the given key is held down.
 *
 * key — keycode number, numeric string, or name ('fn', 'ctrl', 'F1', …).
 * reader — optional explicit KeyboardReader; falls back to KeyboardContext.
 */
export function useKeyPressed(key: KeyId, reader?: KeyboardReader): boolean {
  const ctxReader = useContext(KeyboardContext);
  const src = reader ?? ctxReader;
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!src) return;
    const code = resolveKeyCode(key);
    return src.onKey((c, v) => {
      if (c === code) setPressed(v !== 0); // 0=released, 1=down, 2=repeat
    });
  }, [src, typeof key === 'number' ? key : key.toString().toLowerCase()]);

  return pressed;
}
