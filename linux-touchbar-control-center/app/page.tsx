import { go, routerAt } from '@/lib/routes/router-registry';
import type { LayerConfig } from '@/lib/routes/loadRoutes';
import { getSystemLock, onSystemLockChange } from '@/lib/lock/store';
import { LOCK_LAYER, HOME_LAYER } from '@/lib/lock/navigation';
import { useSystemLock } from '@/lib/hooks/useSystemLock';

export const layerConfig: LayerConfig = { animation: 'fade' };

// Full route of the deepest registered branch rooted at the app root.
function currentRoute(): string {
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

// ── Lock → layer navigation, module-scope ────────────────────────────────────
// Lives OUTSIDE the component on purpose: RootPage is the root's default
// layer (`index`), so the moment it navigates to another layer it unmounts —
// a React useEffect subscription would die with it and lock events would be
// missed. The store subscription below is registered once, at module scope,
// and keeps driving go() for the whole app lifetime regardless of which layer
// is mounted.
let previous: string | null = null;
let prevIsLocked: boolean | null = null;
let unlockTimer: ReturnType<typeof setTimeout> | null = null;

function handleLockState(state: { isLocked: boolean | null }): void {
  const isLocked = state.isLocked;
  if (isLocked === prevIsLocked) return;
  const prev = prevIsLocked;
  prevIsLocked = isLocked;
  if (isLocked === null) return; // no active session — stay put

  if (isLocked) {
    const current = currentRoute();
    if (current && current !== LOCK_LAYER) previous = current;
    go(LOCK_LAYER, 'fade');
  } else if (prev === null) {
    // Boot, unlocked — the initial destination.
    go(process.env.INITIAL_ROUTE || 'splitted');
  } else if (prev === true) {
    // Genuine unlock — restore the pre-lock layer after a short hold.
    const back = previous && previous !== LOCK_LAYER ? previous : HOME_LAYER;
    previous = null;
    if (unlockTimer) clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => go(back, 'fade'), 1000);
  }
}

onSystemLockChange(handleLockState);
handleLockState(getSystemLock());

export default function RootPage() {
  useSystemLock(); // keep the shared logind watcher started
  return null;
}
