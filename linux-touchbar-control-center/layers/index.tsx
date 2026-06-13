import React, { createContext, useContext, useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Box, KeyboardContext, useKeyPressed, useTouchLock, animated, useTransition, easings } from 'react-drm';
import type { Style, KeyboardReader, KeyId, LayerAnimation, Layer, FromLayerSwitch, ToLayerSwitch, SwitchOptions, SpringValue } from 'react-drm';
import { LAYER_TRANSITION } from '../config';

export type { LayerAnimation, Layer, FromLayerSwitch, ToLayerSwitch, SwitchOptions };

// Backward-compat: accept a plain LayerAnimation string (applies to both sides).
function resolveOpts(raw?: LayerAnimation | SwitchOptions): SwitchOptions {
  if (!raw) return {};
  if (typeof raw === 'string') return {
    fromLayerSwitch: { outAnim: raw },
    toLayerSwitch:   { inAnim:  raw },
  };
  return raw;
}

// ── Context ────────────────────────────────────────────────────────────────────

interface LayerCtx {
  current: string;
  go:   (name: string, opts?: LayerAnimation | SwitchOptions) => void;
  next: (opts?: LayerAnimation | SwitchOptions) => void;
  prev: (opts?: LayerAnimation | SwitchOptions) => void;
}

const Ctx = createContext<LayerCtx>({ current: '', go: () => {}, next: () => {}, prev: () => {} });

export function useLayers(): LayerCtx { return useContext(Ctx); }

export type LayerHostHandle = LayerCtx;

// ── Style helpers ──────────────────────────────────────────────────────────────

function easing(anim: LayerAnimation) {
  return anim === 'fade' ? easings.easeOutQuad : easings.easeInOutQuad;
}

/**
 * Style for a layer at presence p (1 = fully on screen, 0 = fully off).
 * Entering layers run p 0→1, leaving layers 1→0; slides exit toward the
 * opposite side they entered from, so the offset sign flips per phase.
 * Fade layers sit offscreen at exactly p=0 — useTransition mounts a delayed
 * entering layer immediately, and its full-alpha overlay would otherwise
 * black out the leaving layer below before the fade-in even starts.
 */
function presenceStyle(
  anim: LayerAnimation,
  phase: 'enter' | 'leave',
  p: SpringValue<number>,
  w: number,
  h: number,
) {
  const base = { position: 'absolute' as const, top: 0, width: w, height: h };
  const dir = phase === 'enter' ? 1 : -1;
  const off = (sign: number, size: number) => p.to(v => Math.round(sign * (1 - v) * size));
  switch (anim) {
    case 'fade':        return { ...base, left: p.to(v => (v <= 0 ? -2 * w : 0)) };
    case 'slide-left':  return { ...base, left: off(dir, w) };
    case 'slide-right': return { ...base, left: off(-dir, w) };
    case 'slide-up':    return { ...base, left: 0, top: off(dir, h) };
    case 'slide-down':  return { ...base, left: 0, top: off(-dir, h) };
  }
}

// ── LayerHost (public) ─────────────────────────────────────────────────────────

export const LayerHost = forwardRef<LayerHostHandle, {
  layers:    Layer[];
  initial?:  string;
  width:     number;
  height:    number;
  keyboard?: KeyboardReader;
  fnKey?:    KeyId;
  fnLayer?:  string;
}>(function LayerHost({ layers, initial, width, height, keyboard, fnKey = 'fn', fnLayer }, ref) {
  const inherited = useContext(KeyboardContext);
  const kb = keyboard ?? inherited ?? null;
  return (
    <KeyboardContext.Provider value={kb}>
      <LayerHostInner
        ref={ref}
        layers={layers} initial={initial}
        width={width} height={height}
        fnKey={fnKey} fnLayer={fnLayer}
      />
    </KeyboardContext.Provider>
  );
});

// ── LayerHostInner (private) ───────────────────────────────────────────────────

interface PendingSwitch {
  fromAnim:     LayerAnimation;
  fromDuration: number;
  toAnim:       LayerAnimation;
  toDuration:   number;
  showAfter:    number;
}

