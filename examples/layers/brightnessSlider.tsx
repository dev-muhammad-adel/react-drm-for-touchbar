import React, { useState, useRef } from 'react';
import { execFile, execFileSync } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { MdBrightness4, MdBrightness6, MdBrightness7 } from 'react-icons/md';
import { BackButton } from '../components/BackButton';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readBrightness(): number {
  try {
    const cur = parseInt(execFileSync('brightnessctl', ['get'], { encoding: 'utf8' }).trim());
    const max = parseInt(execFileSync('brightnessctl', ['max'], { encoding: 'utf8' }).trim());
    return max > 0 ? Math.min(1, cur / max) : 0.5;
  } catch { return 0.5; }
}

function applyBrightness(pct: number): void {
  execFile('brightnessctl', ['set', `${Math.max(1, Math.round(pct * 100))}%`], () => {});
}

function Sep() {
  return <Box style={{ width: 1, height: 28, backgroundColor: '#1e293b' }} />;
}

// ── Track ─────────────────────────────────────────────────────────────────────

const TRACK_W  = 700;
const HANDLE_D = 14;

function Track({ fill, color }: { fill: number; color: string }) {
  const fillW   = Math.round(fill * TRACK_W);
  const handleX = Math.max(0, Math.min(TRACK_W - HANDLE_D, fillW - HANDLE_D / 2));

  return (
    <Box style={{ width: TRACK_W, height: HANDLE_D }}>
      {/* Dim track */}
      <Box style={{ position: 'absolute', left: 0,     top: 6, width: TRACK_W, height: 2, backgroundColor: '#1e293b' }} />
      {/* Filled portion */}
      {fillW > 0 && (
        <Box style={{ position: 'absolute', left: 0, top: 6, width: fillW, height: 2, backgroundColor: color }} />
      )}
      {/* Handle */}
      <Box style={{ position: 'absolute', left: handleX, top: 0, width: HANDLE_D, height: HANDLE_D, borderRadius: HANDLE_D / 2, backgroundColor: color }}>
        <Box style={{ position: 'absolute', left: 4, top: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: '#0f172a' }} />
      </Box>
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BrightnessSliderLayer({ width, height }: { width: number; height: number }) {
  const [bright, setBright] = useState<number>(() => readBrightness());
  const drag = useRef<{ x: number; v: number } | null>(null);

  function clamp(v: number) { return Math.max(0, Math.min(1, v)); }
  function update(v: number) { setBright(v); applyBrightness(v); }

  function onMove(x: number) {
    if (!drag.current) return;
    const nv = clamp(drag.current.v + (x - drag.current.x) / TRACK_W);
    update(nv);
    drag.current = { x, v: nv };
  }

  const BrightIcon = bright < 0.3 ? MdBrightness4 : bright < 0.7 ? MdBrightness6 : MdBrightness7;

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <BackButton to="splitted" />
      <Sep />

      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <BrightIcon style={{ width: 28, height: 28 }} fill="#fbbf24" stroke="none" />
        <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'IosevkaTerm Nerd Font' }}>BRIGHT</Text>
      </Box>

      <Button
        width={TRACK_W} height={height}
        color="transparent" activeColor="transparent"
        style={{ justifyContent: 'center', alignItems: 'center' }}
        onTouchStart={(x) => { drag.current = { x, v: bright }; }}
        onTouchMove={onMove}
        onTouchEnd={() => { drag.current = null; }}
      >
        <Track fill={bright} color="#fbbf24" />
      </Button>

      <Text style={{ width: 52, fontSize: 18, color: '#94a3b8', fontFamily: 'IosevkaTerm Nerd Font' }}>
        {`${Math.round(bright * 100)}%`}
      </Text>
    </Box>
  );
}
