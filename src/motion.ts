import React, { useEffect, useRef } from 'react';
import { animated } from './spring';
import { useSpring } from '@react-spring/core';
import { Box } from './components/Box';
import type { BoxProps } from './components/Box';
import { useButtonGesture } from './components/Button';
import type { ButtonGestureOptions } from './components/Button';
import { SPRING } from './motion-presets';

// The subset of Box/Style properties react-spring can meaningfully
// interpolate — numeric and color values only. Everything else in a Style
// object is layout/structural (flexDirection, justifyContent, ...) and isn't
// something you'd animate toward, so it's intentionally left out here rather
// than accepted and silently snapped.
export interface MotionValues {
  x?: number | number[];
  y?: number | number[];
  width?: number | number[];
  height?: number | number[];
  color?: string;
  borderColor?: string;
  borderWidth?: number | number[];
  opacity?: number | number[];
  borderRadius?: number | number[];
  rotate?: number | number[];
  top?: number | number[];
  left?: number | number[];
  right?: number | number[];
  bottom?: number | number[];
}

// Same shape as Motion's own transition prop: a spring preset plus optional
// repeat controls. `repeatType: 'reverse'` bounces between `initial` and the
// animate target forever — the same "breathing" pattern Motion's own docs
// use for a looping animation, expressed purely through animate/transition
// rather than a hand-driven value. (No 'mirror' — react-spring's `loop` has
// no equivalent, and nothing here needs it.)
export type Easing = (t: number) => number;
export interface MotionTransition {
  // Spring physics (SpringPreset's shape, but optional here — a transition
  // may specify `duration` instead, so it can't require tension/friction the
  // way a named SpringPreset constant does).
  tension?: number;
  friction?: number;
  mass?: number;
  /** Switches this transition from spring physics to a fixed-duration tween
   *  (ms) — matches Motion's own type: 'tween' vs type: 'spring' split,
   *  determined the same way: which fields you set. Takes priority over
   *  tension/friction/mass when present. May be an ARRAY aligned to keyframe
   *  count (animate={{ width: [a, b, c] }}) to give each segment its own
   *  duration — same as Motion's transition duration arrays. */
  duration?: number | number[];
  /** Tween easing. May be an array aligned to keyframe count, like Motion's
   *  ease arrays (ease: [easeOutQuad, easeInOutQuad]). */
  ease?: Easing | Easing[];
  /** Delay (ms) before the animation starts. Ignored while `repeat` is set —
   *  loops use `repeatDelay` instead. Applies to the whole animation, not
   *  per key. */
  delay?: number;
  repeat?: number;
  repeatType?: 'loop' | 'reverse';
  repeatDelay?: number;
}

// Either one transition for every animated key, or a per-key map (Motion's
// own shape: transition={{ opacity: {...}, default: {...} }}) — 'default'
// covers any key not explicitly listed. An ARRAY form is also allowed: one
// transition per keyframe segment (animate={{ width: [a, b] }} pairs with
// transition={[{ ... }, { ... }]}), so each segment can have its own spring
// physics or tween — the array is clamped to the last element once exhausted.
export type MotionTransitionProp = MotionTransition | MotionTransition[] | (Partial<Record<keyof MotionValues, MotionTransition>> & { default?: MotionTransition });

// A per-key transition map has object values ({ width: {...}, default: {...} });
// a single transition holds only primitives — numbers for tension/friction/
// duration/mass, a function for ease. Detecting it by value shape (rather than
// "no tension AND no friction") means a plain `{ duration, ease }` tween is not
// mistaken for a per-key map and silently dropped. Arrays (keyframe-aligned
// duration/ease) are deliberately excluded — `typeof [] === 'object'` would
// otherwise misclassify such a single transition.
function isPerKeyTransition(t: MotionTransitionProp): t is Partial<Record<keyof MotionValues, MotionTransition>> & { default?: MotionTransition } {
  if (Array.isArray(t)) return false; // array form = one transition per keyframe segment
  return Object.values(t as Record<string, unknown>).some(v => v !== null && typeof v === 'object' && !Array.isArray(v));
}

function resolveTransition(t: MotionTransitionProp | undefined, key: string): MotionTransition {
  if (!t) return SPRING.snappy;
  // Array form never reaches here (configFor indexes it by step) — defensive.
  if (Array.isArray(t)) return t[t.length - 1];
  if (!isPerKeyTransition(t)) return t;
  return (t as Record<string, MotionTransition>)[key] ?? t.default ?? SPRING.snappy;
}

