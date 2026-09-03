import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appIconSource } from 'react-drm';

/**
 * Installed-app discovery for the launcher.
 *
 * Scans the freedesktop `.desktop` files (the same source the system app
 * menu / application drawer is built from) in the usual priority order —
 * user-local first, system-wide last — dedupes by desktop-file id, parses
 * each entry (Name / Exec / Icon) and resolves the icon through the
 * react-drm icon theme. The scan runs once per process and is cached.
 */

export interface AppInfo {
  id:      string;          // desktop-file id (stable React key, dedupe key)
  name:    string;          // display name, used for alphabet sections + sort
  iconSrc: string | null;   // resolved theme/path icon, or null → letter avatar
  command: string;          // executable to spawn
  args:    string[];        // extra launch arguments
}

// ─── Exec parsing ────────────────────────────────────────────────────────────

/**
 * Clean an Exec= line from a .desktop file into a command + argv.
 * Drops the .desktop field codes (%f %F %u …) and decodes %% → %, tokenizes
 * respecting quotes. Returns { command: null } when nothing executable is left.
 */
export function parseExec(exec: string): { command: string | null; args: string[] } {
  const cleaned = exec.replace(/%[fFuUdDnNickvm]/g, '').replace(/%%/g, '%').trim();
  if (!cleaned) return { command: null, args: [] };

  const tokens: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of cleaned) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return { command: tokens[0] ?? null, args: tokens.slice(1) };
}

// ─── .desktop parsing ────────────────────────────────────────────────────────

interface DesktopEntry {
  name?: string;
  exec?: string;
  icon?: string;
  type?: string;
  noDisplay?: boolean;
  hidden?: boolean;
}

/** Minimal [Desktop Entry] reading — key=value lines, no localization (Name only). */
function readDesktop(data: string): DesktopEntry | null {
  const desc: Record<string, string> = {};
  let inEntry = false;
  for (const rawLine of data.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { inEntry = line === '[Desktop Entry]'; continue; }
    if (!inEntry) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    desc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }

  if (desc.Type && desc.Type !== 'Application') return null;
  const name = desc.Name?.trim();
  const exec = desc.Exec?.trim();
  if (!name || !exec) return null;
  return {
    name,
    exec,
    icon: desc.Icon?.trim(),
    type: desc.Type,
    noDisplay: desc.NoDisplay === 'true',
    hidden: desc.Hidden === 'true',
  };
}

/** Icon= may be a freedesktop name (theme lookup) or an absolute path (SVG). */
function resolveIcon(icon: string | undefined): string | null {
  if (!icon) return null;
  if (icon.startsWith('/')) return /\.svg$/i.test(icon) ? icon : null;
  return appIconSource(icon);
}

// ─── Directories ─────────────────────────────────────────────────────────────

function appDirs(): string[] {
  const home = process.env.HOME ?? '';
  return [
    `${home}/.local/share/applications`,
    `${home}/.local/share/flatpak/exports/share/applications`,
    '/var/lib/flatpak/exports/share/applications',
    '/usr/local/share/applications',
    '/usr/share/applications',
  ];
}

// ─── Scan ────────────────────────────────────────────────────────────────────

/**
 * All installed apps, alphabetical, deduped by desktop-file id (a user-local
 * file overrides the identically-named system one). Cached after the first call.
 * Returns [] when the system has no Application .desktop entries.
 */
export function getInstalledApps(): AppInfo[] {
  if (installed) return installed;
  installed = scanApps();
  return installed;
}

let installed: AppInfo[] | null = null;

function scanApps(): AppInfo[] {
  const byId = new Map<string, AppInfo>();
  for (const dir of appDirs()) {
    let files: string[];
    try { files = readdirSync(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith('.desktop')) continue;
      if (byId.has(file)) continue; // higher-priority dir already won this id
      let entry: DesktopEntry | null;
      try {
        entry = readDesktop(readFileSync(path.join(dir, file), 'utf8'));
      } catch {
        continue;
      }
      if (!entry || entry.noDisplay || entry.hidden) continue;
      const { command, args } = parseExec(entry.exec!);
      if (!command) continue;
      byId.set(file, { id: file, name: entry.name!, iconSrc: resolveIcon(entry.icon), command, args });
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}