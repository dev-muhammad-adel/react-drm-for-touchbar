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
  borderColor?: string;
  activeBorderColor?: string;
  borderWidth?: number;
  style?: Style;
  activeStyle?: Style;
  children?: React.ReactNode;
  onClick?:      () => void;
  onTouchStart?: (x: number, y: number) => void;
  onTouchMove?:  (x: number, y: number) => void;
  onTouchEnd?:   (x: number, y: number) => void;
}

export function Button({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  color = '#2a2a3e',
  activeColor = '#4a90d9',
  borderColor,
  activeBorderColor,
  borderWidth,
  style,
  activeStyle,
  onClick,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
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
  }, [onClick, x, y]);

  useLayoutEffect(() => {
    if (!registry) return;
    const key  = id.current;
    const node = nodeRef.current;

    const lb = node ? layoutCtx.current.get(node) : undefined;
    const rx = lb?.x ?? x;
    const ry = lb?.y ?? y;
    const rw = lb?.w ?? width;
    const rh = lb?.h ?? height;

    registry.registerGesture(key, {
      x: rx, y: ry, width: rw, height: rh,
      onClick:      handleTap,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    });
    return () => registry.unregisterGesture(key);
  });

  return (
    <Box
      ref={nodeRef}
      x={x} y={y}
      width={width} height={height}
      color={active ? activeColor : color}
      borderColor={active && activeBorderColor ? activeBorderColor : borderColor}
      borderWidth={borderWidth}
      style={active && activeStyle ? activeStyle : style}
    >
      {children}
    </Box>
  );
}
