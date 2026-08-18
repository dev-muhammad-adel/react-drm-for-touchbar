import React, { useRef, useEffect } from 'react';
import { spawn } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { MdVolumeOff, MdVolumeDown, MdVolumeUp } from 'react-icons/md';
import { BackButton } from '@/components/BackButton';
import { SliderTrack } from '@/components/SliderTrack';
import { useLayers } from './index';
import { createLogger } from 'react-drm';
import { useVolumeControl, readVolume, TRACK_W, clampVolume } from '@/lib/hooks/useVolume';
import { PW_ENV } from '@/lib/services/volume';

const log = createLogger('audioSlider');

function Sep() {
  return <Box style={{ width: 1, height: 28, backgroundColor: '#1e293b' }} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AudioSliderLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers();
  const { vol, setVolume, syncVolume } = useVolumeControl();
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

  // Reset the inactivity countdown on every volume change — covers both a
  // drag on this layer's own track and one still being driven by the
  // splitted layer's volume button (long-press-and-drag), which never
  // touches this track directly so onTouchStart/onTouchEnd below never fire.
  useEffect(() => {
    scheduleHide();
  }, [vol]);

  // Sync when volume changes externally (keyboard shortcut, another app).
  // PipeWire/PulseAudio is socket-based so chokidar can't watch it —
  // pactl subscribe is the audio equivalent of a file watcher.
  useEffect(() => {
    const proc = spawn('pactl', ['subscribe'], { env: PW_ENV });

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes("'change' on sink") && !drag.current) {
        syncVolume(readVolume());
      }
    });

    proc.on('error', () => {}); // pactl unavailable — wpctl-only system

    return () => {
      clearHideTimer();
      proc.kill();
    };
  }, []);

  function onMove(x: number) {
    if (!drag.current) return;
    const nv = clampVolume(drag.current.v + (x - drag.current.x) / TRACK_W);
    setVolume(nv);
    drag.current = { x, v: nv };
  }

  const VolumeIcon = vol < 0.02 ? MdVolumeOff : vol < 0.5 ? MdVolumeDown : MdVolumeUp;

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <BackButton to="splitted" animation="slide-down" />
      <Sep />

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
        <SliderTrack
          fill={vol}
          width={TRACK_W}
          icon={<VolumeIcon style={{ width: 18, height: 18 }} fill="#f5f5f7" stroke="none" />}
        />
      </Button>

      <Text style={{ width: 52, fontSize: 18, color: '#94a3b8', fontFamily: 'IosevkaTerm Nerd Font' }}>
        {`${Math.round(vol * 100)}%`}
      </Text>
    </Box>
  );
}
