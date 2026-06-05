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
  if (s.width !== undefined) return s.width;
  if (node.type === 'box') return (node as BoxNode).width;
  if (node.type === 'svg_image') return (node as SvgNode).width;
  return 0;
}

function nodeHeight(node: SceneNode): number {
  const s = getStyle(node);
  if (s.height !== undefined) return s.height;
  if (node.type === 'box') return (node as BoxNode).height;
  if (node.type === 'svg_image') return (node as SvgNode).height;
  return 0;
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

  const isRow = (s.flexDirection ?? 'row') === 'row';
  const justify = s.justifyContent ?? 'flex-start';
  const align = s.alignItems ?? 'flex-start';
  const mainSize = isRow ? cw : ch;
  const crossSize = isRow ? ch : cw;
  const itemGap = isRow ? (s.columnGap ?? s.gap ?? 0) : (s.rowGap ?? s.gap ?? 0);

  const infos = children.map(child => {
    const cs = getStyle(child);
    const flexGrow = cs.flexGrow ?? 0;
    const mainBase =
      cs.flexBasis !== undefined && cs.flexBasis !== 'auto'
        ? (cs.flexBasis as number)
        : isRow ? nodeWidth(child) : nodeHeight(child);
    const crossBase = isRow ? nodeHeight(child) : nodeWidth(child);
    return { mainBase, crossBase, flexGrow };
  });

  const totalBase = infos.reduce((s, b) => s + b.mainBase, 0);
  const totalGap = (children.length - 1) * itemGap;
  const freeSpace = Math.max(0, mainSize - totalBase - totalGap);
  const totalGrow = infos.reduce((s, b) => s + b.flexGrow, 0);

  const mainSizes = infos.map(b =>
    b.flexGrow > 0 && totalGrow > 0
      ? b.mainBase + freeSpace * (b.flexGrow / totalGrow)
      : b.mainBase,
  );

  const totalUsed = mainSizes.reduce((a, b) => a + b, 0) + totalGap;
  let mainStart = 0;
  let extraGap = 0;

  if (justify === 'flex-end') {
    mainStart = mainSize - totalUsed;
  } else if (justify === 'center') {
    mainStart = (mainSize - totalUsed) / 2;
  } else if (justify === 'space-between' && children.length > 1) {
    extraGap = (mainSize - mainSizes.reduce((a, b) => a + b, 0)) / (children.length - 1);
  } else if (justify === 'space-around') {
    extraGap = (mainSize - mainSizes.reduce((a, b) => a + b, 0)) / children.length;
    mainStart = extraGap / 2;
  } else if (justify === 'space-evenly') {
    extraGap = (mainSize - mainSizes.reduce((a, b) => a + b, 0)) / (children.length + 1);
    mainStart = extraGap;
  }

  const placements: LayoutBox[] = [];
  let pos = mainStart;

  for (let i = 0; i < children.length; i++) {
    const ms = mainSizes[i];
    const cb = infos[i].crossBase;

    let crossOff: number, crossDim: number;
    switch (align) {
      case 'flex-end': crossOff = crossSize - cb; crossDim = cb; break;
      case 'center':   crossOff = (crossSize - cb) / 2; crossDim = cb; break;
      case 'stretch':  crossOff = 0; crossDim = crossSize; break;
      default:         crossOff = 0; crossDim = cb; // flex-start
    }

    placements.push(
      isRow
        ? { x: cx + pos, y: cy + crossOff, w: ms, h: crossDim }
        : { x: cx + crossOff, y: cy + pos, w: crossDim, h: ms },
    );

    pos += ms + (justify.startsWith('space') ? extraGap : itemGap);
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
  // Text nodes always use their own absolute x/y
  if (node.type === 'text') {
    results.set(node, { x: node.x, y: node.y, w: 0, h: 0 });
    return;
  }

  const s = getStyle(node);
  let x: number, y: number, w: number, h: number;

  if (placement) {
    // Parent (flex or grid) already computed our position
    ({ x, y, w, h } = placement);
    // position: relative may add an offset on top of the flex/grid placement
    if (s.position === 'relative') {
      x += s.left ?? (s.right !== undefined ? -s.right : 0);
      y += s.top  ?? (s.bottom !== undefined ? -s.bottom : 0);
    }
  } else if (s.position === 'absolute') {
    w = nodeWidth(node);
    h = nodeHeight(node);
    x = s.right !== undefined && s.left === undefined
      ? containing.x + containing.w - w - s.right
      : containing.x + (s.left ?? 0);
    y = s.bottom !== undefined && s.top === undefined
      ? containing.y + containing.h - h - s.bottom
      : containing.y + (s.top ?? 0);
  } else {
    // Legacy block: node carries its own absolute x/y
    x = node.x;
    y = node.y;
    w = nodeWidth(node);
    h = nodeHeight(node);
    if (s.position === 'relative') {
      x += s.left ?? (s.right !== undefined ? -s.right : 0);
      y += s.top  ?? (s.bottom !== undefined ? -s.bottom : 0);
    }
  }

  results.set(node, { x, y, w, h });
  if (node.type === 'svg_image') return; // no children

  const pt = s.paddingTop    ?? s.padding ?? 0;
  const pb = s.paddingBottom ?? s.padding ?? 0;
  const pl = s.paddingLeft   ?? s.padding ?? 0;
  const pr = s.paddingRight  ?? s.padding ?? 0;

  const myBox: LayoutBox = { x, y, w, h };
  const display = s.display ?? 'block';

  // Only Box and Svg participate in flex/grid; Text nodes keep absolute coords
  const isLayoutable = (c: SceneNode) => c.type === 'box' || c.type === 'svg_image';
  const flowKids = node.children.filter(c => isLayoutable(c) && getStyle(c).position !== 'absolute');
  const absKids  = node.children.filter(c => isLayoutable(c) && getStyle(c).position === 'absolute');

  if (display === 'flex') {
    const pos = computeFlex(flowKids, x + pl, y + pt, w - pl - pr, h - pt - pb, s);
    flowKids.forEach((child, i) => computeNode(child, pos[i], myBox, results));
  } else if (display === 'grid') {
    const pos = computeGrid(flowKids, x + pl, y + pt, w - pl - pr, h - pt - pb, s);
    flowKids.forEach((child, i) => computeNode(child, pos[i], myBox, results));
  } else {
    flowKids.forEach(child => computeNode(child, null, myBox, results));
  }

  // Absolute children are positioned relative to this node's box
  absKids.forEach(child => computeNode(child, null, myBox, results));

  // Text children always traverse for their subtrees (none, but keeps code consistent)
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
