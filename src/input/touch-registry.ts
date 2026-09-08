import { createContext } from 'react';
import type { BoxNode, RootContainer, SceneNode } from '../scene/types';
import { createLogger } from '../logger';

const touchLog   = createLogger('touch');
const touchDebug = process.env.REACT_DRM_LOG_LEVEL === 'debug';

export interface GestureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Scene box this region belongs to — lets the registry hit-test in true paint (z) order. */
  node?: BoxNode;
  /** Called at touch time to get current bounds — use this for flex-positioned elements. */
  getBounds?: () => { x: number; y: number; width: number; height: number };
  /** Extra pixels to expand the hit area on each side. */
  hitSlop?: number;
  onClick?:      () => void;
  onTouchStart?: (x: number, y: number) => void;
  onTouchMove?:  (x: number, y: number) => void;
  onTouchEnd?:   (x: number, y: number) => void;
  /** Gesture became a drag/scroll — reset pressed visuals, no tap will fire. */
  onTouchCancel?: () => void;
}

export interface TapRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  handler: () => void;
}

export interface SwipeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  onSwipeLeft?:  (dx: number) => void;
  onSwipeRight?: (dx: number) => void;
  /** Minimum horizontal travel to count as a swipe. Default: 80. */
  threshold?: number;
  // Real-time scroll — set onScrollMove to opt in; disables discrete swipe callbacks
  onScrollStart?: () => void;
  /** dx = total horizontal displacement from drag start (positive = finger moved right) */
  onScrollMove?:  (dx: number) => void;
  /** velocityX = signed px/frame (~60fps) at release, for momentum */
  onScrollEnd?:   (velocityX: number) => void;
}

// Kept as alias so existing code doesn't need changes
export type Region = TapRegion;

export class TouchRegistry {
  private regions      = new Map<symbol, GestureRegion>();
  private swipeRegions = new Map<symbol, SwipeRegion>();

  private activeRegion:    GestureRegion | null = null;
  private touchOrigin:     { x: number; y: number } | null = null;
  private shiftX  = 0;
  private shiftY  = 0;
  private locked  = false;

  constructor(private readonly getRoot: () => RootContainer | null = () => null) {}

  // Scroll gesture tracking
  private activeScrollKey:  symbol | null = null;
  private scrollStartX      = 0;
  private prevScrollX       = 0;
  private prevScrollTime    = 0;
  private lastScrollX       = 0;
  private lastScrollTime    = 0;

  /** Keep in sync with the pixel-shift orbit so hit-tests use layout coordinates. */
  setShift(dx: number, dy: number): void { this.shiftX = dx; this.shiftY = dy; }

  /** Block new gesture starts (e.g. during layer transitions). */
  setLocked(v: boolean): void { this.locked = v; }

  // ── Tap regions (backward compat) ──────────────────────────────────────────

  register(id: symbol, region: TapRegion): void {
    this.regions.set(id, {
      x: region.x, y: region.y, width: region.width, height: region.height,
      onClick: region.handler,
    });
  }

  unregister(id: symbol): void { this.regions.delete(id); }

  // ── Gesture regions ────────────────────────────────────────────────────────

  registerGesture(id: symbol, region: GestureRegion): void {
    this.regions.set(id, region);
  }

  unregisterGesture(id: symbol): void { this.regions.delete(id); }

  // ── Swipe regions ──────────────────────────────────────────────────────────

  registerSwipe(id: symbol, region: SwipeRegion): void {
    this.swipeRegions.set(id, region);
  }

  unregisterSwipe(id: symbol): void { this.swipeRegions.delete(id); }

  // ── Touch lifecycle ────────────────────────────────────────────────────────

