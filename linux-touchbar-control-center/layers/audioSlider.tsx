import React, { useState, useRef, useEffect } from 'react';
import { execFile, execFileSync, spawn } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { MdVolumeOff, MdVolumeDown, MdVolumeUp } from 'react-icons/md';
import { BackButton } from '../components/BackButton';
import { useLayers } from './index';

// When running as root the session socket isn't inherited — pass it explicitly.
const PW_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  XDG_RUNTIME_DIR:  process.env.XDG_RUNTIME_DIR  ?? '/run/user/1000',
  PIPEWIRE_REMOTE:  process.env.PIPEWIRE_REMOTE   ?? '/run/user/1000/pipewire-0',
};

// ── Backend detection ─────────────────────────────────────────────────────────

function hasWpctl(): boolean {
  try { execFileSync('wpctl', ['--help'], { encoding: 'utf8', env: PW_ENV }); return true; }
  catch { return false; }
}

const USE_WPCTL = hasWpctl();

// ── Helpers ───────────────────────────────────────────────────────────────────

function readVolume(): number {
  try {
    if (USE_WPCTL) {
      const out = execFileSync('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@'],
        { encoding: 'utf8', env: PW_ENV });
      // "Volume: 0.50" or "Volume: 0.50 [MUTED]"
      const m = out.match(/Volume:\s*([\d.]+)/);
      return m ? Math.min(1, parseFloat(m[1])) : 0.5;
    } else {
      const out = execFileSync('pactl', ['get-sink-volume', '@DEFAULT_SINK@'],
        { encoding: 'utf8' });
      // "Volume: front-left: 65536 /  100% / ..."
      const m = out.match(/(\d+)%/);
      return m ? Math.min(1, parseInt(m[1]) / 100) : 0.5;
    }
  } catch { return 0.5; }
}

function applyVolume(pct: number): void {
  if (USE_WPCTL) {
    execFile('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', pct.toFixed(2)],
      { env: PW_ENV },
      (err) => { if (err) console.error('[audioSlider] wpctl:', err.message); },
    );
  } else {
    execFile('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${Math.round(pct * 100)}%`],
      (err) => { if (err) console.error('[audioSlider] pactl:', err.message); },
    );
  }
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
  const { go } = useLayers();
  const [vol, setVol] = useState<number>(() => readVolume());
  const drag = useRef<{ x: number; v: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHideTimer() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      drag.current = null;
      go('splitted', 'slide-down');
    }, 5000);
  }

  // Sync when volume changes externally (keyboard shortcut, another app).
  // PipeWire/PulseAudio is socket-based so chokidar can't watch it —
  // pactl subscribe is the audio equivalent of a file watcher.
  useEffect(() => {
    scheduleHide(); // auto-close after inactivity, even if the slider is never touched
    const proc = spawn('pactl', ['subscribe'], { env: PW_ENV });

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes("'change' on sink") && !drag.current) {
        setVol(readVolume());
      }
    });

    proc.on('error', () => {}); // pactl unavailable — wpctl-only system

    return () => {
      clearHideTimer();
      proc.kill();
    };
  }, []);

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
      <BackButton to="splitted" animation="slide-down" />
      <Sep />

      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <VolumeIcon style={{ width: 28, height: 28 }} fill={iconColor} stroke="none" />
        <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'IosevkaTerm Nerd Font' }}>VOLUME</Text>
      </Box>

      <Button
        width={TRACK_W} height={height}
        color="transparent" activeColor="transparent"
        style={{ justifyContent: 'center', alignItems: 'center' }}
        onTouchStart={(x) => {
          clearHideTimer();
          drag.current = { x, v: vol };
        }}
        onTouchMove={onMove}
        onTouchEnd={() => {
          drag.current = null;
          scheduleHide();
        }}
      >
        <Track fill={vol} color="#38bdf8" />
      </Button>

      <Text style={{ width: 52, fontSize: 18, color: '#94a3b8', fontFamily: 'IosevkaTerm Nerd Font' }}>
        {`${Math.round(vol * 100)}%`}
      </Text>
    </Box>
  );
}
