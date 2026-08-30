/**
 * Pure alphabet-navigation logic for the Touch Bar launcher, kept separate
 * from the UI so it can be reasoned about and tested on its own.
 *
 * The Touch Bar is one long, short strip: A–Z is mapped linearly across the
 * launcher's usable width, and a finger position (in px) maps straight to a
 * letter. Nothing here knows about rendering.
 */

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Sentinel for app names that don't start with a letter (0–9, symbols…). */
export const NO_LETTER = -1;

/** Which alphabet index an app name starts with (-1 if it isn't a letter). */
export function letterForName(name: string): number {
  const c = name.trim().charAt(0).toUpperCase();
  const i = ALPHABET.indexOf(c);
  return i < 0 ? NO_LETTER : i;
}

/**
 * Letter under a finger at horizontal position `x` within a field `width`
 * wide. x is clamped to the field so the mapping stays stable when the finger
 * overshoots the edges. 0 → 'A', width-1 → 'Z'.
 */
export function letterIndexAt(x: number, width: number): number {
  if (width <= 0) return 0;
  const clamped = Math.max(0, Math.min(width, x));
  const i = Math.floor((clamped / width) * ALPHABET.length);
  return Math.max(0, Math.min(ALPHABET.length - 1, i));
}

/** The letter glyph for an index ('' for an out-of-range index). */
export function letterOf(index: number): string {
  return ALPHABET[index] ?? '';
}