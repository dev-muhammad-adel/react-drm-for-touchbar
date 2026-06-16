// Repaint hook for out-of-band scene mutations — used by the react-spring
// adapter (src/spring.ts), which writes animated values straight into scene
// nodes each frame instead of going through a React commit.

let repaint: ((needsLayout?: boolean) => void) | null = null;
let scheduled = false;
let scheduledNeedsLayout = false;

export function setRepaint(fn: ((needsLayout?: boolean) => void) | null): void {
  repaint = fn;
}

/** Request a repaint after mutating scene nodes directly. Batched per tick. */
export function invalidate(needsLayout = false): void {
  if (!repaint) return;
  scheduledNeedsLayout = scheduledNeedsLayout || needsLayout;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const nl = scheduledNeedsLayout;
    scheduledNeedsLayout = false;
    repaint?.(nl);
  });
}
