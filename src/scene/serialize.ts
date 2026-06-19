import colorString from 'color-string';
import type { SceneNode, RootContainer, SvgContainerNode, SvgElementNode } from './types';
import type { LayoutBox } from './layout';

export type DrawCommand =
  | { cmd: 'clear'; r: number; g: number; b: number }
  | { cmd: 'fill_rect'; x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number; tl: number; tr: number; br: number; bl: number }
  | { cmd: 'stroke_rect'; x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number; tl: number; tr: number; br: number; bl: number; lineWidth: number; borderStyle: string }
  | { cmd: 'shadow'; x: number; y: number; w: number; h: number; tl: number; tr: number; br: number; bl: number; r: number; g: number; b: number; a: number; dx: number; dy: number; blur: number; inset: boolean }
  | { cmd: 'clip_push'; x: number; y: number; w: number; h: number; tl: number; tr: number; br: number; bl: number }
  | { cmd: 'clip_pop' }
  | { cmd: 'transform_push'; cx: number; cy: number; rotate: number }  // rotate in radians, pivot (cx,cy)
  | { cmd: 'transform_pop' }
  | { cmd: 'text'; x: number; y: number; r: number; g: number; b: number; a: number; size: number; family: string; text: string; bold: boolean; italic: boolean; align: string; containerX: number; containerW: number; lineHeight: number }
  | { cmd: 'draw_svg'; x: number; y: number; w: number; h: number; src: string }
  | { cmd: 'draw_image'; x: number; y: number; w: number; h: number; sw: number; sh: number; data: Buffer; tl: number; tr: number; br: number; bl: number }
  | { cmd: 'overlay'; a: number };  // black veil 0=transparent … 1=opaque

function cmdSignature(c: Exclude<DrawCommand, { cmd: 'draw_image' }>): string {
  switch (c.cmd) {
    case 'clear':
      return `c:${c.r},${c.g},${c.b}`;
    case 'fill_rect':
      return `fr:${c.x},${c.y},${c.w},${c.h},${c.r},${c.g},${c.b},${c.a},${c.tl},${c.tr},${c.br},${c.bl}`;
    case 'stroke_rect':
      return `sr:${c.x},${c.y},${c.w},${c.h},${c.r},${c.g},${c.b},${c.a},${c.tl},${c.tr},${c.br},${c.bl},${c.lineWidth},${c.borderStyle}`;
    case 'shadow':
      return `sh:${c.x},${c.y},${c.w},${c.h},${c.tl},${c.tr},${c.br},${c.bl},${c.r},${c.g},${c.b},${c.a},${c.dx},${c.dy},${c.blur},${c.inset ? 1 : 0}`;
    case 'clip_push':
      return `cp:${c.x},${c.y},${c.w},${c.h},${c.tl},${c.tr},${c.br},${c.bl}`;
    case 'clip_pop':
      return 'co';
    case 'transform_push':
      return `tp:${c.cx},${c.cy},${c.rotate}`;
    case 'transform_pop':
      return 'to';
    case 'text':
      return `t:${c.x},${c.y},${c.r},${c.g},${c.b},${c.a},${c.size},${c.family},${c.text},${c.bold ? 1 : 0},${c.italic ? 1 : 0},${c.align},${c.containerX},${c.containerW},${c.lineHeight}`;
    case 'draw_svg':
      return `svg:${c.x},${c.y},${c.w},${c.h},${c.src}`;
    case 'overlay':
      return `o:${c.a}`;
  }
}

/**
 * Cheap structural signature of a frame for blit deduplication.
 * Returns null when the frame contains an animated image (draw_image / GIF) —
 * those mutate their Buffer in place, so we never dedup them.
 */
export function frameSignature(cmds: DrawCommand[]): string | null {
  let out = '';
  for (const c of cmds) {
    if (c.cmd === 'draw_image') return null; // GIF animating → always render
    if (c.cmd === 'transform_push') return null; // rotation animates → always render (and skip hashing the rotated subtree)
    out += `${cmdSignature(c)};`;
  }
  return out;
}

