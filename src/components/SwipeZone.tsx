import React, { useLayoutEffect, useRef, useContext } from 'react';
import { Box } from './Box';
import { TouchRegistryContext } from '../input/touch-registry';
import { LayoutContext } from '../scene/layout-context';
import type { Style } from '../scene/style';
import type { BoxNode } from '../scene/types';

export interface SwipeZoneProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Called when user swipes left. `dx` is the horizontal travel in pixels. */
  onSwipeLeft?:  (dx: number) => void;
  /** Called when user swipes right. `dx` is the horizontal travel in pixels. */
  onSwipeRight?: (dx: number) => void;
  /** Minimum horizontal pixel travel to count as a swipe. Default: 80. */
  threshold?: number;
  color?: string;
  style?: Style;
  children?: React.ReactNode;
}

/**
 * A hit zone that fires onSwipeLeft / onSwipeRight.
 * Works correctly inside flex/grid containers.
 *
 * Wire up the renderer touch events from your TouchReader:
 *   const rendered = render(<App />, display);
 *   reader.startWithGestures({
 *     onTouchStart: rendered.touchStart,
 *     onTouchMove:  rendered.touchMove,
 *     onTouchEnd:   rendered.touchEnd,
 *   });
 */
export function SwipeZone({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  onSwipeLeft,
  onSwipeRight,
  threshold,
  color = 'transparent',
  style,
  children,
}: SwipeZoneProps): React.ReactElement {
  const registry  = useContext(TouchRegistryContext);
  const layoutCtx = useContext(LayoutContext);
  const id      = useRef(Symbol());
  const nodeRef = useRef<BoxNode | null>(null);

  useLayoutEffect(() => {
    if (!registry) return;
    const key  = id.current;
    const node = nodeRef.current;

    const lb = node ? layoutCtx.current.get(node) : undefined;
    const rx = lb?.x ?? x;
    const ry = lb?.y ?? y;
    const rw = lb?.w ?? width;
    const rh = lb?.h ?? height;

    registry.registerSwipe(key, { x: rx, y: ry, width: rw, height: rh, onSwipeLeft, onSwipeRight, threshold });
    return () => registry.unregisterSwipe(key);
  });

  return (
    <Box ref={nodeRef} x={x} y={y} width={width} height={height} color={color} style={style}>
      {children}
    </Box>
  );
}
