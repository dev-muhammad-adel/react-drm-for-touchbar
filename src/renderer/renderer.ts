import fs from 'fs';
import { Worker } from 'worker_threads';
import React from 'react';
import { reconciler } from './reconciler';
import { serializeScene } from '../scene/serialize';
import type { DrawCommand } from '../scene/serialize';
import { computeLayout } from '../scene/layout';
import { TouchRegistry, TouchRegistryContext } from '../input/touch-registry';
import { LayoutContext } from '../scene/layout-context';
import { TouchReader } from '../native/input';
import type { SceneNode, RootContainer } from '../scene/types';
import type { LayoutBox } from '../scene/layout';
import type { DrmDisplay } from '../native/binding';

export interface RenderOptions {
  /**
   * Dim to half brightness after this many idle seconds (step 1).
   * 0 = screen-saver disabled (default).
   */
  dimSecs?: number;
  /**
   * Additional seconds after dim before the screen goes fully off (step 2).
   * Defaults to the same value as dimSecs.
   */
  offSecs?: number;
  /** @deprecated  Use dimSecs instead. */
  screenSaverSecs?: number;
  /**
   * Shift the entire frame by ±2 px on a slow orbit to spread AMOLED pixel
   * wear.  Value = seconds per orbit step (default: 60 s).  0 = disabled.
   */
  pixelShiftSecs?: number;
}

export interface RenderResult {
  /** Unmount the React tree. */
  unmount: () => void;

  /**
   * Push a new React element into the existing renderer without reopening the
   * display.  Used by hot-reload to swap in updated components.
   */
  update: (element: React.ReactNode) => void;

  /**
   * Legacy one-shot tap hit-test (fires on touch-down).
   * Use touchStart / touchMove / touchEnd for swipe support.
   */
  hitTest: (x: number, y: number) => void;

  /** Call when a finger touches down. Fires tap handlers + starts swipe tracking. */
  touchStart: (x: number, y: number) => void;

  /** Call when the finger moves. */
  touchMove: (x: number, y: number) => void;

  /** Call when the finger lifts. Fires swipe handlers if gesture qualifies. */
  touchEnd: (x: number, y: number) => void;

  /**
   * Signal user activity — resets the idle timer and wakes the display if it
   * was dimmed or off.  Call this from keyboard / custom input handlers.
   */
  wake: () => void;
}

// ── Input device helpers ──────────────────────────────────────────────────────
// Uses net.Socket (epoll-backed) with O_NONBLOCK instead of createReadStream
// (which uses the thread pool and starves when many devices are opened at once).

// Spawns a Worker thread that does a blocking fs.readSync loop on the character
// device.  Worker threads have their own OS thread — blocking there doesn't
// stall the libuv thread pool, so any number of devices can be monitored at once.
// Each read returns exactly one 24-byte input_event; the worker posts it as a
// Buffer to the main thread, which receives it via the normal event loop.
function openEvdevStream(
  dev: string,
  onData: (chunk: Buffer) => void,
  onError: (err: Error) => void,
): () => void {
  let active = true;

  const worker = new Worker(`
    const { workerData, parentPort } = require('worker_threads');
    const fs = require('fs');
    let fd;
    try { fd = fs.openSync(workerData.dev, 'r'); }
    catch (e) { parentPort.postMessage({ error: e.message }); process.exit(0); }
    const buf = Buffer.alloc(24);
    for (;;) {
      let n;
      try { n = fs.readSync(fd, buf, 0, 24, null); }
      catch (e) { parentPort.postMessage({ error: e.message }); break; }
      if (n !== 24) break;
      const ab = new ArrayBuffer(24);
      new Uint8Array(ab).set(buf);
      parentPort.postMessage(ab, [ab]);
    }
    try { fs.closeSync(fd); } catch {}
  `, { eval: true, workerData: { dev } });

  worker.on('message', (msg: ArrayBuffer | { error: string }) => {
    if (!active) return;
    if (msg instanceof ArrayBuffer) onData(Buffer.from(msg));
    else onError(new Error((msg as { error: string }).error));
  });
  worker.on('error', (err: Error) => { if (active) onError(err); });
  worker.on('exit', (code) => {
    if (active && code !== 0) onError(new Error(`evdev worker for ${dev} exited: ${code}`));
  });

  return () => { active = false; worker.terminate(); };
}

