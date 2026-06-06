import type { SceneNode, BoxNode, SvgNode, RootContainer } from './types';
import type { Style } from './style';

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function getStyle(node: SceneNode): Style {
  if (node.type === 'box' || node.type === 'svg_image') {
    return (node as BoxNode | SvgNode).style ?? {};
  }
  return {};
}

function nodeWidth(node: SceneNode): number {
  const s = getStyle(node);
  let w = s.width !== undefined ? s.width
        : node.type === 'box' ? (node as BoxNode).width
        : node.type === 'svg_image' ? (node as SvgNode).width
        : 0;
  if (s.minWidth !== undefined) w = Math.max(w, s.minWidth);
  if (s.maxWidth !== undefined) w = Math.min(w, s.maxWidth);
  return w;
}

function nodeHeight(node: SceneNode): number {
  const s = getStyle(node);
  let h = s.height !== undefined ? s.height
        : node.type === 'box' ? (node as BoxNode).height
        : node.type === 'svg_image' ? (node as SvgNode).height
        : 0;
  if (s.minHeight !== undefined) h = Math.max(h, s.minHeight);
  if (s.maxHeight !== undefined) h = Math.min(h, s.maxHeight);
  return h;
}

// Expand "repeat(N, track)" and split into tokens
function expandTrack(template: string): string[] {
  const expanded = template.replace(
    /repeat\(\s*(\d+)\s*,\s*([^)]+?)\s*\)/g,
    (_, n, v) => Array.from({ length: parseInt(n, 10) }, () => (v as string).trim()).join(' '),
  );
  return expanded.trim().split(/\s+/);
}

function resolveTrackSizes(tokens: string[], available: number): number[] {
  let usedFixed = 0;
  let totalFr = 0;
  const fr = tokens.map(t => t.endsWith('fr'));
  const vals = tokens.map(t => parseFloat(t));
  for (let i = 0; i < tokens.length; i++) {
    if (fr[i]) totalFr += vals[i]; else usedFixed += vals[i];
  }
  const frUnit = totalFr > 0 ? Math.max(0, available - usedFixed) / totalFr : 0;
  return vals.map((v, i) => (fr[i] ? v * frUnit : v));
}

function computeFlex(
  children: SceneNode[],
  cx: number, cy: number, cw: number, ch: number,
  s: Style,
): LayoutBox[] {
  if (children.length === 0) return [];

  const isRow       = (s.flexDirection ?? 'row') === 'row';
  const justify     = s.justifyContent ?? 'flex-start';
  const parentAlign = s.alignItems ?? 'flex-start';
  const mainSize    = isRow ? cw : ch;
  const crossSize   = isRow ? ch : cw;
  const itemGap     = isRow ? (s.columnGap ?? s.gap ?? 0) : (s.rowGap ?? s.gap ?? 0);

  type Info = {
    flexGrow: number;
    innerMain: number;
    innerCross: number;
    mMainA: number;  // leading margin in main axis
    mMainB: number;  // trailing margin in main axis
    mCrossA: number; // leading margin in cross axis
    mCrossB: number; // trailing margin in cross axis
  };

  const infos: Info[] = children.map(child => {
    const cs = getStyle(child);
    const ml = cs.marginLeft  ?? cs.marginHorizontal ?? cs.margin ?? 0;
    const mr = cs.marginRight ?? cs.marginHorizontal ?? cs.margin ?? 0;
    const mt = cs.marginTop   ?? cs.marginVertical   ?? cs.margin ?? 0;
    const mb = cs.marginBottom ?? cs.marginVertical  ?? cs.margin ?? 0;

    // flex: N shorthand → flexGrow=N, flexBasis=0
    const flexGrow = cs.flexGrow ?? (cs.flex !== undefined ? cs.flex : 0);
    const hasFlex  = cs.flex !== undefined && cs.flexBasis === undefined;
    const innerMain =
      cs.flexBasis !== undefined && cs.flexBasis !== 'auto' ? (cs.flexBasis as number)
      : hasFlex ? 0
      : isRow ? nodeWidth(child) : nodeHeight(child);
    const innerCross = isRow ? nodeHeight(child) : nodeWidth(child);

    return {
      flexGrow,
      innerMain,
      innerCross,
      mMainA:  isRow ? ml : mt,
      mMainB:  isRow ? mr : mb,
      mCrossA: isRow ? mt : ml,
      mCrossB: isRow ? mb : mr,
    };
  });

  // Space distribution uses outer main sizes (inner + margins)
  const outerMains = infos.map(b => b.innerMain + b.mMainA + b.mMainB);
  const totalBase  = outerMains.reduce((a, b) => a + b, 0);
  const totalGap   = (children.length - 1) * itemGap;
  const freeSpace  = Math.max(0, mainSize - totalBase - totalGap);
  const totalGrow  = infos.reduce((a, b) => a + b.flexGrow, 0);

  // Distribute free space into inner main sizes via flex-grow
  const innerMainSizes = infos.map(b =>
    b.flexGrow > 0 && totalGrow > 0
      ? b.innerMain + freeSpace * (b.flexGrow / totalGrow)
      : b.innerMain,
  );
  const outerMainSizes = infos.map((b, i) => innerMainSizes[i] + b.mMainA + b.mMainB);

  const totalUsed = outerMainSizes.reduce((a, b) => a + b, 0) + totalGap;
  let mainStart = 0;
  let extraGap  = 0;

  if (justify === 'flex-end') {
    mainStart = mainSize - totalUsed;
  } else if (justify === 'center') {
    mainStart = (mainSize - totalUsed) / 2;
  } else if (justify === 'space-between' && children.length > 1) {
    extraGap = (mainSize - outerMainSizes.reduce((a, b) => a + b, 0)) / (children.length - 1);
  } else if (justify === 'space-around') {
    extraGap  = (mainSize - outerMainSizes.reduce((a, b) => a + b, 0)) / children.length;
    mainStart = extraGap / 2;
  } else if (justify === 'space-evenly') {
    extraGap  = (mainSize - outerMainSizes.reduce((a, b) => a + b, 0)) / (children.length + 1);
    mainStart = extraGap;
  }

  const placements: LayoutBox[] = [];
  let pos = mainStart;

  for (let i = 0; i < children.length; i++) {
    const ims = innerMainSizes[i];
    const oms = outerMainSizes[i];
    const { innerCross, mMainA, mCrossA, mCrossB } = infos[i];

    // alignSelf overrides parent alignItems for this child
    const cs = getStyle(children[i]);
    const align = (cs.alignSelf && cs.alignSelf !== 'auto') ? cs.alignSelf : parentAlign;
    const availCross = crossSize - mCrossA - mCrossB;

    let crossOff: number, crossDim: number;
    switch (align) {
      case 'flex-end': crossOff = availCross - innerCross; crossDim = innerCross; break;
      case 'center':   crossOff = (availCross - innerCross) / 2; crossDim = innerCross; break;
      case 'stretch':  crossOff = 0; crossDim = availCross; break;
      default:         crossOff = 0; crossDim = innerCross; // flex-start
    }

    placements.push(
      isRow
        ? { x: cx + pos + mMainA, y: cy + mCrossA + crossOff, w: ims, h: crossDim }
        : { x: cx + mCrossA + crossOff, y: cy + pos + mMainA, w: crossDim, h: ims },
    );

    pos += oms + (justify.startsWith('space') ? extraGap : itemGap);
  }

  return placements;
}

