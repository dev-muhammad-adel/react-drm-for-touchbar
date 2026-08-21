import { readdirSync } from 'node:fs';
import path from 'node:path';
import type React from 'react';
import type { Layer, LayerAnimation, FromLayerSwitch, ToLayerSwitch } from 'react-drm';

// Next.js-style file-based routes under app/. A folder's page.tsx is a leaf
// layer's component (default export) plus an optional `layerConfig` export
// for its transition — that's also how a branch folder's own default child
// works: its sibling page.tsx (if any) is mounted as DEFAULT_CHILD_NAME and,
// since loadRouteChildren always puts it first, becomes the branch's default
// via LayerHost's own index-0 fallback — no separate "initial" config needed.
// A folder with children instead has a layout.tsx — the shell that stays
// mounted while its children switch. RouteBranch (lib/routes/RouteBranch.tsx)
// is what actually wires a folder's layout to its children at render time —
// this module only does fs/import mechanics. Key-gesture bindings (Fn key,
// dock shortcut, ...) are NOT part of this — they're not a routing concern,
// see lib/hooks/useLayerToggle.ts, called directly wherever a binding
// belongs, driven through router-registry.ts.
export interface LayerConfig {
  animation?:  LayerAnimation;
  entering?:   ToLayerSwitch;
  leaving?:    FromLayerSwitch;
  enterDelay?: number;
  duration?:   number;
}

// This renderer needs an explicit pixel width/height (used directly in slide-
// transition math), so a layout can't just place `{children}` the way a DOM
// layout would — it has to compute the size it's giving its nested content
// and hand that down explicitly, the same render-prop shape SafeArea already
// uses elsewhere in this app.
export type LayoutChildren = (width: number, height: number) => React.ReactNode;

export interface LoadedLayout {
  component: React.ComponentType<{
    width:    number;
    height:   number;
    children: LayoutChildren;
    /** This branch's own registry path (e.g. 'splitted') — for addressing its
     *  own children with go(`${path}/${name}`) without hardcoding the name a
     *  second time in the layout file. '' at root. */
    path:     string;
  }>;
}

/** One entry from a folder's children scan. Branches (folders with their own
 *  layout.tsx) carry no component here — RouteBranch mounts those itself,
 *  recursively, rather than rendering them as a plain leaf. */
export interface RouteChild {
  name:      string;
  isBranch:  boolean;
  component: React.ComponentType<{ width: number; height: number }> | null;
  config:    LayerConfig;
}

const APP_ROOT = path.resolve(__dirname, '..', '..', 'app');
const PAGE_RE   = /^page\.(tsx|ts|jsx|js)$/;
const LAYOUT_RE = /^layout\.(tsx|ts|jsx|js)$/;

/** Name given to a branch's own sibling page.tsx when it has one — Next.js
 *  addresses that page by "no further path segment"; this engine needs an
 *  actual name since navigation here is always go(name), never a URL. */
export const DEFAULT_CHILD_NAME = 'index';

// Plain absolute paths, not file:// URLs: this project compiles to CommonJS,
// and tsc transpiles `await import(x)` for a CJS target into
// `Promise.resolve(x).then(() => require(x))` — so at runtime this is really
// `require()`, which doesn't understand file:// URL strings (only tsx's own
// dev-time loader hooks tolerated that). Plain paths work for both: require()
// natively, and Node's real dynamic import() (e.g. under tsx) accepts an
// absolute path specifier directly too.
async function loadPage(dir: string, file: string, label: string): Promise<{ component: React.ComponentType<any>; config: LayerConfig }> {
  const mod = await import(path.join(dir, file));
  if (typeof mod.default !== 'function') throw new Error(`${label} has no default export`);
  return { component: mod.default, config: mod.layerConfig ?? {} };
}

export async function loadRouteChildren(...segments: string[]): Promise<RouteChild[]> {
  const dir = path.join(APP_ROOT, ...segments);
  const dirEntries = readdirSync(dir, { withFileTypes: true });
  const routeDirs  = dirEntries.filter(e => e.isDirectory());
  const ownFiles    = dirEntries.filter(e => e.isFile()).map(e => e.name);

  const children: RouteChild[] = [];

  // This folder's own sibling page.tsx (if any) is its default child — same
  // page RouteBranch's loadLayout call for this same segment will find a
  // layout.tsx alongside.
  const ownPageFile = ownFiles.find(f => PAGE_RE.test(f));
  if (ownPageFile) {
    const { component, config } = await loadPage(dir, ownPageFile, `app/${[...segments, ownPageFile].join('/')}`);
    children.push({ name: DEFAULT_CHILD_NAME, isBranch: false, component, config });
  }

  const scanned = await Promise.all(routeDirs.map(async (entry): Promise<RouteChild | null> => {
    const routeDir = path.join(dir, entry.name);
    const files = readdirSync(routeDir);
    const layoutFile = files.find(f => LAYOUT_RE.test(f));
    const pageFile   = files.find(f => PAGE_RE.test(f));

    if (!pageFile && !layoutFile) return null; // not a route folder (e.g. shared assets)

    if (layoutFile) {
      // Branch (may also have its own sibling page.tsx — that's handled by
      // this same function when called for *this* child's own segment, not
      // here). Its layerConfig here sets how *it* transitions within this
      // parent — separate from that sibling page.tsx's own layerConfig,
      // which is about how *it* transitions within the branch's own host.
      const mod = await import(path.join(routeDir, layoutFile));
      return { name: entry.name, isBranch: true, component: null, config: mod.layerConfig ?? {} };
    }

    const { component, config } = await loadPage(routeDir, pageFile!, `app/${[...segments, entry.name, pageFile].join('/')}`);
    return { name: entry.name, isBranch: false, component, config };
  }));

  children.push(...scanned.filter((c): c is RouteChild => c !== null));
  return children;
}

/** The segment's own layout.tsx (not its children's) — null if it's a leaf. */
export async function loadLayout(...segments: string[]): Promise<LoadedLayout | null> {
  const dir = path.join(APP_ROOT, ...segments);
  const layoutFile = readdirSync(dir).find(f => LAYOUT_RE.test(f));
  if (!layoutFile) return null;

  const mod = await import(path.join(dir, layoutFile));
  if (typeof mod.default !== 'function') {
    throw new Error(`app/${[...segments, layoutFile].join('/')} has no default export`);
  }
  return { component: mod.default };
}
