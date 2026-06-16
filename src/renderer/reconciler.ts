import ReactReconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants';
import type { RootContainer, SceneNode, BoxNode, TextNode, TextLeafNode, AnyNode, SvgNode, GifNode, SvgContainerNode, SvgElementNode } from '../scene/types';
import type { Style } from '../scene/style';

// JSX camelCase prop names → SVG XML attribute names
const JSX_TO_SVG_ATTR: Record<string, string> = {
  accentHeight: 'accent-height', alignmentBaseline: 'alignment-baseline',
  baselineShift: 'baseline-shift', capHeight: 'cap-height',
  className: 'class',
  clipPath: 'clip-path', clipRule: 'clip-rule',
  colorInterpolation: 'color-interpolation', colorInterpolationFilters: 'color-interpolation-filters',
  colorRendering: 'color-rendering', dominantBaseline: 'dominant-baseline',
  enableBackground: 'enable-background',
  fillOpacity: 'fill-opacity', fillRule: 'fill-rule',
  floodColor: 'flood-color', floodOpacity: 'flood-opacity',
  fontFamily: 'font-family', fontSize: 'font-size', fontSizeAdjust: 'font-size-adjust',
  fontStretch: 'font-stretch', fontStyle: 'font-style', fontVariant: 'font-variant',
  fontWeight: 'font-weight',
  glyphName: 'glyph-name',
  glyphOrientationHorizontal: 'glyph-orientation-horizontal',
  glyphOrientationVertical: 'glyph-orientation-vertical',
  horizAdvX: 'horiz-adv-x', horizOriginX: 'horiz-origin-x',
  imageRendering: 'image-rendering', letterSpacing: 'letter-spacing',
  lightingColor: 'lighting-color',
  markerEnd: 'marker-end', markerMid: 'marker-mid', markerStart: 'marker-start',
  overlinePosition: 'overline-position', overlineThickness: 'overline-thickness',
  paintOrder: 'paint-order', panose1: 'panose-1', pointerEvents: 'pointer-events',
  renderingIntent: 'rendering-intent', shapeRendering: 'shape-rendering',
  stopColor: 'stop-color', stopOpacity: 'stop-opacity',
  strikethroughPosition: 'strikethrough-position', strikethroughThickness: 'strikethrough-thickness',
  strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit', strokeOpacity: 'stroke-opacity',
  strokeWidth: 'stroke-width',
  textAnchor: 'text-anchor', textDecoration: 'text-decoration', textRendering: 'text-rendering',
  underlinePosition: 'underline-position', underlineThickness: 'underline-thickness',
  unicodeBidi: 'unicode-bidi', unicodeRange: 'unicode-range', unitsPerEm: 'units-per-em',
  vectorEffect: 'vector-effect',
  vertAdvY: 'vert-adv-y', vertOriginX: 'vert-origin-x', vertOriginY: 'vert-origin-y',
  wordSpacing: 'word-spacing', writingMode: 'writing-mode', xHeight: 'x-height',
  xlinkActuate: 'xlink:actuate', xlinkArcrole: 'xlink:arcrole',
  xlinkHref: 'href',  // xlink:href is deprecated; use href
  xlinkRole: 'xlink:role', xlinkShow: 'xlink:show',
  xlinkTitle: 'xlink:title', xlinkType: 'xlink:type',
  xmlBase: 'xml:base', xmlLang: 'xml:lang', xmlSpace: 'xml:space',
};

const SKIP_SVG_PROPS = new Set(['children', 'ref', 'key', 'xmlnsXlink', 'style']);

// Inline SVG element tags (excludes 'svg' root and 'text' which is our custom element)
const SVG_TAGS = new Set([
  'animate', 'animateMotion', 'animateTransform',
  'circle', 'clipPath', 'defs', 'desc', 'ellipse',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood',
  'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage',
  'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
  'filter', 'foreignObject', 'g', 'image', 'line', 'linearGradient',
  'marker', 'mask', 'metadata', 'mpath', 'path', 'pattern',
  'polygon', 'polyline', 'radialGradient', 'rect', 'set', 'stop',
  'switch', 'symbol', 'textPath', 'title', 'tspan', 'use', 'view',
]);

// SVG element tags that hold text content and collide with react-drm's own
// element names ('text'). Treated as svg_el only inside an <svg> (see hostContext).
const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'textPath']);

function svgTextContent(children: unknown): string | undefined {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children) && children.every(c => typeof c === 'string' || typeof c === 'number')) {
    return children.join('');
  }
  return undefined;
}

function svgAttrsFromProps(props: Record<string, unknown>): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [key, val] of Object.entries(props)) {
    if (SKIP_SVG_PROPS.has(key)) continue;
    if (val === undefined || val === null || val === false) continue;
    attrs[JSX_TO_SVG_ATTR[key] ?? key] = String(val);
  }
  return attrs;
}

