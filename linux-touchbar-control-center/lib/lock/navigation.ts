import { routerAt } from '@/lib/routes/router-registry';

export const LOCK_LAYER = 'lock';
export const HOME_LAYER = 'splitted';

/**
 * Full route of the deepest registered branch rooted at the app root, e.g.
 * 'splitted/browser' — the exact place to restore after an unlock. Each
 * branch's LayerHost is registered under its own path (RouteBranch), so
 * walking `router.current` down the tree yields the current layer at every
 * level, not just the root one.
 */
export function currentRoute(): string {
  const segments: string[] = [];
  let prefix = '';
  for (;;) {
    const router = routerAt(prefix);
    if (!router) return segments.join('/');
    const name = router.current;
    if (!name) return segments.join('/');
    segments.push(name);
    prefix = prefix ? `${prefix}/${name}` : name;
  }
}

export type LockNavigation =
  | { kind: 'lock'; goto: string; remember: string | null }
  | { kind: 'unlock'; goto: string };

/**
 * Pure lock→layer mapping, tested independently of React. On lock, remember
 * the current layer (unless it already is the lock layer) before redirecting.
 * On unlock, restore the remembered layer, falling back to the home layer.
 */
export function resolveLockNavigation(
  isLocked: boolean,
  previous: string | null,
  current: string,
): LockNavigation {
  if (isLocked) {
    const remember = current && current !== LOCK_LAYER ? current : previous;
    return { kind: 'lock', goto: LOCK_LAYER, remember };
  }
  const back = previous && previous !== LOCK_LAYER ? previous : HOME_LAYER;
  return { kind: 'unlock', goto: back };
}