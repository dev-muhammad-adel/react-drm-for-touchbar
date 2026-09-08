/**
 * Theme-driven colours (generic semantic slots).
 *
 * The theme is an independent source of truth: it exposes reusable, semantic
 * colour slots (primary / onPrimary, surface / surfaceVariant, backgrounds,
 * text tiers, status colors, borders, effects). Layers map their own UI onto
 * these slots, so the theme never depends on any specific layer.
 *
 * Reads THEME.colours from the user's config (see config.blueprint.ts).
 */
import { THEME } from './utils/configLoader';
import { THEMES } from './themes';


export interface ThemeColours {
  // Brand / interactive
  primary: string;
  primaryHover: string;
  secondary: string;

  // Backgrounds & surfaces
  background: string;
  surface: string;
  surfaceVariant: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textDisabled: string;

  // Lines
  border: string;
  borderWidth:number;
  divider: string;

  // Status / semantic
  success: string;
  warning: string;
  error: string;
  info: string;

  // Effects
  overlay: string;
  shadow: string;
}

const DEFAULT_THEME = 'macos';

function resolve(): ThemeColours {
  return THEMES[THEME.theme] ?? THEMES[DEFAULT_THEME];
}

/** The active colour palette, resolved from THEME.theme by name. */
export const SELECTED_THEME: ThemeColours = resolve();



/**
 * The active dock palette, resolved from THEME.dock by name (falls back to the
 * main theme when `THEME.dock` is unset).
 */

/** Hex `#rrggbb` → `rgba(r, g, b, a)` for translucent fills from a theme slot. */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
