import dbus from 'dbus-next';
import type { ActiveWindowBackend } from './types';

// GNOME Wayland via the Window Monitor Pro shell extension
// (https://extensions.gnome.org/extension/8549/window-monitor-pro/):
// push-based WindowFocusChanged(id, title, class, pid) signal plus
// Focus* methods for the initial state.

const SVC   = 'org.gnome.Shell';
const PATH  = '/org/gnome/Shell/Extensions/WindowMonitorPro';
const IFACE = 'org.gnome.Shell.Extensions.WindowMonitorPro';

export const gnome: ActiveWindowBackend = {
  name: 'gnome (window-monitor-pro)',

  async start(push) {
    let bus: dbus.MessageBus;
    try {
      bus = dbus.sessionBus();
    } catch { return null; }

    try {
      const obj   = await bus.getProxyObject(SVC, PATH);
      const iface = obj.getInterface(IFACE);
      if (!iface) throw new Error('extension not installed');

      iface.on('WindowFocusChanged', (_id: number, title: string, klass: string, pid: number) => {
        push({ title: String(title ?? ''), class: String(klass ?? ''), pid: Number(pid ?? 0) });
      });

      // Initial state — methods may fail when no window is focused yet.
      const [title, klass, pid] = await Promise.all([
        iface.FocusTitle().catch(() => ''),
        iface.FocusClass().catch(() => ''),
        iface.FocusPID().catch(() => 0),
      ]);
      push({ title: String(title ?? ''), class: String(klass ?? ''), pid: Number(pid ?? 0) });

      return () => { bus.disconnect(); };
    } catch {
      bus.disconnect();
      return null; // not GNOME, or the extension isn't installed/enabled
    }
  },
};