export interface Rect { x: number; y: number; w: number; h: number; }

function cmdBox(c: DrawCommand): Rect | 'full' | null {
  switch (c.cmd) {
    case 'fill_rect': case 'stroke_rect': case 'clip_push':
    case 'draw_svg':  case 'draw_image':
      return { x: c.x, y: c.y, w: c.w, h: c.h };
    case 'clip_pop': return null;
    case 'text': {
      // Horizontal extent for the full-height damage band (only x/w are used by
      // the band; y/h are ignored). Over-estimate to avoid stale fragments:
      // cover the container (aligned text lives inside it) AND a generous
      // per-glyph advance for left-aligned/overflowing text. damageRects unions
      // both the old and new command's box, so shrinking text is covered too.
      const est = c.text.length * c.size * 0.75;
      const x0  = Math.min(c.x, c.containerX);
      const x1  = Math.max(c.x + est, c.containerX + c.containerW);
      return { x: x0, y: c.y, w: x1 - x0, h: c.lineHeight || c.size * 1.5 };
    }
    default: return 'full'; // clear / overlay / shadow
  }
}

function cmdEq(a: DrawCommand, b: DrawCommand): boolean {
  if (a.cmd !== b.cmd) return false;
  if (a.cmd === 'draw_image') return false; // animating buffer — always re-flush

  switch (a.cmd) {
    case 'clear':
      return a.r === (b as typeof a).r
        && a.g === (b as typeof a).g
        && a.b === (b as typeof a).b;
    case 'fill_rect':
      return a.x === (b as typeof a).x
        && a.y === (b as typeof a).y
        && a.w === (b as typeof a).w
        && a.h === (b as typeof a).h
        && a.r === (b as typeof a).r
        && a.g === (b as typeof a).g
        && a.b === (b as typeof a).b
        && a.a === (b as typeof a).a
        && a.tl === (b as typeof a).tl
        && a.tr === (b as typeof a).tr
        && a.br === (b as typeof a).br
        && a.bl === (b as typeof a).bl;
    case 'stroke_rect':
      return a.x === (b as typeof a).x
        && a.y === (b as typeof a).y
        && a.w === (b as typeof a).w
        && a.h === (b as typeof a).h
        && a.r === (b as typeof a).r
        && a.g === (b as typeof a).g
        && a.b === (b as typeof a).b
        && a.a === (b as typeof a).a
        && a.tl === (b as typeof a).tl
        && a.tr === (b as typeof a).tr
        && a.br === (b as typeof a).br
        && a.bl === (b as typeof a).bl
        && a.lineWidth === (b as typeof a).lineWidth
        && a.borderStyle === (b as typeof a).borderStyle;
    case 'shadow':
      return a.x === (b as typeof a).x
        && a.y === (b as typeof a).y
        && a.w === (b as typeof a).w
        && a.h === (b as typeof a).h
        && a.tl === (b as typeof a).tl
        && a.tr === (b as typeof a).tr
        && a.br === (b as typeof a).br
        && a.bl === (b as typeof a).bl
        && a.r === (b as typeof a).r
        && a.g === (b as typeof a).g
        && a.b === (b as typeof a).b
        && a.a === (b as typeof a).a
        && a.dx === (b as typeof a).dx
        && a.dy === (b as typeof a).dy
        && a.blur === (b as typeof a).blur
        && a.inset === (b as typeof a).inset;
    case 'clip_push':
      return a.x === (b as typeof a).x
        && a.y === (b as typeof a).y
        && a.w === (b as typeof a).w
        && a.h === (b as typeof a).h
        && a.tl === (b as typeof a).tl
        && a.tr === (b as typeof a).tr
        && a.br === (b as typeof a).br
        && a.bl === (b as typeof a).bl;
    case 'clip_pop':
      return true;
    case 'transform_push':
      return a.cx === (b as typeof a).cx
        && a.cy === (b as typeof a).cy
        && a.rotate === (b as typeof a).rotate;
    case 'transform_pop':
      return true;
    case 'text':
      return a.x === (b as typeof a).x
        && a.y === (b as typeof a).y
        && a.r === (b as typeof a).r
        && a.g === (b as typeof a).g
        && a.b === (b as typeof a).b
        && a.a === (b as typeof a).a
        && a.size === (b as typeof a).size
        && a.family === (b as typeof a).family
        && a.text === (b as typeof a).text
        && a.bold === (b as typeof a).bold
        && a.italic === (b as typeof a).italic
        && a.align === (b as typeof a).align
        && a.containerX === (b as typeof a).containerX
        && a.containerW === (b as typeof a).containerW
        && a.lineHeight === (b as typeof a).lineHeight;
    case 'draw_svg':
      return a.x === (b as typeof a).x
        && a.y === (b as typeof a).y
        && a.w === (b as typeof a).w
        && a.h === (b as typeof a).h
        && a.src === (b as typeof a).src;
    case 'overlay':
      return a.a === (b as typeof a).a;
  }
}


