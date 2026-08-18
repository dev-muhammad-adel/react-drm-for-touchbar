import { execFile, execFileSync } from 'child_process';

// When running as root the session socket isn't inherited — pass it explicitly.
export const PW_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? '/run/user/1000',
  PIPEWIRE_REMOTE: process.env.PIPEWIRE_REMOTE ?? '/run/user/1000/pipewire-0',
};

function hasWpctl(): boolean {
  try { execFileSync('wpctl', ['--help'], { encoding: 'utf8', env: PW_ENV }); return true; }
  catch { return false; }
}

const USE_WPCTL = hasWpctl();

export function readVolume(): number {
  try {
    if (USE_WPCTL) {
      const out = execFileSync('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@'],
        { encoding: 'utf8', env: PW_ENV });
      // "Volume: 0.50" or "Volume: 0.50 [MUTED]"
      const m = out.match(/Volume:\s*([\d.]+)/);
      return m ? Math.min(1, parseFloat(m[1])) : 0.5;
    } else {
      const out = execFileSync('pactl', ['get-sink-volume', '@DEFAULT_SINK@'],
        { encoding: 'utf8' });
      // "Volume: front-left: 65536 /  100% / ..."
      const m = out.match(/(\d+)%/);
      return m ? Math.min(1, parseInt(m[1]) / 100) : 0.5;
    }
  } catch { return 0.5; }
}

export function applyVolume(pct: number, done: () => void): void {
  if (USE_WPCTL) {
    execFile('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', pct.toFixed(4)],
      { env: PW_ENV },
      (err) => {
        if (err) console.error('[volume] wpctl:', err.message);
        done();
      },
    );
  } else {
    execFile('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${Math.round(pct * 100)}%`],
      (err) => {
        if (err) console.error('[volume] pactl:', err.message);
        done();
      },
    );
  }
}
