import { useEffect, useState } from 'react';
import net from 'net';
import fs from 'fs';

export interface ActiveWindow {
  title: string;
  class: string;
}

const EMPTY: ActiveWindow = { title: '', class: '' };

// Auto-discover the Hyprland instance dir — works even when running as root
// (where HYPRLAND_INSTANCE_SIGNATURE may not be in the environment).
function findHyprDir(): string | null {
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

function parseLine(line: string): ActiveWindow | null {
  if (!line.startsWith('activewindow>>')) return null;
  const data  = line.slice('activewindow>>'.length);
  const comma = data.indexOf(',');
  return comma === -1
    ? { class: data, title: '' }
    : { class: data.slice(0, comma), title: data.slice(comma + 1) };
}

export function useActiveWindow(): ActiveWindow {
  const [win, setWin] = useState<ActiveWindow>(EMPTY);

  useEffect(() => {
    const dir = findHyprDir();
    if (!dir) return;

    // Fetch the window that is already focused right now.
    const cmd = net.createConnection(`${dir}/.socket.sock`);
    let buf = '';
    cmd.write('/activewindow');
    cmd.on('data', (c: Buffer) => { buf += c.toString(); });
    cmd.on('end', () => {
      try {
        const json = JSON.parse(buf) as { class?: string; title?: string };
        if (json.class !== undefined) {
          setWin({ class: json.class ?? '', title: json.title ?? '' });
        }
      } catch { /**/ }
    });
    cmd.on('error', () => {});

    // Subscribe to focus-change events.
    const ev = net.createConnection(`${dir}/.socket2.sock`);
    let carry = '';

    ev.on('data', (chunk: Buffer) => {
      carry += chunk.toString('utf8');
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseLine(line.trim());
        if (!parsed) continue;
        setWin(prev =>
          prev.class === parsed.class && prev.title === parsed.title ? prev : parsed,
        );
      }
    });

    ev.on('error', () => {});

    return () => { cmd.destroy(); ev.destroy(); };
  }, []);

  return win;
}