// The "single" transition for whole-animation settings (delay/repeat): the
// plain transition, or the LAST element of the array form (an array is clamped
// to its final element once keyframes run out). Per-key maps have no single
// representative → undefined.
function singleTransition(t: MotionTransitionProp | undefined): MotionTransition | undefined {
  if (!t || isPerKeyTransition(t)) return undefined;
  return Array.isArray(t) ? t[t.length - 1] : t;
}

// Keyframe-aligned fields (duration/ease arrays) flattened to a single value.
// `step` selects an array element by KEYFRAME INDEX (clamping to the last for
// exhausted arrays); omit it (or it's -1) to take the final element — the
// resting state a spring settles into when no sequence is running.
function scalarize(t: MotionTransition, step = -1): MotionTransition {
  const at = <T,>(v: T | T[] | undefined): T | undefined =>
    Array.isArray(v) ? v[step === -1 ? Math.max(0, v.length - 1) : Math.min(step, v.length - 1)] : v;
  return { ...t, duration: at(t.duration), ease: at(t.ease) };
}

function transitionToSpringConfig(t: MotionTransition) {
  return t.duration !== undefined
    ? { duration: t.duration, easing: t.ease }
    : { tension: t.tension, friction: t.friction, mass: t.mass };
}

// Resolves a transition to a per-spring react-spring config. `step` is only
// meaningful inside a keyframe sequence — the array form indexes THAT segment
// (clamped to the last element); single/per-key transitions step their inline
// duration/ease arrays instead. Outside a sequence (-1) everything rests on
// its final element.
function configFor(transition: MotionTransitionProp | undefined, key: string, step = -1) {
  if (Array.isArray(transition)) {
    const idx = step === -1 ? Math.max(0, transition.length - 1) : Math.min(step, transition.length - 1);
    return transitionToSpringConfig(transition[idx]);
  }
  return transitionToSpringConfig(scalarize(resolveTransition(transition, key), step));
}

const BOX_KEYS = ['x', 'y', 'width', 'height', 'color', 'borderColor', 'borderWidth'] as const;

// Splits a spring's live value bag into animated.Box's direct props (x, y,
// width, height, color, ...) vs. its `style` object (opacity, borderRadius,
// rotate, top/left/right/bottom, ...) — Box takes the former as top-level
// props, the latter only exist on Style. See components/Box.tsx / scene/style.ts.
function splitSpringStyle(values: Record<string, unknown>) {
  const boxProps: Record<string, unknown> = {};
  const style: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if ((BOX_KEYS as readonly string[]).includes(key)) boxProps[key] = value;
    else style[key] = value;
  }
  return { boxProps, style };
}

// react-spring's `loop` (and the from/to it bounces between) is a whole-spring
// setting, not per-key — so a single motion.Box can't have one property loop
// forever while another animates once and stops. In practice that's rarely
// needed: a property whose target never changes just re-settles on the same
// value every "cycle", which is a no-op. Only the top-level/default repeat
// config drives looping; per-key repeat overrides aren't supported.
function resolveLoop(transition: MotionTransitionProp | undefined) {
  const t = singleTransition(transition)
    ?? (transition && isPerKeyTransition(transition) ? transition.default : undefined);
  if (!t?.repeat) return undefined;
  return t.repeatType === 'reverse' ? { reverse: true } : true;
}

