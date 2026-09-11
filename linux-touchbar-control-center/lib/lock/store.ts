import { createLogger } from 'react-drm';
import { SystemLockWatcher } from './watcher';
import { createLogindAdapter } from './logind';
import type { LogindAdapter } from './logind';
import type { LockEventKind, SystemLockState, SystemLockListener } from './types';

const log = createLogger('systemLock');

// One shared logind watcher for every consumer, refcounted so the D-Bus
// connection is only open while someone is subscribed.

export class SystemLockStore {
  private readonly makeAdapter: () => LogindAdapter;
  private readonly listeners = new Set<SystemLockListener>();
  private watcher: SystemLockWatcher | null = null;
  private adapter: LogindAdapter | null = null;
  private starting = false;
  private current: SystemLockState = { isLocked: null, sessionId: null };

  constructor(makeAdapter: () => LogindAdapter = createLogindAdapter) {
    this.makeAdapter = makeAdapter;
  }

  getState(): SystemLockState {
    return { ...this.current };
  }

  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: SystemLockListener): () => void {
    this.listeners.add(listener);
    this.ensureStarted();
    listener({ ...this.current }, 'change'); // immediate snapshot, like subscribeActiveWindow
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopWatcher();
    };
  }

  /** Subscribe to the lock transition (LockedHint false → true). */
  onLock(cb: () => void): () => void {
    return this.subscribe((_state, kind) => { if (kind === 'lock') cb(); });
  }

  /** Subscribe to the unlock transition (LockedHint true → false). */
  onUnlock(cb: () => void): () => void {
    return this.subscribe((_state, kind) => { if (kind === 'unlock') cb(); });
  }

  /** Subscribe to every state change. */
  onChange(cb: (state: SystemLockState) => void): () => void {
    return this.subscribe(state => cb(state));
  }

  private broadcast(state: SystemLockState, kind: LockEventKind): void {
    this.current = state;
    for (const listener of this.listeners) {
      try { listener(state, kind); } catch { /* a subscriber must not kill the watcher */ }
    }
  }

  private ensureStarted(): void {
    if (this.watcher || this.starting) return;
    this.starting = true;

    const adapter = this.makeAdapter();
    const watcher = new SystemLockWatcher(adapter, (state, kind) => this.broadcast(state, kind));
    this.watcher = watcher;
    this.adapter = adapter;

    watcher.start()
      .then(() => {
        if (this.watcher === watcher && this.listeners.size === 0) this.stopWatcher(); // left mid-start
      })
      .catch(err => {
        log.warn('logind lock watch unavailable:', err instanceof Error ? err.message : err);
        if (this.watcher === watcher) this.stopWatcher();
      })
      .finally(() => { this.starting = false; });
  }

  private stopWatcher(): void {
    const watcher = this.watcher;
    const adapter = this.adapter;
    this.watcher = null;
    this.adapter = null;
    this.current = { isLocked: null, sessionId: null };
    void watcher?.dispose();
    adapter?.close();
  }
}

/** Shared instance for the whole app (refcounted, closes the bus when idle). */
export const systemLockStore = new SystemLockStore();

export function getSystemLock(): SystemLockState {
  return systemLockStore.getState();
}

export function subscribeSystemLock(listener: SystemLockListener): () => void {
  return systemLockStore.subscribe(listener);
}

/** Subscribe to every state change; returns an unsubscribe function. */
export function onSystemLockChange(cb: (state: SystemLockState) => void): () => void {
  return systemLockStore.onChange(cb);
}

/** Subscribe to the lock transition (LockedHint false → true). */
export function onSystemLock(cb: () => void): () => void {
  return systemLockStore.onLock(cb);
}

/** Subscribe to the unlock transition (LockedHint true → false). */
export function onSystemUnlock(cb: () => void): () => void {
  return systemLockStore.onUnlock(cb);
}