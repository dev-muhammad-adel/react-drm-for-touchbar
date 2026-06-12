import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import React from 'react';
import { render } from '../renderer/renderer';
import type { RenderResult, RenderOptions } from '../renderer/renderer';
import type { DrmDisplay } from '../native/binding';

// Walk up from startDir looking for a package.json that declares "workspaces"
// (the monorepo/workspace root). Falls back to the highest package.json found.
// This ensures both linux-touchbar-control-center/ and src/ are covered in one watch.
function findWatchRoot(startDir: string): string {
  let dir = startDir;
  let highest = startDir;

  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      highest = dir;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return dir;
      } catch { /* unparseable package.json — keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return highest;
}

function clearProjectCache(): void {
  for (const key of Object.keys(require.cache)) {
    if (!key.includes('node_modules') && !key.endsWith('.node')) {
      delete require.cache[key];
    }
  }
}

function watchDir(dir: string, onChange: () => void): () => void {
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const watcher = chokidar.watch(dir, {
    ignored: [/(^|[/\\])node_modules([/\\]|$)/, /(^|[/\\])\.git([/\\]|$)/, /\.node$/],
    ignoreInitial: true,
    // awaitWriteFinish catches atomic saves from vim/nvim (write-to-tmp then rename)
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 50 },
  });

  watcher.on('all', (_event, filePath) => {
    if (!/\.(js|ts|tsx)$/.test(filePath)) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; onChange(); }, 150);
  });

  watcher.on('error', () => {});
  return () => { void watcher.close(); };
}

/**
 * High-level hot-reload entry point.
 *
 * Loads `appModulePath` (no extension needed), renders its exported `App`
 * component, then watches for source/compiled changes and live-swaps the
 * React tree — all without restarting the process or reopening the display.
 *
 * Convention: the module must export a component named `App` (or a default
 * export) that accepts `{ width, height }` props.
 *
 * Usage in the entry file:
 *   const result = renderHot(path.resolve(__dirname, 'hello-app'), display);
 *   process.on('SIGINT', () => { result.unmount(); display.close(); process.exit(0); });
 */
export function renderHot(
  appModulePath: string,
  display: DrmDisplay,
  options?: RenderOptions & { appProps?: Record<string, unknown> },
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

  // React's concurrent scheduler can surface render errors as uncaught exceptions
  // (after updateContainer returns). Survive them so hot-reload keeps working.
  const uncaughtHandler = (err: unknown) => {
    console.error('[hot-reload] uncaught exception (process survived):', err);
    try { result.update(lastGood); } catch { /* best-effort restore */ }
  };
  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', uncaughtHandler);

  const dir = findWatchRoot(path.dirname(appModulePath));
  console.log(`[hot-reload] watching ${dir}`);

  watchDir(dir, () => {
    clearProjectCache();
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
