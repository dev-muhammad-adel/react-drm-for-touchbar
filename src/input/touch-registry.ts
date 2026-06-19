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

    for (const r of this.regions.values()) {
      const b    = r.getBounds?.() ?? r;
      const slop = r.hitSlop ?? 8;
      if (lx >= b.x - slop && lx < b.x + b.width + slop) {
        this.activeRegion = r;
        r.onTouchStart?.(lx, ly);
        break;
      }
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

    // Cancel pending taps once the finger travels — a drag (scroll/swipe) must not
    // click the button it started on. Regions with their own onTouchMove are
    // drag-intent (sliders) and keep tracking.
    if (this.activeRegion?.onClick && !this.activeRegion.onTouchMove && this.touchOrigin) {
      const moved = Math.hypot(lx - this.touchOrigin.x, ly - this.touchOrigin.y);
      if (moved > 12) {
        const r = this.activeRegion;
        this.activeRegion = null;
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

const _G = global as Record<string, unknown>;
const _K = '__react_drm_TouchRegistryContext__';
if (!_G[_K]) _G[_K] = createContext<TouchRegistry | null>(null);
export const TouchRegistryContext = _G[_K] as import('react').Context<TouchRegistry | null>;
