import { useState, useEffect, useRef, useCallback } from 'react';
import dbus, { MessageBus, Variant } from 'dbus-next';
import { useActiveWindow } from './useActiveWindow';

// VLC speaks MPRIS2. It registers org.mpris.MediaPlayer2.vlc, and extra
// instances get a .instanceN suffix — so we track every name under that prefix
// and target the focused one by matching the compositor's active-window pid
// (resolved via GetConnectionUnixProcessID), mirroring useDolphin's approach.
//
// MPRIS events are used for status/metadata changes. Position is refreshed by
// a lightweight poll so external seeks (e.g. from VLC UI) are reflected
// reliably without relying on signal quality.

const PREFIX = 'org.mpris.MediaPlayer2.vlc';
const OBJ    = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PROPS  = 'org.freedesktop.DBus.Properties';

export type VlcStatus = 'Playing' | 'Paused' | 'Stopped';

export interface VlcState {
  title:      string;
  artist:     string;
  status:     VlcStatus;
  positionUs: number; // microseconds, polled from Player.Position
  lengthUs:   number; // microseconds (0 = unknown / no track)
}

const IDLE: VlcState = { title: '', artist: '', status: 'Stopped', positionUs: 0, lengthUs: 0 };

const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0);

/** Pull title/artist/length out of an MPRIS Metadata a{sv} dict. */
function readMeta(meta: Record<string, Variant> | undefined) {
  const m = meta ?? {};
  const artistRaw = m['xesam:artist']?.value;
  // Local files often lack xesam:title — fall back to the filename from the url.
  let title = (m['xesam:title']?.value as string) ?? '';
  if (!title) {
    const url = m['xesam:url']?.value as string | undefined;
    const base = url?.split('/').pop();
    if (base) { try { title = decodeURIComponent(base); } catch { title = base; } }
  }
  return {
    title,
    artist:   Array.isArray(artistRaw) ? artistRaw.join(', ') : ((artistRaw as string) ?? ''),
    lengthUs: num(m['mpris:length']?.value),
  };
}

