import { useEffect, useRef, useState } from 'react';
import { readMicMuted, toggleMicMute } from '@/lib/services/mic';

const POLL_MS = 2000;

/**
 * Mic mute state plus a toggle — polls so it stays in sync with mute changes
 * from elsewhere (a keyboard shortcut, another app), same idea as volume's
 * syncVolume. The toggle updates local state optimistically so the tap feels
 * immediate rather than waiting on the next poll.
 */
export function useMicMute(): { muted: boolean; toggle: () => void } {
  const [muted, setMuted] = useState(() => readMicMuted());
  const busyRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      if (!busyRef.current) setMuted(readMicMuted());
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  function toggle() {
    if (busyRef.current) return;
    busyRef.current = true;
    setMuted(m => !m);
    toggleMicMute(() => { busyRef.current = false; });
  }

  return { muted, toggle };
}
