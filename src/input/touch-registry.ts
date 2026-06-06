import { createContext } from 'react';

export interface GestureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Called at touch time to get current bounds — use this for flex-positioned elements. */
  getBounds?: () => { x: number; y: number; width: number; height: number };
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
    this.touchOrigin  = { x, y };
    this.activeRegion = null;

    for (const r of this.regions.values()) {
      const b = r.getBounds?.() ?? r;
      // Y is always 0 on Touch Bar hardware (1D device) — match on x range only.
      if (x >= b.x && x < b.x + b.width) {
        this.activeRegion = r;
        r.onTouchStart?.(x, y);
        r.onClick?.();
        break;
      }
    }
  }

  touchMove(x: number, y: number): void {
    this.activeRegion?.onTouchMove?.(x, y);
  }

  touchEnd(x: number, y: number): void {
    this.activeRegion?.onTouchEnd?.(x, y);
    this.activeRegion = null;

    if (!this.touchOrigin) return;
    const { x: sx, y: sy } = this.touchOrigin;
    this.touchOrigin = null;
    const dx = x - sx;

    for (const r of this.swipeRegions.values()) {
      // Y is always 0 on Touch Bar hardware — match on x range only.
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

export const TouchRegistryContext = createContext<TouchRegistry | null>(null);
