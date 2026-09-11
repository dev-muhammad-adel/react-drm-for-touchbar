/**
 * Lock state of the current active graphical Linux session, sourced from
 * systemd-logind's org.freedesktop.login1.Session.LockedHint property.
 */

export interface SystemLockState {
  /** true = locked, false = unlocked, null = no active graphical session. */
  isLocked: boolean | null;
  /** The logind session id of the active graphical session, or null. */
  sessionId: string | null;
}

/**
 * Why a subscriber was notified. 'lock'/'unlock' are LockedHint transitions
 * of the tracked session; 'change' is every other state change (session
 * switch, no-session transition, initial detection).
 */
export type LockEventKind = 'lock' | 'unlock' | 'change';

export type SystemLockListener = (state: SystemLockState, kind: LockEventKind) => void;