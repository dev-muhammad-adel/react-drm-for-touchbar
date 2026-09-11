import dbus from 'dbus-next';

// systemd-logind transport over D-Bus (dbus-next). Owns the system-bus
// connection and the org.freedesktop.login1 session proxies, and nothing else:
// it just exposes raw session properties, session list, and session
// life-cycle / PropertiesChanged events. The selection logic lives in the
// watcher.

const LOGIN1_SERVICE = 'org.freedesktop.login1';
const LOGIN1_MANAGER_PATH = '/org/freedesktop/login1';
const LOGIN1_MANAGER_IFACE = 'org.freedesktop.login1.Manager';
const LOGIN1_SESSION_IFACE = 'org.freedesktop.login1.Session';
const DBUS_PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

/** Raw snapshot of the org.freedesktop.login1.Session properties we care about. */
export interface LogindSessionProps {
  id: string;
  active: boolean;
  remote: boolean;
  klass: string; // 'user' | 'system' | …
  type: string;  // 'wayland' | 'x11' | 'mir' | 'tty' | …
  lockedHint: boolean;
}

/** The subset of a session's properties delivered by a PropertiesChanged signal. */
export interface LogindSessionChanges {
  active?: boolean;
  lockedHint?: boolean;
}

/** A handle onto one logind session object (id, path, properties, signals). */
export interface LogindSessionHandle {
  readonly id: string;
  readonly path: string;
  /** Full fresh property snapshot from the bus. */
  read(): Promise<LogindSessionProps>;
  /** Fires { active, lockedHint } deltas; returns an unsubscribe function. */
  onPropertiesChanged(cb: (changes: LogindSessionChanges) => void): () => void;
  close(): void;
}

export interface LogindAdapter {
  /** All currently known sessions. */
  listSessions(): Promise<LogindSessionHandle[]>;
  /** Fires when a new session appears; returns an unsubscribe function. */
  onSessionAdded(cb: (handle: LogindSessionHandle) => void): () => void;
  /** Fires when a session disappears; returns an unsubscribe function. */
  onSessionRemoved(cb: (id: string) => void): () => void;
  close(): void;
}

class LogindSessionHandleImpl implements LogindSessionHandle {
  readonly id: string;
  readonly path: string;
  private readonly props: dbus.ClientInterface;

  constructor(obj: dbus.ProxyObject, id: string, path: string) {
    this.id = id;
    this.path = path;
    this.props = obj.getInterface(DBUS_PROPERTIES_IFACE);
  }

  async read(): Promise<LogindSessionProps> {
    const getProp = (name: string): Promise<unknown> =>
      (this.props.Get(LOGIN1_SESSION_IFACE, name) as Promise<dbus.Variant>)
        .then(v => v?.value)
        .catch(() => undefined);

    const [active, remote, klass, type, lockedHint] = await Promise.all([
      getProp('Active'), getProp('Remote'), getProp('Class'), getProp('Type'), getProp('LockedHint'),
    ]);

    return {
      id: this.id,
      active: active === true,
      remote: remote === true,
      klass: String(klass ?? ''),
      type: String(type ?? ''),
      lockedHint: lockedHint === true,
    };
  }

  onPropertiesChanged(cb: (changes: LogindSessionChanges) => void): () => void {
    const handler = (_iface: unknown, changed: Record<string, dbus.Variant>, _invalidated: string[]): void => {
      const changes: LogindSessionChanges = {};
      if (changed && typeof changed === 'object') {
        if (changed.Active) changes.active = changed.Active.value === true;
        if (changed.LockedHint) changes.lockedHint = changed.LockedHint.value === true;
      }
      cb(changes);
    };
    this.props.on('PropertiesChanged', handler);
    return () => { this.props.off('PropertiesChanged', handler); };
  }

  close(): void {
    this.props.removeAllListeners('PropertiesChanged');
  }
}

export function createLogindAdapter(bus?: dbus.MessageBus): LogindAdapter {
  const system = bus ?? dbus.systemBus();
  const handles = new Map<string, LogindSessionHandleImpl>();
  const addedHandlers = new Set<(handle: LogindSessionHandle) => void>();
  const removedHandlers = new Set<(id: string) => void>();

  let manager: dbus.ClientInterface | null = null;
  let initPromise: Promise<void> | null = null;

  async function ensureHandle(id: string, path: string): Promise<LogindSessionHandleImpl> {
    let handle = handles.get(id);
    if (!handle) {
      const obj = await system.getProxyObject(LOGIN1_SERVICE, path);
      handle = new LogindSessionHandleImpl(obj, id, path);
      handles.set(id, handle);
    }
    return handle;
  }

  async function init(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const obj = await system.getProxyObject(LOGIN1_SERVICE, LOGIN1_MANAGER_PATH);
      manager = obj.getInterface(LOGIN1_MANAGER_IFACE);
      manager.on('SessionNew', (id: string, path: string) => {
        ensureHandle(id, path).then(handle => {
          for (const cb of addedHandlers) { try { cb(handle); } catch { /* subscriber error */ } }
        }).catch(() => { /* session vanished before we could proxy it */ });
      });
      manager.on('SessionRemoved', (id: string) => {
        const handle = handles.get(id);
        if (handle) { handles.delete(id); handle.close(); }
        for (const cb of removedHandlers) { try { cb(id); } catch { /* subscriber error */ } }
      });
    })();
    return initPromise;
  }

  return {
    async listSessions(): Promise<LogindSessionHandle[]> {
      await init();
      if (!manager) throw new Error('logind manager unavailable');
      const raw = (await manager.ListSessions()) as Array<[string, number, string, string, string]>;
      for (const [id, , , , path] of raw) await ensureHandle(id, path);
      return [...handles.values()];
    },

    onSessionAdded(cb: (handle: LogindSessionHandle) => void): () => void {
      addedHandlers.add(cb);
      void init().catch(() => { /* bus unavailable — subscribers just never fire */ });
      return () => { addedHandlers.delete(cb); };
    },

    onSessionRemoved(cb: (id: string) => void): () => void {
      removedHandlers.add(cb);
      void init().catch(() => { /* bus unavailable — subscribers just never fire */ });
      return () => { removedHandlers.delete(cb); };
    },

    close(): void {
      initPromise = null;
      addedHandlers.clear();
      removedHandlers.clear();
      manager = null;
      for (const handle of handles.values()) handle.close();
      handles.clear();
      system.disconnect();
    },
  };
}