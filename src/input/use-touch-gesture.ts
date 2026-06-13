import { useContext, useEffect, useRef } from 'react';
import { TouchReader, type GestureOptions } from '../native/input';
import { DisplaySizeContext } from '../scene/display-context';

export interface TouchGestureOptions extends GestureOptions {
  /** Override the input device path. Defaults to auto-detect. */
  devicePath?: string;
}

/**
 * React hook that opens a TouchReader and fires gesture callbacks.
 * The reader is automatically stopped when the component unmounts.
 *
 * Callbacks (onSwipeLeft, onSwipeRight, etc.) are read from a ref so
 * you can pass inline functions without causing the reader to restart.
 *
 * Usage:
 *   useTouchGesture({
 *     onSwipeLeft:  () => setPage(p => p - 1),
 *     onSwipeRight: () => setPage(p => p + 1),
 *     onTouchStart: (x, y) => console.log('touch at', x, y),
 *   });
 */
export function useTouchGesture(opts: TouchGestureOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { devicePath, swipeThreshold } = opts;
  const { width, height } = useContext(DisplaySizeContext);

  useEffect(() => {
    let reader: TouchReader | undefined;
    try {
      reader = new TouchReader({ devicePath, width, height });
      reader.startWithGestures({
        swipeThreshold,
        onTouchStart:  (x, y)       => optsRef.current.onTouchStart?.(x, y),
        onTouchMove:   (x, y)       => optsRef.current.onTouchMove?.(x, y),
        onTouchEnd:    (x, y)       => optsRef.current.onTouchEnd?.(x, y),
        onSwipeLeft:   (sx, ex, y)  => optsRef.current.onSwipeLeft?.(sx, ex, y),
        onSwipeRight:  (sx, ex, y)  => optsRef.current.onSwipeRight?.(sx, ex, y),
      });
    } catch (_) { /* no touch device — silently skip */ }
    return () => reader?.stop();
  // Only recreate the reader if the device, threshold, or display size changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devicePath, swipeThreshold, width, height]);
}