export function damageRects(prev: DrawCommand[] | null, next: DrawCommand[]): Rect[] | null {
  if (!prev || prev.length !== next.length) return null;
  // A rotated subtree's child commands are emitted in pre-rotation coordinates,
  // so their bounding boxes don't reflect where they paint. Can't compute a
  // partial damage region — force a full-FB flush whenever a transform is live.
  for (const c of next) if (c.cmd === 'transform_push') return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, changed = false;
  for (let i = 0; i < next.length; i++) {
    if (cmdEq(prev[i], next[i])) continue;
    changed = true;
    for (const c of [prev[i], next[i]]) {
      const b = cmdBox(c);
      if (b === 'full') return null;
      if (b === null) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
  }
  if (!changed) return [];
  if (maxX < minX) return null;
  return [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgElToXml(node: SvgElementNode): string {
  if (!node || node.type !== 'svg_el') return '';
  const attrStr = Object.entries(node.attrs ?? {})
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(' ');
  const open = attrStr ? `<${node.tag} ${attrStr}` : `<${node.tag}`;
  const inner = (node.children ?? []).map(svgElToXml).join('');
  const text = node.text != null ? escapeXml(node.text) : '';
  const body = `${text}${inner}`;
  if (!body) return `${open}/>`;
  return `${open}>${body}</${node.tag}>`;
}

/** Parse any CSS color (named, hex, rgb[a]) to [r, g, b, a] in 0..1. */
const colorCache = new Map<string, [number, number, number, number]>();
export function parseColor(color: string): [number, number, number, number] {
  // The same palette strings recur on every command of every frame; parsing
  // them with color-string each time is a hot spot. Cache by string.
  let cached = colorCache.get(color);
  if (cached) return cached;
  const rgba = colorString.get.rgb(color);
  cached = rgba ? [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3]] : [1, 1, 1, 1];
  colorCache.set(color, cached);
  return cached;
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

function emitNode(node: SceneNode, cmds: DrawCommand[], layout: ReadonlyMap<SceneNode, LayoutBox>, parentLb?: LayoutBox, offsetX = 0): void {
  if (node.type === 'box') {
    const rawLb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 };
    const lb = offsetX ? { ...rawLb, x: rawLb.x - offsetX } : rawLb;
    const a  = node.style?.opacity ?? 1;
    const [tl, tr, br, bl] = resolveCornerRadii(node.style);
    // Rotation wraps the whole box (background + border + children) around its
    // center. Layout is untouched — this only rewrites the draw CTM natively.
    const rotateDeg = node.style?.rotate ?? 0;
    if (rotateDeg !== 0) {
      cmds.push({ cmd: 'transform_push', cx: lb.x + lb.w / 2, cy: lb.y + lb.h / 2, rotate: rotateDeg * Math.PI / 180 });
    }
    const shadowOpacity = node.style?.shadowOpacity ?? 1;
    let shadowCmd: Extract<DrawCommand, { cmd: 'shadow' }> | null = null;
    if (node.style?.shadowColor && shadowOpacity > 0) {
      const [sr, sg, sb, sa] = parseColor(node.style.shadowColor);
      shadowCmd = {
        cmd: 'shadow',
        x: lb.x, y: lb.y, w: lb.w, h: lb.h,
        tl, tr, br, bl,
        r: sr, g: sg, b: sb, a: sa * shadowOpacity,
        dx: node.style.shadowOffsetX ?? 0,
        dy: node.style.shadowOffsetY ?? 0,
        blur: node.style.shadowRadius ?? 0,
        inset: node.style.shadowInset ?? false,
      };
    }
    // Outer drop shadow paints behind the box; an inset shadow paints over the
    // background and under the children, so it's deferred until after the
    // fill/border (see below).
    if (shadowCmd && !shadowCmd.inset) cmds.push(shadowCmd);
    const bgColor = node.style?.backgroundColor ?? node.color;
    if (bgColor !== 'transparent') {
      const [r, g, b, ca] = parseColor(bgColor);
      // Skip invisible fills — the native fill_rect treats a<=0 as "alpha not
      // set" and coerces it to 1, turning a transparent rect opaque.
      const alpha = ca * a;
      if (alpha > 0.001) {
        cmds.push({ cmd: 'fill_rect', x: lb.x, y: lb.y, w: lb.w, h: lb.h, r, g, b, a: alpha, tl, tr, br, bl });
      }
    }
    const borderColor = node.style?.borderColor ?? node.borderColor;
    const borderWidth = node.style?.borderWidth ?? node.borderWidth;
    const borderStyle = node.style?.borderStyle ?? 'solid';
    if (borderColor && borderWidth && borderWidth > 0) {
      const [r, g, b, ca] = parseColor(borderColor);
      const alpha = ca * a;
      if (alpha > 0.001) {
        cmds.push({ cmd: 'stroke_rect', x: lb.x, y: lb.y, w: lb.w, h: lb.h, r, g, b, a: alpha, tl, tr, br, bl, lineWidth: borderWidth, borderStyle });
      }
    }
    if (shadowCmd && shadowCmd.inset) cmds.push(shadowCmd); // over bg, under children

    const clip = node.style?.overflow === 'hidden' || node.style?.overflow === 'scroll';
    if (clip) cmds.push({ cmd: 'clip_push', x: lb.x, y: lb.y, w: lb.w, h: lb.h, tl, tr, br, bl });

    const isAbsolute = (n: SceneNode) =>
      n.style?.position === 'absolute' || n.x !== undefined || n.y !== undefined;

    // Negative-zIndex absolutes → flow children (tree order) → non-negative absolutes
    const absNeg  = node.children.filter(c => isAbsolute(c) && zIndexOf(c) < 0)
                                  .sort((a, b) => zIndexOf(a) - zIndexOf(b));
    const flow    = node.children.filter(c => !isAbsolute(c));
    const absPos  = node.children.filter(c => isAbsolute(c) && zIndexOf(c) >= 0)
                                  .sort((a, b) => zIndexOf(a) - zIndexOf(b));

    const childOffsetX = offsetX + (node.scrollX ?? 0);
    // Fast path: most boxes have only flow children — skip the three filter
    // passes (and their temporary array allocations) when none are absolute.
    if (!node.children.some(isAbsolute)) {
      for (const child of node.children) emitNode(child, cmds, layout, lb, childOffsetX);
    } else {
      for (const child of [...absNeg, ...flow, ...absPos]) emitNode(child, cmds, layout, lb, childOffsetX);
    }
    if (clip) cmds.push({ cmd: 'clip_pop' });
    if (rotateDeg !== 0) cmds.push({ cmd: 'transform_pop' });
  } else if (node.type === 'text') {
    const rawLb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: 0, h: 0 };
    const lb = offsetX ? { ...rawLb, x: rawLb.x - offsetX } : rawLb;
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
    // Default the line box to the text's measured layout height so the native
    // renderer vertically centers the glyph ink within it (otherwise text
    // hugs the top of its box and reads as sitting low when the box is centered).
    const lineHeight = node.style?.lineHeight ?? lb.h;
    if (a > 0.001) {
      cmds.push({ cmd: 'text', x: lb.x, y: lb.y, r, g, b, a, size, family, text: node.text, bold, italic, align, containerX, containerW, lineHeight });
    }
  } else if (node.type === 'svg_image') {
    const rawLb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 };
    const lb = offsetX ? { ...rawLb, x: rawLb.x - offsetX } : rawLb;
    cmds.push({ cmd: 'draw_svg', x: lb.x, y: lb.y, w: lb.w, h: lb.h, src: node.src });
  } else if (node.type === 'gif_image') {
    if (node.frame && node.frameW && node.frameH) {
      const rawLb = layout.get(node) ?? { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 };
      const lb = offsetX ? { ...rawLb, x: rawLb.x - offsetX } : rawLb;
      const [tl, tr, br, bl] = resolveCornerRadii(node.style);
      cmds.push({ cmd: 'draw_image', x: lb.x, y: lb.y, w: lb.w, h: lb.h, sw: node.frameW, sh: node.frameH, data: node.frame, tl, tr, br, bl });
    }
  } else if (node.type === 'svg') {
    const svgNode = node as SvgContainerNode;
    const lb = layout.get(node) ?? { x: svgNode.x ?? 0, y: svgNode.y ?? 0, w: svgNode.width, h: svgNode.height };
    // Build (and cache) the serialized SVG markup once; reuse on every subsequent
    // frame until the node or its children are mutated (reconciler clears _cachedSrc).
    if (!svgNode._cachedSrc) {
      const attrs = { xmlns: 'http://www.w3.org/2000/svg', ...svgNode.attrs };
      const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ');
      const inner = svgNode.svgChildren.map(svgElToXml).join('');
      svgNode._cachedSrc = `<svg ${attrStr}>${inner}</svg>`;
    }
    cmds.push({ cmd: 'draw_svg', x: lb.x, y: lb.y, w: lb.w, h: lb.h, src: svgNode._cachedSrc });
  }
}

