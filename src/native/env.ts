import fs from 'fs';
import path from 'path';

// Loads the repo-root `.env` (per-distro hardware profile) before any module
// that reads process.env — src/index.ts imports this first, so the native
// binding's getenv(), hardware.ts and every runtime consumer all see the
// seeded values. Real exported environment variables win over the file.
// Format is plain KEY=VALUE, same as systemd's EnvironmentFile (which is how
// the installed service gets them): comments (#) and blank lines are skipped,
// an optional leading `export ` is tolerated, and surrounding quotes on the
// value are stripped.

function candidatePaths(): string[] {
  const explicit = process.env.REACT_DRM_ENV_FILE;
  const cwd = process.cwd();
  const here = __dirname;
  return [
    explicit,
    path.resolve(cwd, '.env'),
    path.resolve(cwd, '..', '.env'),
    path.resolve(here, '..', '..', '.env'),       // src/native -> repo root (dev/tsx)
    path.resolve(here, '..', '..', '..', '.env'),  // dist/src/native -> repo root (built)
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

function setFromFile(file: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const keyValue = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const eq = keyValue.indexOf('=');
    if (eq <= 0) continue;
    const key = keyValue.slice(0, eq).trim();
    let value = keyValue.slice(eq + 1).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue; // real env wins
    if (value.length >= 2
        && ((value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

export function loadRepoEnv(): void {
  for (const file of candidatePaths()) {
    if (fs.existsSync(file)) {
      setFromFile(file);
      return; // first existing file only, so cwd/.env can shadow the repo root
    }
  }
}

loadRepoEnv();