// Repaint hook for out-of-band scene mutations — used by the react-spring
// adapter (src/spring.ts), which writes animated values straight into scene
// nodes each frame instead of going through a React commit.

let repaint: (() => void) | null = null;
let scheduled = false;

export function setRepaint(fn: (() => void) | null): void {
  repaint = fn;
}

/** Request a repaint after mutating scene nodes directly. Batched per tick. */
export function invalidate(): void {
  if (scheduled || !repaint) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    repaint?.();
  });
}
