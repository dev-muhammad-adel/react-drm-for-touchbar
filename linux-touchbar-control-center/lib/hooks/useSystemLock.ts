import { useCallback, useEffect, useState } from 'react';
import type { SystemLockState } from '@/lib/lock/types';
import {
  getSystemLock,
  subscribeSystemLock,
  onSystemLock,
  onSystemUnlock,
  onSystemLockChange,
} from '@/lib/lock/store';

export type { SystemLockState };

export interface SystemLockApi {
  /** true = locked, false = unlocked, null = no active graphical session. */
  isLocked: boolean | null;
  /** The active graphical logind session id, or null. */
  sessionId: string | null;
  /** Subscribe to the lock transition; returns an unsubscribe function. */
  onLock(cb: () => void): () => void;
  /** Subscribe to the unlock transition; returns an unsubscribe function. */
  onUnlock(cb: () => void): () => void;
  /** Subscribe to any state change; returns an unsubscribe function. */
  onChange(cb: (state: SystemLockState) => void): () => void;
}

/**
 * Lock state of the current active graphical Linux session, read from
 * systemd-logind's LockedHint over D-Bus. All consumers share one logind
 * connection (see lib/lock/).
 */
export function useSystemLock(): SystemLockApi {
  const [state, setState] = useState<SystemLockState>(getSystemLock);

  useEffect(() => subscribeSystemLock(s => setState(s)), []);

  // Event helpers forward to the shared store; the caller owns the unsubscribe.
  const onLock = useCallback((cb: () => void) => onSystemLock(cb), []);
  const onUnlock = useCallback((cb: () => void) => onSystemUnlock(cb), []);
  const onChange = useCallback((cb: (s: SystemLockState) => void) => onSystemLockChange(cb), []);

  return { isLocked: state.isLocked, sessionId: state.sessionId, onLock, onUnlock, onChange };
}