export function useVlc() {
  const [connected, setConnected] = useState(false);
  const [state,     setState]     = useState<VlcState>(IDLE);
  const [services,  setServices]  = useState<string[]>([]);
  const [target,    setTarget]    = useState<string | null>(null);

  const { pid: activePid } = useActiveWindow();
  const busRef     = useRef<MessageBus | null>(null);
  const targetRef  = useRef<string | null>(null);
  const trackIdRef = useRef<string>(''); // mpris:trackid of the current track (for SetPosition)

  // ── Track every VLC MPRIS name on the bus ────────────────────────────────
  useEffect(() => {
    let alive = true;
    const bus = dbus.sessionBus();
    busRef.current = bus;
    const svcs = new Set<string>();
    const sync = () => alive && setServices([...svcs]);

    (async () => {
      const dobj  = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      const diface = dobj.getInterface('org.freedesktop.DBus');
      diface.on('NameOwnerChanged', (name: string, _old: string, newOwner: string) => {
        if (!alive || !name.startsWith(PREFIX)) return;
        if (newOwner) svcs.add(name); else svcs.delete(name);
        sync();
      });
      const names: string[] = await diface.ListNames();
      if (!alive) return;
      names.filter(n => n.startsWith(PREFIX)).forEach(n => svcs.add(n));
      sync();
    })().catch(() => {});

    return () => { alive = false; busRef.current = null; bus.disconnect(); };
  }, []);

  // ── Resolve which instance is focused (by pid) ───────────────────────────
  useEffect(() => {
    let alive = true;
    const bus = busRef.current;
    if (!bus || services.length === 0) { setTarget(null); return; }
    if (services.length === 1) { setTarget(services[0]); return; }
    (async () => {
      for (const svc of services) {
        const reply = await bus.call(new dbus.Message({
          destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus',
          interface: 'org.freedesktop.DBus', member: 'GetConnectionUnixProcessID',
          signature: 's', body: [svc],
        })).catch(() => null);
        if (alive && reply && Number(reply.body[0]) === activePid) { setTarget(svc); return; }
      }
      if (alive) setTarget(services[0]); // focused pid not matched — fall back
    })();
    return () => { alive = false; };
  }, [services, activePid]);

  // ── Subscribe to the focused instance's signals ──────────────────────────
  useEffect(() => {
    const bus = busRef.current;
    if (!bus || !target) { setConnected(false); setState(IDLE); return; }
    let alive = true;
    setConnected(true);

    // One-shot Get of Position to re-anchor after a metadata/status event.
    const anchorPosition = async () => {
      try {
        const reply = await bus.call(new dbus.Message({
          destination: target, path: OBJ, interface: PROPS,
          member: 'Get', signature: 'ss', body: [PLAYER, 'Position'],
        }));
        if (alive) {
          const pos = num((reply?.body[0] as Variant)?.value);
          setState(prev => (Math.abs(prev.positionUs - pos) >= 50_000 ? { ...prev, positionUs: pos } : prev));
        }
      } catch { /* instance closing */ }
    };

    const posPoll = setInterval(() => { void anchorPosition(); }, 250);

    (async () => {
      const obj    = await bus.getProxyObject(target, OBJ);
      if (!alive) return;
      const props  = obj.getInterface(PROPS);
      const player = obj.getInterface(PLAYER);

      // Initial full read.
      const all = await props.GetAll(PLAYER) as Record<string, Variant>;
      if (!alive) return;
      const meta0 = all.Metadata?.value as Record<string, Variant> | undefined;
      trackIdRef.current = (meta0?.['mpris:trackid']?.value as string) ?? '';
      setState({
        ...readMeta(meta0),
        status:     (all.PlaybackStatus?.value as VlcStatus) ?? 'Stopped',
        positionUs: num(all.Position?.value),
      });
      void anchorPosition();

      // Status / metadata changes.
      props.on('PropertiesChanged', (iface: string, changed: Record<string, Variant>, invalidated: string[]) => {
        if (!alive || iface !== PLAYER) return;
        let metaChanged = false;
        setState(prev => {
          const next = { ...prev };
          if (changed.PlaybackStatus) next.status = changed.PlaybackStatus.value as VlcStatus;
          if (changed.Metadata) {
            const m = changed.Metadata.value as Record<string, Variant>;
            trackIdRef.current = (m['mpris:trackid']?.value as string) ?? '';
            Object.assign(next, readMeta(m));
            metaChanged = true;
          }
          if (changed.Position) next.positionUs = num(changed.Position.value);
          return next;
        });
        // A new track / play-pause resets where position should anchor.
        if (metaChanged || changed.PlaybackStatus || invalidated?.includes('Position')) anchorPosition();
      });

      // Seeks are reflected by polling Position; keep this listener as a fast path.
      player.on('Seeked', () => { void anchorPosition(); });
    })().catch(() => {});

    return () => {
      alive = false;
      clearInterval(posPoll);
      bus.getProxyObject(target, OBJ).then(obj => {
        obj.getInterface(PROPS).removeAllListeners('PropertiesChanged');
        obj.getInterface(PLAYER).removeAllListeners('Seeked');
      }).catch(() => {});
    };
  }, [target]);

  targetRef.current = target;

  /** Toggle play/pause on the focused instance (MPRIS Player.PlayPause). */
  const playPause = useCallback(() => {
    const bus = busRef.current, svc = targetRef.current;
    if (!bus || !svc) return;
    bus.call(new dbus.Message({
      destination: svc, path: OBJ, interface: PLAYER, member: 'PlayPause',
    })).catch(() => {});
  }, []);

  /** Seek to an absolute position (µs) via MPRIS Player.SetPosition(trackId, x). */
  const seek = useCallback((positionUs: number) => {
    const bus = busRef.current, svc = targetRef.current, tid = trackIdRef.current;
    if (!bus || !svc || !tid) return;
    const targetUs = Math.max(0, Math.round(positionUs));

    bus.call(new dbus.Message({
      destination: svc, path: OBJ, interface: PLAYER, member: 'SetPosition',
      signature: 'ox', body: [tid, BigInt(targetUs)],
    }))
      .then(async () => {
        // Re-anchor to VLC's exact value; some streams clamp/adjust the target.
        try {
          const reply = await bus.call(new dbus.Message({
            destination: svc, path: OBJ, interface: PROPS,
            member: 'Get', signature: 'ss', body: [PLAYER, 'Position'],
          }));
          setState(prev => ({ ...prev, positionUs: num((reply?.body[0] as Variant)?.value) }));
        } catch { /* instance changed or closed */ }
      })
      .catch(() => {});
  }, []);

  return { connected, ...state, playPause, seek };
}
