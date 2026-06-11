import React from 'react';
import type { Style } from '../scene/style';
import type { TextNode } from '../scene/types';

export interface TextProps {
  x?: number;
  y?: number;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  style?: Style;
  children?: string | number;
}

export const Text = React.forwardRef<TextNode, TextProps>(function Text(props, ref) {
  return React.createElement('text', { ...props, ref });
});
