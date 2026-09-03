import { execFile, execFileSync } from 'child_process';
import { PW_ENV } from './volume';

// Same wpctl-preferred/pactl-fallback pattern as volume.ts, targeting the
// default input (source) instead of the default output (sink).

function hasWpctl(): boolean {
  try { execFileSync('wpctl', ['--help'], { encoding: 'utf8', env: PW_ENV }); return true; }
  catch { return false; }
}

const USE_WPCTL = hasWpctl();

export function readMicMuted(): boolean {
  try {
    if (USE_WPCTL) {
      const out = execFileSync('wpctl', ['get-volume', '@DEFAULT_AUDIO_SOURCE@'],
        { encoding: 'utf8', env: PW_ENV });
      return out.includes('[MUTED]');
    } else {
      const out = execFileSync('pactl', ['get-source-mute', '@DEFAULT_SOURCE@'],
        { encoding: 'utf8' });
      return /Mute:\s*yes/.test(out);
    }
  } catch { return false; }
}

export function toggleMicMute(done: () => void): void {
  if (USE_WPCTL) {
    execFile('wpctl', ['set-mute', '@DEFAULT_AUDIO_SOURCE@', 'toggle'],
      { env: PW_ENV },
      (err) => { if (err) console.error('[mic] wpctl:', err.message); done(); },
    );
  } else {
    execFile('pactl', ['set-source-mute', '@DEFAULT_SOURCE@', 'toggle'],
      (err) => { if (err) console.error('[mic] pactl:', err.message); done(); },
    );
  }
}