  touchStart(x: number, y: number): void {
    if (this.locked) return;
    // Undo pixel shift so hit-test coordinates match unshifted layout positions.
    const lx = x - this.shiftX;
    const ly = y - this.shiftY;
    this.touchOrigin     = { x: lx, y: ly };
    this.activeRegion    = null;
    this.activeScrollKey = null;

    // Hit-test from the display top down in TRUE paint (z) order, mirroring the
    // serializer: at each box, children paint as [negative-z absolutes (z asc)],
    // then flow (tree order), then non-negative-z absolutes (z asc) — so the
    // topmost element is the last one painted. The scene tree, not registration
    // order, decides: a layer mounting later (e.g. a media list toggled on top
    // of the control cluster) still sits *under* an earlier-mounting absolutely
    // positioned panel that is painted above it, so the panel must win.
    const root    = this.getRoot();
    const byNode  = new Map<BoxNode, GestureRegion>();
    const noNode: GestureRegion[] = [];
    for (const r of this.regions.values()) {
      if (r.node) byNode.set(r.node, r);
      else noNode.push(r);
    }

    const paths = touchDebug ? debugPaths(root) : undefined;
    if (touchDebug) {
      touchLog.debug(
        `tap (${lx.toFixed(1)}, ${ly.toFixed(1)}) shift=(${this.shiftX}, ${this.shiftY}) ` +
        `regions=${this.regions.size} swipe=${this.swipeRegions.size}` +
        (root ? ` root children=${root.children.length}` : ' no-root'),
      );
      for (const [i, r] of [...this.regions.values()].entries()) {
        const b = safeBounds(r);
        const p = r.node && paths ? paths.get(r.node) : '(fixed)';
        touchLog.debug(
          `  #${i} ${p} '${r.node && p ? nodeLabel(r.node, p) : ''}' ` +
          `bounds=${b ? `(${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.width.toFixed(1)}x${b.height.toFixed(1)})` : '?'} ` +
          `hit=${b ? hits(r, lx, ly) : '-'}`,
        );
      }
    }

    let region: GestureRegion | undefined;
    if (root) {
      const found = hitTestScene(root, byNode, lx, ly, (n, r, hit) => {
        if (touchDebug && paths) {
          const b = r ? safeBounds(r) : undefined;
          touchLog.debug(
            `    visit ${nodeLabel(n, paths.get(n) ?? '?')} ` +
            `region=${r ? 'yes' : 'no'} ` +
            `bounds=${b ? `(${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.width.toFixed(1)}x${b.height.toFixed(1)})` : '?'} ` +
            `hit=${hit}`,
          );
        }
      });
      region = found;
      if (!region) region = firstHitting(noNode, lx, ly);
    } else {
      // No scene tree available (standalone use) — fall back to order heuristics.
      region = firstHitting([...this.regions.values()], lx, ly);
    }
    if (touchDebug) {
      touchLog.debug(`  => ${region ? `${winnerLabel(region, paths)} wins` : 'NO REGION'}`);
    }
    if (region) {
      this.activeRegion = region;
      region.onTouchStart?.(lx, ly);
    }

    // Find scroll region (regions with onScrollMove get live tracking instead of discrete swipes)
    for (const [key, r] of this.swipeRegions.entries()) {
      if (!r.onScrollMove) continue;
      if (lx >= r.x && lx < r.x + r.width) {
        this.activeScrollKey = key;
        this.scrollStartX    = lx;
        this.prevScrollX     = lx;
        this.prevScrollTime  = Date.now();
        this.lastScrollX     = lx;
        this.lastScrollTime  = Date.now();
        r.onScrollStart?.();
        break;
      }
    }
  }

