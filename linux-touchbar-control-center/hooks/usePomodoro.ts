import { useEffect } from 'react';
import { atom, useAtom } from 'jotai';

export const POMO_SESSION = 25 * 60; // seconds in one pomodoro

export const pomoElapsedAtom  = atom(0);
export const pomoRunningAtom  = atom(false);
export const pomoSessionsAtom = atom(0);
export const pomoFlashAtom    = atom(false);

export function usePomodoroEngine() {
  const [running]              = useAtom(pomoRunningAtom);
  const [elapsed, setElapsed]  = useAtom(pomoElapsedAtom);
  const [, setSessions]        = useAtom(pomoSessionsAtom);
  const [, setFlash]           = useAtom(pomoFlashAtom);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [running, setElapsed]);

  // Auto-mark a session at every 25-min boundary
  useEffect(() => {
    if (elapsed === 0 || elapsed % POMO_SESSION !== 0) return;
    setSessions(s => s + 1);
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(t);
  }, [elapsed, setSessions, setFlash]);
}
