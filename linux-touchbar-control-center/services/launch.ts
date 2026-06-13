import { spawn } from 'child_process';
import { readdirSync } from 'fs';
import type { DockApp } from '../config';

/**
 * Launch a desktop app from the Touch Bar process.
 *
 * The control center usually runs as root (react-drm.service / sudo), but GUI
 * apps must start inside the real user's graphical session. When SUDO_USER is
 * set we drop to that user with `runuser` and reconstruct the session env
 * (XDG_RUNTIME_DIR, the user D-Bus bus, and the Wayland/X display) so the app
 * can reach the compositor. Run directly otherwise.
 */
export function launchApp(app: DockApp): void {
  const { command, args = [] } = app;
  const uid      = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const sudoUser = process.env.SUDO_USER;
  const sudoUid  = process.env.SUDO_UID;

  let child;
  if (uid === 0 && sudoUser && sudoUid) {
    const runtimeDir = `/run/user/${sudoUid}`;
    const env = [
      `XDG_RUNTIME_DIR=${runtimeDir}`,
      `DBUS_SESSION_BUS_ADDRESS=unix:path=${runtimeDir}/bus`,
      `DISPLAY=${process.env.DISPLAY ?? ':0'}`,
    ];
    const wayland = detectWayland(runtimeDir);
    if (wayland) env.push(`WAYLAND_DISPLAY=${wayland}`);

    child = spawn(
      'runuser',
      ['-u', sudoUser, '--', 'env', ...env, command, ...args],
      { detached: true, stdio: 'ignore' },
    );
  } else {
    child = spawn(command, args, { detached: true, stdio: 'ignore' });
  }

  child.on('error', err => console.error('[dock] launch failed:', command, err.message));
  child.unref();
}

/** Find the user's Wayland socket name (e.g. `wayland-1`) under their runtime dir. */
function detectWayland(runtimeDir: string): string | null {
  if (process.env.WAYLAND_DISPLAY) return process.env.WAYLAND_DISPLAY;
  try {
    return readdirSync(runtimeDir).find(f => /^wayland-\d+$/.test(f)) ?? null;
  } catch {
    return null;
  }
}
