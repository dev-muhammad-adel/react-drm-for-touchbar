import { useEffect, useState } from 'react';
import { touchIdStore, type TouchIdState } from './useTouchIdStatus';

/** Derivable unlock state shared by the root-layout TouchIdGate and the lock
 *  page — the same status machine backed by a single store, so both always
 *  agree (and either can write it, e.g. debug buttons on the lock page). */
export type UnlockStatus = {
  isActive: boolean;
  status: 'fail' | 'success' | 'loading' | undefined;
  tries: number;
  message: undefined | string;
};

const INITIAL: UnlockStatus = {
  isActive: false,
  status: undefined,
  tries: 0,
  message: undefined,
};

/** Deterministic transition from the raw prompt state — derived here, once,
 *  so every consumer converges on the same status and `retry` increments
 *  `tries` exactly once no matter how many components are listening. */
function reduce(prev: UnlockStatus, s: TouchIdState): UnlockStatus {
  switch (s) {
    case 'idle':
      return { ...prev, status: undefined, isActive: false };
    case 'waiting':
      return {
        ...prev,
        isActive: true,
        status: undefined,
        message: prev.status === 'loading' ? 'Touch ID is stuck. Please try again.' : undefined,
      };
    case 'scanning':
      return { ...prev, status: 'loading', isActive: true };
    case 'matched':
      return { ...prev, status: 'success', isActive: false };
    case 'retry':
      return { ...prev, isActive: true, status: 'fail', tries: prev.tries + 1 };
    case 'failed':
      return { ...prev, status: 'fail', isActive: false };
  }
}

class UnlockStatusStore {
  private state: UnlockStatus = INITIAL;
  private readonly listeners = new Set<() => void>();
  private unsubTouch: (() => void) | null = null;

  get(): UnlockStatus {
    return { ...this.state };
  }

  patch(patch: Partial<UnlockStatus>): void {
    this.commit({ ...this.state, ...patch });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.unsubTouch) this.unsubTouch = touchIdStore.subscribe(s => this.commit(reduce(this.state, s)));
    listener();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unsubTouch) {
        this.unsubTouch();
        this.unsubTouch = null;
        this.state = INITIAL;
      }
    };
  }

  private commit(next: UnlockStatus): void {
    if (
      next.isActive === this.state.isActive &&
      next.status === this.state.status &&
      next.tries === this.state.tries &&
      next.message === this.state.message
    ) return;
    this.state = next;
    for (const l of this.listeners) { try { l(); } catch { /* listener error */ } }
  }
}

/** Shared instance for every consumer (TouchIdGate + lock page). */
const unlockStatusStore = new UnlockStatusStore();

export interface UnlockStatusApi extends UnlockStatus {
  /** Directly set any bit of the shared status (debug/override use). */
  setStatus(patch: Partial<UnlockStatus>): void;
}

/** The one state machine for Touch ID — turns the raw D-Bus prompt state into
 *  the shared UI status/tries/message set. Consumed by TouchIdGate and the
 *  lock page so their feedback always matches. */
export function useUnlockStatus(): UnlockStatusApi {
  const [state, setState] = useState<UnlockStatus>(() => unlockStatusStore.get());

  useEffect(() => unlockStatusStore.subscribe(() => setState(unlockStatusStore.get())), []);

  return {
    ...state,
    setStatus: (patch: Partial<UnlockStatus>) => unlockStatusStore.patch(patch),
  };
}