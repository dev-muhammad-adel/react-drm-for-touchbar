import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dbus, { MessageBus, Variant } from 'dbus-next';

// Spotify registers a single MPRIS2 service. Chrome itself has no native MPRIS2
// service on Linux; on KDE Plasma the `plasma-browser-integration` Chrome
// extension exposes browser media sessions over D-Bus.
const PLAYER_CONFIGS = [
  { prefix: 'org.mpris.MediaPlayer2.spotify', name: 'spotify' as const },
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
}

export interface MediaPlayer {
  /** D-Bus service name, e.g. `org.mpris.MediaPlayer2.spotify`. */
  service: string;
  /** Human-readable source: `chrome` (via plasma-browser-integration) or `spotify`. */
  name: 'chrome' | 'spotify';
  /** Current playback state. */
  state: MediaPlayerState;
  /** Toggle play/pause on this player. */
  playPause(): void;
  /** Skip to the next track. */
  next(): void;
  /** Go back to the previous track. */
  previous(): void;
}

const IDLE: MediaPlayerState = { title: '', artist: '', status: 'Stopped' };

function readMeta(meta: Record<string, Variant> | undefined): Pick<MediaPlayerState, 'title' | 'artist'> {
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
  };
}

export interface UseMediaPlayersResult {
  /** True when at least one Chrome/Spotify MPRIS player is present on the bus. */
  show: boolean;
  /** True when no Chrome/Spotify MPRIS player is present (convenience alias). */
  hide: boolean;
  /** One entry per detected player, in detection order. */
  players: MediaPlayer[];
}

/**
 * Tracks Chrome (via KDE plasma-browser-integration) and Spotify MPRIS2 players.
 * Returns visibility flags and an array of control/status objects.
 */
export function useMediaPlayers(): UseMediaPlayersResult {
  const [services, setServices] = useState<string[]>([]);
  const [states,   setStates]   = useState<Record<string, MediaPlayerState>>({});
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
    })().catch(() => {});

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
            if (changed.Metadata) Object.assign(next, readMeta(changed.Metadata.value as Record<string, Variant>));
            return { ...prev, [service]: next };
          });
        });

        await applyAll();

        cleanups.push(() => {
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

  // ── Stable control callbacks keyed by service ──────────────────────────────
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

  // ── Expose one MediaPlayer object per detected service ─────────────────────
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
      };
    });
  }, [services, states, playPause, next, previous]);

  const show = players.length > 0;

  return { show, hide: !show, players };
}
