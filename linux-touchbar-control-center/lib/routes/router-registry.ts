import type { LayerHostHandle } from '@/layers';
import type { LayerAnimation, SwitchOptions } from 'react-drm';

// Every mounted RouteBranch registers its own nested LayerHost here, keyed by
// its full segment path ('' for root, 'splitted' for its nested host, and so
// on for any future depth) — see RouteBranch's registration effect. This is
// what makes a single global go(path) possible instead of every layout.tsx
// needing its own locally-scoped handle (ref, prop, or context) to drive
// whichever host it happens to own.
const registry = new Map<string, LayerHostHandle>();
const waiters = new Map<string, Set<() => void>>();

export function registerRouter(path: string, router: LayerHostHandle | null): void {
  if (router) {
    registry.set(path, router);
    const pending = waiters.get(path);
    if (pending) { waiters.delete(path); pending.forEach(fn => fn()); }
  } else {
    registry.delete(path);
  }
}

/** The live handle for one path, or undefined if that branch isn't mounted. */
export function routerAt(path: string): LayerHostHandle | undefined {
  return registry.get(path);
}

function onceRegistered(path: string, cb: () => void): void {
  if (registry.has(path)) { cb(); return; }
  let pending = waiters.get(path);
  if (!pending) { pending = new Set(); waiters.set(path, pending); }
  pending.add(cb);
}

/**
 * Navigate anywhere in the route tree by full path, e.g. go('splitted/browser')
 * or go('dock') for a root-level sibling. Switches each level's own host in
 * turn; any level that isn't registered yet — including the very first one —
 * is waited for and retried once it is. This matters even for prefix '' (root):
 * a page rendered as one of root's own children (e.g. a redirect-on-mount
 * page.tsx) has its effects fire *before* its ancestor RouteBranch's own
 * registration effect (React fires effects bottom-up), so root's router can
 * still be unregistered at the moment such a page calls go() on its very
 * first render.
 */
export function go(path: string, opts?: LayerAnimation | SwitchOptions): void {
  step('', path.split('/').filter(Boolean), opts);
}

function step(prefix: string, remaining: string[], opts?: LayerAnimation | SwitchOptions): void {
  if (remaining.length === 0) return;
  const router = registry.get(prefix);
  if (!router) {
    onceRegistered(prefix, () => step(prefix, remaining, opts));
    return;
  }

  const [name, ...rest] = remaining;
  router.go(name, rest.length === 0 ? opts : undefined);
  if (rest.length === 0) return;

  const nextPrefix = prefix ? `${prefix}/${name}` : name;
  onceRegistered(nextPrefix, () => step(nextPrefix, rest, opts));
}
