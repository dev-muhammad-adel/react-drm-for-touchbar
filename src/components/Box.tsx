import React from 'react';
import type { Style } from '../scene/style';
import type { BoxNode } from '../scene/types';

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

export const Box = React.forwardRef<BoxNode, BoxProps>(function Box(props, ref) {
  return React.createElement('box' as string, { ...props, ref });
});