function parseEvdev(
  carry: { buf: Buffer },
  chunk: Buffer,
  onEvent: (type: number, code: number, value: number) => void,
): void {
  const buf = carry.buf.length ? Buffer.concat([carry.buf, chunk]) : chunk;
  const count = Math.floor(buf.length / 24);
  for (let i = 0; i < count; i++) {
    const off = i * 24;
    onEvent(buf.readUInt16LE(off + 16), buf.readUInt16LE(off + 18), buf.readInt32LE(off + 20));
  }
  carry.buf = count * 24 < buf.length ? buf.slice(count * 24) : Buffer.alloc(0);
}

// ── Pointer watcher ───────────────────────────────────────────────────────────
// Reads evdev events from all devices with a mouse handler (e.g. event7, event8
// on Apple MacBook — the trackpad and Touch Bar).  Any non-SYN event (type≠0)
// counts as user activity.  Absolute-only devices like these never send data to
// /dev/input/mice, so we must read their eventN files directly.

function watchPointer(onActivity: () => void): () => void {
  const devices: string[] = [];
  try {
    for (const block of fs.readFileSync('/proc/bus/input/devices', 'utf8').trim().split(/\n\n+/)) {
      if (!/\bmouse\d+\b/.test(block)) continue;
      const m = block.match(/Handlers=.*?\b(event\d+)\b/);
      if (m) devices.push(`/dev/input/${m[1]}`);
    }
  } catch { /**/ }

  if (devices.length === 0) {
    console.warn('[react-drm] watchPointer: no pointer devices found');
    return () => {};
  }
  console.log(`[react-drm] watchPointer: monitoring ${devices.join(', ')}`);

  const stops = devices.map(dev => {
    const carry = { buf: Buffer.alloc(0) };
    return openEvdevStream(
      dev,
      chunk => parseEvdev(carry, chunk, (type) => {
        if (type !== 0) onActivity(); // any non-SYN event = user activity
      }),
      err => console.warn(`[react-drm] watchPointer: ${dev}: ${err.message}`),
    );
  });
  return () => stops.forEach(s => s());
}

// ── Keyboard watcher ──────────────────────────────────────────────────────────
// Reads evdev events from all devices with a kbd handler.  EV_KEY (type=1)
// key-down (value=1) counts as user activity.
//
// Many devices claim the "kbd" handler (Power Button, Sleep Button, PC Speaker,
// Video Bus) but have only 1-2 keys.  We skip them by requiring ≥3 non-zero
// words in the KEY= bitmap — real keyboards have 5-12, virtual keyboards 8+.
function hasRichKeymap(block: string): boolean {
  const m = block.match(/^B: KEY=(.+)$/m);
  if (!m) return false;
  return m[1].trim().split(/\s+/).filter(w => !/^0+$/.test(w)).length >= 3;
}

function watchKeyboard(onActivity: () => void): () => void {
  const devices: string[] = [];
  try {
    for (const block of fs.readFileSync('/proc/bus/input/devices', 'utf8').trim().split(/\n\n+/)) {
      if (!/\bkbd\b/.test(block)) continue;
      if (!hasRichKeymap(block)) continue;
      const m = block.match(/Handlers=.*?\b(event\d+)\b/);
      if (m) devices.push(`/dev/input/${m[1]}`);
    }
  } catch { /**/ }

  if (devices.length === 0) {
    console.warn('[react-drm] watchKeyboard: no keyboard devices found');
    return () => {};
  }
  console.log(`[react-drm] watchKeyboard: monitoring ${devices.join(', ')}`);

  const stops = devices.map(dev => {
    const carry = { buf: Buffer.alloc(0) };
    return openEvdevStream(
      dev,
      chunk => parseEvdev(carry, chunk, (type, _code, value) => {
        if (type === 1 && value === 1) onActivity(); // EV_KEY key-down
      }),
      err => console.warn(`[react-drm] watchKeyboard: ${dev}: ${err.message}`),
    );
  });
  return () => stops.forEach(s => s());
}

