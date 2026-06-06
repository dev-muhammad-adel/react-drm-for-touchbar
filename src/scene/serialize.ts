import type { SceneNode, RootContainer } from './types';
import { computeLayout } from './layout';
import type { LayoutBox } from './layout';

export type DrawCommand =
  | { cmd: 'clear'; r: number; g: number; b: number }
  | { cmd: 'fill_rect'; x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number; tl: number; tr: number; br: number; bl: number }
  | { cmd: 'stroke_rect'; x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number; tl: number; tr: number; br: number; bl: number; lineWidth: number }
  | { cmd: 'text'; x: number; y: number; r: number; g: number; b: number; a: number; size: number; family: string; text: string }
  | { cmd: 'draw_svg'; x: number; y: number; w: number; h: number; src: string }
  | { cmd: 'overlay'; a: number };  // black veil 0=transparent … 1=opaque

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black:   [0, 0, 0],
  white:   [1, 1, 1],
  red:     [1, 0, 0],
  green:   [0, 0.502, 0],
  lime:    [0, 1, 0],
  blue:    [0, 0, 1],
  yellow:  [1, 1, 0],
  cyan:    [0, 1, 1],
  magenta: [1, 0, 1],
  gray:    [0.502, 0.502, 0.502],
  grey:    [0.502, 0.502, 0.502],
  orange:  [1, 0.647, 0],
  purple:  [0.502, 0, 0.502],
  pink:    [1, 0.753, 0.796],
  navy:    [0, 0, 0.502],
  teal:    [0, 0.502, 0.502],
};

export function parseColor(color: string): [number, number, number] {
  if (NAMED_COLORS[color]) return NAMED_COLORS[color];
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const full = hex.length === 3
      ? hex.split('').map(c => c + c).join('')
      : hex;
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
    ];
  }
  const rgb = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgb) return [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255];
  return [1, 1, 1];
}

function resolveCornerRadii(s: import('./style').Style | undefined): [number, number, number, number] {
  const base = s?.borderRadius ?? 0;
  return [
    s?.borderTopLeftRadius     ?? base,
    s?.borderTopRightRadius    ?? base,
    s?.borderBottomRightRadius ?? base,
    s?.borderBottomLeftRadius  ?? base,
  ];
}

function emitNode(node: SceneNode, cmds: DrawCommand[], layout: ReadonlyMap<SceneNode, LayoutBox>): void {
  if (node.type === 'box') {
    const lb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: node.width, h: node.height };
    const a  = node.style?.opacity ?? 1;
    const [tl, tr, br, bl] = resolveCornerRadii(node.style);
    if (node.color !== 'transparent') {
      const [r, g, b] = parseColor(node.color);
      cmds.push({ cmd: 'fill_rect', x: lb.x, y: lb.y, w: lb.w, h: lb.h, r, g, b, a, tl, tr, br, bl });
    }
    if (node.borderColor && node.borderWidth && node.borderWidth > 0) {
      const [r, g, b] = parseColor(node.borderColor);
      cmds.push({ cmd: 'stroke_rect', x: lb.x, y: lb.y, w: lb.w, h: lb.h, r, g, b, a, tl, tr, br, bl, lineWidth: node.borderWidth });
    }
    for (const child of node.children) emitNode(child, cmds, layout);
  } else if (node.type === 'text') {
    const lb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: 0, h: 0 };
    const [r, g, b] = parseColor(node.color);
    const a = node.style?.opacity ?? 1;
    cmds.push({ cmd: 'text', x: lb.x, y: lb.y, r, g, b, a, size: node.fontSize, family: node.fontFamily, text: node.text });
  } else if (node.type === 'svg_image') {
    const lb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: node.width, h: node.height };
    cmds.push({ cmd: 'draw_svg', x: lb.x, y: lb.y, w: lb.w, h: lb.h, src: node.src });
  }
}

export function serializeScene(
  root: RootContainer,
  precomputedLayout?: ReadonlyMap<SceneNode, LayoutBox>,
): DrawCommand[] {
  const layout = precomputedLayout ?? computeLayout(root, root.width, root.height);
  const cmds: DrawCommand[] = [{ cmd: 'clear', r: 0, g: 0, b: 0 }];
  for (const child of root.children) emitNode(child, cmds, layout);
  return cmds;
}
