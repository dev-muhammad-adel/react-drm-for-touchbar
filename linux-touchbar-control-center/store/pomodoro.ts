import { atom } from 'jotai';

export const POMO_SESSION = 25 * 60; // seconds in one pomodoro

export const pomoElapsedAtom  = atom(0);
export const pomoRunningAtom  = atom(false);
export const pomoSessionsAtom = atom(0);
export const pomoFlashAtom    = atom(false);
