export interface SafeAreaInsets {
  top:    number;
  right:  number;
  bottom: number;
  left:   number;
}

/** Horizontal pixels reserved left/right against pixel-shift clipping (matches MAX_X_SHIFT). */
export const SAFE_INSET_X = 11;
/** Vertical pixels reserved top/bottom against pixel-shift clipping (matches MAX_Y_SHIFT). */
export const SAFE_INSET_Y = 2;
/** @deprecated Use SAFE_INSET_X / SAFE_INSET_Y */
export const SAFE_INSET = SAFE_INSET_X;
