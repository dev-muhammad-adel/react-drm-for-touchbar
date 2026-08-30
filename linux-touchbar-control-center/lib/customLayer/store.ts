import fs from 'node:fs';
import path from 'node:path';
import {
  CUSTOM_WIDGET_WIDTHS, CUSTOM_WIDGET_MIN_WIDTH, CUSTOM_WIDGET_MAX_WIDTH, snapToGrid, createLogger,
} from 'react-drm';
import type { CustomWidget, CustomWidgetType, CustomLayerDragGhost } from 'react-drm';

const log = createLogger('custom-layer-store');

// Same path convention as config-gui's writer (config-gui/main/main.ts):
// next to config.ts, resolved via cwd rather than __dirname since this file
// has no compiled dist/ counterpart to keep in sync (see page.tsx's fuller
// note on this from the read-only iteration of this feature).
const CUSTOM_LAYER_JSON_PATH = path.resolve(process.cwd(), 'custom-layer.json');

/**
 * Widget types currently offered. Anything else already on disk (from
 * earlier experiments) is filtered out so it never renders again, and
 * drag-commits of other types are rejected at the bridge.
 */
const AVAILABLE_CUSTOM_WIDGET_TYPES: ReadonlySet<string> = new Set([
  'clock', 'capslock', 'activewindow', 'separator', 'clipboard',
]);

export interface CustomLayerState {
  widgets: CustomWidget[];
  dirty: boolean;
  ghost: CustomLayerDragGhost | null;
  barWidth: number;
  barHeight: number;
  leftInset: number;
}

type Listener = (state: CustomLayerState) => void;

function readFromDisk(): CustomWidget[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(CUSTOM_LAYER_JSON_PATH, 'utf8'));
    const widgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
    // Only currently-offered, structurally-complete widget types are ever
    // shown — an entry missing any coordinate (e.g. hand-edited or left by
    // an earlier prototype with `x: null`) would crash bridge clients that
    // do arithmetic on these fields.
    return widgets.filter((w: any) =>
      AVAILABLE_CUSTOM_WIDGET_TYPES.has(w?.type)
      && typeof w.id === 'string'
      && [w.x, w.y, w.width, w.height].every(n => typeof n === 'number' && Number.isFinite(n)),
    );
  } catch {
    return [];
  }
}

