import net from 'net';
import fs from 'fs';
import type { ActiveWindow, ActiveWindowBackend } from './types';
import { EMPTY } from './types';

// Auto-discover the Hyprland instance dir — works even when running as root
// (where HYPRLAND_INSTANCE_SIGNATURE may not be in the environment).
// Also used by detect.ts as the "is Hyprland running" probe.
export function findHyprDir(): string | null {
  const sig     = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  const runtime = process.env.XDG_RUNTIME_DIR ?? '/run/user/1000';

  const bases = [`${runtime}/hypr`, '/tmp/hypr'];

  for (const base of bases) {
    // If we know the signature, try it directly first.
    if (sig) {
      const dir = `${base}/${sig}`;
      try { fs.accessSync(`${dir}/.socket2.sock`); return dir; } catch { /**/ }
    }
    // Otherwise scan for the first directory that has a socket.
    try {
      for (const entry of fs.readdirSync(base)) {
        const dir = `${base}/${entry}`;
        try { fs.accessSync(`${dir}/.socket2.sock`); return dir; } catch { /**/ }
      }
    } catch { /**/ }
  }
  return null;
}

function queryActiveWindow(dir: string): Promise<ActiveWindow> {
  return new Promise(resolve => {
    const cmd = net.createConnection(`${dir}/.socket.sock`);
    let buf = '';
    cmd.write('j/activewindow'); // 'j' prefix = JSON output (like hyprctl -j)
    cmd.on('data', (c: Buffer) => { buf += c.toString(); });
    cmd.on('end', () => {
      try {
        const json = JSON.parse(buf) as { class?: string; title?: string; pid?: number };
        resolve(json.class !== undefined
          ? { class: json.class ?? '', title: json.title ?? '', pid: json.pid ?? 0 }
          : EMPTY);
      } catch { resolve(EMPTY); }
    });
    cmd.on('error', () => resolve(EMPTY));
  });
}

export const hyprland: ActiveWindowBackend = {
  name: 'hyprland',

  async start(push) {
    const dir = findHyprDir();
    if (!dir) return null;
    let alive = true;

    const refresh = () => queryActiveWindow(dir).then(w => { if (alive) push(w); });

    // Fetch the window that is already focused right now.
    refresh();

    // Focus-change events carry class/title but not pid, so each event
    // triggers a one-shot command-socket query for the full picture.
    const ev = net.createConnection(`${dir}/.socket2.sock`);
    let carry = '';

    ev.on('data', (chunk: Buffer) => {
      carry += chunk.toString('utf8');
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      if (lines.some(l => l.startsWith('activewindow>>') || l.startsWith('windowtitle>>'))) refresh();
    });

    ev.on('error', () => {});

    return () => { alive = false; ev.destroy(); };
  },
};
