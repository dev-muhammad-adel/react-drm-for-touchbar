import { useContext, useEffect, useRef, useState } from 'react';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { Box, Text, Button, LayoutContext, NativeDrawContext, DisplaySizeContext, BoxNode } from 'react-drm';
import { CAVA } from '@/config.blueprint';

// ── Audio Visualizer ─────────────────────────────────────────────────────────
const CAVA_BARS = CAVA.bars;
const CAVA_CFG  = '/tmp/.react-drm-cava.conf';
const CAVA_MAX_HEIGHT = 34;

try {
  writeFileSync(CAVA_CFG, [
    '[general]',
    `bars = ${CAVA_BARS}`,
    `framerate = ${CAVA.framerate}`,
    '[input]',
    'method = pulse',
    'source = auto',
    '[output]',
    'method = raw',
    'raw_target = /dev/stdout',
    'data_format = binary',
    'channels = mono',
    'bit_format = 8bit',
  ].join('\n'));
} catch { /**/ }

// orange (bass) → cyan (treble)
const BAR_COLORS = Array.from({ length: CAVA_BARS }, (_, i) => {
  const t = i / (CAVA_BARS - 1);
  const r = Math.round(249 - t * 215);
  const g = Math.round(115 + t *  96);
  const b = Math.round( 22 + t * 216);
  const hex = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
});

const BAR_W = 10;
const GAP   = 3;
const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const BAR_RGB      = BAR_COLORS.flatMap(hexRgb);                              // flat r,g,b per bar (active)
const INACTIVE_RGB = Array.from({ length: CAVA_BARS }, () => hexRgb('#1e293b')).flat();

/** Live bar levels, 0-1 each, BARS entries. Flat (all-zero) if cava isn't installed. */
export function useCavaBars(): any {
  const layoutRef  = useContext(LayoutContext);
  const native     = useContext(NativeDrawContext);
  const { height: dispH } = useContext(DisplaySizeContext);
  const barsRef    = useRef<BoxNode>(null);
  const heightsRef = useRef<number[]>(new Array(CAVA_BARS).fill(2));
  const [, force]  = useState(0);

  useEffect(() => {
    let partial: Buffer = Buffer.alloc(0);
    let prev = new Array(CAVA_BARS).fill(2);
    const proc = spawn('cava', ['-p', CAVA_CFG]);
    proc.stdout?.on('data', (chunk: Buffer) => {
      partial = partial.length ? Buffer.concat([partial, chunk]) : chunk;
      const whole = partial.length - (partial.length % CAVA_BARS);
      if (whole < CAVA_BARS) return;
      const frame = partial.slice(whole - CAVA_BARS, whole); // newest complete frame
      partial = whole < partial.length ? partial.slice(whole) : Buffer.alloc(0);
      const heights = Array.from(frame, v => Math.max(2, Math.round((v / 255) * CAVA_MAX_HEIGHT)));
      if (heights.every((h, i) => h === prev[i])) return;
      prev = heights;
      heightsRef.current = heights;

      // Native fast path: draw straight into the FB at the bars' laid-out box
      // (off the React commit loop → no full-tree layout/serialize). The box's
      // bottom edge + centered x are stable (bottom/center-aligned), so coords
      // are correct even between commits.
      const node = barsRef.current;
      const box = node ? layoutRef.current.get(node) : undefined;
      if (native && box) {
        const active = heights.some(h => h > 2);
        native.drawBars({
          x0: box.x, baseY: box.y + box.h, barW: BAR_W, gap: GAP, fullHeight: dispH,
          bg: [0, 0, 0], heights, colors: active ? BAR_RGB : INACTIVE_RGB,
        });
      } else {
        force(n => n + 1); // no native/layout yet → fall back to a React re-render
      }
    });
    return () => { try { proc.kill('SIGTERM'); } catch { /**/ } };
  }, [native, dispH, layoutRef]);

 const bars = heightsRef.current;
  const isActive = bars.some(h => h > 2);
  return {
    barsRef , bars,isActive,BAR_COLORS
  };
}
