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

const log = createLogger('config');

let mod: typeof import('../../config.blueprint');
try {
  mod = require('../../config');
  log.info('loaded user config.ts; using user overrides instead of defaults from config.blueprint.ts');
} catch (err) {
  if ((err as NodeJS.ErrnoException)?.code !== 'MODULE_NOT_FOUND') throw err;
  mod = require('../../config.blueprint');
  log.info('no user config.ts found; using defaults from config.blueprint.ts');
}

export const DISPLAY = mod.DISPLAY;
export const ESC_KEY = mod.ESC_KEY;
export const SLEEP = mod.SLEEP;
export const LAYER_TRANSITION = mod.LAYER_TRANSITION;
export const ACTIVE_WINDOW = mod.ACTIVE_WINDOW;
export const SCREENSHOT = mod.SCREENSHOT;
export const DOLPHIN = mod.DOLPHIN;
export const KONSOLE = mod.KONSOLE;
export const SYSTEMBAR = mod.SYSTEMBAR;
export const CAVA = mod.CAVA;
export const DEFAULT_BROWSER_KEYS = mod.DEFAULT_BROWSER_KEYS;
export const BROWSER_KEY_OVERRIDES = mod.BROWSER_KEY_OVERRIDES;
export const browserKeysFor = mod.browserKeysFor;
export const DEFAULT_VSCODE_KEYS = mod.DEFAULT_VSCODE_KEYS;
export const VSCODE_KEY_OVERRIDES = mod.VSCODE_KEY_OVERRIDES;
export const vscodeKeysFor = mod.vscodeKeysFor;
export const DOCK = mod.DOCK;
export const FN_LAYER = mod.FN_LAYER;
export const FN_KEYS = mod.FN_KEYS;

// Must run before any appIconSource() call anywhere in the app (dock.tsx's
// module-level ICON_SRC included) — setIconTheme() also clears the lookup
// cache, so even a call this early is safe regardless of what else has
// already imported this module.
setIconTheme(DOCK.icons.theme);

export type { BrowserKeymap, VsCodeKeymap, DockApp, FnKeyExtra } from '@/config.blueprint';
