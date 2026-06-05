import type { Style } from './style';

export type Color = string;

export interface BoxNode {
  type: 'box';
  x: number;
  y: number;
  width: number;
  height: number;
  color: Color;
  borderColor?: Color;
  borderWidth?: number;
  style?: Style;
  children: SceneNode[];
}

export interface TextNode {
  type: 'text';
  x: number;
  y: number;
  color: Color;
  fontSize: number;
  fontFamily: string;
  text: string;
  children: SceneNode[];
}

export interface TextLeafNode {
  type: 'text-leaf';
  text: string;
  children: never[];
}

export interface SvgNode {
  type: 'svg_image';
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  style?: Style;
  children: SceneNode[];
}

export type SceneNode = BoxNode | TextNode | SvgNode;
export type AnyNode = SceneNode | TextLeafNode;

export interface RootContainer {
  type: 'root';
  children: SceneNode[];
  width: number;
  height: number;
  _onCommit?: () => void;
}