  touchMove(x: number, y: number): void {
    const lx = x - this.shiftX;
    const ly = y - this.shiftY;

    if (touchDebug) {
      touchLog.debug(
        `move (${lx.toFixed(1)}, ${ly.toFixed(1)}) active=${this.activeRegion ? winnerLabel(this.activeRegion, debugPaths(this.getRoot())) : 'none'}` +
        (this.activeScrollKey !== null ? ' scrolling' : ''),
      );
    }

    // Cancel pending taps once the finger travels — a drag (scroll/swipe) must not
    // click the button it started on. Regions with their own onTouchMove are
    // drag-intent (sliders) and keep tracking.
    if (this.activeRegion?.onClick && !this.activeRegion.onTouchMove && this.touchOrigin) {
      const moved = Math.hypot(lx - this.touchOrigin.x, ly - this.touchOrigin.y);
      if (moved > 12) {
        const r = this.activeRegion;
        this.activeRegion = null;
        if (touchDebug) touchLog.debug(`  drag>12px -> cancel tap on ${winnerLabel(r, debugPaths(this.getRoot()))}`);
        if (r.onTouchCancel) r.onTouchCancel();
        else r.onTouchEnd?.(lx, ly); // legacy regions reset pressed state here
      }
    }

    this.activeRegion?.onTouchMove?.(lx, ly);

    if (this.activeScrollKey !== null) {
      const r = this.swipeRegions.get(this.activeScrollKey);
      if (r?.onScrollMove) {
        this.prevScrollX    = this.lastScrollX;
        this.prevScrollTime = this.lastScrollTime;
        this.lastScrollX    = lx;
        this.lastScrollTime = Date.now();
        r.onScrollMove(lx - this.scrollStartX);
      }
    }
  }

  touchEnd(x: number, y: number): void {
    const lx = x - this.shiftX;
    const ly = y - this.shiftY;
    const region = this.activeRegion;
    if (touchDebug) {
      touchLog.debug(
        `end (${lx.toFixed(1)}, ${ly.toFixed(1)})` +
        (region ? ` active=${winnerLabel(region, debugPaths(this.getRoot()))}` : ' active=none'),
      );
    }
    region?.onTouchEnd?.(lx, ly);
    this.activeRegion = null;

    // Fire tap only if the finger lifted within the button's bounds — prevents
    // accidental triggers when sliding across the bar.
    if (region) {
      const b    = region.getBounds?.() ?? region;
      const slop = region.hitSlop ?? 8;
      const inside = lx >= b.x - slop && lx < b.x + b.width + slop;
      if (touchDebug) touchLog.debug(`  tap in-bounds=${inside} b=(${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.width.toFixed(1)}x${b.height.toFixed(1)}) slop=${slop}`);
      if (inside) {
        region.onClick?.();
      }
    }

    // Dispatch scroll end with momentum velocity
    if (this.activeScrollKey !== null) {
      const r = this.swipeRegions.get(this.activeScrollKey);
      if (r?.onScrollEnd) {
        const dt = this.lastScrollTime - this.prevScrollTime;
        // px/frame at ~60fps; ignore velocity if last two samples are too close in time
        const velocityX = dt > 5 ? (this.lastScrollX - this.prevScrollX) / dt * 16 : 0;
        r.onScrollEnd(velocityX);
      }
      this.activeScrollKey = null;
    }

    if (!this.touchOrigin) return;
    const { x: sx } = this.touchOrigin;  // already corrected
    this.touchOrigin = null;
    const dx = lx - sx;                  // both corrected — delta is accurate

const regions = [...this.swipeRegions.values()];

for (const r of regions) {
  const b = r;

  if (sx < b.x || sx >= b.x + b.width) continue;

  const threshold = b.threshold ?? 80;

  if (Math.abs(dx) < threshold) continue;

  if (dx < 0) b.onSwipeLeft?.(Math.abs(dx));
  else        b.onSwipeRight?.(dx);
}



  }

  /** Legacy one-shot hit-test — fires tap/onClick only, no gesture tracking. */
  hitTest(x: number, y: number): void {
    this.touchStart(x, y);
  }
}

function hits(region: GestureRegion, lx: number, ly: number): boolean {
  const b    = region.getBounds?.() ?? region;
  const slop = region.hitSlop ?? 8;
  return lx >= b.x - slop && lx < b.x + b.width + slop &&
         ly >= b.y - slop && ly < b.y + b.height + slop;
}

/** Bounds at touch time, tolerating nodes whose layout hasn't been computed yet. */
function safeBounds(region: GestureRegion): { x: number; y: number; width: number; height: number } | undefined {
  try {
    return region.getBounds?.() ?? { x: region.x, y: region.y, width: region.width, height: region.height };
  } catch {
    return undefined;
  }
}

