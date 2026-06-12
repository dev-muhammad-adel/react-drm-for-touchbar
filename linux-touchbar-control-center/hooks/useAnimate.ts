import { useState, useEffect, useRef } from 'react';

type Easing = (t: number) => number;

export const ease = {
  linear:   (t: number) => t,
  in:       (t: number) => t * t,
  out:      (t: number) => t * (2 - t),
  inOut:    (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
};

/**
 * Smoothly animates a number from its current value to `target` over `duration` ms.
 *
 * const opacity = useAnimate(isVisible ? 1 : 0, 300, ease.out);
 */
export function useAnimate(target: number, duration: number, easing: Easing = ease.out): number {
  const [value, setValue] = useState(target);
  const from     = useRef(target);
  const startRef = useRef<number | null>(null);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;
    from.current  = value;
    startRef.current = null;

    const id = setInterval(() => {
      if (startRef.current === null) startRef.current = Date.now();
      const t = Math.min(1, (Date.now() - startRef.current) / duration);
      setValue(from.current + (target - from.current) * easing(t));
      if (t >= 1) clearInterval(id);
    }, 16);

    return () => clearInterval(id);
  }, [target, duration]);

  return value;
}
