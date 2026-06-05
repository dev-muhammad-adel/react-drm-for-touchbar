import { useLayoutEffect, useRef, useContext } from 'react';
import { TouchRegistryContext } from './touch-registry';
import type { GestureRegion } from './touch-registry';

/**
 * Registers a rectangular gesture region with the renderer's TouchRegistry.
 * Fires onTouchStart / onTouchMove / onTouchEnd / onClick when the region
 * is touched — no TouchReader setup required.
 *
 * Callbacks are read from a ref so you can pass inline functions without
 * causing the region to re-register on every render.
 * The region re-registers only when x / y / width / height change.
 *
 * Usage:
 *   useGestureRegion({
 *     x: 0, y: 0, width, height,
 *     onTouchStart: (x, y) => press(x, y),
 *     onTouchMove:  (x, y) => slide(x, y),
 *     onTouchEnd:   ()     => release(),
 *   });
 */
export function useGestureRegion(opts: GestureRegion): void {
  const registry = useContext(TouchRegistryContext);
  const id       = useRef(Symbol());
  const optsRef  = useRef(opts);
  optsRef.current = opts;

  const { x, y, width, height } = opts;

  useLayoutEffect(() => {
    if (!registry) return;
    const key = id.current;
    registry.registerGesture(key, {
      x, y, width, height,
      onClick:      ()       => optsRef.current.onClick?.(),
      onTouchStart: (tx, ty) => optsRef.current.onTouchStart?.(tx, ty),
      onTouchMove:  (tx, ty) => optsRef.current.onTouchMove?.(tx, ty),
      onTouchEnd:   (tx, ty) => optsRef.current.onTouchEnd?.(tx, ty),
    });
    return () => registry.unregisterGesture(key);
  // Re-register only when the hit area changes, not when callbacks change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, x, y, width, height]);
}
