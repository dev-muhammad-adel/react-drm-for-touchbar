import fs from 'fs';
import path from 'path';
import React from 'react';
import { render } from '../renderer/renderer';
import type { RenderResult, RenderOptions } from '../renderer/renderer';
import type { DrmDisplay } from '../native/binding';


function findWatchRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return startDir;
}

const PROJECT = (id: string) => !id.includes('node_modules') && !id.endsWith('.node');


function invalidate(changed: string[]): void {
  const cache = require.cache;

  // Invert the dependency graph: for each module id, the set that imports it.
  const importers = new Map<string, Set<string>>();
  let edges = 0;
  for (const id of Object.keys(cache)) {
    for (const child of cache[id]?.children ?? []) {
      edges++;
      let set = importers.get(child.id);
      if (!set) importers.set(child.id, (set = new Set()));
      set.add(id);
    }
  }

  if (edges === 0) {
    // No graph to walk — can't know dependents, so clear everything project-local.
    for (const id of Object.keys(cache)) if (PROJECT(id)) delete cache[id];
    return;
  }

  const evict = new Set<string>();
  const queue = changed.filter(id => cache[id]);
  while (queue.length) {
    const id = queue.pop()!;
    if (evict.has(id) || !PROJECT(id)) continue;
    evict.add(id);
    for (const dep of importers.get(id) ?? []) queue.push(dep);
  }
  for (const id of evict) delete cache[id];
}

const IGNORED_DIR = /(^|[/\\])(node_modules|\.git|dist|build)([/\\]|$)/;
function watchDir(dir: string, onChange: (changed: string[]) => void): () => void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<string>();
  console.log(`[hot-reload] watching ${dir}`);

  const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    if (IGNORED_DIR.test(rel) || !/\.(js|ts|tsx)$/.test(rel)) return;
    pending.add(path.resolve(dir, rel));
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      const changed = [...pending];
      pending.clear();
      onChange(changed);
    }, 150);
  });

  watcher.on('error', () => {});
  return () => watcher.close();
}

export function renderHot(
  appModulePath: string,
  display: DrmDisplay,
  options?: RenderOptions & {
    appProps?: Record<string, unknown>;
    watch?: boolean;
  },
): RenderResult {
  function load(): React.ReactNode {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(appModulePath) as Record<string, unknown>;
    const App = (mod.App ?? mod.default) as React.ComponentType<{ width: number; height: number }>;
    if (typeof App !== 'function') {
      throw new Error(`[renderHot] ${appModulePath} must export App or a default component`);
    }
    return React.createElement(App, { width: display.width, height: display.height, ...options?.appProps });
  }

  const initialEl = load();
  const result = render(initialEl, display, options);
  let lastGood: React.ReactNode = initialEl;

  const uncaughtHandler = (err: unknown) => {
    console.error('[react-drm] uncaught exception (process survived):', err);
    try { result.update(lastGood); } catch { /* best-effort restore */ }
  };
  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', uncaughtHandler);

  const watch = options?.watch ?? process.env.NODE_ENV !== 'production';
  if (!watch) return result;

  const dir = findWatchRoot(path.dirname(appModulePath));

  watchDir(dir, (changed) => {
    invalidate(changed);
    let el: React.ReactNode;
    try {
      el = load();
    } catch (err) {
      console.error('[hot-reload] load failed:', err);
      return; // keep showing last good render
    }
    try {
      result.update(el);
      lastGood = el;
      process.stdout.write('\r[hot-reload] reloaded\n');
    } catch (err) {
      console.error('[hot-reload] update failed:', err);
      try { result.update(lastGood); } catch { /* best-effort restore */ }
    }
  });

  return result;
}
