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
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  borderRadius?: number;
  rotate?: number;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
}

// Same shape as Motion's own transition prop: a spring preset plus optional
// repeat controls. `repeatType: 'reverse'` bounces between `initial` and the
// animate target forever — the same "breathing" pattern Motion's own docs
// use for a looping animation, expressed purely through animate/transition
// rather than a hand-driven value. (No 'mirror' — react-spring's `loop` has
// no equivalent, and nothing here needs it.)
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
   *  tension/friction/mass when present. */
  duration?: number;
  ease?: (t: number) => number;
  repeat?: number;
  repeatType?: 'loop' | 'reverse';
  repeatDelay?: number;
}

// Either one transition for every animated key, or a per-key map (Motion's
// own shape: transition={{ opacity: {...}, default: {...} }}) — 'default'
// covers any key not explicitly listed.
export type MotionTransitionProp = MotionTransition | (Partial<Record<keyof MotionValues, MotionTransition>> & { default?: MotionTransition });

function isPerKeyTransition(t: MotionTransitionProp): t is Partial<Record<keyof MotionValues, MotionTransition>> & { default?: MotionTransition } {
  return !('tension' in t) && !('friction' in t);
}

function resolveTransition(t: MotionTransitionProp | undefined, key: string): MotionTransition {
  if (!t) return SPRING.snappy;
  if (!isPerKeyTransition(t)) return t;
  return (t as Record<string, MotionTransition>)[key] ?? t.default ?? SPRING.snappy;
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
  const t = transition && !isPerKeyTransition(transition) ? transition : transition?.default;
  if (!t?.repeat) return undefined;
  return t.repeatType === 'reverse' ? { reverse: true } : true;
}

function useMotionSpring(
  animate: MotionValues | undefined,
  initial: MotionValues | undefined,
  transition: MotionTransitionProp | undefined,
  onAnimationComplete?: () => void,
) {
  const configFn = (key: string) => {
    const t = resolveTransition(transition, key);
    return t.duration !== undefined
      ? { duration: t.duration, easing: t.ease }
      : { tension: t.tension, friction: t.friction, mass: t.mass };
  };
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
  const [springValues, api] = useSpring(() => ({ ...seedKeys, config: configFn }));
  const mounted = useRef(false);

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
  useEffect(() => {
    if (!target) return;
    if (isStatic) {
      // .set() assigns immediately and reliably notifies the host
      // (applyAnimatedValues in spring.ts — what actually writes into the
      // real scene node). .start()  with immediate:true does NOT: react-
      // spring treats "start to the value it's already at" as a no-op and
      // skips the notification entirely, so a purely static instance would
      // never paint at all (verified empirically — this is not a hypothetical).
      api.set(target);
      return;
    }
    api.start({
      ...target,
      // A reverse loop needs an explicit `from` to bounce back to — without
      // it react-spring has nowhere to return to and just settles once.
      // `initial` is that other endpoint (mirrors how the seed above works).
      from: loop && initial ? initial : undefined,
      config: configFn,
      loop,
      delay: loop && transition && !isPerKeyTransition(transition) ? transition.repeatDelay : undefined,
      onRest: mounted.current ? onAnimationComplete : undefined,
    });
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, transitionKey]);

  return springValues as Record<string, unknown>;
}

export interface MotionBoxProps extends Omit<BoxProps, 'x' | 'y' | 'width' | 'height' | 'color' | 'borderColor' | 'borderWidth'> {
  initial?: MotionValues;
  animate?: MotionValues;
  transition?: MotionTransitionProp;
  onAnimationComplete?: () => void;
}

function MotionBoxImpl(
  { initial, animate, transition, onAnimationComplete, style, children, ...rest }: MotionBoxProps,
  ref: React.Ref<unknown>,
) {
  const springValues = useMotionSpring(animate, initial, transition, onAnimationComplete);
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
