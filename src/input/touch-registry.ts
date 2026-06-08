import { createContext } from 'react';

export interface GestureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Called at touch time to get current bounds — use this for flex-positioned elements. */
  getBounds?: () => { x: number; y: number; width: number; height: number };
  /** Extra pixels to expand the hit area on each side. */
  hitSlop?: number;
  onClick?:      () => void;
  onTouchStart?: (x: number, y: number) => void;
  onTouchMove?:  (x: number, y: number) => void;
  onTouchEnd?:   (x: number, y: number) => void;
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
}

// Kept as alias so existing code doesn't need changes
export type Region = TapRegion;

export class TouchRegistry {
  private regions      = new Map<symbol, GestureRegion>();
  private swipeRegions = new Map<symbol, SwipeRegion>();

  private activeRegion:  GestureRegion | null = null;
  private touchOrigin:   { x: number; y: number } | null = null;
  private shiftX  = 0;
  private shiftY  = 0;
  private locked  = false;

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
    this.touchOrigin  = { x: lx, y: ly };
    this.activeRegion = null;

    for (const r of this.regions.values()) {
      const b    = r.getBounds?.() ?? r;
      const slop = r.hitSlop ?? 8;
      if (lx >= b.x - slop && lx < b.x + b.width + slop) {
        this.activeRegion = r;
        r.onTouchStart?.(lx, ly);
        break;
      }
    }
  }

  touchMove(x: number, y: number): void {
    this.activeRegion?.onTouchMove?.(x - this.shiftX, y - this.shiftY);
  }

  touchEnd(x: number, y: number): void {
    const lx = x - this.shiftX;
    const ly = y - this.shiftY;
    const region = this.activeRegion;
    region?.onTouchEnd?.(lx, ly);
    this.activeRegion = null;

    // Fire tap only if the finger lifted within the button's bounds — prevents
    // accidental triggers when sliding across the bar.
    if (region) {
      const b    = region.getBounds?.() ?? region;
      const slop = region.hitSlop ?? 8;
      if (lx >= b.x - slop && lx < b.x + b.width + slop) {
        region.onClick?.();
      }
    }

    if (!this.touchOrigin) return;
    const { x: sx } = this.touchOrigin;  // already corrected
    this.touchOrigin = null;
    const dx = lx - sx;                  // both corrected — delta is accurate

    for (const r of this.swipeRegions.values()) {
      if (sx < r.x || sx >= r.x + r.width) continue;
      const threshold = r.threshold ?? 80;
      if (Math.abs(dx) < threshold) continue;
      if (dx < 0) r.onSwipeLeft?.(Math.abs(dx));
      else        r.onSwipeRight?.(dx);
    }
  }

  /** Legacy one-shot hit-test — fires tap/onClick only, no gesture tracking. */
  hitTest(x: number, y: number): void {
    this.touchStart(x, y);
  }
}

const _G = global as Record<string, unknown>;
const _K = '__react_drm_TouchRegistryContext__';
if (!_G[_K]) _G[_K] = createContext<TouchRegistry | null>(null);
export const TouchRegistryContext = _G[_K] as import('react').Context<TouchRegistry | null>;
