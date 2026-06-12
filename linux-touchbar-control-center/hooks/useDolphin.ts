import fs from 'fs';
import { useState, useEffect, useRef, useCallback } from 'react';
import dbus, { MessageBus } from 'dbus-next';
import { DOLPHIN } from '../config';
import { useActiveWindow } from './useActiveWindow';

// Dolphin exposes every menu action as a QAction D-Bus object at
// <window>/actions/<name> — trigger() invokes it, properties carry state.
// All calls use low-level Messages: the MainWindow interface has overloaded
// methods (openDirectories) that break dbus-next's proxy introspection.
//
// Each dolphin window is usually its own process (org.kde.dolphin-<pid>),
// and a process can also host several windows (/dolphin/Dolphin_<n>). The
// hook tracks every instance and targets the focused one: the compositor's
// active-window pid names the service directly, and isActiveWindow() picks
// the window when a process hosts more than one.

const WATCHED = {
  canBack:    { action: 'go_back',           prop: 'enabled' },
  canForward: { action: 'go_forward',        prop: 'enabled' },
  hidden:     { action: 'show_hidden_files', prop: 'checked' },
  split:      { action: 'split_view',        prop: 'checked' },
  preview:    { action: 'show_preview',      prop: 'checked' },
} as const;

export type DolphinState = { [K in keyof typeof WATCHED]: boolean };

const IDLE: DolphinState = { canBack: false, canForward: false, hidden: false, split: false, preview: false };

export interface Place { title: string; path: string }

interface Target { svc: string; win: string }

/** Quick-jump chips come from KDE's own Places sidebar bookmarks. */
function loadPlaces(): Place[] {
  try {
    const xml = fs.readFileSync(`${process.env.HOME}/.local/share/user-places.xbel`, 'utf8');
    const places: Place[] = [];
    const re = /<bookmark[^>]*href="file:\/\/([^"]*)"[^>]*>([\s\S]*?)<\/bookmark>/g;
    for (let m; (m = re.exec(xml)) && places.length < DOLPHIN.maxPlaces;) {
      if (/IsHidden>true</.test(m[2])) continue;
      const title = m[2].match(/<title>([^<]*)<\/title>/)?.[1];
      if (title) places.push({ title, path: decodeURIComponent(m[1]) });
    }
    return places;
  } catch { return []; }
}

export function useDolphin() {
  const [connected, setConnected] = useState(false);
  const [state,     setState]     = useState<DolphinState>(IDLE);
  const [places]                  = useState<Place[]>(loadPlaces);

  const { pid: activePid } = useActiveWindow();

  const busRef    = useRef<MessageBus | null>(null);
  const svcsRef   = useRef<Set<string>>(new Set());
  const targetRef = useRef<Target | null>(null);
  const pidRef    = useRef(0);

  pidRef.current = activePid;

  const call = useCallback(async (svc: string, path: string, iface: string, member: string, signature = '', body: unknown[] = []) => {
    const bus = busRef.current;
    if (!bus) return null;
    return bus.call(new dbus.Message({ destination: svc, path, interface: iface, member, signature, body }));
  }, []);

  /** Point targetRef at the focused dolphin window. */
  const resolveTarget = useCallback(async () => {
    const bus  = busRef.current!;
    const svcs = svcsRef.current;
    if (svcs.size === 0) { targetRef.current = null; return; }

    // The focused window's pid (from the compositor) names its service
    // directly; other live services are fallbacks for focus transitions.
    const byPid   = `org.kde.dolphin-${pidRef.current}`;
    const ordered = svcs.has(byPid) ? [byPid, ...[...svcs].filter(s => s !== byPid)] : [...svcs];

    for (const svc of ordered) {
      try {
        const root = await bus.getProxyObject(svc, '/dolphin');
        const wins = root.nodes.filter(n => /\/Dolphin_\d+$/.test(n));
        if (wins.length === 0) continue;
        let win = wins[0];
        if (wins.length > 1) {
          // Process hosts several windows — ask which one has focus.
          for (const w of wins) {
            const reply = await call(svc, w, 'org.kde.dolphin.MainWindow', 'isActiveWindow').catch(() => null);
            if (reply?.body[0]) { win = w; break; }
          }
        }
        targetRef.current = { svc, win };
        return;
      } catch { continue; } // service died mid-scan
    }
    targetRef.current = null;
  }, [call]);

  useEffect(() => {
    let alive = true;
    const bus = dbus.sessionBus();
    busRef.current = bus;

    const syncConnected = () => setConnected(svcsRef.current.size > 0);

    async function init() {
      const obj   = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      const iface = obj.getInterface('org.freedesktop.DBus');

      iface.on('NameOwnerChanged', (name: string, _old: string, newOwner: string) => {
        if (!alive || !name.startsWith('org.kde.dolphin-')) return;
        if (newOwner) {
          svcsRef.current.add(name);
        } else {
          svcsRef.current.delete(name);
          if (targetRef.current?.svc === name) targetRef.current = null;
          if (svcsRef.current.size === 0) setState(IDLE);
        }
        syncConnected();
      });

      const names: string[] = await iface.ListNames();
      if (!alive) return;
      names.filter(n => n.startsWith('org.kde.dolphin-')).forEach(n => svcsRef.current.add(n));
      syncConnected();
    }

    init().catch(() => {});

    // Dolphin's QAction adaptor declares emits-change but never sends
    // PropertiesChanged, so live button state has to be polled.
    const timer = setInterval(async () => {
      if (!alive || svcsRef.current.size === 0) return;
      try {
        await resolveTarget();
        const target = targetRef.current;
        if (!target) return;
        const entries = await Promise.all(
          (Object.keys(WATCHED) as (keyof typeof WATCHED)[]).map(async key => {
            const { action, prop } = WATCHED[key];
            const reply = await call(target.svc, `${target.win}/actions/${action}`, 'org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.qtproject.Qt.QAction', prop]);
            return [key, Boolean((reply?.body[0] as dbus.Variant)?.value)] as const;
          }),
        );
        if (!alive) return;
        setState(prev => {
          const next = Object.fromEntries(entries) as DolphinState;
          return (Object.keys(next) as (keyof DolphinState)[]).some(k => next[k] !== prev[k]) ? next : prev;
        });
      } catch { /* window mid-close — NameOwnerChanged will clean up */ }
    }, DOLPHIN.pollMs);

    return () => {
      alive = false;
      clearInterval(timer);
      bus.disconnect();
    };
  }, [resolveTarget, call]);

  /** Trigger any dolphin action by name on the focused window (no-op on disabled actions). */
  const trigger = useCallback((action: string) => {
    const t = targetRef.current;
    if (t) call(t.svc, `${t.win}/actions/${action}`, 'org.qtproject.Qt.QAction', 'trigger').catch(() => {});
  }, [call]);

  /** Open a directory in a new tab — Dolphin's D-Bus offers no way to navigate the current view. */
  const openDir = useCallback((path: string) => {
    const t = targetRef.current;
    if (t) call(t.svc, t.win, 'org.kde.dolphin.MainWindow', 'openDirectories', 'asb', [[`file://${path}`], false]).catch(() => {});
  }, [call]);

  return { connected, state, places, trigger, openDir };
}
