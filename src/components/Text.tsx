import React from 'react';
import type { Style } from '../scene/style';

export interface TextProps {
  x?: number;
  y?: number;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  style?: Style;
  children?: string | number;
}

export function Text(props: TextProps): React.ReactElement {
  return React.createElement('text', props);
}
