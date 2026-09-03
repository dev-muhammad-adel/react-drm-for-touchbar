import React from 'react';
import { Box } from 'react-drm';
import { useCavaBars } from '@/lib/hooks/useCavaBars';
import { CAVA } from '@/config.blueprint';

const BAR_W = 5;
const GAP = 2;
const MAX_H = 20;

// Same orange (bass) → cyan (treble) gradient as systembar's visualizer.
function colorFor(i: number, n: number): string {
  const t = n > 1 ? i / (n - 1) : 0;
  const r = Math.round(249 - t * 215);
  const g = Math.round(115 + t * 96);
  const b = Math.round(22 + t * 216);
  const hex = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
const CAVA_BARS = CAVA.bars;

export function Cava({width}:{width:number}) {
  const {
    barsRef , bars,isActive,BAR_COLORS
  } = useCavaBars();
  console.log(width)
  return (
    // Fixed height, not auto — bar heights change every frame, and letting
    // the container re-size with them would make the whole widget jitter
    // vertically as it re-centers inside DraggableWidget's Button each frame.
    <Box style={{ alignItems: 'flex-end',width, paddingHorizontal: 8}}>
          <Box ref={barsRef} style={{ alignItems: 'flex-end', gap: GAP }}>
            {bars.map((h: any, i: number ) => (
              <Box key={i} style={{width:((width - 2*(CAVA_BARS -1) - 16)/CAVA_BARS) , height: h, backgroundColor: isActive ? BAR_COLORS[i] : '#1e293b' }} />
            ))}
          </Box>
        </Box>
  );
}
