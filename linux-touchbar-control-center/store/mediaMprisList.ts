import { atom } from 'jotai';

/**
 * True when the left-side `mediaMprisList` layer is manually "pinned" / locked.
 * When true, the split layer will not auto-switch the left panel based on the
 * active window.
 */
export const mediaMprisListPinnedAtom = atom<boolean>(false);
