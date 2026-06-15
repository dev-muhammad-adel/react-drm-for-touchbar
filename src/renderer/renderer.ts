import fs from 'fs';
import { Worker } from 'worker_threads';
import React from 'react';
import { reconciler } from './reconciler';
import { setRepaint } from './invalidate';
import { serializeScene, frameSignature } from '../scene/serialize';
import type { DrawCommand } from '../scene/serialize';
import { computeLayoutYoga, loadYogaEngine, yogaReady } from '../scene/layout-yoga';
import { TouchRegistry, TouchRegistryContext } from '../input/touch-registry';
import { LayoutContext } from '../scene/layout-context';
import { DisplaySizeContext } from '../scene/display-context';
import { TouchReader } from '../native/input';
import { KeyboardReader, findKeyboardDevices, findPointerDevices, findLidDevice } from '../native/keyboard';
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
   * Sweep the entire frame ±11 px horizontally (sinusoidal Y ±2 px) to spread
   * AMOLED pixel wear.  Value = seconds for one direction sweep (default: 300 s).
   * 0 = disabled.
   */
  pixelShiftSecs?: number;
  /**
   * If provided, the renderer subscribes to this KeyboardReader for idle
   * activity detection instead of opening the keyboard device a second time.
   */
  keyboardReader?: KeyboardReader;
  /**
   * Scale Touch Bar brightness to match the main display brightness.
   * Default: false.
   */
  adaptiveBrightness?: boolean;
  /**
   * Fixed brightness level when adaptiveBrightness is false.
   * Hardware supports exactly 3 levels: 0 (off), 1 (half), 2 (full).
   * Default: 2 (full brightness).
   */
  activeBrightness?: 0 | 1 | 2;
  /**
   * Max framebuffer flushes per second. Bursts (e.g. 60fps spring frames)
   * coalesce into a single trailing flush, keeping the appletbdrm USB
   * request/response handshake within its timeout window. Default: 30.
   */
  flushFps?: number;
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

  /**
   * Quiesce before system sleep: stop rendering and idle watchers and close
   * the DRM fd (the device disappears during suspend anyway). The React tree
   * stays mounted; commits keep updating the scene off-screen.
   */
  suspend: () => void;

  /**
   * Undo suspend() after the device is back (attached + driver bound):
   * reopens the display, restarts the watchers and repaints the latest scene.
   */
  resume: () => void;
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

  let workerFd: number | null = null;

  const worker = new Worker(`
    const { workerData, parentPort } = require('worker_threads');
    const fs = require('fs');
    let fd;
    try { fd = fs.openSync(workerData.dev, 'r'); }
    catch (e) { parentPort.postMessage({ error: e.message }); process.exit(0); }
    parentPort.postMessage({ fd });
    const buf = Buffer.alloc(24);
    for (;;) {
      let n;
      try { n = fs.readSync(fd, buf, 0, 24, null); }
      catch { break; }
      if (n !== 24) break;
      const ab = new ArrayBuffer(24);
      new Uint8Array(ab).set(buf);
      parentPort.postMessage(ab, [ab]);
    }
    try { fs.closeSync(fd); } catch {}
  `, { eval: true, workerData: { dev } });

  worker.on('message', (msg: ArrayBuffer | { fd: number } | { error: string }) => {
    if (!active) return;
    if (msg instanceof ArrayBuffer) { onData(Buffer.from(msg)); return; }
    if (typeof msg === 'object' && 'fd' in msg) { workerFd = (msg as { fd: number }).fd; return; }
    onError(new Error((msg as { error: string }).error));
  });
  worker.on('error', (err: Error) => { if (active) onError(err); });
  worker.on('exit', (code) => {
    if (active && code !== 0) onError(new Error(`evdev worker for ${dev} exited: ${code}`));
  });

  return () => {
    active = false;
    // Close the fd from the main thread — workers share the process fd table,
    // so this unblocks the readSync with EBADF and lets the worker exit cleanly.
    // Without this, process.exit() hangs waiting for the blocked worker threads.
    if (workerFd !== null) { try { fs.closeSync(workerFd); } catch {} workerFd = null; }
    worker.terminate();
  };
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
// Reads evdev events from all pointer devices (touchpad, touchscreen, mouse)
// across all seats. Any non-SYN event counts as user activity.

