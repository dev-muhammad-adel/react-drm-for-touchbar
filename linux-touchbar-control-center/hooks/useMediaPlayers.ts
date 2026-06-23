import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dbus, { MessageBus, Variant } from 'dbus-next';

// Spotify and Firefox expose native MPRIS2 services. Chrome itself has no
// native MPRIS2 service on Linux; on KDE Plasma the
// `plasma-browser-integration` extension exposes browser media sessions over
// D-Bus.
const PLAYER_CONFIGS = [
  { prefix: 'org.mpris.MediaPlayer2.spotify', name: 'spotify' as const },
  { prefix: 'org.mpris.MediaPlayer2.firefox', name: 'firefox' as const },
  { prefix: 'org.mpris.MediaPlayer2.plasma-browser-integration', name: 'chrome' as const },
];

const OBJ    = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PROPS  = 'org.freedesktop.DBus.Properties';

export type PlayerStatus = 'Playing' | 'Paused' | 'Stopped';

export interface MediaPlayerState {
  title:  string;
  artist: string;
  status: PlayerStatus;
  /** Album-art URL from MPRIS `mpris:artUrl` (http/https/file/data), or '' if none. */
  artUrl: string;
  /** Track length in microseconds (MPRIS `mpris:length`), 0 if unknown. */
  length: number;
  /** Last sampled playback position in microseconds (MPRIS `Position`). */
  position: number;
  /** Current track object path (MPRIS `mpris:trackid`), needed for SetPosition. */
  trackId: string;
}

export interface MediaPlayer {
  /** D-Bus service name, e.g. `org.mpris.MediaPlayer2.spotify`. */
  service: string;
  /** Human-readable source for the matched player service. */
  name: 'chrome' | 'firefox' | 'spotify';
  /** Current playback state. */
  state: MediaPlayerState;
  /** Toggle play/pause on this player. */
  playPause(): void;
  /** Skip to the next track. */
  next(): void;
  /** Go back to the previous track. */
  previous(): void;
  /** Seek to an absolute position in microseconds (MPRIS `SetPosition`). */
  seek(positionUs: number): void;
}

const IDLE: MediaPlayerState = { title: '', artist: '', status: 'Stopped', artUrl: '', length: 0, position: 0, trackId: '' };

function readMeta(meta: Record<string, Variant> | undefined): Pick<MediaPlayerState, 'title' | 'artist' | 'artUrl' | 'length' | 'trackId'> {
  const m = meta ?? {};
  const artistRaw = m['xesam:artist']?.value;
  let title = (m['xesam:title']?.value as string) ?? '';
  if (!title) {
    const url = m['xesam:url']?.value as string | undefined;
    const base = url?.split('/').pop();
    if (base) { try { title = decodeURIComponent(base); } catch { title = base; } }
  }
  return {
    title,
    artist: Array.isArray(artistRaw) ? artistRaw.join(', ') : ((artistRaw as string) ?? ''),
    artUrl: (m['mpris:artUrl']?.value as string) ?? '',
    // mpris:length is an int64 → dbus-next gives a BigInt; coerce to Number (µs).
    length: Number(m['mpris:length']?.value ?? 0),
    trackId: (m['mpris:trackid']?.value as string) ?? '',
  };
}

export interface UseMediaPlayersResult {
  /** True when at least one supported MPRIS player is present on the bus. */
  show: boolean;
  /** True when no supported MPRIS player is present (convenience alias). */
  hide: boolean;
  /** True until the first bus scan resolves — distinguishes "still discovering" from "no players". */
  loading: boolean;
  /** One entry per detected player, in detection order. */
  players: MediaPlayer[];
}

/**
 * Tracks supported MPRIS2 players, including Spotify, Firefox and Chrome via
 * KDE plasma-browser-integration.
 * Returns visibility flags and an array of control/status objects.
 */