// An svg_el's attr/text change makes the owning <svg>'s cached markup stale.
// svg_el has no direct container ref, so climb _parent to the <svg> and clear it.
function clearSvgCacheFor(el: SvgElementNode): void {
  let p: SvgContainerNode | SvgElementNode | undefined = el._parent;
  while (p) {
    if (p.type === 'svg') { (p as SvgContainerNode)._cachedSrc = undefined; return; }
    p = (p as SvgElementNode)._parent;
  }
}

function nodeFromProps(type: string, props: Record<string, unknown>, inSvg = false): AnyNode {
  if (inSvg && type !== 'svg' && (SVG_TAGS.has(type) || SVG_TEXT_TAGS.has(type))) {
    return {
      type: 'svg_el',
      tag: type,
      attrs: svgAttrsFromProps(props),
      children: [],
      text: SVG_TEXT_TAGS.has(type) ? svgTextContent(props.children) : undefined,
    } as SvgElementNode;
  }
  if (type === 'box') {
    return {
      type: 'box',
      x: props.x as number | undefined,
      y: props.y as number | undefined,
      width: props.width as number | undefined,
      height: props.height as number | undefined,
      color: (props.color as string) ?? 'transparent',
      borderColor: props.borderColor as string | undefined,
      borderWidth: props.borderWidth as number | undefined,
      style: props.style as Style | undefined,
      scrollX: props.scrollX as number | undefined,
      children: [],
    } as BoxNode;
  }
  if (type === 'text') {
    const children = props.children;
    const text =
      typeof children === 'string' ? children :
      typeof children === 'number' ? String(children) :
      Array.isArray(children) ? children.join('') : '';
    return {
      type: 'text',
      x: props.x as number | undefined,
      y: props.y as number | undefined,
      color: (props.color as string) ?? 'white',
      fontSize: (props.fontSize as number) ?? 16,
      fontFamily: (props.fontFamily as string) ?? 'sans-serif',
      text,
      style: props.style as Style | undefined,
      children: [],
    } as TextNode;
  }
  if (type === 'svg_image') {
    return {
      type: 'svg_image',
      x: props.x as number | undefined,
      y: props.y as number | undefined,
      width: (props.width as number) ?? 0,
      height: (props.height as number) ?? 0,
      src: (props.src as string) ?? '',
      style: props.style as Style | undefined,
      children: [],
    } as SvgNode;
  }
  if (type === 'gif_image') {
    return {
      type: 'gif_image',
      x: props.x as number | undefined,
      y: props.y as number | undefined,
      width: (props.width as number) ?? 0,
      height: (props.height as number) ?? 0,
      style: props.style as Style | undefined,
      children: [],
    } as GifNode;
  }
  if (type === 'svg') {
    const w = props.width;
    const h = props.height;
    return {
      type: 'svg',
      x: props.x as number | undefined,
      y: props.y as number | undefined,
      width: typeof w === 'number' ? w : 0,
      height: typeof h === 'number' ? h : 0,
      style: props.style as Style | undefined,
      attrs: svgAttrsFromProps(props),
      children: [],
      svgChildren: [],
    } as SvgContainerNode;
  }
  if (SVG_TAGS.has(type)) {
    return {
      type: 'svg_el',
      tag: type,
      attrs: svgAttrsFromProps(props),
      children: [],
    } as SvgElementNode;
  }
  throw new Error(`react-drm: unknown element type "${type}". Use <Box>, <Text>, or <Svg>.`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciler = ReactReconciler({
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  noTimeout: -1,

  now: Date.now,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  getRootHostContext: () => ({ inSvg: false }),
  getChildHostContext: (parentCtx: { inSvg: boolean }, type: string) =>
    parentCtx.inSvg || type === 'svg' ? { inSvg: true } : parentCtx,
  getPublicInstance: (instance: AnyNode) => instance,

  createInstance: (type: string, props: Record<string, unknown>, _root: unknown, hostContext: { inSvg: boolean }) =>
    nodeFromProps(type, props, hostContext.inSvg),

  createTextInstance: (text: string) => {
    process.stderr.write(`react-drm: raw text "${text.trim()}" detected — wrap text in <Text>\n`);
    return { type: 'text-leaf', text, children: [] } as TextLeafNode;
  },

  appendInitialChild: (parent: AnyNode, child: AnyNode) => {
    if (parent.type === 'text-leaf') return;
    if (child.type === 'text-leaf') {
      if (parent.type === 'text') (parent as TextNode).text = child.text;
      return;
    }
    if (parent.type === 'svg') {
      (child as SvgElementNode)._parent = parent;
      (parent as SvgContainerNode).svgChildren.push(child as SvgElementNode);
      (parent as SvgContainerNode)._cachedSrc = undefined;
      return;
    }
    if (parent.type === 'svg_el') {
      (child as SvgElementNode)._parent = parent;
      (parent as SvgElementNode).children.push(child as SvgElementNode);
      return;
    }
    (parent as SceneNode).children.push(child as SceneNode);
  },

  finalizeInitialChildren: () => false,

  prepareUpdate: (
    _instance: AnyNode,
    _type: string,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ) => newProps,

  shouldSetTextContent: (type: string) => type === 'text',

  prepareForCommit: () => null,
  resetAfterCommit: (container: RootContainer) => {
    container._onCommit?.();
  },

  // Container mutations
  appendChildToContainer: (container: RootContainer, child: AnyNode) => {
    if (child.type !== 'text-leaf' && child.type !== 'svg_el') container.children.push(child as SceneNode);
  },
  insertInContainerBefore: (container: RootContainer, child: AnyNode, before: AnyNode) => {
    if (child.type === 'text-leaf' || child.type === 'svg_el') return;
    const idx = container.children.indexOf(before as SceneNode);
    container.children.splice(idx === -1 ? 0 : idx, 0, child as SceneNode);
  },
  removeChildFromContainer: (container: RootContainer, child: AnyNode) => {
    if (child.type === 'svg_el') return;
    const idx = container.children.indexOf(child as SceneNode);
    if (idx !== -1) container.children.splice(idx, 1);
  },

  // Instance mutations
  appendChild: (parent: AnyNode, child: AnyNode) => {
    if (parent.type === 'text-leaf' || child.type === 'text-leaf') return;
    if (parent.type === 'svg') {
      (child as SvgElementNode)._parent = parent;
      (parent as SvgContainerNode).svgChildren.push(child as SvgElementNode);
      (parent as SvgContainerNode)._cachedSrc = undefined;
      return;
    }
    if (parent.type === 'svg_el') {
      (child as SvgElementNode)._parent = parent;
      (parent as SvgElementNode).children.push(child as SvgElementNode);
      return;
    }
    (parent as SceneNode).children.push(child as SceneNode);
  },
  insertBefore: (parent: AnyNode, child: AnyNode, before: AnyNode) => {
    if (parent.type === 'text-leaf' || child.type === 'text-leaf') return;
    if (parent.type === 'svg') {
      (child as SvgElementNode)._parent = parent;
      const arr = (parent as SvgContainerNode).svgChildren;
      const idx = arr.indexOf(before as SvgElementNode);
      arr.splice(idx === -1 ? 0 : idx, 0, child as SvgElementNode);
      (parent as SvgContainerNode)._cachedSrc = undefined;
      return;
    }
    if (parent.type === 'svg_el') {
      (child as SvgElementNode)._parent = parent;
      const arr = (parent as SvgElementNode).children;
      const idx = arr.indexOf(before as SvgElementNode);
      arr.splice(idx === -1 ? 0 : idx, 0, child as SvgElementNode);
      return;
    }
    const arr = (parent as SceneNode).children;
    const idx = arr.indexOf(before as SceneNode);
    arr.splice(idx === -1 ? 0 : idx, 0, child as SceneNode);
  },
  removeChild: (parent: AnyNode, child: AnyNode) => {
    if (parent.type === 'text-leaf') return;
    if (parent.type === 'svg') {
      const arr = (parent as SvgContainerNode).svgChildren;
      const idx = arr.indexOf(child as SvgElementNode);
      if (idx !== -1) arr.splice(idx, 1);
      (parent as SvgContainerNode)._cachedSrc = undefined;
      return;
    }
    if (parent.type === 'svg_el') {
      const arr = (parent as SvgElementNode).children;
      const idx = arr.indexOf(child as SvgElementNode);
      if (idx !== -1) arr.splice(idx, 1);
      return;
    }
    const arr = (parent as SceneNode).children;
    const idx = arr.indexOf(child as SceneNode);
    if (idx !== -1) arr.splice(idx, 1);
  },

  commitUpdate: (
    instance: AnyNode,
    updatePayload: Record<string, unknown>,
    type: string,
  ) => {
    if (instance.type === 'text-leaf') return;
    if (instance.type === 'svg_el') {
      const el = instance as SvgElementNode;
      el.attrs = svgAttrsFromProps(updatePayload);
      if (SVG_TEXT_TAGS.has(el.tag)) el.text = svgTextContent(updatePayload.children);
      clearSvgCacheFor(el); // child attr/text changed → owning <svg> markup is stale
      return;
    }
    if (instance.type === 'svg') {
      const svgChildren = (instance as SvgContainerNode).svgChildren;
      const updated = nodeFromProps(type, updatePayload) as SvgContainerNode;
      Object.assign(instance, updated);
      (instance as SvgContainerNode).svgChildren = svgChildren;
      (instance as SvgContainerNode).children = [];
      (instance as SvgContainerNode)._cachedSrc = undefined; // invalidate cached markup
      return;
    }
    const updated = nodeFromProps(type, updatePayload);
    const children = (instance as SceneNode).children;
    Object.assign(instance, updated);
    (instance as SceneNode).children = children;
  },

  commitTextUpdate: (instance: TextLeafNode, _old: string, newText: string) => {
    instance.text = newText;
  },

  commitMount: () => {},
  resetTextContent: () => {},
  clearContainer: (container: RootContainer) => { container.children = []; },
  detachDeletedInstance: () => {},
  hideInstance: () => {},
  hideTextInstance: () => {},
  unhideInstance: () => {},
  unhideTextInstance: () => {},

  getCurrentEventPriority: () => DefaultEventPriority,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  preparePortalMount: () => {},
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);