// ── Backlight control ─────────────────────────────────────────────────────────
// Controls the Touch Bar backlight via sysfs so the "off" state actually turns
// the panel off and wake from off reliably restores it.

class Backlight {
  private readonly file: string | null = null;
  private readonly max: number = 0;
  private saved: number = 0;

  constructor() {
    try {
      const base = '/sys/class/backlight';
      const names = fs.readdirSync(base);
      const name = names.find(n => n.includes('display-pipe') || n.includes('appletb_backlight'));
      if (!name) return;
      const dir = `${base}/${name}`;
      this.file  = `${dir}/brightness`;
      this.max   = parseInt(fs.readFileSync(`${dir}/max_brightness`, 'utf8').trim(), 10);
      this.saved = parseInt(fs.readFileSync(this.file, 'utf8').trim(), 10) || this.max;
    } catch { /**/ }
  }

  off(): void {
    if (!this.file) return;
    try {
      this.saved = parseInt(fs.readFileSync(this.file, 'utf8').trim(), 10) || this.max;
      fs.writeFileSync(this.file, '0');
    } catch { /**/ }
  }

  on(): void {
    if (!this.file) return;
    try { fs.writeFileSync(this.file, String(this.saved || this.max)); } catch { /**/ }
  }
}

// ── Pixel shift (AMOLED burn-in protection) ───────────────────────────────────
// 18-position circular orbit: center + ring at radius 1 + ring at radius 2.
// Each step moves one position; the full cycle takes 18 × pixelShiftSecs.
// Shift is ±2 px max — imperceptible, but spreads pixel stress over time.

const ORBIT: ReadonlyArray<[number, number]> = [
  [ 0,  0],
  [ 1,  0], [ 2,  0],
  [ 2,  1], [ 2,  2],
  [ 1,  2], [ 0,  2],
  [-1,  2], [-2,  2],
  [-2,  1], [-2,  0],
  [-2, -1], [-2, -2],
  [-1, -2], [ 0, -2],
  [ 1, -2], [ 2, -2],
  [ 2, -1],
];