function useMotionSpring(
  animate: MotionValues | undefined,
  initial: MotionValues | undefined,
  transition: MotionTransitionProp | undefined,
  onAnimationStart?: () => void,
  onAnimationComplete?: () => void,
  animateOnMount?: boolean,
  onKeyframeComplete?: (frameIndex: number) => void,
) {
  // Per-key react-spring config: array duration/ease fields flatten to their
  // resting (last) elements whenever a sequence isn't running.
  const springConfig = (key: string) => configFor(transition, key);
  const loop = resolveLoop(transition);
  // react-spring's Controller requires every key to be present in the very
  // first useSpring() call — touching a key later via .set()/.start() that
  // wasn't part of that initial shape throws (verified empirically). Since
  // `animate` and `initial` can each carry different keys, and which one is
  // "current" can change (e.g. a Button's whileTap target swapping in), seed
  // the union of both up front. The seeded VALUES here don't matter — the
  // mount effect below immediately overwrites them via set()/start(); only
  // their presence as known keys does.
  const seedKeys = { ...animate, ...initial };
  // An array value anywhere in `animate` marks a keyframe sequence (Motion's
  // keyframes: animate={{ width: [w/1.7, 0] }}) — played as one chained
  // animation, settling on the LAST element. Shorter/exact arrays per key are
  // padded by holding each key's final element once it's exhausted.
  const isKeyframes = Object.values(animate ?? {}).some(v => Array.isArray(v));
  const keyframeLen = isKeyframes
    ? Math.max(1, ...Object.values(animate!).map(v => Array.isArray(v) ? v.length : 1))
    : 1;
  type MotionValuesExpanded = Record<string, number | number[] | string | undefined>;
  function buildFrames(v: MotionValues): Record<string, number | string>[] {
    const source = v as unknown as MotionValuesExpanded;
    const frames: Record<string, number | string>[] = [];
    for (let i = 0; i < keyframeLen; i++) {
      const frame: Record<string, number | string> = {};
      for (const k of Object.keys(source)) {
        const val = source[k];
        if (val === undefined) continue;
        frame[k] = Array.isArray(val) ? (val[Math.min(i, val.length - 1)] as number) : val;
      }
      frames.push(frame);
    }
    return frames;
  }
  const springSeed = isKeyframes ? buildFrames(animate!)[keyframeLen - 1] : seedKeys;
  const [springValues, api] = useSpring(() => ({ ...springSeed, config: springConfig }));

  // No `animate` target means this instance is purely static — settle once
  // to `initial` and never move again, rather than treating it as "nothing
  // to animate toward" and skipping the mount-time paint entirely.
  const target = animate ?? initial;
  const isStatic = !animate;

  // JSON.stringify keys the effect on value content, not object identity —
  // `animate`/`transition` are plain objects callers create fresh each
  // render (same as Motion's own `animate` prop), so referential equality
  // would re-trigger the spring on every render.
  const targetKey = JSON.stringify(target);
  const transitionKey = JSON.stringify(transition);
  // `animate` targets may equal what the instance already sits at on the
  // FIRST mount (e.g. a collapsed panel whose `animate` defaults to 0 while
  // it should visibly hold its `initial` width until the caller flips a
  // target). Defer the mount animation in that case — paint `initial` and
  // only animate once `animate` actually CHANGES.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!target) return;
    if (isStatic) {
      // .set() assigns immediately and reliably notifies the host
      // (applyAnimatedValues in spring.ts — what actually writes into the
      // real scene node). .start()  with immediate:true does NOT: react-
      // spring treats "start to the value it's already at" as a no-op and
      // skips the notification entirely, so a purely static instance would
      // never paint at all (verified empirically — this is not a hypothetical).
      onAnimationStart?.();
      api.set(target);
      onAnimationComplete?.();
      return;
    }
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (!animateOnMount && initial) {
        onAnimationStart?.();
        api.set(initial);
        onAnimationComplete?.();
        return;
      }
    }
    // react-spring's own onStart/onRest drive the callbacks: onStart only
    // fires when a real animation actually begins moving (a start() toward
    // the value a spring is already settled at is a `noop` — no onStart), and
    // onRest fires on completion, cancellation AND noop. Only report
    // "complete" when it finished (`result.finished`), so a cancelled or
    // never-started animation can't falsely flip an isAnimating flag off.
    const base: Record<string, unknown> = {
      // A reverse loop needs an explicit `from` to bounce back to — without
      // it react-spring has nowhere to return to and just settles once.
      // `initial` is that other endpoint (mirrors how the seed above works).
      from: loop && initial ? initial : undefined,
      config: springConfig,
      loop,
      delay: loop
        ? singleTransition(transition)?.repeatDelay
        : singleTransition(transition)?.delay,
      onStart: onAnimationStart,
      onRest: (result: { finished?: boolean }) => { if (result.finished) onAnimationComplete?.(); },
    };
    // Keyframe sequences (`to` array) are chained into ONE animation that
    // settles on the last frame — the caller's `animate={{ width: [w/1.7, 0] }}`
    // becomes "widen, then shrink, then rest at 0". Per-key arrays of unequal
    // length hold each key's last value once exhausted (buildFrames padding).
    // React-spring applies configs per chained frame, so each segment gets the
    // transition resolved at ITS index — keyframe-aligned duration/ease arrays
    // (transition={{ duration: [200, 800] }}) shape each segment individually.
    if (isKeyframes) {
      const frames = buildFrames(target);
      const withConfig = frames.map((frame, step) => {
        const keys = Object.keys(target as MotionValues);
        // A chained frame carries ONE config for the whole step; when keys
        // resolve to differing transitions the first animated key wins (the
        // per-key + per-frame nesting isn't expressible in a single spring).
        const cfg = configFor(transition, keys[0] ?? '', step);
        return {
          ...frame,
          config: cfg,
          // Each to-frame is started as its own spring step, so a frame-level
          // onRest fires exactly when THAT segment settles — giving callers a
          // per-frame callback (onKeyframeComplete) before the final
          // whole-sequence onAnimationComplete.
          onRest: (result: { finished?: boolean }) => {
            if (result.finished) onKeyframeComplete?.(step);
          },
        };
      });
      api.start({
        ...base,
        to: withConfig as unknown as Record<string, number | string>[],
      });
    } else {
      api.start({
        ...base,
        // `target` is a plain MotionValues object; spread it as scalar values.
        // Overload resolution needs a cast here because MotionValues also
        // allows keyframe arrays used by the isKeyframes branch above.
        ...(target as unknown as Record<string, number | string>),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, transitionKey, isKeyframes]);

  return springValues as Record<string, unknown>;
}