export function useMediaPlayers(): UseMediaPlayersResult {
  const [services, setServices] = useState<string[]>([]);
  const [states,   setStates]   = useState<Record<string, MediaPlayerState>>({});
  const [loading,  setLoading]  = useState(true);
  const busRef = useRef<MessageBus | null>(null);

  // ── Track matching MPRIS service names on the session bus ──────────────────
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
        if (!alive) return;
        const match = PLAYER_CONFIGS.find(c => name.startsWith(c.prefix));
        if (!match) return;
        if (newOwner) svcs.add(name); else svcs.delete(name);
        sync();
      });
      const names: string[] = await diface.ListNames();
      if (!alive) return;
      names.forEach(name => {
        const match = PLAYER_CONFIGS.find(c => name.startsWith(c.prefix));
        if (match) svcs.add(name);
      });
      sync();
    })().catch(() => {}).finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; busRef.current = null; bus.disconnect(); };
  }, []);

  // ── Subscribe to every detected player and keep state in sync ──────────────
  useEffect(() => {
    const bus = busRef.current;
    if (!bus || services.length === 0) return;
    let alive = true;
    const cleanups: Array<() => void> = [];

    services.forEach(service => {
      (async () => {
        const obj    = await bus.getProxyObject(service, OBJ);
        if (!alive) return;
        const props  = obj.getInterface(PROPS);
        const player = obj.getInterface(PLAYER);

        const applyAll = async () => {
          try {
            const all = await props.GetAll(PLAYER) as Record<string, Variant>;
            if (!alive) return;
            const meta = all.Metadata?.value as Record<string, Variant> | undefined;
            setStates(prev => ({
              ...prev,
              [service]: {
                ...readMeta(meta),
                status: (all.PlaybackStatus?.value as PlayerStatus) ?? 'Stopped',
                position: Number(all.Position?.value ?? 0),
              },
            }));
          } catch { /* player closed */ }
        };

        props.on('PropertiesChanged', (iface: string, changed: Record<string, Variant>) => {
          if (!alive || iface !== PLAYER) return;
          setStates(prev => {
            const current = prev[service] ?? IDLE;
            const next: MediaPlayerState = { ...current };
            if (changed.PlaybackStatus) next.status = changed.PlaybackStatus.value as PlayerStatus;
            if (changed.Metadata) {
              Object.assign(next, readMeta(changed.Metadata.value as Record<string, Variant>));
              next.position = 0; // new track → restart the progress bar
            }
            return { ...prev, [service]: next };
          });
        });

        // Position is not push-notified: a Seeked signal covers jumps, and a 1s
        // poll keeps the bar moving during normal playback.
        player.on('Seeked', (pos: bigint | number) => {
          if (!alive) return;
          setStates(prev => prev[service]
            ? { ...prev, [service]: { ...prev[service], position: Number(pos) } }
            : prev);
        });

        const poll = setInterval(async () => {
          try {
            const v = await props.Get(PLAYER, 'Position');
            if (!alive) return;
            const position = Number((v as Variant)?.value ?? 0);
            setStates(prev => {
              const cur = prev[service];
              if (!cur || cur.position === position) return prev;
              return { ...prev, [service]: { ...cur, position } };
            });
          } catch { /* player closed */ }
        }, 1000);

        await applyAll();

        cleanups.push(() => {
          clearInterval(poll);
          props.removeAllListeners('PropertiesChanged');
          player.removeAllListeners('Seeked');
        });
      })().catch(() => {});
    });

    return () => {
      alive = false;
      cleanups.forEach(c => c());
    };
  }, [services]);

  const send = useCallback((service: string | undefined, member: 'PlayPause' | 'Next' | 'Previous') => {
    const bus = busRef.current;
    const svc = service ?? services[0];
    if (!bus || !svc) return;
    bus.call(new dbus.Message({
      destination: svc, path: OBJ, interface: PLAYER, member,
    })).catch(() => {});
  }, [services]);

  const playPause = useCallback((service?: string) => send(service, 'PlayPause'), [send]);
  const next      = useCallback((service?: string) => send(service, 'Next'),      [send]);
  const previous  = useCallback((service?: string) => send(service, 'Previous'),  [send]);

  // Absolute seek via MPRIS Player.SetPosition(o trackId, x positionµs).
  const seek = useCallback((service: string | undefined, positionUs: number) => {
    const bus = busRef.current;
    const svc = service ?? services[0];
    const tid = svc ? states[svc]?.trackId : undefined;
    if (!bus || !svc || !tid) return;
    bus.call(new dbus.Message({
      destination: svc, path: OBJ, interface: PLAYER, member: 'SetPosition',
      signature: 'ox', body: [tid, BigInt(Math.max(0, Math.round(positionUs)))],
    })).catch(() => {});
  }, [services, states]);

  const players = useMemo<MediaPlayer[]>(() => {
    return services.map(service => {
      const match = PLAYER_CONFIGS.find(c => service.startsWith(c.prefix));
      return {
        service,
        name: match?.name ?? 'spotify',
        state: states[service] ?? IDLE,
        playPause: () => playPause(service),
        next:      () => next(service),
        previous:  () => previous(service),
        seek:      (positionUs: number) => seek(service, positionUs),
      };
    });
  }, [services, states, playPause, next, previous, seek]);

  const show = players.length > 0;

  return { show, hide: !show, loading, players };
}
