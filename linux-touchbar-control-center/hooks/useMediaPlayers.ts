import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dbus, { MessageBus, Variant } from 'dbus-next';

// Modern Chromium builds expose browser media sessions directly. Plasma
// Browser Integration remains a fallback for browsers without native MPRIS2.
const PLAYER_CONFIGS = [
  { prefix: 'org.mpris.MediaPlayer2.spotify', name: 'spotify' as const },
  { prefix: 'org.mpris.MediaPlayer2.firefox', name: 'firefox' as const },
  { prefix: 'org.mpris.MediaPlayer2.brave', name: 'chrome' as const },
  { prefix: 'org.mpris.MediaPlayer2.chromium', name: 'chrome' as const },
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
 * Tracks supported MPRIS2 players, including Spotify, Firefox and
 * Chromium-based browsers.
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
        const applyAll = async () => {
          try {
            const reply = await bus.call(new dbus.Message({
              destination: service,
              path: OBJ,
              interface: PROPS,
              member: 'GetAll',
              signature: 's',
              body: [PLAYER],
            }));
            if (!reply) return;
            const all = reply.body[0] as Record<string, Variant>;
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

        await applyAll();
        const poll = setInterval(applyAll, 1000);

        cleanups.push(() => clearInterval(poll));
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
