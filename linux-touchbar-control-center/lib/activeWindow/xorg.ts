import { spawn, execFile, type ChildProcess } from 'child_process';
import fs from 'fs';
import type { ActiveWindow, ActiveWindowBackend } from './types';
import { EMPTY } from './types';

// Plain X11 (any window manager) via `xprop`, the EWMH way:
//   - _NET_ACTIVE_WINDOW on the root window names the focused client;
//   - _NET_WM_NAME / WM_CLASS / _NET_WM_PID on that client give the rest.
// `xprop -spy` is push-based (one line per change), so we mirror the
// hyprland backend: a long-lived spy on the root drives a one-shot query
// for the full picture, and a second spy on the focused window catches
// title changes that don't move focus (terminals, browsers, …).
//
// GNOME-on-Xorg is handled by the gnome backend (Window Monitor Pro), which
// also delivers pids; this is the fallback for every other X11 desktop.

// Discover a DISPLAY/XAUTHORITY even under sudo, where both env vars are
// usually stripped — same source-of-truth-on-disk idea as detect.ts.
function xEnv(): NodeJS.ProcessEnv | null {
  const env = { ...process.env };

  if (!env.DISPLAY) {
    try {
      for (const f of fs.readdirSync('/tmp/.X11-unix')) {
        const m = /^X(\d+)$/.exec(f);
        if (m) { env.DISPLAY = `:${m[1]}`; break; }
      }
    } catch { /**/ }
  }
  if (!env.DISPLAY) return null;

  if (!env.XAUTHORITY) {
    const user = process.env.SUDO_USER;
    const candidates = [
      user && `/home/${user}/.Xauthority`,
      process.env.SUDO_UID && `/run/user/${process.env.SUDO_UID}/.Xauthority`,
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      try { fs.accessSync(c); env.XAUTHORITY = c; break; } catch { /**/ }
    }
  }
  return env;
}

// xprop quotes strings; the active-window id is the first hex word.
const firstQuoted  = (line: string) => /"((?:[^"\\]|\\.)*)"/.exec(line)?.[1];
const lastQuoted   = (line: string) => [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].pop()?.[1];
const firstWindowId = (line: string) => /0x[0-9a-f]+/i.exec(line)?.[0];

function queryWindow(env: NodeJS.ProcessEnv, id: string): Promise<ActiveWindow> {
  return new Promise(resolve => {
    execFile('xprop', ['-id', id, '_NET_WM_NAME', 'WM_NAME', 'WM_CLASS', '_NET_WM_PID'],
      { env }, (err, stdout) => {
        if (err) return resolve(EMPTY);
        let netName = '', wmName = '', klass = '', pid = 0;
        for (const line of stdout.split('\n')) {
          if (line.startsWith('_NET_WM_NAME')) netName = firstQuoted(line) ?? '';
          else if (line.startsWith('WM_NAME'))  wmName = firstQuoted(line) ?? '';
          // WM_CLASS is (instance, class) — the class matches Hyprland's `class`.
          else if (line.startsWith('WM_CLASS')) klass = lastQuoted(line) ?? '';
          else if (line.startsWith('_NET_WM_PID')) pid = Number(/\d+/.exec(line)?.[0] ?? 0);
        }
        resolve({ title: netName || wmName, class: klass, pid });
      });
  });
}

export const xorg: ActiveWindowBackend = {
  name: 'xorg (xprop)',

  async start(push) {
    const env = xEnv();
    if (!env) return null;

    let alive = true;
    let activeId: string | null = null;
    let rootSpy: ChildProcess | null = null;
    let titleSpy: ChildProcess | null = null;

    const refresh = () => {
      if (!activeId) { push(EMPTY); return; }
      const id = activeId;
      queryWindow(env, id).then(w => { if (alive && id === activeId) push(w); });
    };

    // A fresh title spy bound to whichever window is focused now, so a
    // terminal/browser retitling itself updates without a focus change.
    const watchTitle = (id: string) => {
      titleSpy?.kill();
      // Spy only the EWMH title — watching WM_NAME too would double every
      // event (both update together). The focus-change query still reads
      // WM_NAME, so legacy apps without _NET_WM_NAME keep their title.
      titleSpy = spawn('xprop', ['-id', id, '-spy', '_NET_WM_NAME'], { env });
      titleSpy.stdout?.on('data', () => { if (alive) refresh(); });
      titleSpy.on('error', () => {});
    };

    const onActive = (id: string | null) => {
      if (id === activeId) return;
      activeId = id;
      refresh();
      if (id) watchTitle(id); else titleSpy?.kill();
    };

    rootSpy = spawn('xprop', ['-root', '-spy', '_NET_ACTIVE_WINDOW'], { env });
    // spawn errors (xprop missing) surface async — without a root spy we have
    // no backend, so tear down and let the store fall through.
    rootSpy.on('error', () => { alive = false; titleSpy?.kill(); });

    let carry = '';
    rootSpy.stdout?.on('data', (chunk: Buffer) => {
      carry += chunk.toString('utf8');
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('_NET_ACTIVE_WINDOW')) continue;
        const id = firstWindowId(line);
        onActive(id && !/^0x0+$/.test(id) ? id : null);
      }
    });

    // xprop -spy prints the current value immediately, so the initial focus
    // arrives through the stream above — no separate priming query needed.
    return () => { alive = false; rootSpy?.kill(); titleSpy?.kill(); };
  },
};