export interface MotionBoxProps extends Omit<BoxProps, 'x' | 'y' | 'width' | 'height' | 'color' | 'borderColor' | 'borderWidth'> {
  initial?: MotionValues;
  animate?: MotionValues;
  transition?: MotionTransitionProp;
  /** Fires each time an animation (re)starts — i.e. whenever the `animate`
   *  target changes and the spring begins moving. Use it with
   *  onAnimationComplete to track a "pending"/in-progress state. */
  onAnimationStart?: () => void;
  /** Fires when the animation settles at its target (spring no longer
   *  moving), mirrored on the `initial` settle for static instances. */
  onAnimationComplete?: () => void;
  /** Default true. When false, the component holds `initial` on mount and
   *  plays no animation until the `animate` target CHANGES — useful for
   *  content that should sit at a natural size until the first interaction
   *  (e.g. a peek panel that finally collapses to 0 only after expanding). */
  animateOnMount?: boolean;
  /** Fires when EACH keyframe segment settles, in order (0-based frame
   *  index), before the final onAnimationComplete. Only for chained
   *  keyframes (animate={{ width: [a, b, c] }}). */
  onKeyframeComplete?: (frameIndex: number) => void;
}

function MotionBoxImpl(
  { initial, animate, transition, onAnimationStart, onAnimationComplete, animateOnMount, onKeyframeComplete, style, children, ...rest }: MotionBoxProps,
  ref: React.Ref<unknown>,
) {
  const springValues = useMotionSpring(animate, initial, transition, onAnimationStart, onAnimationComplete, animateOnMount, onKeyframeComplete);
  const { boxProps, style: springStyle } = splitSpringStyle(springValues);
  return React.createElement(
    animated.Box,
    { ref, ...rest, ...boxProps, style: { ...style, ...springStyle } },
    children,
  );
}
export const MotionBox = React.forwardRef(MotionBoxImpl);

export interface MotionButtonProps extends ButtonGestureOptions {
  initial?: MotionValues;
  animate?: MotionValues;
  /** Style applied while pressed — springs back to `animate` on release. */
  whileTap?: MotionValues;
  transition?: MotionTransitionProp;
  style?: BoxProps['style'];
  children?: React.ReactNode;
  /** Fires whenever pressed state toggles — for driving sibling/child
   *  motion.Box elements (which can't reach a parent Button's internal press
   *  state on their own) off the same gesture, instead of wiring separate
   *  onTouchStart/onTouchEnd/onTouchCancel by hand. */
  onActiveChange?: (active: boolean) => void;
}

function MotionButtonImpl(
  { initial, animate, whileTap, transition, style, children, onActiveChange, ...gestureOptions }: MotionButtonProps,
  forwardedRef: React.Ref<unknown>,
) {
  const { active, nodeRef } = useButtonGesture(gestureOptions);
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);
  const target = active && whileTap ? { ...animate, ...whileTap } : animate;
  const springValues = useMotionSpring(target, initial, transition);
  const { boxProps, style: springStyle } = splitSpringStyle(springValues);

  const setRef = (node: unknown) => {
    (nodeRef as React.MutableRefObject<unknown>).current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<unknown>).current = node;
  };

  return React.createElement(
    animated.Box,
    { ref: setRef, x: gestureOptions.x, y: gestureOptions.y, width: gestureOptions.width, height: gestureOptions.height, ...boxProps, style: { ...style, ...springStyle } },
    children,
  );
}
export const MotionButton = React.forwardRef(MotionButtonImpl);

/** Motion(Framer Motion)-shaped animation primitives on top of this
 *  renderer's own react-spring foundation (see spring.ts) — `Box`/`Button`
 *  are unchanged and unaffected; `motion.Box`/`motion.Button` are the opt-in
 *  animated variants, matching motion.dev's own initial/animate/whileTap/
 *  transition shape, including transition.repeat/repeatType for loops and
 *  per-key transitions. There's no equivalent of Motion's `useTransform`
 *  (one value driving several differently-computed outputs) — everything
 *  here is a flat target value, same as the real animate prop. */
export const motion = {
  Box: MotionBox as unknown as React.ForwardRefExoticComponent<MotionBoxProps>,
  Button: MotionButton as unknown as React.ForwardRefExoticComponent<MotionButtonProps>,
};