export function serializeScene(
  root: RootContainer,
  layout: ReadonlyMap<SceneNode, LayoutBox>,
): DrawCommand[] {
  const cmds: DrawCommand[] = [{ cmd: 'clear', r: 0, g: 0, b: 0 }];
  for (const child of root.children) emitNode(child, cmds, layout);
  return cmds;
}

// ── Binary command buffer ────────────────────────────────────────────────────
// Encodes a DrawCommand[] into a compact Float64Array + string table + buffer
// table.  The native renderBinary() reads straight from typed-array memory
// offsets instead of walking JS object properties, cutting N-API overhead for
// frames with many commands.

/** Integer command-type codes packed into the binary buffer. */
export const CMD_TYPE = {
  CLEAR:       0,
  FILL_RECT:   1,
  STROKE_RECT: 2,
  SHADOW:      3,
  CLIP_PUSH:   4,
  CLIP_POP:    5,
  TEXT:        6,
  DRAW_SVG:    7,
  DRAW_IMAGE:  8,
  OVERLAY:     9,
  TRANSFORM_PUSH: 10,
  TRANSFORM_POP:  11,
} as const;

/** Float64 words per command slot. */
export const BINARY_STRIDE = 22;
//  [0]     cmd_type  (CMD_TYPE integer)
//  [1..16] numeric fields (layout below per command type)
//  [17]    str0_idx  (string-table index, or -1)
//  [18]    str1_idx
//  [19]    str2_idx
//  [20]    buf_idx   (Buffer-table index for draw_image, or -1)
//  [21]    reserved (0)
//
//  CLEAR:       [1]=r [2]=g [3]=b
//  OVERLAY:     [1]=a
//  CLIP_POP:    (no fields)
//  TRANSFORM_POP:  (no fields)
//  TRANSFORM_PUSH: [1]=cx [2]=cy [3]=rotate(radians)
//  CLIP_PUSH:   [1]=x [2]=y [3]=w [4]=h [5]=tl [6]=tr [7]=br [8]=bl
//  FILL_RECT:   [1]=x [2]=y [3]=w [4]=h [5]=r [6]=g [7]=b [8]=a [9]=tl [10]=tr [11]=br [12]=bl
//  STROKE_RECT: [1]=x [2]=y [3]=w [4]=h [5]=r [6]=g [7]=b [8]=a [9]=tl [10]=tr [11]=br [12]=bl [13]=lineWidth  str0=borderStyle
//  SHADOW:      [1]=x [2]=y [3]=w [4]=h [5]=tl [6]=tr [7]=br [8]=bl [9]=r [10]=g [11]=b [12]=a [13]=dx [14]=dy [15]=blur [16]=inset
//  TEXT:        [1]=x [2]=y [3]=r [4]=g [5]=b [6]=a [7]=size [8]=containerX [9]=containerW [10]=lineHeight [11]=bold [12]=italic  str0=family str1=text str2=align
//  DRAW_SVG:    [1]=x [2]=y [3]=w [4]=h  str0=src
//  DRAW_IMAGE:  [1]=x [2]=y [3]=w [4]=h [5]=sw [6]=sh [7]=tl [8]=tr [9]=br [10]=bl  buf0=data

