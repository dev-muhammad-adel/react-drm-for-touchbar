import React, { useState, useLayoutEffect, useRef, useContext } from 'react';
import { Box } from './Box';
import { TouchRegistryContext } from '../input/touch-registry';
import { LayoutContext } from '../scene/layout-context';
import type { Style } from '../scene/style';
import type { BoxNode } from '../scene/types';

export interface ScrollRowProps {
  /** Total pixel width of the scrollable content row. */
  contentWidth: number;
  style?: Style;
  children?: React.ReactNode;
}

/**
 * Horizontally scrollable container with live finger tracking and momentum.
 * Works like React Native's horizontal ScrollView.
 * The outer box clips at its layout width; the inner content row shifts via marginLeft.
 */
export function ScrollRow({ contentWidth, style, children }: ScrollRowProps): React.ReactElement {
  const registry  = useContext(TouchRegistryContext);
  const layoutCtx = useContext(LayoutContext);
  const id        = useRef(Symbol());
  const nodeRef   = useRef<BoxNode | null>(null);

  const [offsetX,  setOffsetX]  = useState(0);
  const offsetRef   = useRef(0);
  const startOffRef = useRef(0);
  const maxOffRef   = useRef(0);
  const animRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  offsetRef.current = offsetX;

  useLayoutEffect(() => {
    if (!registry) return;
    const key = id.current;
    const lb  = nodeRef.current ? layoutCtx.current.get(nodeRef.current) : undefined;
    maxOffRef.current = Math.max(0, contentWidth - (lb?.w ?? 0));

    registry.registerSwipe(key, {
      x: lb?.x ?? 0,
      y: lb?.y ?? 0,
      width:  lb?.w ?? 0,
      height: lb?.h ?? 0,

      onScrollStart() {
        if (animRef.current) { clearInterval(animRef.current); animRef.current = null; }
        startOffRef.current = offsetRef.current;
      },

      onScrollMove(dx: number) {
        const next = Math.max(0, Math.min(startOffRef.current - dx, maxOffRef.current));
        offsetRef.current = next;
        setOffsetX(next);
      },

      onScrollEnd(velocityX: number) {
        let vel = -velocityX; // offset moves opposite to finger
        if (Math.abs(vel) < 0.5) return;
        if (animRef.current) clearInterval(animRef.current);
        animRef.current = setInterval(() => {
          vel *= 0.92; // friction
          if (Math.abs(vel) < 0.3) {
            clearInterval(animRef.current!);
            animRef.current = null;
            return;
          }
          const next = Math.max(0, Math.min(offsetRef.current + vel, maxOffRef.current));
          offsetRef.current = next;
          setOffsetX(next);
        }, 16);
      },
    });
    return () => registry.unregisterSwipe(key);
  });

  useLayoutEffect(() => () => {
    if (animRef.current) { clearInterval(animRef.current); animRef.current = null; }
  }, []);

  return (
    <Box ref={nodeRef} color="transparent" style={{ ...style, flexDirection: 'row', overflow: 'hidden' }}>
      <Box style={{ width: contentWidth, flexDirection: 'row', marginLeft: -offsetX }}>
        {children}
      </Box>
    </Box>
  );
}
