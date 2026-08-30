/**
 * Hardware identifiers for the Touch Bar and its host machine — DRM driver
 * names, backlight sysfs nodes, USB id and the keyboard bridge name. Single
 * source of truth for every TypeScript consumer (the renderer and the control
 * center). install.sh, the udev rule and the C++ binding keep their own
 * literal copies; they're bash/udev/C++ and can't import this.
 *
 * These values are read from env at startup, defaulting to the upstream
 * (t2linux) names when a variable is unset. Each distro sources its own env
 * file — .env.example.t2linux or .env.example.kait2en — so a build runs with a
 * single, coherent set of names (never a union across distros).
 *
 * List-valued variables are comma-separated strings.
 */

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

function readStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

// Touch Bar backlight sysfs node, in preference order. 'display-pipe' is the
// generic DRM-pipe fallback; appletb_backlight (upstream) / t2tb_backlight
// (KaiT2en) are the HID-backlight names.
export const TB_BACKLIGHT_NAMES: string[] = readList(
  'REACT_DRM_TB_BACKLIGHT_NAMES', ['display-pipe', 'appletb_backlight']);

// Host display (laptop panel) backlight candidates, in preference order. Used
// to drive the on-screen brightness slider, not the Touch Bar itself.
// Mirrors tiny-dfr's find_display_backlight().
export const DISPLAY_BACKLIGHT_NAMES: string[] = readList(
  'REACT_DRM_DISP_BACKLIGHT_NAMES',
  ['apple-panel-bl', 'gmux_backlight', 'intel_backlight', 'acpi_video0']);

export const DISP_BACKLIGHT_NAMES: string[] = DISPLAY_BACKLIGHT_NAMES;

// Touch Bar DRM panel driver (appletbdrm upstream, t2bdrm on KaiT2en forks).
// A DRM card whose uevent DRIVER= matches the selected one is the Touch Bar.
export const TOUCHBAR_DRM_DRIVERS: string[] = readList(
  'REACT_DRM_DRM_DRIVER', ['appletbdrm']);

// Touch Bar Display USB id (Apple, T2 Touch Bar — 05ac:8302).
export const TOUCHBAR_USB_VENDOR_ID: string = readStr('REACT_DRM_USB_VENDOR', '05ac');
export const TOUCHBAR_USB_PRODUCT_ID: string = readStr('REACT_DRM_USB_PRODUCT', '8302');

// Built-in T2 keyboard bridge tokens (apple-bce/bce-vhci upstream, t2bce on
// KaiT2en forks). Matched as substrings against the keyboard syspath. The C++
// binding mirrors this via its own REACT_DRM_USB_BRIDGE read.
export const TOUCHBAR_USB_BRIDGE: string[] = readList(
  'REACT_DRM_USB_BRIDGE', ['apple-bce', 'bce-vhci']);
