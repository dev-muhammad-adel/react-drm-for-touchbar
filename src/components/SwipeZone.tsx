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

  onSwipeLeft?: (dx: number) => void;
  onSwipeRight?: (dx: number) => void;

  onScrollStart?: () => void;
  onScrollMove?: (dx: number) => void;
  onScrollEnd?: (velocity: number) => void;

  threshold?: number;
  color?: string;
  style?: Style;
  children?: React.ReactNode;
}

export function SwipeZone({
  width = 0,
  height = 0,
  onSwipeLeft,
  onSwipeRight,
  onScrollStart,
  onScrollMove,
  onScrollEnd,
  threshold = 80,
  color = 'transparent',
  style,
  children,
}: SwipeZoneProps) {
  const registry = useContext(TouchRegistryContext);
  const layoutCtx = useContext(LayoutContext);

  const id = useRef(Symbol());
  const nodeRef = useRef<BoxNode | null>(null);

  // register ONLY when dependencies change
  useLayoutEffect(() => {
    if (!registry) return;

    const key = id.current;
    const node = nodeRef.current;

    const lb = node ? layoutCtx.current.get(node) : undefined;

    registry.registerSwipe(key, {
      x: lb?.x ?? 0,
      y: lb?.y ?? 0,
      width: lb?.w ?? width,
      height: lb?.h ?? height,

      onSwipeLeft,
      onSwipeRight,
      onScrollStart,
      onScrollMove,
      onScrollEnd,
      threshold,
    });

    return () => registry.unregisterSwipe(key);
  }, [
    registry,
    layoutCtx,
    width,
    height,
    threshold,
    onSwipeLeft,
    onSwipeRight,
    onScrollMove,
    onScrollStart,
    onScrollEnd,
  ]);

  return (
    <Box ref={nodeRef} color={color} style={style}>
      {children}
    </Box>
  );
}