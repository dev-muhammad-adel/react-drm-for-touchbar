import type React from 'react';
import { Globals } from '@react-spring/core';
import { createHost } from '@react-spring/animated';
import { Box } from './components/Box';
import { Text } from './components/Text';
import { invalidate } from './renderer/invalidate';
import type { SceneNode } from './scene/types';
import type { Style } from './scene/style';

const LAYOUT_STYLE_KEYS = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'marginHorizontal', 'marginVertical', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
  'padding', 'paddingHorizontal', 'paddingVertical', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'flexDirection', 'flexWrap',
  'justifyContent', 'alignItems', 'alignSelf', 'alignContent', 'gap', 'rowGap', 'columnGap',
  'position', 'left', 'right', 'top', 'bottom',
]);

const LAYOUT_PROP_KEYS = new Set(['x', 'y', 'width', 'height']);

// Node has no requestAnimationFrame — drive react-spring's frame loop with a
// timer. rafz only schedules while animations are active, so this idles free.
Globals.assign({
  requestAnimationFrame: (cb: (t: number) => void) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number,
});

// Animated components write each frame straight into the scene node (the host
// instance behind the forwarded ref) and request a repaint — no React render.
const host = createHost(
  { Box, Text },
  {
    applyAnimatedValues(instance: unknown, props: Record<string, unknown>): boolean {
      if (!instance || typeof instance !== 'object' || !('type' in instance)) return false;
      const node = instance as SceneNode & Record<string, unknown>;
      const { style, children: _children, ...rest } = props as {
        style?: Record<string, unknown>;
        children?: unknown;
      };
      let needsLayout = false;

      if (style) {
        for (const key of Object.keys(style)) {
          if (LAYOUT_STYLE_KEYS.has(key)) {
            needsLayout = true;
            break;
          }
        }
      }

      for (const key of Object.keys(rest)) {
        if (LAYOUT_PROP_KEYS.has(key)) {
          needsLayout = true;
          break;
        }
      }

      if (style) node.style = { ...(node.style as Style), ...style } as Style;
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) node[k] = v;
      invalidate(needsLayout);
      return true;
    },
  },
);

// Animated props may be SpringValues/Interpolations, so the strict component
// prop types don't apply — keep the animated variants loosely typed.
type AnimatedComponent = React.ForwardRefExoticComponent<
  Record<string, unknown> & { style?: Record<string, unknown>; children?: React.ReactNode }
>;

export const animated = host.animated as unknown as {
  Box: AnimatedComponent;
  Text: AnimatedComponent;
};

export {
  useSpring,
  useSpringValue,
  useTransition,
  useSprings,
  to as springTo,
  easings,
  config as springConfig,
} from '@react-spring/core';
export type { SpringValue, Interpolation, TransitionFn } from '@react-spring/core';
