import type { Style } from './style';

export type Color = string;

export interface BoxNode {
  type: 'box';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color: Color;
  borderColor?: Color;
  borderWidth?: number;
  style?: Style;
  children: SceneNode[];
  scrollX?: number; // set by ScrollBox; serializer shifts children by -scrollX
}

export interface TextNode {
  type: 'text';
  x?: number;
  y?: number;
  color: Color;
  fontSize: number;
  fontFamily: string;
  text: string;
  style?: Style;
  children: SceneNode[];
}

export interface TextLeafNode {
  type: 'text-leaf';
  text: string;
  children: never[];
}

export interface SvgNode {
  type: 'svg_image';
  x?: number;
  y?: number;
  width: number;
  height: number;
  src: string;
  style?: Style;
  children: SceneNode[];
}

export interface GifNode {
  type: 'gif_image';
  x?: number;
  y?: number;
  width: number;
  height: number;
  style?: Style;
  children: SceneNode[];
  // Mutated out-of-band by the <Gif> component each frame (like the spring
  // adapter): the current frame's premultiplied-BGRA pixels and its source
  // dimensions. Not a React prop — survives commitUpdate (nodeFromProps omits
  // it, so Object.assign never clears it).
  frame?: Buffer;
  frameW?: number;
  frameH?: number;
}

export interface SvgContainerNode {
  type: 'svg';
  x?: number;
  y?: number;
  width: number;
  height: number;
  style?: Style;
  attrs: Record<string, string>;
  children: SceneNode[];        // always empty; satisfies SceneNode interface
  svgChildren: SvgElementNode[];
  /** @internal Cached serialized SVG markup — cleared on tree mutation, rebuilt on first serialize. */
  _cachedSrc?: string;
}

export interface SvgElementNode {
  type: 'svg_el';
  tag: string;
  attrs: Record<string, string>;
  children: SvgElementNode[];
  text?: string;
  /** @internal Set on attach so commitUpdate can climb to the owning <svg> and clear its `_cachedSrc`. */
  _parent?: SvgContainerNode | SvgElementNode;
}

export type SceneNode = BoxNode | TextNode | SvgNode | GifNode | SvgContainerNode;
export type AnyNode = SceneNode | TextLeafNode | SvgElementNode;

export interface RootContainer {
  type: 'root';
  children: SceneNode[];
  width: number;
  height: number;
  _onCommit?: (needsLayout?: boolean) => void;
}
