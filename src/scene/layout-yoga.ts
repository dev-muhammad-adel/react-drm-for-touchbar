import type { SceneNode, BoxNode, SvgNode, SvgContainerNode, TextNode, RootContainer } from './types';
import type { Style } from './style';
import type { LayoutBox } from './layout';
import { measureText } from './layout';

/**
 * Yoga-backed layout engine, selected with REACT_DRM_LAYOUT=yoga.
 *
 * Mirrors the legacy engine's semantics, which differ from CSS defaults:
 * - flexDirection defaults to 'row', alignItems to 'stretch'
 * - items never shrink (flexShrink is always 0)
 * - `flex: N` means grow N with flexBasis 0
 * - position:absolute (or x/y props) sizes to the explicit width/height, not
 *   to content — unspecified dimensions are 0
 * - root children and display:'block' children fill their containing box
 *   unless they have explicit dimensions
 * - display:'grid' is not supported here; computeLayoutYoga throws and the
 *   caller falls back to the legacy engine for the whole tree
 *
 * yoga-layout is ESM with top-level await, so it can't be required from this
 * CJS build — callers must loadYogaEngine() (dynamic import) before use.
 */

type Yoga = Awaited<typeof import('yoga-layout')>['default'];
type YogaNode = ReturnType<Yoga['Node']['create']>;

let Y: Yoga | null = null;
let yogaConfig: ReturnType<Yoga['Config']['create']> | null = null;

export async function loadYogaEngine(): Promise<void> {
  if (!Y) {
    Y = (await import('yoga-layout')).default;
    // Legacy produces fractional positions; disable yoga's pixel-grid
    // rounding so both engines emit identical coordinates.
    yogaConfig = Y.Config.create();
    yogaConfig.setPointScaleFactor(0);
  }
}

export function yogaReady(): boolean {
  return Y !== null;
}

function getStyle(node: SceneNode): Style {
  if (node.type === 'box' || node.type === 'svg_image' || node.type === 'svg') {
    return (node as BoxNode | SvgNode | SvgContainerNode).style ?? {};
  }
  return {};
}

function explicitWidth(node: SceneNode): number | undefined {
  const s = getStyle(node);
  if (s.width !== undefined) return s.width;
  if (node.type === 'box')       return (node as BoxNode).width;
  if (node.type === 'svg_image') return (node as SvgNode).width;
  if (node.type === 'svg')       return (node as SvgContainerNode).width;
  return undefined;
}

function explicitHeight(node: SceneNode): number | undefined {
  const s = getStyle(node);
  if (s.height !== undefined) return s.height;
  if (node.type === 'box')       return (node as BoxNode).height;
  if (node.type === 'svg_image') return (node as SvgNode).height;
  if (node.type === 'svg')       return (node as SvgContainerNode).height;
  return undefined;
}

function isLayoutable(c: SceneNode): boolean {
  return c.type === 'box' || c.type === 'svg_image' || c.type === 'svg' || c.type === 'text';
}

function isAbsolute(node: SceneNode): boolean {
  const s = getStyle(node);
  if (s.position === 'absolute') return true;
  return (node as BoxNode).x !== undefined || (node as BoxNode).y !== undefined;
}

const JUSTIFY = () => ({
  'flex-start':    Y!.JUSTIFY_FLEX_START,
  'flex-end':      Y!.JUSTIFY_FLEX_END,
  'center':        Y!.JUSTIFY_CENTER,
  'space-between': Y!.JUSTIFY_SPACE_BETWEEN,
  'space-around':  Y!.JUSTIFY_SPACE_AROUND,
  'space-evenly':  Y!.JUSTIFY_SPACE_EVENLY,
} as const);

const ALIGN = () => ({
  'flex-start': Y!.ALIGN_FLEX_START,
  'flex-end':   Y!.ALIGN_FLEX_END,
  'center':     Y!.ALIGN_CENTER,
  'stretch':    Y!.ALIGN_STRETCH,
} as const);

/** Pairs a scene node with its yoga node so results can be read back. */
interface Built {
  scene: SceneNode;
  yoga:  YogaNode;
  children: Built[];
}

/** Cross axis a stretching parent imposes on this node, if any. */
type StretchAxis = 'horizontal' | 'vertical' | null;

