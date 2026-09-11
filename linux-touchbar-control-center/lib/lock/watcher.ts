import type {
  LogindAdapter, LogindSessionHandle, LogindSessionProps,
} from './logind';
import type { LockEventKind, SystemLockState } from './types';

const GRAPHICAL_TYPES = new Set(['wayland', 'x11', 'mir']);

/** True when logind considers this an active, local, user graphical session. */
export function isActiveGraphical(s: LogindSessionProps): boolean {
  return s.active && !s.remote && s.klass === 'user' && GRAPHICAL_TYPES.has(s.type);
}

export type LockWatcherListener = (state: SystemLockState, kind: LockEventKind) => void;

/**
 * Event-driven lock-state tracker whose single source of truth is
 * systemd-logind's LockedHint property.
 *
 * It picks the active graphical session (Active=yes, Remote=no, Class=user,
 * Type in wayland/x11/mir), reads its LockedHint for the initial state, and
 * subscribes to that session's PropertiesChanged. A LockedHint delta becomes
 * a lock/unlock event; an Active=false delta (or a SessionNew/SessionRemoved
 * on the manager) re-elects the active session — unsubscribing the previous
 * session and subscribing to the new one, then re-reading its LockedHint.
 * When there is no active graphical session the state is `null`, never false.
 *
 * Purely event-driven; nothing polls loginctl or spawns shell commands.
 */
export class SystemLockWatcher {
  private readonly adapter: LogindAdapter;
  private readonly emit: LockWatcherListener;
  private readonly handles = new Map<string, LogindSessionHandle>();
  private state: SystemLockState = { isLocked: null, sessionId: null };
  private currentId: string | null = null;
  private unsubscribeCurrent: (() => void) | null = null;
  private stopAdded: (() => void) | null = null;
  private stopRemoved: (() => void) | null = null;
  private started = false;

  constructor(adapter: LogindAdapter, emit: LockWatcherListener) {
    this.adapter = adapter;
    this.emit = emit;
  }

  getState(): SystemLockState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.stopAdded = this.adapter.onSessionAdded(handle => {
      this.handles.set(handle.id, handle);
      void this.reselect();
    });
    this.stopRemoved = this.adapter.onSessionRemoved(id => {
      this.handles.delete(id);
      void this.reselect();
    });

    try {
      for (const handle of await this.adapter.listSessions()) {
        this.handles.set(handle.id, handle);
      }
      await this.reselect();
    } catch (err) {
      this.started = false;
      this.stopAdded?.(); this.stopAdded = null;
      this.stopRemoved?.(); this.stopRemoved = null;
      throw err;
    }
  }

  async dispose(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.stopAdded?.(); this.stopAdded = null;
    this.stopRemoved?.(); this.stopRemoved = null;
    this.unsubscribeCurrent?.(); this.unsubscribeCurrent = null;
    this.currentId = null;
    this.handles.clear();
  }

  /** Re-elect the active graphical session and (re)subscribe to it. */
  private async reselect(): Promise<void> {
    const info = await this.readActiveSession();
    const nextId = info?.id ?? null;
    if (!this.started) return;
    if (nextId === this.currentId) return; // still the same session — keep the subscription

    this.unsubscribeCurrent?.();
    this.unsubscribeCurrent = null;
    this.currentId = nextId;

    if (!info) {
      this.publish({ isLocked: null, sessionId: null }, 'change');
      return;
    }

    const handle = this.handles.get(info.id);
    if (handle) this.subscribe(handle);
    this.publish({ isLocked: info.lockedHint, sessionId: info.id }, 'change');
  }

  private async readActiveSession(): Promise<LogindSessionProps | null> {
    for (const handle of this.handles.values()) {
      try {
        const info = await handle.read();
        if (isActiveGraphical(info)) return info;
      } catch { /* session disappeared mid-read — skip it */ }
    }
    return null;
  }

  private subscribe(handle: LogindSessionHandle): void {
    this.unsubscribeCurrent = handle.onPropertiesChanged(changes => {
      void this.onActiveSessionChanged(handle.id, changes);
    });
  }

  private async onActiveSessionChanged(id: string, changes: { active?: boolean; lockedHint?: boolean }): Promise<void> {
    if (!this.started || id !== this.currentId) return;
    if (changes.active === false) {
      await this.reselect(); // the session handed the display to someone else
      return;
    }
    if (changes.lockedHint !== undefined) {
      this.publish(
        { isLocked: changes.lockedHint, sessionId: id },
        changes.lockedHint ? 'lock' : 'unlock',
      );
    }
  }

  private publish(next: SystemLockState, kind: LockEventKind): void {
    if (next.isLocked === this.state.isLocked && next.sessionId === this.state.sessionId) return;
    this.state = next;
    try { this.emit(next, kind); } catch { /* a listener must not kill the watcher */ }
  }
}