function shiftCmds(cmds: DrawCommand[], dx: number, dy: number): DrawCommand[] {
  if (dx === 0 && dy === 0) return cmds;
  return cmds.map(cmd => {
    switch (cmd.cmd) {
      case 'clear':
      case 'overlay':
      case 'clip_pop':
        return cmd;           // no coordinates to shift
      default:
        return { ...cmd, x: cmd.x + dx, y: cmd.y + dy };
    }
  });
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function render(
  element: React.ReactNode,
  display: DrmDisplay,
  options: RenderOptions = {},
): RenderResult {
  // Resolve timing — support deprecated screenSaverSecs as alias for dimSecs
  const dimMs = ((options.dimSecs ?? options.screenSaverSecs) ?? 0) * 1000;
  const offMs = ((options.offSecs ?? options.dimSecs ?? options.screenSaverSecs) ?? 0) * 1000;

  const backlight = dimMs > 0 ? new Backlight() : null;

  const registry  = new TouchRegistry();
  const layoutRef: { current: Map<SceneNode, LayoutBox> } = { current: new Map() };

  const container: RootContainer = {
    type: 'root',
    children: [],
    width:  display.width,
    height: display.height,
  };

  // ── Pixel shift ───────────────────────────────────────────────────────────
  // Max orbit radius is 2px in each direction. We add 1 extra pixel so that
  // border strokes (whose outer edge aligns with the item boundary) also stay
  // fully on-screen after the shift, avoiding Cairo antialiasing artefacts.
  const SHIFT_RADIUS = 3;
  const psMs = (options.pixelShiftSecs ?? 60) * 1000;
  let orbitIdx = 0;
  let [shiftX, shiftY] = ORBIT[0];
  const shiftTimer = psMs > 0
    ? setInterval(() => {
        orbitIdx = (orbitIdx + 1) % ORBIT.length;
        [shiftX, shiftY] = ORBIT[orbitIdx];
        registry.setShift(shiftX, shiftY);
        renderCurrent(); // re-render at new position
      }, psMs)
    : null;

  // ── Screen-saver state ────────────────────────────────────────────────────
  type SsState = 'active' | 'dim' | 'off';
  let state: SsState = 'active';
  let lastCmds: DrawCommand[] = [];
  let dimTimer:  ReturnType<typeof setTimeout> | null = null;
  let offTimer:  ReturnType<typeof setTimeout> | null = null;

  const DIM_OVERLAY: DrawCommand = { cmd: 'overlay', a: 0.65 }; // ~35% brightness

  function renderCurrent(): void {
    const shifted = shiftCmds(lastCmds, shiftX, shiftY);
    if      (state === 'active') display.render(shifted);
    else if (state === 'dim')    display.render([...shifted, DIM_OVERLAY]);
    // 'off': display stays black — no call needed
  }

  function clearTimers(): void {
    if (dimTimer) { clearTimeout(dimTimer); dimTimer = null; }
    if (offTimer) { clearTimeout(offTimer); offTimer = null; }
  }

  function startIdleTimers(): void {
    clearTimers();
    if (dimMs <= 0) return;

    dimTimer = setTimeout(() => {
      state = 'dim';
      display.render([...lastCmds, DIM_OVERLAY]);

      offTimer = setTimeout(() => {
        state = 'off';
        backlight?.off();
        display.render([{ cmd: 'clear', r: 0, g: 0, b: 0 }]);
      }, offMs);
    }, dimMs);
  }

  function wake(): void {
    const wasInactive = state !== 'active';
    const wasOff = state === 'off';
    state = 'active';
    clearTimers();
    if (wasOff) backlight?.on();
    if (wasInactive) display.render(lastCmds);
    startIdleTimers();
  }

  if (dimMs > 0) startIdleTimers();
  // ──────────────────────────────────────────────────────────────────────────

  container._onCommit = () => {
    const layout   = computeLayout(container, container.width, container.height);
    layoutRef.current = layout;
    const commands = serializeScene(container, layout);
    lastCmds = commands;
    renderCurrent(); // respects current dim/off state
  };

  const root = reconciler.createContainer(
    container, 0, null, false, null, 'react-drm',
    (err: Error) => console.error('[react-drm] recoverable error:', err),
    null,
  );

  function doUpdate(el: React.ReactNode): void {
    const wrapped = React.createElement(
      TouchRegistryContext.Provider, { value: registry },
      React.createElement(LayoutContext.Provider, { value: layoutRef }, el),
    );
    reconciler.updateContainer(wrapped, root, null, null);
  }

  doUpdate(element);

  const stopPointer  = dimMs > 0 ? watchPointer(wake)  : () => {};
  const stopKeyboard = dimMs > 0 ? watchKeyboard(wake) : () => {};

  let stopTouch = (): void => {};
  try {
    const touchDevice = new TouchReader();
    touchDevice.startWithGestures({
      onTouchStart: (x, y) => { wake(); registry.touchStart(x, y); },
      onTouchMove:  (x, y) => { registry.touchMove(x, y); },
      onTouchEnd:   (x, y) => { registry.touchEnd(x, y); },
    });
    stopTouch = () => touchDevice.stop();
    console.log('[react-drm] touch device ready');
  } catch (e) {
    console.warn('[react-drm] no touch device:', (e as Error).message ?? e);
  }

  return {
    unmount: () => {
      reconciler.updateContainer(null, root, null, null);
      clearTimers();
      if (shiftTimer) clearInterval(shiftTimer);
      stopPointer();
      stopKeyboard();
      stopTouch();
    },
    update: doUpdate,
    hitTest:    (x, y) => registry.hitTest(x, y),
    touchStart: (x, y) => { wake(); registry.touchStart(x, y); },
    touchMove:  (x, y) => { wake(); registry.touchMove(x, y); },
    touchEnd:   (x, y) => { wake(); registry.touchEnd(x, y); },
    wake,
  };
}