function applyCommonStyle(yn: YogaNode, node: SceneNode, stretch: StretchAxis): void {
  const s = getStyle(node);
  const yoga = Y!;

  const w = explicitWidth(node);
  const h = explicitHeight(node);
  // Legacy quirk: a stretching parent overrides the child's explicit
  // cross-axis size entirely — drop it so yoga stretches the same way.
  if (w !== undefined && stretch !== 'horizontal') yn.setWidth(w);
  if (h !== undefined && stretch !== 'vertical')   yn.setHeight(h);
  if (s.minWidth  !== undefined) yn.setMinWidth(s.minWidth);
  if (s.maxWidth  !== undefined) yn.setMaxWidth(s.maxWidth);
  if (s.minHeight !== undefined) yn.setMinHeight(s.minHeight);
  if (s.maxHeight !== undefined) yn.setMaxHeight(s.maxHeight);

  yn.setMargin(yoga.EDGE_LEFT,   s.marginLeft   ?? s.marginHorizontal ?? s.margin ?? 0);
  yn.setMargin(yoga.EDGE_RIGHT,  s.marginRight  ?? s.marginHorizontal ?? s.margin ?? 0);
  yn.setMargin(yoga.EDGE_TOP,    s.marginTop    ?? s.marginVertical   ?? s.margin ?? 0);
  yn.setMargin(yoga.EDGE_BOTTOM, s.marginBottom ?? s.marginVertical   ?? s.margin ?? 0);

  yn.setPadding(yoga.EDGE_LEFT,   s.paddingLeft   ?? s.paddingHorizontal ?? s.padding ?? 0);
  yn.setPadding(yoga.EDGE_RIGHT,  s.paddingRight  ?? s.paddingHorizontal ?? s.padding ?? 0);
  yn.setPadding(yoga.EDGE_TOP,    s.paddingTop    ?? s.paddingVertical   ?? s.padding ?? 0);
  yn.setPadding(yoga.EDGE_BOTTOM, s.paddingBottom ?? s.paddingVertical   ?? s.padding ?? 0);

  // Container props — legacy defaults: row + stretch.
  yn.setFlexDirection(s.flexDirection === 'column' ? yoga.FLEX_DIRECTION_COLUMN : yoga.FLEX_DIRECTION_ROW);
  yn.setJustifyContent(JUSTIFY()[s.justifyContent ?? 'flex-start']);
  yn.setAlignItems(ALIGN()[s.alignItems ?? 'stretch']);
  yn.setGap(yoga.GUTTER_COLUMN, s.columnGap ?? s.gap ?? 0);
  yn.setGap(yoga.GUTTER_ROW,    s.rowGap    ?? s.gap ?? 0);

  // Item props — legacy never shrinks.
  yn.setFlexShrink(0);
  const grow = s.flexGrow ?? (s.flex !== undefined ? s.flex : 0);
  if (grow > 0) yn.setFlexGrow(grow);
  if (s.flexBasis !== undefined && s.flexBasis !== 'auto') {
    yn.setFlexBasis(s.flexBasis);
  } else if (s.flex !== undefined && s.flexBasis === undefined) {
    yn.setFlexBasis(0); // `flex: N` shorthand
  }
  if (s.alignSelf && s.alignSelf !== 'auto') yn.setAlignSelf(ALIGN()[s.alignSelf]);

  if (isAbsolute(node)) {
    yn.setPositionType(yoga.POSITION_TYPE_ABSOLUTE);
    // Legacy: right/bottom only apply when left/top are unset; x/y props are
    // the fallback offsets.
    if (s.left !== undefined)        yn.setPosition(yoga.EDGE_LEFT, s.left);
    else if (s.right !== undefined)  yn.setPosition(yoga.EDGE_RIGHT, s.right);
    else                             yn.setPosition(yoga.EDGE_LEFT, (node as BoxNode).x ?? 0);
    if (s.top !== undefined)         yn.setPosition(yoga.EDGE_TOP, s.top);
    else if (s.bottom !== undefined) yn.setPosition(yoga.EDGE_BOTTOM, s.bottom);
    else                             yn.setPosition(yoga.EDGE_TOP, (node as BoxNode).y ?? 0);
    // Legacy sizes absolutes to their explicit dimensions only — never content.
    if (w === undefined && node.type !== 'text') yn.setWidth(0);
    if (h === undefined && node.type !== 'text') yn.setHeight(0);
  } else if (s.position === 'relative') {
    yn.setPosition(yoga.EDGE_LEFT, s.left ?? (s.right !== undefined ? -s.right : 0));
    yn.setPosition(yoga.EDGE_TOP,  s.top  ?? (s.bottom !== undefined ? -s.bottom : 0));
  }
}

