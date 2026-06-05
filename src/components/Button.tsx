import React, {
  useState,
  useLayoutEffect,
  useRef,
  useContext,
  useCallback,
} from 'react';
import { Box } from './Box';
import { TouchRegistryContext } from '../input/touch-registry';
import { LayoutContext } from '../scene/layout-context';
import type { Style } from '../scene/style';
import type { BoxNode } from '../scene/types';

export interface ButtonProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  activeColor?: string;
  style?: Style;
  children?: React.ReactNode;
  onClick?: () => void;
}

export function Button({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  color = '#2a2a3e',
  activeColor = '#4a90d9',
  style,
  onClick,
  children,
}: ButtonProps): React.ReactElement {
  const [active, setActive] = useState(false);
  const registry  = useContext(TouchRegistryContext);
  const layoutCtx = useContext(LayoutContext);
  const id      = useRef(Symbol());
  const nodeRef = useRef<BoxNode | null>(null);

  const handleTap = useCallback(() => {
    setActive(true);
    onClick?.();
    setTimeout(() => setActive(false), 120);
  }, [onClick]);

  // Re-register after every render so the hit region always matches the
  // rendered position — even when the Button is inside a flex/grid container.
  useLayoutEffect(() => {
    if (!registry) return;
    const key  = id.current;
    const node = nodeRef.current;

    // Prefer the layout-engine position; fall back to explicit props.
    const lb = node ? layoutCtx.current.get(node) : undefined;
    const rx = lb?.x ?? x;
    const ry = lb?.y ?? y;
    const rw = lb?.w ?? width;
    const rh = lb?.h ?? height;

    registry.register(key, { x: rx, y: ry, width: rw, height: rh, handler: handleTap });
    return () => registry.unregister(key);
  });

  return (
    <Box
      ref={nodeRef}
      x={x} y={y}
      width={width} height={height}
      color={active ? activeColor : color}
      style={style}
    >
      {children}
    </Box>
  );
}
