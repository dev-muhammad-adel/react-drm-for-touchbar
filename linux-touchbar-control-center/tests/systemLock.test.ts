import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SystemLockWatcher } from '../lib/lock/watcher';
import { SystemLockStore } from '../lib/lock/store';
import { createLogindAdapter } from '../lib/lock/logind';
import type { LogindAdapter, LogindSessionHandle, LogindSessionProps } from '../lib/lock/logind';
import type { LockEventKind, SystemLockState } from '../lib/lock/types';

// ── Fake logind transport ────────────────────────────────────────────────────

interface SessionOpts {
  active?: boolean;
  remote?: boolean;
  klass?: string;
  type?: string;
  lockedHint?: boolean;
}

function session(id: string, opts: SessionOpts = {}): LogindSessionProps {
  return {
    id,
    active: opts.active ?? false,
    remote: opts.remote ?? false,
    klass: opts.klass ?? 'user',
    type: opts.type ?? 'wayland',
    lockedHint: opts.lockedHint ?? false,
  };
}

class FakeHandle implements LogindSessionHandle {
  readonly id: string;
  readonly path: string;
  props: LogindSessionProps;
  reads = 0;
  private listeners = new Set<(changes: { active?: boolean; lockedHint?: boolean }) => void>();

  constructor(props: LogindSessionProps) {
    this.id = props.id;
    this.props = { ...props };
    this.path = `/org/freedesktop/login1/session/${props.id}`;
  }

  async read(): Promise<LogindSessionProps> {
    this.reads += 1;
    return { ...this.props };
  }

  onPropertiesChanged(cb: (changes: { active?: boolean; lockedHint?: boolean }) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(changes: { active?: boolean; lockedHint?: boolean }): void {
    for (const cb of [...this.listeners]) cb(changes);
  }

  close(): void { this.listeners.clear(); }
}

class FakeAdapter implements LogindAdapter {
  sessions = new Map<string, FakeHandle>();
  closed = false;
  private addedHandlers = new Set<(handle: LogindSessionHandle) => void>();
  private removedHandlers = new Set<(id: string) => void>();

  add(props: LogindSessionProps): FakeHandle {
    const handle = new FakeHandle(props);
    this.sessions.set(handle.id, handle);
    for (const cb of this.addedHandlers) cb(handle);
    return handle;
  }

  remove(id: string): void {
    const handle = this.sessions.get(id);
    this.sessions.delete(id);
    handle?.close();
    for (const cb of this.removedHandlers) cb(id);
  }

  async listSessions(): Promise<LogindSessionHandle[]> {
    return [...this.sessions.values()];
  }

  onSessionAdded(cb: (handle: LogindSessionHandle) => void): () => void {
    this.addedHandlers.add(cb);
    return () => this.addedHandlers.delete(cb);
  }

  onSessionRemoved(cb: (id: string) => void): () => void {
    this.removedHandlers.add(cb);
    return () => this.removedHandlers.delete(cb);
  }