const LayerHostInner = forwardRef<LayerHostHandle, {
  layers:   Layer[];
  initial?: string;
  width:    number;
  height:   number;
  fnKey:    KeyId;
  fnLayer?: string;
}>(function LayerHostInner({ layers, initial, width, height, fnKey, fnLayer }, ref) {
  const initIdx = initial ? Math.max(0, layers.findIndex(l => l.name === initial)) : 0;

  const [activeIdx, setActiveIdx] = useState(initIdx);
  const { lock, unlock } = useTouchLock();
  const beforeFnIdx = useRef(-1);
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;

  // Resolved options for the in-flight switch — read by the enter/leave
  // callbacks below, which useTransition invokes when the active key changes.
  const pendingRef = useRef<PendingSwitch>({
    fromAnim: 'fade', fromDuration: LAYER_TRANSITION.outDurationMs,
    toAnim:   'fade', toDuration:   LAYER_TRANSITION.inDurationMs, showAfter: 0,
  });
  // Which anim/phase each mounted layer is currently running (keyed by name).
  const phaseRef = useRef(new Map<string, { anim: LayerAnimation; phase: 'enter' | 'leave' }>());

  const fnHeld = useKeyPressed(fnKey);
  const fnIdx  = fnLayer ? layers.findIndex(l => l.name === fnLayer) : -1;

  function switchTo(nextIdx: number, opts: SwitchOptions = {}) {
    const curIdx = activeIdxRef.current;
    if (nextIdx === curIdx || !layers[nextIdx]) return;

    const fromLayer = layers[curIdx];
    const toLayer   = layers[nextIdx];
    const fOpts = opts.fromLayerSwitch;
    const tOpts = opts.toLayerSwitch;

    const fromAnim: LayerAnimation =
      fOpts?.outAnim ?? fromLayer?.leaving?.outAnim ?? fromLayer?.outAnim ?? fromLayer?.animation ?? 'fade';
    const fromDuration =
      fOpts?.duration ?? fromLayer?.leaving?.duration ?? fromLayer?.duration ?? LAYER_TRANSITION.outDurationMs;

    const toAnim: LayerAnimation =
      tOpts?.inAnim    ?? toLayer?.entering?.inAnim    ?? toLayer?.inAnim    ?? toLayer?.animation  ?? 'fade';
    const toDuration =
      tOpts?.duration  ?? toLayer?.entering?.duration  ?? toLayer?.duration   ?? LAYER_TRANSITION.inDurationMs;
    // Fade-on-both-sides defaults to a sequence (fade out, then fade in) —
    // starting both at once reads as an instant cut to black.
    const showAfter =
      tOpts?.showAfter ?? toLayer?.entering?.showAfter ?? toLayer?.enterDelay ??
      (fromAnim === 'fade' && toAnim === 'fade' ? fromDuration : 0);

    pendingRef.current = { fromAnim, fromDuration, toAnim, toDuration, showAfter };
    lock();
    setActiveIdx(nextIdx);
  }

  const transition = useTransition(activeIdx, {
    keys: (i: number) => layers[i]?.name ?? String(i),
    initial: { p: 1 }, // first layer mounts without animating in
    from:    { p: 0 },
    enter: (i: number) => {
      const { toAnim, toDuration, showAfter } = pendingRef.current;
      phaseRef.current.set(layers[i]?.name ?? String(i), { anim: toAnim, phase: 'enter' });
      return {
        p: 1, delay: showAfter,
        config: { duration: toDuration, easing: easing(toAnim) },
        onRest: () => unlock(),
      };
    },
    leave: (i: number) => {
      const { fromAnim, fromDuration } = pendingRef.current;
      phaseRef.current.set(layers[i]?.name ?? String(i), { anim: fromAnim, phase: 'leave' });
      return { p: 0, config: { duration: fromDuration, easing: easing(fromAnim) } };
    },
  });

  const ctx: LayerCtx = {
    current: layers[activeIdx]?.name ?? '',
    go:   (name, raw) => { const i = layers.findIndex(l => l.name === name); if (i >= 0) switchTo(i, resolveOpts(raw)); },
    next: (raw) => switchTo((activeIdxRef.current + 1) % layers.length, resolveOpts(raw)),
    prev: (raw) => switchTo((activeIdxRef.current - 1 + layers.length) % layers.length, resolveOpts(raw)),
  };

  useImperativeHandle(ref, () => ctx);

  useEffect(() => {
    if (fnIdx < 0) return;
    if (fnHeld) {
      beforeFnIdx.current = activeIdxRef.current;
      switchTo(fnIdx, { fromLayerSwitch: { outAnim: 'fade', duration: 5 }, toLayerSwitch: { inAnim: 'fade', duration: 100, showAfter: 0 } });
    } else {
      const returnTo = beforeFnIdx.current >= 0 ? beforeFnIdx.current : activeIdxRef.current;
      switchTo(returnTo, { fromLayerSwitch: { outAnim: 'fade', duration: 5 }, toLayerSwitch: { inAnim: 'fade', duration: 100, showAfter: 0 } });
    }
  }, [fnHeld]);

  const overlayBase: Style = { position: 'absolute', left: 0, top: 0, width, height };

  return (
    <Ctx.Provider value={ctx}>
      {/* Clip layers to the host box so slide transitions stay inside the
          layer column — without this they bleed past the left edge (e.g. over
          the wide-display Esc button that insets this host). */}
      <Box style={{ width, height, overflow: 'hidden' }}>
        {transition((style, i) => {
          const layer = layers[i];
          if (!layer) return null;
          const info = phaseRef.current.get(layer.name) ?? { anim: 'fade' as LayerAnimation, phase: 'enter' as const };
          const Comp = layer.component;
          return (
            <animated.Box style={presenceStyle(info.anim, info.phase, style.p, width, height)}>
              <Comp width={width} height={height} />
              {info.anim === 'fade' && (
                // Fade via a black overlay — opacity doesn't propagate to
                // children in this renderer, but fill alpha does.
                <animated.Box style={{ ...overlayBase, backgroundColor: style.p.to(v => `rgba(0,0,0,${(1 - v).toFixed(3)})`) }} />
              )}
            </animated.Box>
          );
        })}
      </Box>
    </Ctx.Provider>
  );
});
