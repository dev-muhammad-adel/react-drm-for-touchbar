/**
 * Named colour palettes.
 *
 * Each palette matches the generic semantic THEME.colours schema (see
 * config.blueprint.ts) — the theme is an independent palette, and layers map
 * their UI onto its generic slots. The active palette is selected by name via
 * `THEME.theme` in the user's config.
 */
import type { ThemeColours } from './theme';

/** The default dark palette (matches the app's original built-in colors). */
export const macos: ThemeColours = {
  primary:        '#5b8def',
  primaryHover:   '#4a74d6',
  secondary:      '#373737',

  background:     '#000000',
  surface:        '#373737',
  surfaceVariant: '#474747',

  textPrimary:    '#cccccc',
  textSecondary:  '#94a3b8',
  textDisabled:   '#64748b',

  border:         '#171717',
  borderWidth:     2         ,

  divider:        '#1e293b',

  success:        '#4ade80',
  warning:        '#fde047',
  error:          '#f87171',
  info:           '#38bdf8',

  overlay:        '#272727',
  shadow:         '#000000',
};

/** A dark GNOME "Adwaita"-style palette. */
export const adwaitadark: ThemeColours = {
  primary:        '#3584e4',
  primaryHover:   '#5090ea',
  secondary:      '#3d3846',

  background:     '#1f1d26',
  surface:        '#3d3846',
  surfaceVariant: '#4b4658',

  textPrimary:    '#ffffff',
  textSecondary:  '#c0bfbc',
  textDisabled:   '#9a9996',

  border:         '#4b4658',
  borderWidth:     2         ,

  divider:        '#3d3846',

  success:        '#2ec27e',
  warning:        '#f5c211',
  error:          '#e01b24',
  info:           '#3584e4',

  overlay:        '#101014',
  shadow:         '#000000',
};

/** A dark, high-contrast palette. */
export const darkhighcontrast: ThemeColours = {
  primary:        '#4fc3f7',
  primaryHover:   '#81d4fa',
  secondary:      '#b0bec5',

  background:     '#000000',
  surface:        '#000000',
  surfaceVariant: '#1a1a1a',

  textPrimary:    '#ffffff',
  textSecondary:  '#d0d0d0',
  textDisabled:   '#9a9a9a',

  border:         '#373737',
  borderWidth:     2         ,
  divider:        '#373737',

  success:        '#66ff99',
  warning:        '#ffd740',
  error:          '#ff5252',
  info:           '#40c4ff',

  overlay:        '#000000',
  shadow:         '#000000',
};

/** All named palettes, keyed by theme name. */
export const THEMES: Record<string, ThemeColours> = {
  macos,
  adwaitadark,
  darkhighcontrast,
};
