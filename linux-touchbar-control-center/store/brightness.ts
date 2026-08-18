import { atom } from 'jotai';
import { readBrightness, DISPLAY_DEVICE } from '@/lib/services/brightness';

/**
 * Live display brightness (0–1), shared between the brightness slider layer
 * and the splitted layer's brightness button (long-press-and-drag reads/
 * writes this directly, without waiting for the slider to mount). Keyboard
 * backlight has no quick-access control yet, so it stays local to the layer.
 */
export const displayBrightnessAtom = atom<number>(readBrightness(DISPLAY_DEVICE));