function widgetsEqual(a: CustomWidget[], b: CustomWidget[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function newWidgetId(type: CustomWidgetType): string {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Single in-memory owner of the Custom Layer's widget list, for the whole
 * Touch Bar process. Two write paths, deliberately different:
 *  - config-gui-originated changes (drag-commit, remove) only touch
 *    `pending` — nothing reaches disk until an explicit save() (config-gui's
 *    Save button), matching the original spec's Save/Reset requirement.
 *  - on-device changes (long-press drag, on-device remove) persist
 *    immediately via save() — there's no "come back to config-gui to make it
 *    stick" round trip for an edit made standing at the Touch Bar itself.
 */
export class CustomLayerStore {
  private saved: CustomWidget[];
  private pending: CustomWidget[];
  private ghost: CustomLayerDragGhost | null = null;
  private listeners = new Set<Listener>();

  constructor(private barWidth: number, private barHeight: number, private leftInset: number = 0) {
    this.saved = readFromDisk();
    this.pending = this.saved;
  }

  getState(): CustomLayerState {
    return {
      widgets: this.pending,
      dirty: !widgetsEqual(this.saved, this.pending),
      ghost: this.ghost,
      barWidth: this.barWidth,
      barHeight: this.barHeight,
      leftInset: this.leftInset,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    const state = this.getState();
    for (const fn of this.listeners) fn(state);
  }

  private clampPosition(x: number, y: number, w: number, h: number): { x: number; y: number } {
    return {
      x: Math.min(Math.max(x, this.leftInset), Math.max(this.leftInset, this.barWidth - w)),
      y: Math.min(Math.max(y, 0), Math.max(0, this.barHeight - h)),
    };
  }

  // ── Drag from config-gui (staged into `pending` only) ───────────────────

  dragStart(widgetType: CustomWidgetType): void {
    if (!AVAILABLE_CUSTOM_WIDGET_TYPES.has(widgetType)) return;
    const w = CUSTOM_WIDGET_WIDTHS[widgetType];
    const { x, y } = this.clampPosition(
      snapToGrid((this.barWidth - w) / 2),
      0,
      w, this.barHeight,
    );
    this.ghost = { widgetType, x, y };
    this.emit();
  }

  dragMove(x: number, y: number): void {
    if (!this.ghost) return;
    const w = CUSTOM_WIDGET_WIDTHS[this.ghost.widgetType];
    const pos = this.clampPosition(
      snapToGrid(x - w / 2),
      0,
      w, this.barHeight,
    );
    this.ghost = { ...this.ghost, ...pos };
    this.emit();
  }

  dragEnd(commit: boolean): void {
    if (this.ghost && commit) {
      const { widgetType, x, y } = this.ghost;
      this.pending = [...this.pending, {
        id: newWidgetId(widgetType), type: widgetType, x, y,
        width: CUSTOM_WIDGET_WIDTHS[widgetType], height: this.barHeight,
      }];
    }
    this.ghost = null;
    this.emit();
  }

  /** Staged only — persisted on the next save(). */
  remove(id: string): void {
    this.pending = this.pending.filter(w => w.id !== id);
    this.emit();
  }

  // Re-clamps x in case widening pushed the widget past the right edge.
  private applyResize(id: string, width: number): void {
    const widget = this.pending.find(w => w.id === id);
    if (!widget) return;
    const w = Math.min(CUSTOM_WIDGET_MAX_WIDTH, Math.max(CUSTOM_WIDGET_MIN_WIDTH, snapToGrid(width)));
    const { x } = this.clampPosition(widget.x, widget.y, w, widget.height);
    this.pending = this.pending.map(item => (item.id === id ? { ...item, width: w, x } : item));
  }

  /** Staged only — persisted on the next save(). config-gui's resize control. */
  resize(id: string, width: number): void {
    this.applyResize(id, width);
    this.emit();
  }

  save(): void {
    this.saved = this.pending;
    this.persist();
    this.emit();
  }

  reset(): void {
    this.pending = this.saved;
    this.ghost = null;
    this.emit();
  }

  // ── On-device edits (persist immediately) ────────────────────────────────

  moveExisting(id: string, x: number, y: number): void {
    const widget = this.pending.find(w => w.id === id);
    if (!widget) return;
    const pos = this.clampPosition(snapToGrid(x), snapToGrid(y), widget.width, widget.height);
    this.pending = this.pending.map(w => (w.id === id ? { ...w, ...pos } : w));
    this.save(); // also persists anything else already staged in `pending` — acceptable prototype simplification
  }

  removeAndPersist(id: string): void {
    this.pending = this.pending.filter(w => w.id !== id);
    this.save();
  }

  /** On-device resize handle — persists immediately, same as moveExisting. */
  resizeExisting(id: string, width: number): void {
    this.applyResize(id, width);
    this.save();
  }

  private persist(): void {
    try {
      fs.writeFileSync(CUSTOM_LAYER_JSON_PATH, JSON.stringify({ widgets: this.saved }, null, 2));
    } catch (e) {
      log.error('failed to persist custom-layer.json:', e instanceof Error ? e.message : e);
    }
  }
}

// The CustomLayerStore keeps real state (widget list + drag ghost) that must
// survive hot-reload: dev hot-reload evicts modules from require.cache and
// re-evaluates them, which would reset a module-scoped singleton to null while
// the bridge server started in main() keeps running against the old instance.
// Stashing it on globalThis (with a Symbol key, immune to module re-eval) makes
// every re-evaluated copy of this module share the one live store.
const STORE_GLOBAL_KEY = Symbol.for('react-drm.customLayerStore');

type GlobalWithStore = { [STORE_GLOBAL_KEY]: CustomLayerStore } & typeof globalThis;

function readInstance(): CustomLayerStore | null {
  return (globalThis as GlobalWithStore)[STORE_GLOBAL_KEY] ?? null;
}

export function initCustomLayerStore(barWidth: number, barHeight: number, leftInset: number = 0): CustomLayerStore {
  const store = new CustomLayerStore(barWidth, barHeight, leftInset);
  (globalThis as GlobalWithStore)[STORE_GLOBAL_KEY] = store;
  return store;
}

export function getCustomLayerStore(): CustomLayerStore {
  const store = readInstance();
  if (!store) throw new Error('CustomLayerStore not initialized — call initCustomLayerStore() first');
  return store;
}
