import React, { useState, useLayoutEffect, useRef, useContext } from 'react';
import type { Style } from '../scene/style';
import type { BoxNode } from '../scene/types';
import { TouchRegistryContext } from '../input/touch-registry';
import { LayoutContext } from '../scene/layout-context';
import { ScrollOffsetContext } from '../scene/scroll-context';

export interface BoxProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  style?: Style;
  children?: React.ReactNode;
}

// Handles overflow: 'scroll' — manages scrollX state and live touch tracking.
const ScrollBox = React.forwardRef<BoxNode, BoxProps>(function ScrollBox(props, ref) {
  const registry        = useContext(TouchRegistryContext);
  const layoutCtx       = useContext(LayoutContext);
  const parentScrollOff = useContext(ScrollOffsetContext);
  const id        = useRef(Symbol());
  const nodeRef   = useRef<BoxNode | null>(null);

  const [scrollX,  setScrollX]  = useState(0);
  const scrollRef   = useRef(0);
  const startOffRef = useRef(0);
  const maxOffRef   = useRef(0);
  const animRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  scrollRef.current = scrollX;

  useLayoutEffect(() => {
    if (!registry) return;
    const key  = id.current;
    const node = nodeRef.current;
    const lb   = node ? layoutCtx.current.get(node) : undefined;

    // Compute maxScrollX from how far children overflow the container
    if (node && lb) {
      let maxChildX = lb.x + lb.w;
      for (const child of node.children) {
        const clb = layoutCtx.current.get(child as BoxNode);
        if (clb) maxChildX = Math.max(maxChildX, clb.x + clb.w);
      }
      maxOffRef.current = Math.max(0, maxChildX - (lb.x + lb.w));
    }

    registry.registerSwipe(key, {
      x: (lb?.x ?? 0) - parentScrollOff,
      y: lb?.y ?? 0,
      width:  lb?.w ?? 0,
      height: lb?.h ?? 0,

      onScrollStart() {
        if (animRef.current) { clearInterval(animRef.current); animRef.current = null; }
        startOffRef.current = scrollRef.current;
      },

      onScrollMove(dx: number) {
        const next = Math.max(0, Math.min(startOffRef.current - dx, maxOffRef.current));
        scrollRef.current = next;
        setScrollX(next);
      },

      onScrollEnd(velocityX: number) {
        let vel = -velocityX;
        if (Math.abs(vel) < 0.5) return;
        if (animRef.current) clearInterval(animRef.current);
        animRef.current = setInterval(() => {
          vel *= 0.92;
          if (Math.abs(vel) < 0.3) {
            clearInterval(animRef.current!);
            animRef.current = null;
            return;
          }
          const next = Math.max(0, Math.min(scrollRef.current + vel, maxOffRef.current));
          scrollRef.current = next;
          setScrollX(next);
        }, 16);
      },
    });
    return () => registry.unregisterSwipe(key);
  });

  useLayoutEffect(() => () => {
    if (animRef.current) { clearInterval(animRef.current); animRef.current = null; }
  }, []);

  const setRef = (node: BoxNode | null) => {
    nodeRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<BoxNode | null>).current = node;
  };

  return (
    <ScrollOffsetContext.Provider value={parentScrollOff + scrollX}>
      {React.createElement('box' as string, { ...props, scrollX, ref: setRef })}
    </ScrollOffsetContext.Provider>
  );
});

export const Box = React.forwardRef<BoxNode, BoxProps>(function Box(props, ref) {
  if (props.style?.overflow === 'scroll') {
    return React.createElement(ScrollBox, { ...props, ref } as BoxProps & { ref: typeof ref });
  }
  return React.createElement('box' as string, { ...props, ref });
});
