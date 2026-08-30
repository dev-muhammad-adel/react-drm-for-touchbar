/**
 * Shared visual language for the Touch Bar launcher — translucent "glass"
 * surfaces, hairline borders, soft shadows, an accent for the live alphabet
 * cursor. Kept in one place so the pills, the A–Z strip and the filtered menu
 * stay visually coherent.
 */
export const FONT = 'IosevkaTerm Nerd Font';

// Pill / chip surfaces (app rows, close button, captions)
export const PILL_BG         = 'rgba(255, 255, 255, 0.055)';
export const PILL_PRESSED    = 'rgba(255, 255, 255, 0.11)';
export const PILL_BORDER     = 'rgba(255, 255, 255,0.4)';
export const PILL_BORDER_PRESSED = 'rgba(255, 255, 255, 0.20)';
export const PILL_TEXT       = '#eceff4';
export const PILL_TEXT_DIM   = 'rgba(236, 239, 244, 0.55)';
export const PILL_RADIUS     = 10;

// Alphabet wave strip
export const STRIP_BG        = 'rgba(15, 19, 27, 0.82)';
export const STRIP_BORDER    = 'rgba(255, 255, 255, 0.08)';
export const ACCENT          = '#5b8def';
export const ACCENT_SOFT     = 'rgba(91, 141, 239, 0.26)';
export const ACCENT_NONE     = 'rgba(91, 141, 239, 0)';
export const LETTER_DIM      = '#5d6a80';
export const LETTER_SOFT     = '#8ea0b7';
export const LETTER_ACTIVE   = '#ffffff';