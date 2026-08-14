import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Lists installed applications by parsing freedesktop .desktop entries —
 * the same source every app launcher/dock on the desktop reads from, so the
 * picker offers exactly what's actually installed rather than asking the
 * user to know an app's exact command and icon name by heart.
 */

const HOME = os.homedir();
const APP_DIRS = [
  path.join(HOME, '.local/share/applications'),
  '/usr/share/applications',
  '/usr/local/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  path.join(HOME, '.local/share/flatpak/exports/share/applications'),
];

export interface DesktopAppEntry {
  name: string;
  command: string;
  args: string[];
  icon: string | null;
}

/** Tokenizes an Exec= value, honoring the freedesktop spec's double-quoting
 *  and backslash-escaping — spawn() takes the executable and each argument
 *  as separate array entries, it doesn't parse a shell command line itself. */
function splitExec(exec: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < exec.length; i++) {
    const ch = exec[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === '\\' && i + 1 < exec.length) { current += exec[++i]; continue; }
    if (!inQuotes && /\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseDesktopEntry(file: string): DesktopAppEntry | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let inEntrySection = false;
  let name: string | null = null;
  let exec: string | null = null;
  let icon: string | null = null;
  let noDisplay = false;
  let hidden = false;
  let isApplication = true;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEntrySection = line === '[Desktop Entry]';
      continue;
    }
    if (!inEntrySection) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'Name' && !name) name = value; // first (unlocalized) Name= wins
    else if (key === 'Exec') exec = value;
    else if (key === 'Icon') icon = value;
    else if (key === 'NoDisplay') noDisplay = value.toLowerCase() === 'true';
    else if (key === 'Hidden') hidden = value.toLowerCase() === 'true';
    else if (key === 'Type') isApplication = value === 'Application';
  }

  if (!name || !exec || noDisplay || hidden || !isApplication) return null;
  // Field codes (%f %F %u %U %i %c %k ...) are placeholders the launcher
  // fills in (a file path, an icon flag, ...) — meaningless for a fixed dock
  // entry, so drop any token that's exactly one, same as file managers do.
  const tokens = splitExec(exec).filter(t => !/^%[a-zA-Z]$/.test(t));
  if (tokens.length === 0) return null;
  const [command, ...args] = tokens;
  return { name, command, args, icon };
}

let cache: DesktopAppEntry[] | null = null;

export function listDesktopApps(): DesktopAppEntry[] {
  if (cache) return cache;

  const seen = new Set<string>();
  const apps: DesktopAppEntry[] = [];
  for (const dir of APP_DIRS) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).filter(f => f.endsWith('.desktop'));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (seen.has(entry)) continue; // earlier (more user-specific) dir wins
      const app = parseDesktopEntry(path.join(dir, entry));
      if (!app) continue;
      seen.add(entry);
      apps.push(app);
    }
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  cache = apps;
  return apps;
}
