import { KEY } from 'react-drm';
import type { KeyId } from 'react-drm';

/**
 * Central configuration for the example app.
 * Anything tunable lives here — add new sections as features grow.
 */

// ─── Display ────────────────────────────────────────────────────────────────

export const DISPLAY = {
  dimSecs:          30,   // seconds of inactivity before dimming
  offSecs:          60,   // seconds of inactivity before turning off
  pixelShiftSecs:   300,  // OLED pixel-shift interval
  activeBrightness: 2,
} as const;

// ─── On-screen Esc key ───────────────────────────────────────────────────────

export const ESC_KEY: {
  minWidth: number;
  onLayers: 'all' | 'fn';
  width: number;
  gap: number;
} = {
  // Wide Touch Bars (MacBooks without a physical Esc key) report a wider
  // panel — the standard bar is 2008 px, the wide variant 2170 px. Show an
  // on-screen Esc at the far left when the auto-detected display width is at
  // least this. Set to 0 to always show, Infinity to never.
  minWidth: 2170,
  // Where the Esc key shows on wide displays:
  //   'all' — a fixed Esc button at the far left of every layer
  //   'fn'  — Esc shows only in the Fn-key layer, sized like the F-keys
  onLayers: 'fn',
  // Only used by 'all' mode (the fixed left button); 'fn' mode sizes Esc
  // like the surrounding F-keys.
  width:    110,  // px reserved on the left for the Esc button
  gap:      8,    // px between the Esc button and the layer area
} as const;

// ─── Touch Bar lifecycle ─────────────────────────────────────────────────────

export const SLEEP = {
  // In-app Touch Bar lifecycle: attach at startup, quiesce before system
  // sleep (logind delay inhibitor), re-attach + resume after. Applies to
  // every run mode — manual `npm run dev` and react-drm.service alike.
  enabled: true,
  // How long to wait for the appletbdrm card at startup and after resume
  // (covers re-enumeration, udev permission settling and config-write retries).
  cardWaitSecs: 30,
} as const;

// ─── Layer transitions ──────────────────────────────────────────────────────

export const LAYER_TRANSITION = {
  outDurationMs: 200, // leaving layer (fade-out / slide-out)
  inDurationMs:  350, // entering layer — slower so the new layer eases in
} as const;

// ─── Active window tracking ─────────────────────────────────────────────────

export const ACTIVE_WINDOW = {
  // 'auto' detects the session (Xorg vs Wayland, then Hyprland vs GNOME —
  // sudo-safe, via sockets not env vars) and picks the matching backend.
  // Set a backend name to skip detection and force one.
  backend: 'auto' as 'auto' | 'hyprland' | 'gnome',
};

// ─── Screenshots ────────────────────────────────────────────────────────────

// The app usually runs under sudo — save into the real user's home, not /root.
const home = process.env.SUDO_USER ? `/home/${process.env.SUDO_USER}` : (process.env.HOME ?? '.');

export const SCREENSHOT = {
  // Physical keys held together to save a touchbar screenshot. F-keys won't
  // work here — touch bar Macs have no physical F-row, and the touchbar's own
  // injected keys bypass the keyboard reader. Names from KEY_NAMES in react-drm.
  keys: ['ctrl', 'alt', 's'] as KeyId[],
  dir:  `${home}/Pictures/touchbar`,  // created on first use
};

// ─── Dolphin panel ──────────────────────────────────────────────────────────

export const DOLPHIN = {
  maxPlaces: 5,   // quick-jump place chips shown in the panel
  pollMs:    400, // action-state poll interval (dolphin emits no property-change signals)
};

// ─── Browser shortcuts ──────────────────────────────────────────────────────

/**
 * Each value is an array of Linux keycodes pressed simultaneously,
 * listed in the order they should be held down.
 * All available codes are in the KEY object from 'react-drm'.
 */
export type BrowserKeymap = {
  back:     number[];
  forward:  number[];
  reload:   number[];
  newTab:   number[];
  closeTab: number[];
  nextTab:  number[];
  prevTab:  number[];
};

/** Fallback shortcuts, used for any browser without an override below. */
export const DEFAULT_BROWSER_KEYS: BrowserKeymap = {
  back:     [KEY.LEFTALT,  KEY.LEFT],
  forward:  [KEY.LEFTALT,  KEY.RIGHT],
  reload:   [KEY.LEFTCTRL, KEY.KEY_R],
  newTab:   [KEY.LEFTCTRL, KEY.KEY_T],
  closeTab: [KEY.LEFTCTRL, KEY.KEY_W],
  nextTab:  [KEY.LEFTCTRL, KEY.TAB],
  prevTab:  [KEY.LEFTCTRL, KEY.LEFTSHIFT, KEY.TAB],
};


export const BROWSER_KEY_OVERRIDES: Record<string, Partial<BrowserKeymap>> = {
  // firefox:       { reload: [KEY.F5] },
  // chromium:      { nextTab: [KEY.LEFTCTRL, KEY.PAGEDOWN], prevTab: [KEY.LEFTCTRL, KEY.PAGEUP] },
  // 'google-chrome': {},
};

/** Resolve the effective keymap for a window class. */
export function browserKeysFor(windowClass: string): BrowserKeymap {
  const overrides = BROWSER_KEY_OVERRIDES[windowClass.toLowerCase()] ?? {};
  return { ...DEFAULT_BROWSER_KEYS, ...overrides };
}
