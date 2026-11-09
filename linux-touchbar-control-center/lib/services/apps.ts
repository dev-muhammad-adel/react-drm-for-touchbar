import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import dbus from 'dbus-next';
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
  iconSrc: string | null;   // resolved SVG/PNG/JPEG/WEBP icon, or null → fallback
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

/** Icon= may be a freedesktop name or an absolute SVG/PNG/JPEG/WEBP path. */
function resolveIcon(icon: string | undefined): string | null {
  return icon ? appIconSource(icon) : null;
}

// ─── Directories ─────────────────────────────────────────────────────────────

function appDirs(): string[] {
  const home = process.env.HOME ?? '';
  return [
    `${home}/.local/share/applications`,
    `${home}/.local/share/flatpak/exports/share/applications`,
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
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

export function parseFavoriteApps(output: string): string[] {
  return Array.from(output.matchAll(/'([^']+\.desktop)'/g), match => match[1]);
}

/** Ubuntu Dock/GNOME Dash favorites in their visible order, with the complete
 * installed-app list as fallback on other desktops. */
export function getLauncherApps(): AppInfo[] {
  const all = getInstalledApps();
  try {
    const output = execFileSync('gsettings', ['get', 'org.gnome.shell', 'favorite-apps'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const favorites = favoriteApps(output, all);
    if (favorites.length > 0) return favorites;
  } catch { /* gsettings/GNOME is optional */ }
  return all;
}

function favoriteApps(output: string, all: AppInfo[]): AppInfo[] {
  const byId = new Map(all.map(app => [app.id, app]));
  const favorites = parseFavoriteApps(output)
    .map(id => byId.get(id))
    .filter((app): app is AppInfo => app !== undefined);
  return Array.from(new Map(favorites.map(app => [app.id, app])).values());
}

export interface RunningApp {
  id: string;
  name: string;
  icon: string;
}

/** Applications Shell.AppSystem considers running, including unpinned apps.
 * Provided by window-monitor-pro because GNOME blocks Shell.Introspection for
 * ordinary processes. */
export async function getRunningApps(): Promise<RunningApp[]> {
  try {
    const bus = dbus.sessionBus();
    const obj = await bus.getProxyObject('org.gnome.Shell', '/org/gnome/Shell/Extensions/WindowMonitorPro');
    const iface = obj.getInterface('org.gnome.Shell.Extensions.WindowMonitorPro');
    const apps = await iface.RunningApps() as unknown as string;
    const parsed = JSON.parse(apps) as RunningApp[];
    bus.disconnect();
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Ubuntu Dock semantics: pinned favorites in visible order, followed by
 * running unpinned apps in GNOME Shell's running-app order. */
export async function getDockApps(): Promise<AppInfo[]> {
  const all = getInstalledApps();
  let apps = getLauncherApps();

  const running = await getRunningApps();
  if (running.length > 0) {
    const byId = new Map(all.map(app => [app.id, app]));
    const present = new Set(apps.map(app => app.id));
    for (const app of running) {
      if (present.has(app.id)) continue;
      const known = byId.get(app.id);
      const command = known?.command ?? `gtk-launch ${app.id.replace(/\.desktop$/, '')}`;
      const item: AppInfo = {
        id: app.id,
        name: known?.name ?? app.name,
        iconSrc: known?.iconSrc ?? appIconSource(app.icon),
        command,
        args: known?.args ?? [],
      };
      apps = [...apps, item];
      present.add(app.id);
    }
  }
  return apps;
}