import type { SceneNode, RootContainer, SvgContainerNode, SvgElementNode } from './types';
import { computeLayout } from './layout';
import type { LayoutBox } from './layout';

export type DrawCommand =
  | { cmd: 'clear'; r: number; g: number; b: number }
  | { cmd: 'fill_rect'; x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number; tl: number; tr: number; br: number; bl: number }
  | { cmd: 'stroke_rect'; x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number; tl: number; tr: number; br: number; bl: number; lineWidth: number; borderStyle: string }
  | { cmd: 'shadow'; x: number; y: number; w: number; h: number; tl: number; tr: number; br: number; bl: number; r: number; g: number; b: number; a: number; dx: number; dy: number; blur: number }
  | { cmd: 'clip_push'; x: number; y: number; w: number; h: number; tl: number; tr: number; br: number; bl: number }
  | { cmd: 'clip_pop' }
  | { cmd: 'text'; x: number; y: number; r: number; g: number; b: number; a: number; size: number; family: string; text: string; bold: boolean; italic: boolean; align: string; containerX: number; containerW: number; lineHeight: number }
  | { cmd: 'draw_svg'; x: number; y: number; w: number; h: number; src: string }
  | { cmd: 'overlay'; a: number };  // black veil 0=transparent … 1=opaque

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgElToXml(node: SvgElementNode): string {
  const attrStr = Object.entries(node.attrs)
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(' ');
  const open = attrStr ? `<${node.tag} ${attrStr}` : `<${node.tag}`;
  if (node.children.length === 0) return `${open}/>`;
  return `${open}>${node.children.map(svgElToXml).join('')}</${node.tag}>`;
}

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

export function parseColor(color: string): [number, number, number, number] {
  if (NAMED_COLORS[color]) { const [r, g, b] = NAMED_COLORS[color]; return [r, g, b, 1]; }
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') + 'ff'
               : hex.length === 6 ? hex + 'ff'
               : hex; // 8 chars: rrggbbaa
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
      parseInt(full.slice(6, 8), 16) / 255,
    ];
  }
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] !== undefined ? +m[4] : 1];
  return [1, 1, 1, 1];
}

function zIndexOf(node: SceneNode): number {
  return node.style?.zIndex ?? 0;
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

function emitNode(node: SceneNode, cmds: DrawCommand[], layout: ReadonlyMap<SceneNode, LayoutBox>, parentLb?: LayoutBox): void {
  if (node.type === 'box') {
    const lb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 };
    const a  = node.style?.opacity ?? 1;
    const [tl, tr, br, bl] = resolveCornerRadii(node.style);
    const shadowOpacity = node.style?.shadowOpacity ?? 1;
    if (node.style?.shadowColor && shadowOpacity > 0) {
      const [sr, sg, sb, sa] = parseColor(node.style.shadowColor);
      cmds.push({
        cmd: 'shadow',
        x: lb.x, y: lb.y, w: lb.w, h: lb.h,
        tl, tr, br, bl,
        r: sr, g: sg, b: sb, a: sa * shadowOpacity,
        dx: node.style.shadowOffsetX ?? 0,
        dy: node.style.shadowOffsetY ?? 0,
        blur: node.style.shadowRadius ?? 0,
      });
    }
    const bgColor = node.style?.backgroundColor ?? node.color;
    if (bgColor !== 'transparent') {
      const [r, g, b, ca] = parseColor(bgColor);
      cmds.push({ cmd: 'fill_rect', x: lb.x, y: lb.y, w: lb.w, h: lb.h, r, g, b, a: ca * a, tl, tr, br, bl });
    }
    const borderColor = node.style?.borderColor ?? node.borderColor;
    const borderWidth = node.style?.borderWidth ?? node.borderWidth;
    const borderStyle = node.style?.borderStyle ?? 'solid';
    if (borderColor && borderWidth && borderWidth > 0) {
      const [r, g, b, ca] = parseColor(borderColor);
      cmds.push({ cmd: 'stroke_rect', x: lb.x, y: lb.y, w: lb.w, h: lb.h, r, g, b, a: ca * a, tl, tr, br, bl, lineWidth: borderWidth, borderStyle });
    }
    const clip = node.style?.overflow === 'hidden';
    if (clip) cmds.push({ cmd: 'clip_push', x: lb.x, y: lb.y, w: lb.w, h: lb.h, tl, tr, br, bl });

    const isAbsolute = (n: SceneNode) =>
      n.style?.position === 'absolute' || n.x !== undefined || n.y !== undefined;

    // Negative-zIndex absolutes → flow children (tree order) → non-negative absolutes
    const absNeg  = node.children.filter(c => isAbsolute(c) && zIndexOf(c) < 0)
                                  .sort((a, b) => zIndexOf(a) - zIndexOf(b));
    const flow    = node.children.filter(c => !isAbsolute(c));
    const absPos  = node.children.filter(c => isAbsolute(c) && zIndexOf(c) >= 0)
                                  .sort((a, b) => zIndexOf(a) - zIndexOf(b));

    for (const child of [...absNeg, ...flow, ...absPos]) emitNode(child, cmds, layout, lb);
    if (clip) cmds.push({ cmd: 'clip_pop' });
  } else if (node.type === 'text') {
    const lb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: 0, h: 0 };
    const [r, g, b, ca] = parseColor(node.style?.color ?? node.color);
    const a = ca * (node.style?.opacity ?? 1);
    const size   = node.style?.fontSize   ?? node.fontSize;
    const family = node.style?.fontFamily ?? node.fontFamily;
    const fw         = node.style?.fontWeight;
    const bold       = fw === 'bold' || (fw !== undefined && parseInt(fw, 10) >= 700);
    const italic     = node.style?.fontStyle === 'italic';
    const align      = node.style?.textAlign ?? 'left';
    const containerX = parentLb?.x ?? lb.x;
    const containerW = parentLb?.w ?? 0;
    const lineHeight = node.style?.lineHeight ?? 0;
    cmds.push({ cmd: 'text', x: lb.x, y: lb.y, r, g, b, a, size, family, text: node.text, bold, italic, align, containerX, containerW, lineHeight });
  } else if (node.type === 'svg_image') {
    const lb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 };
    cmds.push({ cmd: 'draw_svg', x: lb.x, y: lb.y, w: lb.w, h: lb.h, src: node.src });
  } else if (node.type === 'svg') {
    const svgNode = node as SvgContainerNode;
    const lb = layout.get(node) ?? { x: svgNode.x ?? 0, y: svgNode.y ?? 0, w: svgNode.width, h: svgNode.height };
    const attrs = { xmlns: 'http://www.w3.org/2000/svg', ...svgNode.attrs };
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ');
    const inner = svgNode.svgChildren.map(svgElToXml).join('');
    cmds.push({ cmd: 'draw_svg', x: lb.x, y: lb.y, w: lb.w, h: lb.h, src: `<svg ${attrStr}>${inner}</svg>` });
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
