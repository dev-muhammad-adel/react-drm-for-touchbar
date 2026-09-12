import { useEffect, useState } from 'react';
import dbus, { MessageBus } from 'dbus-next';

// State broadcast by the T2 Touch ID bridge (apps/t2-touchid) on the system
// bus while fprintd is asking for a finger. 'idle' means no prompt is active.
export type TouchIdState = 'idle' | 'waiting' | 'scanning' | 'matched' | 'retry' | 'failed';

const NAME = 'org.kait2en.TouchId';
const PATH = '/org/kait2en/TouchId';
const IFACE = 'org.kait2en.TouchId';

// The bridge emits a bare signal without an object server, so introspection
// would find nothing. Hand the proxy the interface XML directly, the same way
// useMediaPlayers copes with players that answer Introspect() with an empty
// node.
const INTROSPECTION = `<node>
  <interface name="org.kait2en.TouchId">
    <signal name="Changed">
      <arg name="state" type="s"/>
    </signal>
  </interface>
</node>`;

const KNOWN: TouchIdState[] = ['idle', 'waiting', 'scanning', 'matched', 'retry', 'failed'];
function normalize(raw: string): TouchIdState {
  return (KNOWN as string[]).includes(raw) ? (raw as TouchIdState) : 'idle';
}

// One shared D-Bus subscription for every consumer, refcounted so the bus
// connection is only open while someone is subscribed — mirrors the
// SystemLockStore pattern so the lock page and the root-layout gate can never
// drift (each consuming its own bus/subscription would otherwise double-count
// retry tries in whichever store derived from them).
class TouchIdStore {
  private listeners = new Set<(s: TouchIdState) => void>();
  private current: TouchIdState = 'idle';
  private bus: MessageBus | null = null;
  private iface: { on(name: 'Changed', cb: (s: string) => void): void; removeListener(name: 'Changed', cb: (s: string) => void): void } | null = null;
  private starting = false;

  get(): TouchIdState {
    return this.current;
  }

  subscribe(listener: (s: TouchIdState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    this.ensureStarted();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private emit(state: TouchIdState): void {
    this.current = state;
    for (const l of this.listeners) {
      try { l(state); } catch { /* a subscriber must not kill the watcher */ }
    }
  }

  private ensureStarted(): void {
    if (this.iface || this.starting) return;
    this.starting = true;
    const bus = dbus.systemBus();
    this.bus = bus;
    void bus.getProxyObject(NAME, PATH, INTROSPECTION)
      .then(obj => {
        if (!this.bus) return; // stopped mid-start
        const iface = obj.getInterface(IFACE);
        this.iface = iface;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (iface as any).on('Changed', (raw: string) => this.emit(normalize(raw)));
      })
      .catch(() => { /* No bridge or no system bus: stays idle */ })
      .finally(() => { this.starting = false; });
  }

  private stop(): void {
    if (this.iface) { this.iface.removeListener('Changed', () => {}); this.iface = null; }
    this.bus?.disconnect();
    this.bus = null;
    this.current = 'idle';
  }
}

/** Shared instance for every consumer. */
export const touchIdStore = new TouchIdStore();

export function useTouchIdPrompt(): TouchIdState {
  const [state, setState] = useState<TouchIdState>(() => touchIdStore.get());
  useEffect(() => touchIdStore.subscribe(setState), []);
  return state;
}