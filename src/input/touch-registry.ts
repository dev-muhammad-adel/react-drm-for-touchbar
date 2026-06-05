import { createContext } from 'react';

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

// Kept as alias so Button.tsx doesn't need changes
export type Region = TapRegion;

export class TouchRegistry {
  private tapRegions   = new Map<symbol, TapRegion>();
  private swipeRegions = new Map<symbol, SwipeRegion>();

  // Track the active touch for swipe detection
  private activeTouchStart: { x: number; y: number } | null = null;

  // ── Tap regions ────────────────────────────────────────────────────────────

  register(id: symbol, region: TapRegion): void {
    this.tapRegions.set(id, region);
  }

  unregister(id: symbol): void {
    this.tapRegions.delete(id);
  }

  // ── Swipe regions ──────────────────────────────────────────────────────────

  registerSwipe(id: symbol, region: SwipeRegion): void {
    this.swipeRegions.set(id, region);
  }

  unregisterSwipe(id: symbol): void {
    this.swipeRegions.delete(id);
  }

  // ── Touch lifecycle ────────────────────────────────────────────────────────

  /**
   * Call when a finger touches down.
   * Also fires tap handlers immediately (same behavior as the old hitTest).
   */
  touchStart(x: number, y: number): void {
    this.activeTouchStart = { x, y };
    this._hitTestTap(x, y);
  }

  /** Call when the finger moves. */
  touchMove(_x: number, _y: number): void {
    // Available for future drag/pan support.
  }

  /** Call when the finger lifts — detects swipes for registered regions. */
  touchEnd(x: number, y: number): void {
    if (!this.activeTouchStart) return;
    const { x: sx, y: sy } = this.activeTouchStart;
    this.activeTouchStart = null;

    const dx = x - sx;

    for (const r of this.swipeRegions.values()) {
      // Swipe must start inside this region
      if (sx < r.x || sx >= r.x + r.width || sy < r.y || sy >= r.y + r.height) continue;
      const threshold = r.threshold ?? 80;
      if (Math.abs(dx) < threshold) continue;
      if (dx < 0) r.onSwipeLeft?.(Math.abs(dx));
      else        r.onSwipeRight?.(dx);
    }
  }

  /**
   * Legacy one-shot hit-test (tap only, no swipe awareness).
   * Still works if you feed raw single-event touch coordinates.
   */
  hitTest(x: number, y: number): void {
    this._hitTestTap(x, y);
  }

  private _hitTestTap(x: number, y: number): void {
    for (const r of this.tapRegions.values()) {
      if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
        r.handler();
        return;
      }
    }
  }
}

export const TouchRegistryContext = createContext<TouchRegistry | null>(null);
