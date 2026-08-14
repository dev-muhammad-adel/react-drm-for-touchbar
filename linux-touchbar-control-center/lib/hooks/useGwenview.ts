import { useEffect, useRef, useCallback } from 'react';
import dbus, { MessageBus } from 'dbus-next';
import { useActiveWindow } from './useActiveWindow';

// Unlike Dolphin/Konsole/VLC, Gwenview registers no well-known D-Bus name at
// all — only its anonymous unique connection name (":1.NNN"), so there's no
// prefix to filter ListNames() by. The only way to find the right instance
// is to enumerate every unique connection on the session bus and match its
// pid (via GetConnectionUnixProcessID) against the compositor's focused
// window pid — reliable here because this hook is only ever used while the
// active window's class is already known to be gwenview (splittedLayer.tsx
// only shows GwenviewPanel in that case).
//
// Gwenview does expose the same generic QAction-per-menu-action D-Bus
// surface Dolphin does (confirmed by live introspection: /gwenview/
// MainWindow_1/actions/<name>, org.qtproject.Qt.QAction.trigger()) — but it
// has no method or property exposing the current image's folder or the
// list of images in it (checked exhaustively: every property, the full
// object tree in every UI state, open file descriptors, memory maps, its
// config file, recently-used.xbel), so there's no thumbnail strip here —
// the window title (via useActiveWindow, already read cross-desktop) is the
// only available "what's showing" signal.
const OBJ     = '/gwenview/MainWindow_1';
const QACTION = 'org.qtproject.Qt.QAction';

const ACTIONS = {
  prev:        'go_previous',
  next:        'go_next',
  zoomIn:      'view_zoom_in',
  zoomOut:     'view_zoom_out',
  rotateLeft:  'rotate_left',
  rotateRight: 'rotate_right',
  slideshow:   'toggle_slideshow',
  trash:       'file_trash',
} as const;

export function useGwenview() {
  const { pid: activePid, title } = useActiveWindow();
  const busRef    = useRef<MessageBus | null>(null);
  const targetRef = useRef<string | null>(null);

  useEffect(() => {
    const bus = dbus.sessionBus();
    busRef.current = bus;
    return () => { busRef.current = null; bus.disconnect(); };
  }, []);

  // Re-resolve which unique bus connection is the focused Gwenview window
  // whenever the focused pid changes.
  useEffect(() => {
    let alive = true;
    targetRef.current = null;
    const bus = busRef.current;
    if (!bus || !activePid) return;

    (async () => {
      const dobj   = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      const diface = dobj.getInterface('org.freedesktop.DBus');
      const names: string[] = await diface.ListNames();
      const uniques = names.filter(n => n.startsWith(':'));
      const pids = await Promise.all(
        uniques.map(n => diface.GetConnectionUnixProcessID(n).catch(() => -1)),
      );
      if (!alive) return;
      const idx = pids.findIndex(p => p === activePid);
      if (idx >= 0) targetRef.current = uniques[idx];
    })().catch(() => {});

    return () => { alive = false; };
  }, [activePid]);

  const trigger = useCallback((action: string) => {
    const bus = busRef.current, svc = targetRef.current;
    if (!bus || !svc) return;
    bus.call(new dbus.Message({
      destination: svc, path: `${OBJ}/actions/${action}`, interface: QACTION, member: 'trigger',
    })).catch(() => {});
  }, []);

  return {
    // Gwenview's title is "<filename> - WxH - Zoom% [*]" — strip the trailing
    // dimensions/zoom readout down to just the filename.
    filename:    title.replace(/\s+-\s+\d+x\d+.*$/, ''),
    prev:        () => trigger(ACTIONS.prev),
    next:        () => trigger(ACTIONS.next),
    zoomIn:      () => trigger(ACTIONS.zoomIn),
    zoomOut:     () => trigger(ACTIONS.zoomOut),
    rotateLeft:  () => trigger(ACTIONS.rotateLeft),
    rotateRight: () => trigger(ACTIONS.rotateRight),
    slideshow:   () => trigger(ACTIONS.slideshow),
    trash:       () => trigger(ACTIONS.trash),
  };
}
