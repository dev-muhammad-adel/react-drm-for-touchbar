import { atom } from 'jotai';
import { readVolume } from '@/lib/services/volume';

/**
 * Live system volume (0–1), shared between the audio slider layer and the
 * splitted layer's volume button (long-press-and-drag reads/writes this
 * directly, without waiting for the slider to mount).
 */
export const volumeAtom = atom<number>(readVolume());
