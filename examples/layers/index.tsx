import React, { createContext, useContext, useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Box, KeyboardContext, useKeyPressed, useTouchLock } from 'react-drm';
import type { Style, KeyboardReader, KeyId, LayerAnimation, Layer, FromLayerSwitch, ToLayerSwitch, SwitchOptions } from 'react-drm';
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


function easeOut(t: number)   { return t * (2 - t); }
function easeInOut(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
function ease(anim: LayerAnimation, t: number) {
  return anim === 'fade' ? easeOut(t) : easeInOut(t);
}

/** Style for the layer that is leaving (p: 0 → 1). */
function fromLayerStyle(anim: LayerAnimation, p: number, w: number, h: number): Style {
  const e = ease(anim, p);
  const base: Style = { position: 'absolute', left: 0, top: 0, width: w, height: h };
  switch (anim) {
    case 'fade':        return base; // fade handled via overlay (opacity doesn't propagate to children)
    case 'slide-left':  return { ...base, left: -Math.round(e * w) };
    case 'slide-right': return { ...base, left:  Math.round(e * w) };
    case 'slide-up':    return { ...base, top:  -Math.round(e * h) };
    case 'slide-down':  return { ...base, top:   Math.round(e * h) };
  }
}

/** Style for the layer that is entering (p: 0 → 1). */
function toLayerStyle(anim: LayerAnimation, p: number, w: number, h: number): Style {
  const e = ease(anim, p);
  const base: Style = { position: 'absolute', left: 0, top: 0, width: w, height: h };
  switch (anim) {
    case 'fade':        return base; // fade handled via overlay
    case 'slide-left':  return { ...base, left:  Math.round((1 - e) * w) };
    case 'slide-right': return { ...base, left: -Math.round((1 - e) * w) };
    case 'slide-up':    return { ...base, top:   Math.round((1 - e) * h) };
    case 'slide-down':  return { ...base, top:  -Math.round((1 - e) * h) };
  }
}

// ── Trans state ────────────────────────────────────────────────────────────────

interface Trans {
  fromIdx:      number;
  toIdx:        number;
  fromAnim:     LayerAnimation;
  toAnim:       LayerAnimation;
  fromDelay:    number;
  fromDuration: number;
  toDelay:      number;
  toDuration:   number;
  fromProgress: number;
  toProgress:   number;
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

const LayerHostInner = forwardRef<LayerHostHandle, {
  layers:   Layer[];
  initial?: string;
  width:    number;
  height:   number;
  fnKey:    KeyId;
  fnLayer?: string;
}>(function LayerHostInner({ layers, initial, width, height, fnKey, fnLayer }, ref) {
  const initIdx = initial ? Math.max(0, layers.findIndex(l => l.name === initial)) : 0;

  const [stableIdx, setStableIdx] = useState(initIdx);
  const [trans,     setTrans]     = useState<Trans | null>(null);
  const timer       = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0Ref       = useRef(0);
  const { lock, unlock } = useTouchLock();
  const beforeFnIdx = useRef(-1);

  const stableIdxRef = useRef(stableIdx);
  const transRef     = useRef(trans);
  stableIdxRef.current = stableIdx;
  transRef.current     = trans;

  const fnHeld = useKeyPressed(fnKey);
  const fnIdx  = fnLayer ? layers.findIndex(l => l.name === fnLayer) : -1;

  function switchTo(nextIdx: number, opts: SwitchOptions = {}) {
    const curIdx = transRef.current?.toIdx ?? stableIdxRef.current;
    if (nextIdx === curIdx) return;

    if (timer.current) clearInterval(timer.current);

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
    // Fade-on-both-sides defaults to a sequence (fade out, then fade in) — starting
    // both at once stacks the entering layer's full-alpha overlay on top of the
    // leaving layer, which reads as an instant cut to black.
    const toShowAfter =
      tOpts?.showAfter ?? toLayer?.entering?.showAfter ?? toLayer?.enterDelay ??
      (fromAnim === 'fade' && toAnim === 'fade' ? fromDuration : 0);

    t0Ref.current = Date.now();
    lock();

    setTrans({
      fromIdx: curIdx, toIdx: nextIdx,
      fromAnim, fromDelay: 0, fromDuration,
      toAnim,   toDelay: toShowAfter, toDuration,
      fromProgress: 0, toProgress: 0,
    });

    timer.current = setInterval(() => {
      const elapsed = Date.now() - t0Ref.current;
      const fromP = Math.min(1, Math.max(0, elapsed / fromDuration));
      const toP   = Math.min(1, Math.max(0, (elapsed - toShowAfter) / toDuration));
      const done  = elapsed >= Math.max(fromDuration, toShowAfter + toDuration);

      if (done) {
        clearInterval(timer.current!);
        timer.current = null;
        setStableIdx(nextIdx);
        setTrans(null);
        unlock();
      } else {
        setTrans(t => t ? { ...t, fromProgress: fromP, toProgress: toP } : t);
      }
    }, 16);
  }

  useEffect(() => {
    if (fnIdx < 0) return;
    if (fnHeld) {
      beforeFnIdx.current = transRef.current?.toIdx ?? stableIdxRef.current;
      switchTo(fnIdx, { fromLayerSwitch: { outAnim: 'fade', duration: 5 }, toLayerSwitch: { inAnim: 'fade', duration: 100, showAfter: 0 } });
    } else {
      const returnTo = beforeFnIdx.current >= 0 ? beforeFnIdx.current : stableIdxRef.current;
            switchTo(returnTo, { fromLayerSwitch: { outAnim: 'fade', duration: 5 }, toLayerSwitch: { inAnim: 'fade', duration: 100, showAfter: 0 } });

    }
  }, [fnHeld]);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const activeIdx = trans?.toIdx ?? stableIdx;

  const ctx: LayerCtx = {
    current: layers[activeIdx]?.name ?? '',
    go:   (name, raw) => { const i = layers.findIndex(l => l.name === name); if (i >= 0) switchTo(i, resolveOpts(raw)); },
    next: (raw) => switchTo((activeIdx + 1) % layers.length, resolveOpts(raw)),
    prev: (raw) => switchTo((activeIdx - 1 + layers.length) % layers.length, resolveOpts(raw)),
  };

  useImperativeHandle(ref, () => ctx);

  // Layer wrappers are keyed by layer name, and the stable render uses the same
  // Box shape as the transition render — otherwise React remounts the visible
  // panel at both ends of every transition (blank-frame flicker while its data
  // hooks restart).
  if (!trans) {
    const Active = layers[stableIdx]?.component;
    if (!Active) return null;
    return (
      <Ctx.Provider value={ctx}>
        <Box style={{ width, height }}>
          <Box key={layers[stableIdx].name} style={{ position: 'absolute', left: 0, top: 0, width, height }}>
            <Active width={width} height={height} />
          </Box>
        </Box>
      </Ctx.Provider>
    );
  }

  const From = layers[trans.fromIdx]?.component;
  const To   = layers[trans.toIdx]?.component;
  const fStyle = fromLayerStyle(trans.fromAnim, trans.fromProgress, width, height);
  const tStyle = toLayerStyle(trans.toAnim,     trans.toProgress,   width, height);

  // Fade overlay alphas: use backgroundColor rgba instead of opacity (opacity doesn't
  // propagate to children in this renderer, but fill_rect alpha does).
  const fFade = trans.fromAnim === 'fade' ? ease(trans.fromAnim, trans.fromProgress) : 0;
  const tFade = trans.toAnim   === 'fade' ? 1 - ease(trans.toAnim, trans.toProgress) : 0;
  const overlayBase: Style = { position: 'absolute', left: 0, top: 0, width, height };

  // Keep the entering layer unmounted until its showAfter delay has elapsed —
  // it stacks above the leaving layer, so rendering it early hides the out phase.
  const toVisible = trans.toDelay === 0 || trans.toProgress > 0;

  return (
    <Ctx.Provider value={ctx}>
      <Box style={{ width, height }}>
        {From && (
          <Box key={layers[trans.fromIdx].name} style={fStyle}>
            <From width={width} height={height} />
            {fFade > 0.01 && <Box style={{ ...overlayBase, backgroundColor: `rgba(0,0,0,${fFade.toFixed(3)})` }} />}
          </Box>
        )}
        {To && toVisible && (
          <Box key={layers[trans.toIdx].name} style={tStyle}>
            <To width={width} height={height} />
            {tFade > 0.01 && <Box style={{ ...overlayBase, backgroundColor: `rgba(0,0,0,${tFade.toFixed(3)})` }} />}
          </Box>
        )}
      </Box>
    </Ctx.Provider>
  );
});
