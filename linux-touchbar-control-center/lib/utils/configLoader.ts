/**
 * Resolves the active config: the user's editable `config.ts` (gitignored,
 * not tracked — survives `git pull`) if present, else the tracked
 * `config.blueprint.ts` defaults. `install.sh` seeds `config.ts` from the
 * blueprint on first install; this fallback covers running without having
 * installed yet (e.g. `npm run dev` on a fresh clone).
 *
 * A real error in the user's `config.ts` (syntax error, bad import, etc.)
 * is rethrown rather than silently falling back, so broken edits fail loudly.
 */

import { createLogger, setIconTheme } from 'react-drm';

// require() is `any`; typing it as the blueprint module keeps `keyof typeof
// blueprint` (used by cfg below) resolved to real config keys instead of the
// catch-all `string | number | symbol` — otherwise every cfg() call would
// silently type its section as `any`.
const blueprint = require('../../config.blueprint') as typeof import('../../config.blueprint');
const log = createLogger('config');

let mod: typeof import('../../config.blueprint');
try {
  mod = require('../../config');
  log.info('loaded user config.ts; using user overrides instead of defaults from config.blueprint.ts');
} catch (err) {
  if ((err as NodeJS.ErrnoException)?.code !== 'MODULE_NOT_FOUND') throw err;
  mod = blueprint;
  log.info('no user config.ts found; using defaults from config.blueprint.ts');
}

/** Use a section from the user's config.ts, falling back to config.blueprint.ts if missing. */
function cfg<K extends keyof typeof blueprint>(key: K): (typeof blueprint)[K] {
  return mod[key] !== undefined ? mod[key] : blueprint[key];
}

export const DISPLAY = cfg('DISPLAY');
export const ESC_KEY = cfg('ESC_KEY');
export const SLEEP = cfg('SLEEP');
export const LAYER_TRANSITION = cfg('LAYER_TRANSITION');
export const ACTIVE_WINDOW = cfg('ACTIVE_WINDOW');
export const SCREENSHOT = cfg('SCREENSHOT');
export const DOLPHIN = cfg('DOLPHIN');
export const KONSOLE = cfg('KONSOLE');
export const SYSTEMBAR = cfg('SYSTEMBAR');
export const CAVA = cfg('CAVA');
export const DEFAULT_BROWSER_KEYS = cfg('DEFAULT_BROWSER_KEYS');
export const BROWSER_KEY_OVERRIDES = cfg('BROWSER_KEY_OVERRIDES');
export const browserKeysFor = cfg('browserKeysFor');
export const DEFAULT_VSCODE_KEYS = cfg('DEFAULT_VSCODE_KEYS');
export const VSCODE_KEY_OVERRIDES = cfg('VSCODE_KEY_OVERRIDES');
export const vscodeKeysFor = cfg('vscodeKeysFor');
export const DOCK = cfg('DOCK');
export const FN_LAYER = cfg('FN_LAYER');
export const FN_KEYS = cfg('FN_KEYS');
export const CUSTOM_LAYER = cfg('CUSTOM_LAYER');

// Must run before any appIconSource() call anywhere in the app (dock.tsx's
// module-level ICON_SRC included) — setIconTheme() also clears the lookup
// cache, so even a call this early is safe regardless of what else has
// already imported this module.
setIconTheme(DOCK.icons.theme);

export type { BrowserKeymap, VsCodeKeymap, DockApp, FnKeyExtra } from '@/config.blueprint';
