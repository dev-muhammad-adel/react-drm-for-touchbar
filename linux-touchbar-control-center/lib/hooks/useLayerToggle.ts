import { useEffect, useRef } from 'react';
import { useKeyPressed } from 'react-drm';
import type { KeyId } from 'react-drm';
import { useKeyGesture } from '@/lib/hooks/useKeyGesture';
import { go, routerAt } from '@/lib/routes/router-registry';

export interface LayerToggleOptions {
  /** 'toggle' (long-press) / 'double-tap' flip to `layer` and back on repeat;
   *  'hold' shows `layer` only while `key` is physically held. Default 'toggle'. */
  mode?:      'hold' | 'toggle' | 'double-tap';
  longMs?:    number;
  doubleMs?:  number;
  /** Return target when toggling off from a layer that's itself in
   *  `overlays` (so flipping between two overlay toggles lands home, not
   *  ping-pong). Ignored in 'hold' mode. Defaults to whatever was active
   *  right before this toggle turned on. */
  home?:      string;
  /** Every overlay-toggle layer sharing this host, this one included — used
   *  only for the `home` fallback above. */
  overlays?:  string[];
  /** Which branch's host this drives, e.g. '' for root or 'splitted' for its
   *  nested host — see router-registry.ts. Defaults to '' (root). */
  path?:      string;
}

/**
 * Drives one key → layer toggle/hold binding against the route registry's
 * global go()/current — not a locally-scoped handle, so it needs no ref or
 * prop threaded to it. Not part of the routing system itself — call it
 * directly wherever the binding conceptually belongs (e.g. app/layout.tsx
 * for a global hardware shortcut).
 */
export function useLayerToggle(
  key: KeyId,
  layer: string,
  { mode = 'toggle', longMs, doubleMs, home, overlays, path = '' }: LayerToggleOptions = {},
): void {
  const returnTo = useRef<string | null>(null);
  const target = path ? `${path}/${layer}` : layer;

  const toggle = () => {
    const current = routerAt(path)?.current;
    if (current === undefined) return;
    if (current === layer) {
      const back = returnTo.current;
      returnTo.current = null;
      if (back) go(path ? `${path}/${back}` : back);
    } else {
      const fromOverlay = overlays?.includes(current) ?? false;
      returnTo.current = fromOverlay ? (home ?? null) : current;
      go(target);
    }
  };

  useKeyGesture(
    mode === 'hold' ? undefined : key,
    mode === 'double-tap' ? { onDoublePress: toggle } : { onLongPress: toggle },
    { longMs, doubleMs },
  );

  // Momentary hold: show `layer` while held, restore what was showing before
  // on release. Fast fade (not each layer's own transition) — a hold has to
  // feel instant, not wait out a leisurely slide/fade.
  const beforeHold = useRef<string | null>(null);
  const held = useKeyPressed(mode === 'hold' ? key : 0);
  useEffect(() => {
    if (mode !== 'hold') return;
    const current = routerAt(path)?.current;
    if (current === undefined) return;
    const fastFade = { fromLayerSwitch: { outAnim: 'fade' as const, duration: 5 }, toLayerSwitch: { inAnim: 'fade' as const, duration: 100, showAfter: 0 } };
    if (held) {
      beforeHold.current = current;
      go(target, fastFade);
    } else {
      go(path && beforeHold.current ? `${path}/${beforeHold.current}` : (beforeHold.current ?? current), fastFade);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, mode, path]);
}
