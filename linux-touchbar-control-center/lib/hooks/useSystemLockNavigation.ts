import { useEffect, useState } from 'react';
import { go } from '@/lib/routes/router-registry';
import { getSystemLock, subscribeSystemLock } from '@/lib/lock/store';
import { LOCK_LAYER, HOME_LAYER, currentRoute } from '@/lib/lock/navigation';
import type { SystemLockState } from '@/lib/lock/types';

/**
 * Drives lock → layer navigation from the system lock state.
 *
 * Lives in a hook but is meant to be called from a component that stays
 * mounted while children switch (the root layout): the layout survives
 * navigation, so this real subscription outlives any single layer — a page or
 * layer-scoped hook would unmount the moment it navigates away and miss lock
 * events. go() waits for the registration of any level's host, so calling it
 * on the very first render is safe.
 */
export function useSystemLockNavigation(): { isLocked: boolean | null } {
  const [lockState, setLockState] = useState<SystemLockState>(() => getSystemLock());

  useEffect(() => {
    let previous: string | null = null;
    let prevIsLocked: boolean | null = null;
    let unlockTimer: ReturnType<typeof setTimeout> | null = null;

    const handleLockState = (state: SystemLockState): void => {
      setLockState(state);
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
    };

    const unsub = subscribeSystemLock(handleLockState);
    return () => {
      unsub();
      if (unlockTimer) clearTimeout(unlockTimer);
    };
  }, []);

  return { isLocked: lockState.isLocked };
}