import React, { useRef, useContext, useState } from 'react';
import { Box, Text, Button, LayoutContext } from 'react-drm';
import type { BoxNode } from 'react-drm';
import { MdPlayArrow, MdPause } from 'react-icons/md';
import { useVlc } from '../../hooks/useVlc';

const ORANGE = '#fb923c';
const FONT = 'IosevkaTerm Nerd Font';

/** Microseconds → hh:mm:ss (zero-padded hours). */
function hms(us: number): string {
  const s = Math.max(0, Math.floor(us / 1e6));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function VlcPanel({ width, height }: { width: number; height: number }) {
  const { status, positionUs, lengthUs, playPause, seek } = useVlc();
  const [dragUs, setDragUs] = useState<number | null>(null);
  const shownUs = dragUs ?? positionUs;
  const pct = lengthUs > 0 ? Math.max(0, Math.min(1, shownUs / lengthUs)) : 0;

  // Fixed widths → the recessed bar + inset shadow can be sized exactly in px
  // (percentage left isn't supported), and the row fills `width` precisely.
  const PLAY_W = 110, TIME_W = 96, GAP = 8;
  const trackH = Math.max(10, height - 16);   // full height − 16px
  const radius = 10;                           // small corners
  const barW = Math.max(80, width - PLAY_W - TIME_W * 2 - GAP * 3);
  const fillW = Math.round(barW * pct);

  // Tap-to-seek: turn the touch X into a fraction of the bar's live bounds and
  // seek there (MPRIS SetPosition). Bounds come from the bar node's layout box,
  // the same way Button hit-tests itself.
  const layoutCtx = useContext(LayoutContext);
  const barRef = useRef<BoxNode | null>(null);
  const seekAt = (tx: number) => {
    const lb = barRef.current ? layoutCtx.current.get(barRef.current) : undefined;
    if (!lb || lb.w <= 0 || lengthUs <= 0) return;
    const frac = Math.max(0, Math.min(1, (tx - lb.x) / lb.w));
    seek(frac * lengthUs);
  };

  const previewAt = (tx: number) => {
    const lb = barRef.current ? layoutCtx.current.get(barRef.current) : undefined;
    if (!lb || lb.w <= 0 || lengthUs <= 0) return;
    const frac = Math.max(0, Math.min(1, (tx - lb.x) / lb.w));
    setDragUs(Math.round(frac * lengthUs));
  };

  const commitDrag = (tx: number) => {
    const lb = barRef.current ? layoutCtx.current.get(barRef.current) : undefined;
    if (!lb || lb.w <= 0 || lengthUs <= 0) {
      setDragUs(null);
      return;
    }
    const frac = Math.max(0, Math.min(1, (tx - lb.x) / lb.w));
    const nextUs = Math.round(frac * lengthUs);
    seek(nextUs);
    setDragUs(null);
  };

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: GAP, flex: 1 }}>
      <Button
        width={PLAY_W}
        height={height}
        color="#444444"
        activeColor="#555555"
        onClick={playPause}
        style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}
      >
        {status === 'Playing'
          ? <MdPause style={{ width: 32, height: 32 }} fill="#e5e5e5" stroke="none" />
          : <MdPlayArrow style={{ width: 32, height: 32 }} fill="#e5e5e5" stroke="none" />}
      </Button>

      <Box style={{ width: TIME_W, alignItems: 'center', justifyContent: 'center' }}>
        <Text color="#cbd5e1" fontSize={16} fontFamily={FONT}>{hms(shownUs)}</Text>
      </Box>

      {/* Recessed track (full height − 16), small corners, real inset shadow
          (over bg, under fill). Wrapped in a Button so a tap seeks to that time. */}
      <Button
        width={barW}
        height={trackH}
        color="transparent"
        activeColor="transparent"
        onTouchStart={(tx) => previewAt(tx)}
        onTouchMove={(tx) => previewAt(tx)}
        onTouchEnd={(tx) => commitDrag(tx)}
        onTouchCancel={() => setDragUs(null)}
      >
        <Box ref={barRef} style={{ width: barW, height: trackH, borderRadius: radius, backgroundColor: '#19191c', overflow: 'hidden', shadowColor: '#000000', shadowOpacity: 0.7, shadowRadius: 4, shadowInset: true }}>
          <Box style={{ position: 'absolute', left: 0, top: 0, width: fillW, height: trackH, borderRadius: radius, backgroundColor: ORANGE }} />
        </Box>
      </Button>

      <Box style={{ width: TIME_W, alignItems: 'center', justifyContent: 'center' }}>
        <Text color="#cbd5e1" fontSize={16} fontFamily={FONT}>{hms(lengthUs)}</Text>
      </Box>
    </Box>
  );
}
