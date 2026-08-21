import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Lists installed icon theme names — the same search directories appIcon.ts
 * (the app's runtime icon resolver, src/appIcon.ts) checks, so the picker
 * only offers themes that will actually resolve icons. A directory counts as
 * a theme if it has an index.theme file, per the freedesktop icon theme spec
 * — checked directly with existsSync rather than filtering by dirent type
 * first, since some theme installs are symlinks.
 */

const HOME = os.homedir();
const ICON_BASES = [
  path.join(HOME, '.local/share/icons'),
  path.join(HOME, '.icons'),
  '/usr/share/icons',
  '/usr/local/share/icons',
];

let cache: string[] | null = null;

export function listIconThemes(): string[] {
  if (cache) return cache;

  const seen = new Set<string>();
  for (const base of ICON_BASES) {
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (seen.has(name)) continue;
      if (fs.existsSync(path.join(base, name, 'index.theme'))) seen.add(name);
    }
  }

  const themes = [...seen].sort((a, b) => a.localeCompare(b));
  cache = themes;
  return themes;
}