/** Legacy root children and display:'block' children fill the containing box. */
function applyFillContaining(yn: YogaNode, node: SceneNode): void {
  const yoga = Y!;
  yn.setPositionType(yoga.POSITION_TYPE_ABSOLUTE);
  yn.setPosition(yoga.EDGE_LEFT, 0);
  yn.setPosition(yoga.EDGE_TOP, 0);
  if (explicitWidth(node)  === undefined && node.type !== 'text') yn.setWidthPercent(100);
  if (explicitHeight(node) === undefined && node.type !== 'text') yn.setHeightPercent(100);
}

function buildNode(node: SceneNode, fillContaining: boolean, stretch: StretchAxis): Built | null {
  const s = getStyle(node);
  if (s.display === 'none') return null;
  if (s.display === 'grid') throw new Error('yoga layout: display:grid is not supported');

  const yn = Y!.Node.create(yogaConfig!);
  const built: Built = { scene: node, yoga: yn, children: [] };

  if (node.type === 'text') {
    const { w, h } = measureText(node as TextNode);
    if (stretch !== 'horizontal') yn.setWidth(w);
    if (stretch !== 'vertical')   yn.setHeight(h);
    const tn = node as TextNode;
    if (tn.style?.position === 'absolute' || tn.x !== undefined || tn.y !== undefined) {
      yn.setPositionType(Y!.POSITION_TYPE_ABSOLUTE);
      yn.setPosition(Y!.EDGE_LEFT, tn.style?.left ?? tn.x ?? 0);
      yn.setPosition(Y!.EDGE_TOP,  tn.style?.top  ?? tn.y ?? 0);
    }
    yn.setFlexShrink(0);
    return built;
  }

  applyCommonStyle(yn, node, stretch);
  if (fillContaining && !isAbsolute(node)) applyFillContaining(yn, node);

  // svg / svg_image are layout leaves.
  if (node.type === 'svg_image' || node.type === 'svg') return built;

  const childFill = s.display === 'block';
  const crossAxis: 'horizontal' | 'vertical' =
    (s.flexDirection ?? 'row') === 'row' ? 'vertical' : 'horizontal';
  for (const child of (node as BoxNode).children) {
    if (!isLayoutable(child)) continue;
    // Resolve whether this flex container stretches the child's cross axis.
    const cs = getStyle(child);
    const align = (cs.alignSelf && cs.alignSelf !== 'auto') ? cs.alignSelf : (s.alignItems ?? 'stretch');
    const childStretch: StretchAxis =
      !childFill && (s.display ?? 'flex') === 'flex' && align === 'stretch' && !isAbsolute(child)
        ? crossAxis
        : null;
    const builtChild = buildNode(child, childFill, childStretch);
    if (builtChild) {
      yn.insertChild(builtChild.yoga, yn.getChildCount());
      built.children.push(builtChild);
    }
  }
  return built;
}

function collect(built: Built, parentX: number, parentY: number, results: Map<SceneNode, LayoutBox>): void {
  const x = parentX + built.yoga.getComputedLeft();
  const y = parentY + built.yoga.getComputedTop();
  results.set(built.scene, { x, y, w: built.yoga.getComputedWidth(), h: built.yoga.getComputedHeight() });
  for (const child of built.children) collect(child, x, y, results);
}

export function computeLayoutYoga(
  root: RootContainer,
  screenW: number,
  screenH: number,
): Map<SceneNode, LayoutBox> {
  if (!Y) throw new Error('yoga layout: call loadYogaEngine() first');

  const yogaRoot = Y.Node.create(yogaConfig!);
  yogaRoot.setWidth(screenW);
  yogaRoot.setHeight(screenH);

  const tops: Built[] = [];
  try {
    for (const child of root.children) {
      if (!isLayoutable(child)) continue;
      const built = buildNode(child, true, null); // root children fill the screen
      if (built) {
        yogaRoot.insertChild(built.yoga, yogaRoot.getChildCount());
        tops.push(built);
      }
    }

    yogaRoot.calculateLayout(screenW, screenH, Y.DIRECTION_LTR);

    const results = new Map<SceneNode, LayoutBox>();
    for (const built of tops) collect(built, 0, 0, results);
    return results;
  } finally {
    yogaRoot.freeRecursive();
  }
}