function computeGrid(
  children: SceneNode[],
  cx: number, cy: number, cw: number, ch: number,
  s: Style,
): LayoutBox[] {
  if (children.length === 0) return [];

  const colGap = s.columnGap ?? s.gap ?? 0;
  const rowGap = s.rowGap ?? s.gap ?? 0;

  const colTokens = expandTrack(s.gridTemplateColumns ?? `repeat(${children.length}, 1fr)`);
  const numCols = colTokens.length;
  const colSizes = resolveTrackSizes(colTokens, cw - (numCols - 1) * colGap);

  const numRows = Math.ceil(children.length / numCols);
  let rowSizes: number[];

  if (s.gridTemplateRows) {
    const rowTokens = expandTrack(s.gridTemplateRows);
    rowSizes = resolveTrackSizes(rowTokens, ch - (rowTokens.length - 1) * rowGap);
    while (rowSizes.length < numRows) rowSizes.push(rowSizes[rowSizes.length - 1] ?? 0);
  } else {
    const rowH = numRows > 0 ? (ch - (numRows - 1) * rowGap) / numRows : 0;
    rowSizes = Array(numRows).fill(rowH);
  }

  // Precompute track offsets
  const colOff = colSizes.reduce<number[]>(
    (acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1] + colSizes[i - 1] + colGap], [],
  );
  const rowOff = rowSizes.reduce<number[]>(
    (acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1] + rowSizes[i - 1] + rowGap], [],
  );

  const grid = Array.from({ length: numRows }, () => new Array<boolean>(numCols).fill(false));
  const placements = new Array<LayoutBox>(children.length);

  // Explicit gridColumn/gridRow first
  children.forEach((child, idx) => {
    const cs = getStyle(child);
    if (cs.gridColumn !== undefined && cs.gridRow !== undefined) {
      const col = parseInt(String(cs.gridColumn), 10) - 1;
      const row = parseInt(String(cs.gridRow), 10) - 1;
      if (row >= 0 && row < numRows && col >= 0 && col < numCols) {
        placements[idx] = {
          x: cx + colOff[col], y: cy + rowOff[row],
          w: colSizes[col],    h: rowSizes[row],
        };
        grid[row][col] = true;
      }
    }
  });

  // Auto-flow remaining
  let ar = 0, ac = 0;
  children.forEach((_child, idx) => {
    if (placements[idx] !== undefined) return;
    while (ar < numRows && grid[ar][ac]) {
      if (++ac >= numCols) { ac = 0; ar++; }
    }
    if (ar >= numRows) { placements[idx] = { x: cx, y: cy, w: 0, h: 0 }; return; }
    placements[idx] = {
      x: cx + colOff[ac], y: cy + rowOff[ar],
      w: colSizes[ac],    h: rowSizes[ar],
    };
    grid[ar][ac] = true;
    if (++ac >= numCols) { ac = 0; ar++; }
  });

  return placements;
}

