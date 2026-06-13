import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dbus from 'dbus-next';
import type { ActiveWindow, ActiveWindowBackend } from './types';

// KDE Plasma Wayland via KWin scripting (~/active-window.sh, made push-based).
// KWin exposes no D-Bus query for the focused window, but a *loaded* script can
// hook workspace.windowActivated (and each window's captionChanged) and print
// the focus state on every change. KWin routes print() to the journal, so we
// inject a persistent script and tail journalctl for our marker lines.
//
// KDE-on-Xorg is handled by the xorg backend (EWMH props over the X protocol);
// this is only for the Wayland session, where that protocol is blocked.

const SVC             = 'org.kde.KWin';
const SCRIPTING_PATH  = '/Scripting';
const SCRIPTING_IFACE = 'org.kde.kwin.Scripting';
const SCRIPT_IFACE    = 'org.kde.kwin.Script';
const PLUGIN          = 'react-drm-activewindow';

// The injected KWin script: emit "<marker> class\ttitle\tpid" on the initial
// focus and on every focus/title change. captionChanged catches terminals and
// browsers retitling without moving focus (parity with the xorg backend).
function scriptSource(marker: string): string {
  const m = JSON.stringify(marker);
  return `
var active = null;
function emit(w) {
  if (w) print(${m} + " " + w.resourceClass + "\\t" + w.caption + "\\t" + w.pid);
  else   print(${m} + " \\t\\t0");
}
function onCaption() { emit(active); }
function onActivated(w) {
  try { if (active) active.captionChanged.disconnect(onCaption); } catch (e) {}
  active = w;
  try { if (w) w.captionChanged.connect(onCaption); } catch (e) {}
  emit(w);
}
workspace.windowActivated.connect(onActivated);
onActivated(workspace.activeWindow);
`;
}

// journalctl --since takes local "YYYY-MM-DD HH:MM:SS".
function journalStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const plasma: ActiveWindowBackend = {
  name: 'plasma (kwin-script)',

  async start(push) {
    let bus: dbus.MessageBus;
    try { bus = dbus.sessionBus(); } catch { return null; }

    let journal: ChildProcess | null = null;
    let scriptFile: string | null = null;

    try {
      // Is KWin on the bus? (Both Wayland and Xorg KDE own this name; the store
      // only routes the Wayland session here.)
      const dbusObj   = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      const dbusIface = dbusObj.getInterface('org.freedesktop.DBus');
      if (!(await dbusIface.NameHasOwner(SVC))) throw new Error('no KWin');

      const scripting = (await bus.getProxyObject(SVC, SCRIPTING_PATH)).getInterface(SCRIPTING_IFACE);

      // Unique marker per run so a crashed previous run's journal lines can't be
      // mistaken for ours.
      const marker = `REACTDRM_ACTWIN_${process.pid}`;

      // loadScript takes a file path. KWin runs as the user, so the file must be
      // world-readable even when we're under sudo (root-owned 0600 would be
      // unreadable to KWin) — same sudo-awareness as the other backends.
      scriptFile = path.join(os.tmpdir(), `react-drm-actwin-${process.pid}.js`);
      fs.writeFileSync(scriptFile, scriptSource(marker), { mode: 0o644 });

      // Start following the journal *before* loading the script, anchored a
      // second in the past, so the script's initial print() can't slip through
      // before journalctl attaches.
      const since = journalStamp(new Date(Date.now() - 1000));
      const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
      // Under sudo the per-user journal is root's; root can instead read the
      // merged system journal, where KWin's output also lands.
      const args = asRoot
        ? ['-f', '-o', 'cat', '--since', since]
        : ['--user', '-f', '-o', 'cat', '--since', since];
      journal = spawn('journalctl', args);
      journal.on('error', () => {}); // journalctl missing → no updates

      let carry = '';
      journal.stdout?.on('data', (chunk: Buffer) => {
        carry += chunk.toString('utf8');
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) {
          const i = line.indexOf(marker);
          if (i < 0) continue;
          const [klass = '', title = '', pid = '0'] = line.slice(i + marker.length + 1).split('\t');
          push({ title, class: klass, pid: Number(pid) || 0 });
        }
      });

      // A stale instance from a crashed run would double every line — drop it.
      if (await scripting.isScriptLoaded(PLUGIN).catch(() => false)) {
        await scripting.unloadScript(PLUGIN).catch(() => {});
      }

      // loadScript is overloaded (loadScript(path) and loadScript(path, name));
      // dbus-next binds the proxy to the single-arg signature, so call the
      // two-arg form by hand to get a named plugin we can cleanly unload.
      const reply = await bus.call(new dbus.Message({
        destination: SVC, path: SCRIPTING_PATH, interface: SCRIPTING_IFACE,
        member: 'loadScript', signature: 'ss', body: [scriptFile, PLUGIN],
      }));
      if (!reply) throw new Error('loadScript: no reply');
      const id     = reply.body[0] as number;
      const script = (await bus.getProxyObject(SVC, `${SCRIPTING_PATH}/Script${id}`)).getInterface(SCRIPT_IFACE);
      await script.run();

      return () => {
        journal?.kill();
        scripting.unloadScript(PLUGIN).catch(() => {}).finally(() => bus.disconnect());
        if (scriptFile) { try { fs.unlinkSync(scriptFile); } catch { /**/ } }
      };
    } catch {
      journal?.kill();
      if (scriptFile) { try { fs.unlinkSync(scriptFile); } catch { /**/ } }
      bus.disconnect();
      return null; // not KDE, or KWin scripting unavailable
    }
  },
};
