import React from 'react';
import type { Style } from '../scene/style';

export interface SvgProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /**
   * Either an absolute file path to an `.svg` file, or inline SVG markup
   * (a string that starts with `<`).
   */
  src: string;
  style?: Style;
}

export function Svg(props: SvgProps): React.ReactElement {
  return React.createElement('svg_image', props);
}
