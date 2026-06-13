import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
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
const TARGET  = 64; // preferred raster size (px) when picking among PNG sizes

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

interface Hit { path: string; svg: boolean; size: number; }

/** Recursively collect `${name}.svg|png` under a theme dir (depth-limited). */
function walk(dir: string, name: string, out: Hit[], depth = 0): void {
  if (depth > 5) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { continue; }
    if (isDir) { walk(full, name, out, depth + 1); continue; }
    if (entry === `${name}.svg`) out.push({ path: full, svg: true, size: sizeFromPath(full) });
    else if (entry === `${name}.png`) out.push({ path: full, svg: false, size: sizeFromPath(full) });
  }
}

/** Pull a pixel size out of a theme path like `.../48x48/apps/foo.png`. */
function sizeFromPath(p: string): number {
  const m = p.match(/(\d+)x\1/);
  if (m) return parseInt(m[1], 10);
  if (/scalable/.test(p)) return 1024; // treat scalable as "largest"
  return 0;
}

const cache = new Map<string, string | null>();

/** Find the best icon file for a name across the theme chain + pixmaps. */
function findIcon(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;

  // Already a usable path?
  if ((isAbsolute(name) || name.includes('/')) && existsSync(name)) {
    cache.set(name, name);
    return name;
  }

  const hits: Hit[] = [];
  for (const base of ICON_BASES) {
    for (const theme of THEME_CHAIN) {
      walk(join(base, theme), name, hits);
    }
  }
  for (const ext of ['svg', 'png']) {
    const p = join(PIXMAPS, `${name}.${ext}`);
    if (existsSync(p)) hits.push({ path: p, svg: ext === 'svg', size: ext === 'svg' ? 1024 : 0 });
  }

  // Prefer SVG; among rasters, the size closest to TARGET (then larger).
  hits.sort((a, b) => {
    if (a.svg !== b.svg) return a.svg ? -1 : 1;
    return Math.abs(a.size - TARGET) - Math.abs(b.size - TARGET);
  });

  const best = hits[0]?.path ?? null;
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
