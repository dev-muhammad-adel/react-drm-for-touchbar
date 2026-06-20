import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dbus, { MessageBus, Variant } from 'dbus-next';

// Spotify exposes a stable MPRIS2 service. Browser media support in this app
// comes from plasma-browser-integration, which exports the active browser
// session over MPRIS with working metadata / position on the systems we target.
const PLAYER_CONFIGS = [
  { prefix: 'org.mpris.MediaPlayer2.spotify', name: 'spotify' as const },
  { prefix: 'org.mpris.MediaPlayer2.plasma-browser-integration', name: 'browser' as const },
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
  /** Current position in microseconds. */
  positionUs: number;
  /** Total track length in microseconds, 0 when unknown. */
  lengthUs: number;
}

export interface MediaPlayer {
  /** D-Bus service name, e.g. `org.mpris.MediaPlayer2.spotify`. */
  service: string;
  /** Human-readable source. */
  name: 'browser' | 'spotify';
  /** Current playback state. */
  state: MediaPlayerState;
  /** Toggle play/pause on this player. */
  playPause(): void;
  /** Skip to the next track. */
  next(): void;
  /** Go back to the previous track. */
  previous(): void;
  /** Seek to an absolute position in microseconds. */
  seek(positionUs: number): void;
}

const IDLE: MediaPlayerState = {
  title: '',
  artist: '',
  status: 'Stopped',
  artUrl: '',
  positionUs: 0,
  lengthUs: 0,
};

function num(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0;
}

function matchPlayerConfig(service: string) {
  return PLAYER_CONFIGS.find(c => service.startsWith(c.prefix));
}

function normalizeServices(names: string[]): string[] {
  return names
    .filter(name => matchPlayerConfig(name))
    .sort((a, b) => a.localeCompare(b));
}

function readMeta(meta: Record<string, Variant> | undefined): Pick<MediaPlayerState, 'title' | 'artist' | 'artUrl' | 'lengthUs'> {
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
    lengthUs: num(m['mpris:length']?.value),
  };
}

export interface UseMediaPlayersResult {
  /** True when at least one Chrome/Spotify MPRIS player is present on the bus. */
  show: boolean;
  /** True when no Chrome/Spotify MPRIS player is present (convenience alias). */
  hide: boolean;
  /** True until the first bus scan resolves — distinguishes "still discovering" from "no players". */
  loading: boolean;
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
  const [loading,  setLoading]  = useState(true);
  const busRef = useRef<MessageBus | null>(null);
  const trackIdsRef = useRef<Record<string, string>>({});

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
        const match = matchPlayerConfig(name);
        if (!match) return;
        if (newOwner) svcs.add(name); else svcs.delete(name);
        alive && setServices(normalizeServices([...svcs]));
      });
      const names: string[] = await diface.ListNames();
      if (!alive) return;
      names.forEach(name => {
        const match = matchPlayerConfig(name);
        if (match) svcs.add(name);
      });
      alive && setServices(normalizeServices([...svcs]));
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
        const match = matchPlayerConfig(service);
        const obj    = await bus.getProxyObject(service, OBJ);
        if (!alive) return;
        const props  = obj.getInterface(PROPS);
        const player = obj.getInterface(PLAYER);

        const refreshPosition = async () => {
          try {
            const reply = await bus.call(new dbus.Message({
              destination: service,
              path: OBJ,
              interface: PROPS,
              member: 'Get',
              signature: 'ss',
              body: [PLAYER, 'Position'],
            }));
            if (!alive) return;
            const positionUs = num((reply?.body[0] as Variant | undefined)?.value);
            setStates(prev => {
              const current = prev[service] ?? IDLE;
              if (Math.abs(current.positionUs - positionUs) < 50_000) return prev;
              return { ...prev, [service]: { ...current, positionUs } };
            });
          } catch { /* player closed or doesn't expose Position */ }
        };

        const refreshAll = async () => {
          try {
            const all = await props.GetAll(PLAYER) as Record<string, Variant>;
            if (!alive) return;
            const meta = all.Metadata?.value as Record<string, Variant> | undefined;
            trackIdsRef.current[service] = (meta?.['mpris:trackid']?.value as string) ?? '';
            setStates(prev => ({
              ...prev,
              [service]: {
                ...readMeta(meta),
                status: (all.PlaybackStatus?.value as PlayerStatus) ?? 'Stopped',
                positionUs: num(all.Position?.value),
              },
            }));
            void refreshPosition();
          } catch { /* player closed */ }
        };

        props.on('PropertiesChanged', (iface: string, changed: Record<string, Variant>) => {
          if (!alive || iface !== PLAYER) return;
          let refreshAfter = false;
          setStates(prev => {
            const current = prev[service] ?? IDLE;
            const next: MediaPlayerState = { ...current };
            if (changed.PlaybackStatus) next.status = changed.PlaybackStatus.value as PlayerStatus;
            if (changed.Metadata) {
              const meta = changed.Metadata.value as Record<string, Variant>;
              trackIdsRef.current[service] = (meta['mpris:trackid']?.value as string) ?? '';
              Object.assign(next, readMeta(meta));
              refreshAfter = true;
            }
            if (changed.Position) next.positionUs = num(changed.Position.value);
            if (next.title === current.title && next.artist === current.artist
                && next.status === current.status && next.artUrl === current.artUrl
                && next.positionUs === current.positionUs && next.lengthUs === current.lengthUs) {
              return prev;
            }
            return { ...prev, [service]: next };
          });
          if (changed.PlaybackStatus || refreshAfter) void refreshPosition();
        });

        player.on('Seeked', () => { void refreshPosition(); });
        const posPoll = setInterval(() => { void refreshPosition(); }, 500);
        const fullPoll = match?.name === 'browser'
          ? setInterval(() => { void refreshAll(); }, 1000)
          : null;
        await refreshAll();

        cleanups.push(() => {
          clearInterval(posPoll);
          if (fullPoll) clearInterval(fullPoll);
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
  const seek = useCallback((service: string | undefined, positionUs: number) => {
    const bus = busRef.current;
    const svc = service ?? services[0];
    const trackId = svc ? trackIdsRef.current[svc] : '';
    if (!bus || !svc || !trackId) return;
    bus.call(new dbus.Message({
      destination: svc,
      path: OBJ,
      interface: PLAYER,
      member: 'SetPosition',
      signature: 'ox',
      body: [trackId, BigInt(Math.max(0, Math.round(positionUs)))],
    })).catch(() => {});
  }, [services]);

  const players = useMemo<MediaPlayer[]>(() => {
    return services.map(service => {
      const match = matchPlayerConfig(service);
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
