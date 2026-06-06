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
  opacity?: number;
  activeOpacity?: number;
  borderRadius?: number;
  /** Extra pixels to expand the tap hit area on each side. */
  hitSlop?: number;
  style?: Style;
  activeStyle?: Style;
  children?: React.ReactNode;
  onClick?:      () => void;
  onTouchStart?: (x: number, y: number) => void;
  onTouchMove?:  (x: number, y: number) => void;
  onTouchEnd?:   (x: number, y: number) => void;
}

export function Button({
  x,
  y,
  width = 0,
  height = 0,
  color = '#2a2a3e',
  activeColor = '#4a90d9',
  borderColor,
  activeBorderColor,
  borderWidth,
  opacity,
  activeOpacity,
  borderRadius,
  hitSlop,
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

  useLayoutEffect(() => {
    if (!registry) return;
    const key  = id.current;
    const node = nodeRef.current;

    registry.registerGesture(key, {
      x: 0, y: 0, width: 0, height: 0,
      hitSlop,
      // Called at touch time — layout is already current so flex positions are correct.
      getBounds: () => {
        const lb = node ? layoutCtx.current.get(node) : undefined;
        return lb
          ? { x: lb.x, y: lb.y, width: lb.w, height: lb.h }
          : { x: x ?? 0, y: y ?? 0, width, height };
      },
      // Highlight immediately on touch-down for instant visual feedback.
      onTouchStart: (tx, ty) => { setActive(true); onTouchStart?.(tx, ty); },
      // Fire the action when the finger lifts (registry checks bounds before calling).
      onClick: () => { onClick?.(); },
      onTouchMove,
      // Reset highlight shortly after lift whether or not the tap fired.
      onTouchEnd: (tx, ty) => { setTimeout(() => setActive(false), 100); onTouchEnd?.(tx, ty); },
    });
    return () => registry.unregisterGesture(key);
  });

  const baseStyle = active && activeStyle ? activeStyle : style;
  const effectiveStyle: Style = {
    ...(borderRadius !== undefined && { borderRadius }),
    ...(opacity !== undefined && { opacity: active && activeOpacity !== undefined ? activeOpacity : opacity }),
    ...baseStyle,
  };

  return (
    <Box
      ref={nodeRef}
      x={x} y={y}
      width={width} height={height}
      color={active ? activeColor : color}
      borderColor={active && activeBorderColor ? activeBorderColor : borderColor}
      borderWidth={borderWidth}
      style={effectiveStyle}
    >
      {children}
    </Box>
  );
}
