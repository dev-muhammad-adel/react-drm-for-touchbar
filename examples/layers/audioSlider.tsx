import React, { useState, useRef } from 'react';
import { execFile, execFileSync } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { MdVolumeOff, MdVolumeDown, MdVolumeUp } from 'react-icons/md';
import { BackButton } from '../components/BackButton';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readVolume(): number {
  try {
    const out = execFileSync('pactl', ['get-sink-volume', '@DEFAULT_SINK@'], { encoding: 'utf8' });
    const m = out.match(/(\d+)%/);
    return m ? Math.min(1, parseInt(m[1]) / 100) : 0.5;
  } catch { return 0.5; }
}

function applyVolume(pct: number): void {
  execFile('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${Math.round(pct * 100)}%`], () => {});
}

function Sep() {
  return <Box style={{ width: 1, height: 28, backgroundColor: '#1e293b' }} />;
}

// ── Track ─────────────────────────────────────────────────────────────────────

const TRACK_W  = 700;
const HANDLE_D = 14;

function Track({ fill, color }: { fill: number; color: string }) {
  const fillW  = Math.round(fill * TRACK_W);
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
        {/* <Box style={{ position: 'absolute', left: 4, top: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: '#0f172a' }} /> */}
      </Box>
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AudioSliderLayer({ width, height }: { width: number; height: number }) {
  const [vol, setVol] = useState<number>(() => readVolume());
  const drag = useRef<{ x: number; v: number } | null>(null);

  function clamp(v: number) { return Math.max(0, Math.min(1, v)); }
  function update(v: number) { setVol(v); applyVolume(v); }

  function onMove(x: number) {
    if (!drag.current) return;
    const nv = clamp(drag.current.v + (x - drag.current.x) / TRACK_W);
    update(nv);
    drag.current = { x, v: nv };
  }

  const VolumeIcon = vol < 0.02 ? MdVolumeOff : vol < 0.5 ? MdVolumeDown : MdVolumeUp;
  const iconColor  = vol < 0.02 ? '#475569' : '#38bdf8';

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <BackButton to="splitted" />
      <Sep />

      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <VolumeIcon style={{ width: 28, height: 28 }} fill={iconColor} stroke="none" />
        <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'IosevkaTerm Nerd Font' }}>VOLUME</Text>
      </Box>

      <Button
        width={TRACK_W} height={height}
        color="transparent" activeColor="transparent"
        style={{ justifyContent: 'center', alignItems: 'center' }}
        onTouchStart={(x) => { drag.current = { x, v: vol }; }}
        onTouchMove={onMove}
        onTouchEnd={() => { drag.current = null; }}
      >
        <Track fill={vol} color="#38bdf8" />
      </Button>

      <Text style={{ width: 52, fontSize: 18, color: '#94a3b8', fontFamily: 'IosevkaTerm Nerd Font' }}>
        {`${Math.round(vol * 100)}%`}
      </Text>
    </Box>
  );
}