export interface BinaryFrame {
  data: Float32Array;
  strings: string[];
  buffers: Buffer[];
}

// Reused across frames to avoid per-frame allocations. renderBinary() consumes
// the frame synchronously before the next toBinaryBuffer() call, so a single
// shared pool + string/buffer tables are safe to recycle. Float32 (not 64) —
// coords/colors/flags/indices all fit exactly, halving the JS→native copy.
let _pool = new Float32Array(0);
const _strings: string[] = [];
const _buffers: Buffer[]  = [];
const _strIdx = new Map<string, number>();

/**
 * Encode DrawCommand[] into a compact BinaryFrame.
 * shiftX / shiftY are applied to the x/y fields of positional commands in-place,
 * eliminating the shiftCmds() intermediate array allocation.
 */
export function toBinaryBuffer(cmds: DrawCommand[], shiftX = 0, shiftY = 0): BinaryFrame {
  const need = cmds.length * BINARY_STRIDE;
  if (_pool.length < need) _pool = new Float32Array(Math.ceil(need * 1.5));
  const data = _pool;

  const strings = _strings; strings.length = 0;
  const buffers = _buffers; buffers.length = 0;
  const strIdx  = _strIdx;  strIdx.clear();
  function intern(s: string): number {
    let i = strIdx.get(s);
    if (i === undefined) { i = strings.length; strings.push(s); strIdx.set(s, i); }
    return i;
  }

  for (let ci = 0; ci < cmds.length; ci++) {
    const c    = cmds[ci];
    const base = ci * BINARY_STRIDE;
    // Default string/buffer indices to -1 (none).
    data[base + 17] = -1; data[base + 18] = -1; data[base + 19] = -1; data[base + 20] = -1;

    switch (c.cmd) {
      case 'clear':
        data[base]   = CMD_TYPE.CLEAR;
        data[base+1] = c.r; data[base+2] = c.g; data[base+3] = c.b;
        break;
      case 'overlay':
        data[base]   = CMD_TYPE.OVERLAY;
        data[base+1] = c.a;
        break;
      case 'clip_pop':
        data[base] = CMD_TYPE.CLIP_POP;
        break;
      case 'transform_pop':
        data[base] = CMD_TYPE.TRANSFORM_POP;
        break;
      case 'transform_push':
        data[base]   = CMD_TYPE.TRANSFORM_PUSH;
        data[base+1] = c.cx + shiftX; data[base+2] = c.cy + shiftY;
        data[base+3] = c.rotate;
        break;
      case 'clip_push':
        data[base]   = CMD_TYPE.CLIP_PUSH;
        data[base+1] = c.x + shiftX; data[base+2] = c.y + shiftY;
        data[base+3] = c.w;          data[base+4] = c.h;
        data[base+5] = c.tl; data[base+6] = c.tr; data[base+7] = c.br; data[base+8] = c.bl;
        break;
      case 'fill_rect':
        data[base]    = CMD_TYPE.FILL_RECT;
        data[base+1]  = c.x + shiftX; data[base+2] = c.y + shiftY;
        data[base+3]  = c.w;          data[base+4] = c.h;
        data[base+5]  = c.r; data[base+6] = c.g; data[base+7] = c.b; data[base+8] = c.a;
        data[base+9]  = c.tl; data[base+10] = c.tr; data[base+11] = c.br; data[base+12] = c.bl;
        break;
      case 'stroke_rect':
        data[base]    = CMD_TYPE.STROKE_RECT;
        data[base+1]  = c.x + shiftX; data[base+2] = c.y + shiftY;
        data[base+3]  = c.w;          data[base+4] = c.h;
        data[base+5]  = c.r; data[base+6] = c.g; data[base+7] = c.b; data[base+8] = c.a;
        data[base+9]  = c.tl; data[base+10] = c.tr; data[base+11] = c.br; data[base+12] = c.bl;
        data[base+13] = c.lineWidth;
        data[base+17] = intern(c.borderStyle);
        break;
      case 'shadow':
        data[base]    = CMD_TYPE.SHADOW;
        data[base+1]  = c.x + shiftX; data[base+2] = c.y + shiftY;
        data[base+3]  = c.w;          data[base+4] = c.h;
        data[base+5]  = c.tl; data[base+6] = c.tr; data[base+7] = c.br; data[base+8] = c.bl;
        data[base+9]  = c.r;  data[base+10] = c.g; data[base+11] = c.b; data[base+12] = c.a;
        data[base+13] = c.dx; data[base+14] = c.dy; data[base+15] = c.blur;
        data[base+16] = c.inset ? 1 : 0;
        break;
      case 'text':
        data[base]    = CMD_TYPE.TEXT;
        data[base+1]  = c.x + shiftX;     data[base+2]  = c.y + shiftY;
        data[base+3]  = c.r;               data[base+4]  = c.g;
        data[base+5]  = c.b;               data[base+6]  = c.a;
        data[base+7]  = c.size;            data[base+8]  = c.containerX + shiftX;
        data[base+9]  = c.containerW;      data[base+10] = c.lineHeight;
        data[base+11] = c.bold   ? 1 : 0;  data[base+12] = c.italic ? 1 : 0;
        data[base+17] = intern(c.family);
        data[base+18] = intern(c.text);
        data[base+19] = intern(c.align);
        break;
      case 'draw_svg':
        data[base]   = CMD_TYPE.DRAW_SVG;
        data[base+1] = c.x + shiftX; data[base+2] = c.y + shiftY;
        data[base+3] = c.w;          data[base+4] = c.h;
        data[base+17] = intern(c.src);
        break;
      case 'draw_image':
        data[base]   = CMD_TYPE.DRAW_IMAGE;
        data[base+1] = c.x + shiftX; data[base+2] = c.y + shiftY;
        data[base+3] = c.w;          data[base+4] = c.h;
        data[base+5] = c.sw;         data[base+6] = c.sh;
        data[base+7] = c.tl; data[base+8] = c.tr; data[base+9] = c.br; data[base+10] = c.bl;
        data[base+20] = buffers.length;
        buffers.push(c.data);
        break;
    }
  }

  // subarray (a view, no copy) so ElementLength on the native side reflects the
  // actual command count, not the over-allocated pool capacity.
  return { data: data.subarray(0, need), strings, buffers };
}