/** "root[1].children[0]" style paths for every box node — used to name regions in logs. */
function debugPaths(root: RootContainer | null): Map<BoxNode, string> {
  const map = new Map<BoxNode, string>();
  if (!root) return map;
  function walk(n: SceneNode, path: string): void {
    if (n.type === 'box') map.set(n, path);
    for (let i = 0; i < n.children.length; i++) walk(n.children[i], `${path}[${i}]`);
  }
  for (let i = 0; i < root.children.length; i++) walk(root.children[i], `root[${i}]`);
  return map;
}

function nodeLabel(n: BoxNode, path: string): string {
  const abs = sceneIsAbsolute(n);
  const z   = sceneZIndex(n);
  const pos = `${n.style?.position ?? 'flow'}${abs ? '→abs' : ''}`;
  const xy  = n.x !== undefined || n.y !== undefined ? ` x=${n.x ?? ''} y=${n.y ?? ''}` : '';
  return `${path} ${pos} z=${z}${xy}`;
}

/** Topmost-first hit-test over regions without a scene node (fixed rectangles). */
function firstHitting(regions: GestureRegion[], lx: number, ly: number): GestureRegion | undefined {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    if (hits(r, lx, ly)) return r;
  }
  return undefined;
}

function winnerLabel(region: GestureRegion, paths?: Map<BoxNode, string>): string {
  if (region.node && paths) {
    const p = paths.get(region.node);
    if (p) return nodeLabel(region.node, p);
  }
  return '(fixed rect)';
}

function sceneZIndex(n: SceneNode): number {
  return n.style?.zIndex ?? 0;
}

function sceneIsAbsolute(n: SceneNode): boolean {
  return n.style?.position === 'absolute' || (n as BoxNode).x !== undefined || (n as BoxNode).y !== undefined;
}

/**
 * Returns the topmost region whose node's bounds contain the (already shifted)
 * point, determined by walking the scene tree in reverse paint order — the
 * exact inverse of the serializer's draw sequence.
 */
function hitTestScene(
  root: RootContainer,
  byNode: Map<BoxNode, GestureRegion>,
  lx: number,
  ly: number,
  onVisit?: (node: BoxNode, region: GestureRegion | undefined, hit: boolean) => void,
): GestureRegion | undefined {
  function visit(n: SceneNode): GestureRegion | undefined {
    const box = n as BoxNode;
    if (box.children && box.children.length > 0) {
      const absNeg: SceneNode[] = [];
      const flow:   SceneNode[] = [];
      const absPos: SceneNode[] = [];
      for (const child of box.children) {
        const abs = sceneIsAbsolute(child);
        const z   = sceneZIndex(child);
        (abs ? (z < 0 ? absNeg : absPos) : flow).push(child);
      }
      absNeg.sort((a, b) => sceneZIndex(a) - sceneZIndex(b));
      absPos.sort((a, b) => sceneZIndex(a) - sceneZIndex(b));

      // Children that paint last are on top — visit them (and their subtrees) first.
      for (let i = absPos.length - 1; i >= 0; i--) { const r = visit(absPos[i]); if (r) return r; }
      for (let i = flow.length  - 1; i >= 0; i--)  { const r = visit(flow[i]);  if (r) return r; }
      for (let i = absNeg.length - 1; i >= 0; i--) { const r = visit(absNeg[i]); if (r) return r; }
    }
    // A node's own surface paints below all of its children (which were just
    // visited above), so check it last.
    if (n.type === 'box') {
      const region = byNode.get(n);
      const hit    = region ? hits(region, lx, ly) : false;
      onVisit?.(n, region, hit);
      if (region && hit) return region;
    }
    return undefined;
  }

  for (let i = root.children.length - 1; i >= 0; i--) {
    const r = visit(root.children[i]);
    if (r) return r;
  }
  return undefined;
}

const _G = global as Record<string, unknown>;
const _K = '__react_drm_TouchRegistryContext__';
if (!_G[_K]) _G[_K] = createContext<TouchRegistry | null>(null);
export const TouchRegistryContext = _G[_K] as import('react').Context<TouchRegistry | null>;
