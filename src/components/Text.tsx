import React from 'react';

export interface TextProps {
  x?: number;
  y?: number;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  children?: string | number;
}

export function Text(props: TextProps): React.ReactElement {
  return React.createElement('text', props);
}
