import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, isAbsolute, basename } from 'path';

/**
 * Resolve a freedesktop icon name (e.g. `org.kde.dolphin`, `firefox`) to a file
 * the librsvg-backed <Svg> can draw. SVG icons are returned directly; PNG icons
 * are wrapped once into a tiny inline-SVG <image> (librsvg renders embedded
 * raster) written to /tmp, so the whole dock stays on the crisp draw_svg path
 * without adding a PNG decoder. Returns null when nothing matches → the caller
 * falls back to a react-icons glyph.
 */

// Under sudo the app runs as root; resolve the *real* user's home for themes.
const HOME = process.env.SUDO_USER ? `/home/${process.env.SUDO_USER}` : (process.env.HOME ?? '/root');

const ICON_BASES = [
  join(HOME, '.local/share/icons'),
  join(HOME, '.icons'),
  '/usr/share/icons',
  '/usr/local/share/icons',
];
const PIXMAPS = '/usr/share/pixmaps';
const TMP_DIR = '/tmp/.react-drm-icons';

/** Read `Theme=` from a named section of a simple INI file. */
function iniValue(file: string, section: string, key: string): string | null {
  try {
    const txt = readFileSync(file, 'utf8');
    const lines = txt.split('\n');
    let inSection = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('[')) { inSection = line.toLowerCase() === `[${section.toLowerCase()}]`; continue; }
      if (inSection) {
        const m = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
        if (m) return m[1].trim();
      }
    }
  } catch { /* missing file */ }
  return null;
}

/** The user's configured icon theme (KDE first, then GTK), else hicolor. */
function currentTheme(): string {
  return (
    iniValue(join(HOME, '.config/kdeglobals'), 'Icons', 'Theme') ??
    iniValue(join(HOME, '.config/gtk-4.0/settings.ini'), 'Settings', 'gtk-icon-theme-name') ??
    iniValue(join(HOME, '.config/gtk-3.0/settings.ini'), 'Settings', 'gtk-icon-theme-name') ??
    'hicolor'
  );
}

const THEME_CHAIN = Array.from(new Set([currentTheme(), 'breeze', 'Papirus', 'Adwaita', 'hicolor']));

// Common raster sizes, in preference order (closest-to-TARGET-ish first).
const SIZES = [64, 48, 96, 128, 32, 256, 512, 24, 22, 16];

/**
 * Candidate file paths for one (base, theme, name), ordered best-first. This
 * probes the handful of standard freedesktop layouts with existsSync instead of
 * crawling the whole theme tree — a few dozen cheap stat()s vs. reading every
 * file in Papirus/hicolor (which was blocking the first dock switch).
 */
function candidates(base: string, theme: string, name: string): string[] {
  const dir = join(base, theme);
  const out: string[] = [];
  out.push(join(dir, 'scalable/apps', `${name}.svg`)); // most themes (Adwaita, Papirus, hicolor)
  for (const s of SIZES) out.push(join(dir, 'apps', String(s), `${name}.svg`)); // Breeze: apps/<size>/
  for (const s of SIZES) out.push(join(dir, `${s}x${s}`, 'apps', `${name}.svg`)); // sized svg
  for (const s of SIZES) out.push(join(dir, `${s}x${s}`, 'apps', `${name}.png`)); // sized raster
  out.push(join(dir, 'scalable/apps', `${name}-symbolic.svg`));
  return out;
}

const cache = new Map<string, string | null>();

/** Find the best icon file for a name across the theme chain + pixmaps. */
function findIcon(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;

  const resolve = (): string | null => {
    // Already a usable path?
    if ((isAbsolute(name) || name.includes('/')) && existsSync(name)) return name;

    // Probe standard layouts: preferred theme first, then fallbacks.
    for (const theme of THEME_CHAIN) {
      for (const base of ICON_BASES) {
        for (const p of candidates(base, theme, name)) {
          if (existsSync(p)) return p;
        }
      }
    }
    // Loose files in pixmaps.
    for (const ext of ['svg', 'png']) {
      const p = join(PIXMAPS, `${name}.${ext}`);
      if (existsSync(p)) return p;
    }
    return null;
  };

  const best = resolve();
  cache.set(name, best);
  return best;
}

/** Wrap a PNG into an inline-SVG <image> file librsvg can render. */
function wrapPng(file: string): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const out = join(TMP_DIR, basename(file).replace(/\.png$/i, '') + '.svg');
  if (!existsSync(out)) {
    const b64 = readFileSync(file).toString('base64');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'viewBox="0 0 1 1"><image width="1" height="1" preserveAspectRatio="xMidYMid meet" ' +
      `xlink:href="data:image/png;base64,${b64}"/></svg>`;
    writeFileSync(out, svg);
  }
  return out;
}

/**
 * Resolve an icon name to an <Svg>-renderable file path, or null if not found.
 * Results are memoised, so call freely.
 */
export function appIconSource(name: string): string | null {
  const file = findIcon(name);
  if (!file) return null;
  return file.toLowerCase().endsWith('.png') ? wrapPng(file) : file;
}