function computeNode(
  node: SceneNode,
  placement: LayoutBox | null,
  containing: LayoutBox,
  results: Map<SceneNode, LayoutBox>,
): void {
  const s = getStyle(node);

  // display:none — skip entirely (no layout, no children)
  if (s.display === 'none') return;

  // Text: x/y are always relative to the containing layout box.
  if (node.type === 'text') {
    results.set(node, { x: containing.x + (node.x ?? 0), y: containing.y + (node.y ?? 0), w: 0, h: 0 });
    return;
  }

  let x: number, y: number, w: number, h: number;

  // An element with explicit x or y is absolutely positioned (like CSS position:absolute).
  const isExplicitlyPositioned = s.position === 'absolute' || node.x !== undefined || node.y !== undefined;

  if (placement && !isExplicitlyPositioned) {
    // Flex/grid placed this element — use the computed slot.
    ({ x, y, w, h } = placement);
    if (s.position === 'relative') {
      x += s.left ?? (s.right !== undefined ? -s.right : 0);
      y += s.top  ?? (s.bottom !== undefined ? -s.bottom : 0);
    }
  } else if (isExplicitlyPositioned) {
    // x/y props or position:absolute — positioned relative to containing box.
    w = nodeWidth(node);
    h = nodeHeight(node);
    x = s.right !== undefined && s.left === undefined
      ? containing.x + containing.w - w - s.right
      : containing.x + (s.left ?? node.x ?? 0);
    y = s.bottom !== undefined && s.top === undefined
      ? containing.y + containing.h - h - s.bottom
      : containing.y + (s.top ?? node.y ?? 0);
  } else {
    // In-flow with no flex parent (e.g. block container): placed at containing origin.
    x = containing.x;
    y = containing.y;
    w = nodeWidth(node);
    h = nodeHeight(node);
  }

  // Apply min/max constraints
  if (s.minWidth  !== undefined) w = Math.max(w, s.minWidth);
  if (s.maxWidth  !== undefined) w = Math.min(w, s.maxWidth);
  if (s.minHeight !== undefined) h = Math.max(h, s.minHeight);
  if (s.maxHeight !== undefined) h = Math.min(h, s.maxHeight);

  results.set(node, { x, y, w, h });
  if (node.type === 'svg_image') return; // no children

  // Padding shorthands: paddingHorizontal / paddingVertical
  const pt = s.paddingTop    ?? s.paddingVertical   ?? s.padding ?? 0;
  const pb = s.paddingBottom ?? s.paddingVertical   ?? s.padding ?? 0;
  const pl = s.paddingLeft   ?? s.paddingHorizontal ?? s.padding ?? 0;
  const pr = s.paddingRight  ?? s.paddingHorizontal ?? s.padding ?? 0;

  const myBox: LayoutBox = { x, y, w, h };
  // Default display is 'flex' (every Box is a flex container, like React Native)
  const display = s.display ?? 'flex';

  const isLayoutable    = (c: SceneNode) => c.type === 'box' || c.type === 'svg_image';
  // Elements with explicit x/y or position:absolute are out of flow.
  const isAbsoluteChild = (c: SceneNode) => {
    const cs = getStyle(c);
    if (cs.position === 'absolute') return true;
    if (c.type === 'box')       return c.x !== undefined || c.y !== undefined;
    if (c.type === 'svg_image') return c.x !== undefined || c.y !== undefined;
    return false;
  };

  const flowKids = node.children.filter(c => isLayoutable(c) && !isAbsoluteChild(c) && getStyle(c).display !== 'none');
  const absKids  = node.children.filter(c => isLayoutable(c) &&  isAbsoluteChild(c) && getStyle(c).display !== 'none');

  if (display === 'flex') {
    const pos = computeFlex(flowKids, x + pl, y + pt, w - pl - pr, h - pt - pb, s);
    flowKids.forEach((child, i) => computeNode(child, pos[i], myBox, results));
  } else if (display === 'grid') {
    const pos = computeGrid(flowKids, x + pl, y + pt, w - pl - pr, h - pt - pb, s);
    flowKids.forEach((child, i) => computeNode(child, pos[i], myBox, results));
  } else {
    // display:'block' — children inherit containing box, each stacks at origin
    flowKids.forEach(child => computeNode(child, null, myBox, results));
  }

  // Absolute children are positioned relative to this node's box
  absKids.forEach(child => computeNode(child, null, myBox, results));

  // Text children: always relative to their parent's computed box
  node.children
    .filter(c => c.type === 'text')
    .forEach(child => computeNode(child, null, myBox, results));
}

export function computeLayout(
  root: RootContainer,
  screenW: number,
  screenH: number,
): Map<SceneNode, LayoutBox> {
  const results = new Map<SceneNode, LayoutBox>();
  const rootBox: LayoutBox = { x: 0, y: 0, w: screenW, h: screenH };
  for (const child of root.children) {
    computeNode(child, null, rootBox, results);
  }
  return results;
}