function watchPointer(onActivity: () => void): () => void {
  let devices: string[] = [];
  try { devices = findPointerDevices(); } catch { /**/ }

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
// Reads evdev events from all seat0 keyboards. EV_KEY key-down counts as
// user activity. udev ID_INPUT_KEYBOARD=1 already excludes power buttons etc.

function watchKeyboard(onActivity: () => void): () => void {
  let devices: string[] = [];
  try { devices = findKeyboardDevices(); } catch { /**/ }

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

// ── Lid switch watcher ────────────────────────────────────────────────────────
// EV_SW=5, SW_LID=0: value 1 = closed, 0 = open.

function watchLid(onLid: (closed: boolean) => void): () => void {
  let dev: string;
  try { dev = findLidDevice(); } catch { return () => {}; }

  const carry = { buf: Buffer.alloc(0) };
  return openEvdevStream(
    dev,
    chunk => parseEvdev(carry, chunk, (type, code, value) => {
      if (type === 5 && code === 0) onLid(value === 1); // EV_SW + SW_LID
    }),
    err => console.warn(`[react-drm] watchLid: ${err.message}`),
  );
}

// ── Backlight control ─────────────────────────────────────────────────────────
// Controls the Touch Bar backlight via sysfs so the "off" state actually turns
// the panel off and wake from off reliably restores it.

const TB_BACKLIGHT_NAMES  = ['display-pipe', 'appletb_backlight'];
const DISP_BACKLIGHT_NAMES = ['apple-panel-bl', 'gmux_backlight', 'intel_backlight', 'acpi_video0'];

function findBacklightDir(candidates: string[]): string | null {
  try {
    const base = '/sys/class/backlight';
    const name = fs.readdirSync(base).find(n => candidates.some(c => n.includes(c)));
    return name ? `${base}/${name}` : null;
  } catch { return null; }
}

function readInt(path: string): number {
  try { return parseInt(fs.readFileSync(path, 'utf8').trim(), 10) || 0; } catch { return 0; }
}

class Backlight {
  private readonly tbFile:   string | null;
  private readonly tbMax:    number;
  private readonly dispFile: string | null;
  private readonly dispMax:  number;
  private lidClosed = false;
  private activeHwLevel = 2; // raw level currently written while active

  constructor() {
    const tbDir   = findBacklightDir(TB_BACKLIGHT_NAMES);
    const dispDir = findBacklightDir(DISP_BACKLIGHT_NAMES);
    this.tbFile   = tbDir   ? `${tbDir}/brightness`   : null;
    this.tbMax    = tbDir   ? readInt(`${tbDir}/max_brightness`)   : 0;
    this.dispFile = dispDir ? `${dispDir}/brightness` : null;
    this.dispMax  = dispDir ? readInt(`${dispDir}/max_brightness`) : 0;
  }

  private write(value: number): void {
    if (!this.tbFile) return;
    try { fs.writeFileSync(this.tbFile, String(Math.round(value))); } catch (e) {
      console.warn('[react-drm] backlight write failed (need root?):', (e as NodeJS.ErrnoException).code);
    }
  }

  // Scale display brightness to Touch Bar brightness (sqrt for perceptual linearity)
  private adaptiveLevel(): number {
    if (!this.dispFile || !this.dispMax || !this.tbMax) return this.tbMax;
    const normalized = readInt(this.dispFile) / this.dispMax;
    return Math.min(this.tbMax, Math.round(Math.sqrt(normalized) * this.tbMax) + 1);
  }

  setLid(closed: boolean): void {
    this.lidClosed = closed;
    if (closed) this.write(0);
  }

  // level: 0 | 1 | 2 — raw hardware level (3 states only)
  on(adaptive: boolean, level: 0 | 1 | 2 = 2): void {
    if (this.lidClosed) return;
    const target = adaptive ? this.adaptiveLevel() : level;
    this.activeHwLevel = Math.max(1, Math.min(this.tbMax || 2, target));
    this.write(this.activeHwLevel);
  }

  /**
   * Dim via hardware LED to level 1. Returns false (no-op) when activeBrightness
   * is already at or below the dim level so the user's chosen level is respected.
   */
  dim(): boolean {
    if (this.lidClosed) return false;
    const dimLevel = Math.max(1, Math.round((this.tbMax || 2) * 0.2)); // = 1 for tbMax=2
    if (this.activeHwLevel <= dimLevel) return false; // already at or below dim level
    this.write(dimLevel);
    return true;
  }

  off(): void {
    this.write(0);
  }
}

// ── Pixel shift (AMOLED burn-in protection) ───────────────────────────────────
// Smooth bidirectional sweep: X travels ±11 px over pixelShiftSecs, Y follows a
// sinusoidal path. Pauses ~1 s at each endpoint before reversing direction.
// Larger range than a tight orbit — covers more pixel area with no visible jump.

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

  const adaptive    = options.adaptiveBrightness ?? false;
  const activeLevel = options.activeBrightness ?? 2;
  const backlight = new Backlight();

  const registry  = new TouchRegistry();
  const layoutRef: { current: Map<SceneNode, LayoutBox> } = { current: new Map() };

  const container: RootContainer = {
    type: 'root',
    children: [],
    width:  display.width,
    height: display.height,
  };

  // ── Pixel shift ───────────────────────────────────────────────────────────
  const MAX_X_SHIFT    = 11;
  const MAX_Y_SHIFT    = 2;
  const SWEEP_STEP_MS  = 50;
  const SWEEP_PAUSE_MS = 1000;
  const randPhaseY     = Math.random() * Math.PI * 2;
  const psMs           = (options.pixelShiftSecs ?? 300) * 1000; // one-direction sweep duration

  let sweepPhase   = 0.5;   // 0 = leftmost (−MAX_X), 1 = rightmost (+MAX_X)
  let sweepDir     = 1;
  let sweepPauseMs = 0;
  let shiftX       = 0;
  let shiftY       = 0;

  function updateSweep(): boolean {
    if (sweepPauseMs > 0) {
      sweepPauseMs = Math.max(0, sweepPauseMs - SWEEP_STEP_MS);
      return false;
    }
    sweepPhase += sweepDir * (SWEEP_STEP_MS / psMs);
    if (sweepPhase >= 1.0) {
      sweepPhase = 1.0;
      sweepDir = -1;
      sweepPauseMs = SWEEP_PAUSE_MS;
    } else if (sweepPhase <= 0.0) {
      sweepPhase = 0.0;
      sweepDir = 1;
      sweepPauseMs = SWEEP_PAUSE_MS;
    }
    const nx = Math.round((sweepPhase * 2 - 1) * MAX_X_SHIFT);
    const ny = Math.round(Math.sin(sweepPhase * Math.PI * 4 + randPhaseY) * MAX_Y_SHIFT);
    if (nx === shiftX && ny === shiftY) return false;
    shiftX = nx;
    shiftY = ny;
    return true;
  }

  const shiftTimer = psMs > 0
    ? setInterval(() => {
        if (!updateSweep()) return;
        renderCurrent();           // update display first
        registry.setShift(shiftX, shiftY); // then sync touch coords
      }, SWEEP_STEP_MS)
    : null;

  // ── Screen-saver state ────────────────────────────────────────────────────
  type SsState = 'active' | 'dim' | 'off';
  let state: SsState = 'active';
  let suspended = false;
  let lastCmds: DrawCommand[] = [];
  let dimTimer:  ReturnType<typeof setTimeout> | null = null;
  let offTimer:  ReturnType<typeof setTimeout> | null = null;

  // Blit deduplication: skip display.render() when the frame is byte-identical
  // to what's already on screen (same commands + same pixel-shift). Makes idle
  // output free at the DRM level — cava silence, resting springs, no-op commits.
  let lastSig: string | null = '\0'; // sentinel: never matches a real frame
  let lastShiftX = NaN;
  let lastShiftY = NaN;

  // Flush-rate cap. appletbdrm runs a synchronous USB request/response handshake
  // per flush with a 1000ms timeout; driven too fast under load the device misses
  // the window, the response stream desyncs, and it cascades into a freeze. Cap
  // blits to FLUSH_FPS_CAP and coalesce bursts (e.g. 60fps spring frames) into a
  // single trailing flush, so the latest frame still lands without overrunning
  // the device's handshake.
  const MIN_FLUSH_MS = 1000 / (options.flushFps ?? 30); // flush-rate cap (default 30fps)
  let lastFlushAt = 0;
  let pendingFlush: ReturnType<typeof setTimeout> | null = null;

  // Frame profiler — set REACT_DRM_PROFILE=1 to log a per-second breakdown of
  // where each frame's time goes (commits/s, blits/s, layout/serialize/blit ms,
  // draw_svg count). Pairs with the native [native] breakdown (cairo_renderer.cpp,
  // binding.cpp). Off by default; kept as a standing diagnostic tool.
  const PROFILE = !!process.env.REACT_DRM_PROFILE;
  const prof = { commits: 0, blits: 0, layoutMs: 0, serMs: 0, blitMs: 0, svg: 0, cmds: 0 };
  if (PROFILE) setInterval(() => {
    const c = prof.commits || 1, b = prof.blits || 1;
    console.log(`[profile] commits/s=${prof.commits} blits/s=${prof.blits} | `
      + `layout=${(prof.layoutMs/c).toFixed(2)}ms ser=${(prof.serMs/c).toFixed(2)}ms blit=${(prof.blitMs/b).toFixed(2)}ms | `
      + `draw_svg/frame=${(prof.svg/c).toFixed(1)} cmds/frame=${(prof.cmds/c).toFixed(0)}`);
    prof.commits = prof.blits = prof.layoutMs = prof.serMs = prof.blitMs = prof.svg = prof.cmds = 0;
  }, 1000);

  // The actual blit (always the current lastCmds + shift). Guarded so a deferred
  // trailing flush can't fire after suspend / screen-off.
  function doBlit(): void {
    if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
    if (suspended || state === 'off') return;
    lastFlushAt = performance.now();
    if (PROFILE) {
      const t = performance.now();
      display.render(shiftCmds(lastCmds, shiftX, shiftY));
      prof.blitMs += performance.now() - t;
      prof.blits++;
      prof.svg += lastCmds.reduce((n, c) => n + (c.cmd === 'draw_svg' ? 1 : 0), 0);
      prof.cmds += lastCmds.length;
    } else {
      display.render(shiftCmds(lastCmds, shiftX, shiftY));
    }
  }

  function renderCurrent(force = false): void {
    if (suspended) return;       // DRM fd is closed during system sleep
    if (state === 'off') return; // screen stays on the black frame already rendered
    const sig = frameSignature(lastCmds);
    if (!force && sig !== null && sig === lastSig
        && shiftX === lastShiftX && shiftY === lastShiftY) {
      return; // identical frame already on screen — skip the blit
    }
    lastSig = sig;
    lastShiftX = shiftX;
    lastShiftY = shiftY;

    // Rate cap: flush now if enough time has passed (or forced); otherwise
    // schedule a single trailing flush. A burst collapses to one flush that
    // picks up the latest lastCmds when it fires.
    const since = performance.now() - lastFlushAt;
    if (force || since >= MIN_FLUSH_MS) {
      doBlit();
    } else if (!pendingFlush) {
      pendingFlush = setTimeout(doBlit, MIN_FLUSH_MS - since);
    }
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
      // Dim via hardware LED only — content unchanged on screen.
      // backlight.dim() is a no-op (returns false) when activeBrightness is
      // already at or below the dim level, so the user's chosen level is respected.
      backlight.dim();

      offTimer = setTimeout(() => {
        state = 'off';
        backlight.off();
        display.render([{ cmd: 'clear', r: 0, g: 0, b: 0 }]);
      }, offMs);
    }, dimMs);
  }

  function wake(): void {
    if (suspended) return; // reconnecting input during sleep is not activity
    const wasInactive = state !== 'active';
    const wasOff = state === 'off';
    state = 'active';
    clearTimers();
    if (wasOff || wasInactive) backlight.on(adaptive, activeLevel);
    if (wasOff) renderCurrent(true); // screen was cleared to black — force a repaint past the dedup cache
    startIdleTimers();
  }

  function onLid(closed: boolean): void {
    backlight.setLid(closed);
    if (closed) {
      // Lid closed — blank screen, keep idle timers running
      display.render([{ cmd: 'clear', r: 0, g: 0, b: 0 }]);
    } else {
      // Lid opened — treat as activity
      wake();
    }
  }

  backlight.on(adaptive, activeLevel);
  if (dimMs > 0) startIdleTimers();
  // ──────────────────────────────────────────────────────────────────────────

  container._onCommit = () => {
    if (!yogaReady()) return; // pre-engine commits are re-rendered once yoga loads
    const t0 = PROFILE ? performance.now() : 0;
    const layout   = computeLayoutYoga(container, container.width, container.height);
    const t1 = PROFILE ? performance.now() : 0;
    layoutRef.current = layout;
    const commands = serializeScene(container, layout);
    if (PROFILE) { prof.commits++; prof.layoutMs += t1 - t0; prof.serMs += performance.now() - t1; }
    lastCmds = commands;
    renderCurrent(); // respects current dim/off state
  };
  setRepaint(() => container._onCommit?.());

  const root = reconciler.createContainer(
    container, 0, null, false, null, 'react-drm',
    (err: Error) => console.error('[react-drm] recoverable error:', err),
    null,
  );

  let latestEl: React.ReactNode = element;
  function doUpdate(el: React.ReactNode): void {
    latestEl = el;
    const wrapped = React.createElement(
      TouchRegistryContext.Provider, { value: registry },
      React.createElement(DisplaySizeContext.Provider, { value: { width: display.width, height: display.height } },
        React.createElement(LayoutContext.Provider, { value: layoutRef }, el),
      ),
    );
    reconciler.updateContainer(wrapped, root, null, null);
  }

  doUpdate(element);
  // yoga loads async (ESM/WASM); commits before then are skipped, so re-commit
  // the latest tree once the engine is up.
  if (!yogaReady()) {
    loadYogaEngine()
      .then(() => doUpdate(latestEl))
      .catch(err => console.error('[react-drm] layout engine failed to load:', err));
  }

  // The evdev watchers' worker fds die silently when the devices disappear
  // (e.g. the apple-bce bus teardown during suspend), so suspend()/resume()
  // stop and recreate them. The keyboardReader subscription is excluded — the
  // caller's KeyboardReader reconnects on its own and the listener persists.
  let stopLid     = watchLid(onLid);
  let stopPointer = dimMs > 0 ? watchPointer(wake) : () => {};
  let stopKeyboard  = () => {};
  const ownKeyboardWatch = dimMs > 0 && !options.keyboardReader;
  if (ownKeyboardWatch) {
    stopKeyboard = watchKeyboard(wake);
  } else if (dimMs > 0 && options.keyboardReader) {
    // Reuse the caller's KeyboardReader — no second fd open.
    stopKeyboard = options.keyboardReader.onKey((_code, value) => {
      if (value === 1) wake(); // key-down = activity
    });
  }

  let stopTouch = (): void => {};
  try {
    const touchDevice = new TouchReader({ width: display.width, height: display.height });
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

  function suspend(): void {
    if (suspended) return;
    suspended = true;
    if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
    clearTimers();
    stopLid();
    stopPointer();
    if (ownKeyboardWatch) stopKeyboard();
    backlight.off();
    display.close(); // device disappears during suspend — drop the fd cleanly
    console.log('[react-drm] suspended (display closed)');
  }

  function resume(): void {
    if (!suspended) return;
    display.reopen(); // throws if the card is not back yet — caller retries
    suspended = false;
    state = 'active';
    stopLid = watchLid(onLid);
    stopPointer = dimMs > 0 ? watchPointer(wake) : () => {};
    if (ownKeyboardWatch) stopKeyboard = watchKeyboard(wake);
    backlight.on(adaptive, activeLevel);
    startIdleTimers();
    renderCurrent(true); // display was closed during suspend — force a repaint past the dedup cache
    console.log('[react-drm] resumed');
  }

  return {
    unmount: () => {
      setRepaint(null);
      reconciler.updateContainer(null, root, null, null);
      if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
      clearTimers();
      if (shiftTimer) clearInterval(shiftTimer);
      stopLid();
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
    suspend,
    resume,
  };
}
