import { useEffect } from 'react';
import { useAtom } from 'jotai';
import {
  POMO_SESSION,
  pomoElapsedAtom, pomoRunningAtom, pomoSessionsAtom, pomoFlashAtom,
} from '../store/pomodoro';

export function usePomodoroEngine() {
  const [running]              = useAtom(pomoRunningAtom);
  const [elapsed, setElapsed]  = useAtom(pomoElapsedAtom);
  const [, setSessions]        = useAtom(pomoSessionsAtom);
  const [, setFlash]           = useAtom(pomoFlashAtom);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Auto-mark a session at every 25-min boundary
  useEffect(() => {
    if (elapsed === 0 || elapsed % POMO_SESSION !== 0) return;
    setSessions(s => s + 1);
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(t);
  }, [elapsed]);
}