  close(): void {
    this.closed = true;
    for (const handle of this.sessions.values()) handle.close();
    this.sessions.clear();
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

// ── Watcher: LockedHint is the single source of truth ────────────────────────

test('initial state: unlocked session', async () => {
  const fake = new FakeAdapter();
  fake.add(session('c2', { active: true, lockedHint: false }));
  const events: Array<[SystemLockState, LockEventKind]> = [];
  const w = new SystemLockWatcher(fake, (s, k) => events.push([s, k]));

  await w.start();

  assert.deepEqual(w.getState(), { isLocked: false, sessionId: 'c2' });
  // Initial detection is a plain change, not a lock/unlock transition.
  assert.deepEqual(events.map(e => e[1]), ['change']);
  await w.dispose();
});

test('initial state: locked session', async () => {
  const fake = new FakeAdapter();
  fake.add(session('c2', { active: true, lockedHint: true }));
  const w = new SystemLockWatcher(fake, () => {});

  await w.start();

  assert.deepEqual(w.getState(), { isLocked: true, sessionId: 'c2' });
  await w.dispose();
});

test('LockedHint false → true emits lock', async () => {
  const fake = new FakeAdapter();
  const handle = fake.add(session('c2', { active: true, lockedHint: false }));
  const events: LockEventKind[] = [];
  const w = new SystemLockWatcher(fake, (_s, k) => events.push(k));
  await w.start();

  handle.emit({ lockedHint: true });

  assert.deepEqual(w.getState(), { isLocked: true, sessionId: 'c2' });
  assert.deepEqual(events, ['change', 'lock']);
  await w.dispose();
});

test('LockedHint true → false emits unlock', async () => {
  const fake = new FakeAdapter();
  const handle = fake.add(session('c2', { active: true, lockedHint: true }));
  const events: LockEventKind[] = [];
  const w = new SystemLockWatcher(fake, (_s, k) => events.push(k));
  await w.start();

  handle.emit({ lockedHint: false });

  assert.deepEqual(w.getState(), { isLocked: false, sessionId: 'c2' });
  assert.deepEqual(events, ['change', 'unlock']);
  await w.dispose();
});

test('no active graphical session → isLocked = null', async () => {
  const fake = new FakeAdapter();
  fake.add(session('c1', { active: true, type: 'tty', lockedHint: true }));       // graphical? no — tty
  fake.add(session('c2', { active: false, lockedHint: true }));                   // inactive
  fake.add(session('r1', { active: true, remote: true, lockedHint: true }));      // remote
  fake.add(session('s1', { active: true, klass: 'system', lockedHint: true }));   // system class
  const w = new SystemLockWatcher(fake, () => {});

  await w.start();

  assert.deepEqual(w.getState(), { isLocked: null, sessionId: null });
  await w.dispose();
});

test('a session appearing later is picked up (SessionNew), none initially → null', async () => {
  const fake = new FakeAdapter();
  const events: SystemLockState[] = [];
  const w = new SystemLockWatcher(fake, s => events.push(s));
  await w.start();
  assert.deepEqual(w.getState(), { isLocked: null, sessionId: null });

  fake.add(session('c2', { active: true, lockedHint: false }));
  await flush();

  assert.deepEqual(w.getState(), { isLocked: false, sessionId: 'c2' });
  assert.deepEqual(events.at(-1), { isLocked: false, sessionId: 'c2' });
  await w.dispose();
});

// ── Watcher: active session changes ──────────────────────────────────────────

test('session switch: unsubscribes the old session and subscribes the new one', async () => {
  const fake = new FakeAdapter();
  const a = fake.add(session('c2', { active: true, lockedHint: false }));
  const b = fake.add(session('c3', { active: false, lockedHint: true }));
  const events: LockEventKind[] = [];
  const w = new SystemLockWatcher(fake, (_s, k) => events.push(k));
  await w.start();
  assert.equal(w.getState().sessionId, 'c2');

  // VT switch: A stops being active, B becomes the active graphical session.
  a.props.active = false;
  b.props.active = true;
  a.emit({ active: false });
  await flush();
  await flush();

  assert.deepEqual(w.getState(), { isLocked: true, sessionId: 'c3' });

  // B is subscribed: its LockedHint flip is tracked.
  b.props.lockedHint = false;
  b.emit({ lockedHint: false });
  assert.deepEqual(w.getState(), { isLocked: false, sessionId: 'c3' });
  assert.equal(events.at(-1), 'unlock');

  // A is no longer listened to.
  const count = events.length;
  a.props.lockedHint = true;
  a.emit({ lockedHint: true });
  assert.equal(events.length, count);
  await w.dispose();
});

test('removing the active session exposes null', async () => {
  const fake = new FakeAdapter();
  fake.add(session('c2', { active: true, lockedHint: false }));
  const w = new SystemLockWatcher(fake, () => {});
  await w.start();
  assert.equal(w.getState().sessionId, 'c2');

  fake.remove('c2');
  await flush();
  await flush();

  assert.deepEqual(w.getState(), { isLocked: null, sessionId: null });
  await w.dispose();
});

// ── Cleanup / unsubscribe ────────────────────────────────────────────────────

test('watcher dispose stops listening to everything', async () => {
  const fake = new FakeAdapter();
  const handle = fake.add(session('c2', { active: true, lockedHint: false }));
  const events: SystemLockState[] = [];
  const w = new SystemLockWatcher(fake, s => events.push(s));
  await w.start();

  await w.dispose();
  handle.emit({ lockedHint: true });
  fake.add(session('c3', { active: true, lockedHint: true }));
  await flush();

  assert.equal(events.length, 1); // only the initial snapshot
  await w.dispose(); // idempotent
});

test('store: subscribe pushes current, unsubscribe closes the bus', async () => {
  const fake = new FakeAdapter();
  fake.add(session('c2', { active: true, lockedHint: false }));
  const store = new SystemLockStore(() => fake);
  const states: SystemLockState[] = [];
  const kinds: LockEventKind[] = [];
  const unsub = store.subscribe((s, k) => { states.push(s); kinds.push(k); });

  // Synchronous snapshot on subscribe…
  assert.deepEqual(kinds, ['change']);
  // …then the live state once the watcher has started.
  await flush();
  await flush();
  assert.deepEqual(store.getState(), { isLocked: false, sessionId: 'c2' });
  assert.equal(fake.closed, false);

  unsub();
  assert.equal(fake.closed, true);
  assert.deepEqual(store.getState(), { isLocked: null, sessionId: null });
});

test('store: onLock/onUnlock fire only on LockedHint transitions', async () => {
  const fake = new FakeAdapter();
  const handle = fake.add(session('c2', { active: true, lockedHint: false }));
  const store = new SystemLockStore(() => fake);
  const locks: number[] = [];
  const unlocks: number[] = [];
  store.onLock(() => locks.push(Date.now()));
  store.onUnlock(() => unlocks.push(Date.now()));
  await flush();
  await flush();

  handle.emit({ lockedHint: true });
  assert.equal(locks.length, 1);
  assert.equal(unlocks.length, 0);

  handle.emit({ lockedHint: false });
  assert.equal(locks.length, 1);
  assert.equal(unlocks.length, 1);

  // No transition on the session switch — only a generic change.
  const a = handle;
  const b = fake.add(session('c3', { active: false, lockedHint: false }));
  a.props.active = false;
  b.props.active = true;
  a.emit({ active: false });
  await flush();
  await flush();
  assert.equal(locks.length, 1);
  assert.equal(unlocks.length, 1);
  assert.deepEqual(store.getState(), { isLocked: false, sessionId: 'c3' });
});

// ── Real adapter: managers ListSessions delivers (susso) 5-tuples ─────────────

function logindSessionPath(id: string): string {
  return `/org/freedesktop/login1/session/_${id}`;
}

/** Fake MessageBus whose ListSessions returns logind-style `a(susso)` rows. */
function fakeSystemBus(rows: Array<[string, number, string, string, string]>): {
  bus: Parameters<typeof createLogindAdapter>[0];
  sessionProps: Map<string, Record<string, unknown>>;
  managerGetCalls: number;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type FakeVariant = { signature: string; value: unknown };
  const sessionProps = new Map<string, Record<string, unknown>>();
  let managerGetCalls = 0;

  const makeSessionObj = (path: string) => {
    const props: Record<string, unknown> = {
      Active: true, Remote: false, Class: 'user', Type: 'wayland', LockedHint: false,
    };
    sessionProps.set(path, props);
    return {
      getInterface: (iface: string) => {
        if (iface === 'org.freedesktop.login1.Session') {
          return {
            SetLockedHint: async (value: boolean) => { props.LockedHint = value; },
            on: () => {}, off: () => {},
          };
        }
        return {
          Get: async (_i: string, name: string): Promise<FakeVariant> => {
            managerGetCalls += 1;
            const value = props[name];
            return { signature: typeof value === 'boolean' ? 'b' : 's', value };
          },
          on: () => {}, off: () => {}, removeAllListeners: () => {},
        };
      },
    };
  };

  const obj = {
    getInterface: (iface: string) => {
      if (iface === 'org.freedesktop.login1.Manager') {
        return {
          ListSessions: async (): Promise<Array<[string, number, string, string, string]>> => rows,
          on: () => {}, off: () => {},
        };
      }
      return { on: () => {}, off: () => {} };
    },
  };

  return {
    bus: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getProxyObject: async (_svc: string, path: string): Promise<any> =>
        path === '/org/freedesktop/login1' ? obj : makeSessionObj(path),
      disconnect: () => {},
    } as unknown as Parameters<typeof createLogindAdapter>[0],
    sessionProps,
    get managerGetCalls() { return managerGetCalls; },
  };
}

test('adapter.listSessions parses the (susso) rows logind actually returns', async () => {
  // Real-world shape from org.freedesktop.login1.Manager.ListSessions:
  // [id, uid, username, seat, object-path]. Passing the uid in the path slot
  // broke proxying ("Invalid object path: 1000"), which silently took the
  // whole watcher down — this guards that destructuring.
  const { bus, sessionProps } = fakeSystemBus([
    ['3', 1000, 'akaza', '', logindSessionPath('33')],
    ['2', 1000, 'akaza', 'seat0', logindSessionPath('32')],
  ]);

  const adapter = createLogindAdapter(bus);
  const handles = await adapter.listSessions();
  const byId = new Map(handles.map(h => [h.id, h]));

  assert.deepEqual([...byId.keys()].sort(), ['2', '3']);
  assert.equal(byId.get('3')!.path, logindSessionPath('33'));
  assert.equal(byId.get('2')!.path, logindSessionPath('32'));

  assert.deepEqual(await byId.get('2')!.read(), {
    id: '2', active: true, remote: false, klass: 'user', type: 'wayland', lockedHint: false,
  });

  adapter.close();
});