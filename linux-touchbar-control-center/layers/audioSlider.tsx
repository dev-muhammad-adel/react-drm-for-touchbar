import React, { useRef, useEffect } from 'react';
import { spawn } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { useAtomValue } from 'jotai';
import { MdVolumeOff, MdVolumeDown, MdVolumeUp } from 'react-icons/md';
import { BackButton } from '@/components/BackButton';
import { SliderTrack } from '@/components/SliderTrack';
import { useLayers } from './index';
import { createLogger } from 'react-drm';
import { useVolumeControl, readVolume, TRACK_W, clampVolume } from '@/lib/hooks/useVolume';
import { PW_ENV } from '@/lib/services/volume';
import { audioTrackAnchorAtom, ANCHOR_TRACK_W } from '@/store/audioTrackAnchor';

const log = createLogger('audioSlider');

function Sep() {
  return <Box style={{ width: 1, height: 28, backgroundColor: '#1e293b' }} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AudioSliderLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers();
  const { vol, setVolume, syncVolume } = useVolumeControl();
  const anchor = useAtomValue(audioTrackAnchorAtom);
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
      go('splitted', 'fade');
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

  // Anchored (long-press) drags a smaller popover track; the default
  // centered slider stays the full TRACK_W. Sensitivity must match whichever
  // one is actually rendered, or a direct drag on the visible track would
  // feel decoupled from how far the finger actually needs to move.
  const activeTrackW = anchor ? ANCHOR_TRACK_W : TRACK_W;

  function onMove(x: number) {
    if (!drag.current) return;
    const nv = clampVolume(drag.current.v + (x - drag.current.x) / activeTrackW);
    setVolume(nv);
    drag.current = { x, v: nv };
  }

  const VolumeIcon = vol < 0.02 ? MdVolumeOff : vol < 0.5 ? MdVolumeDown : MdVolumeUp;

  const PERCENT_W = 52;
  const PERCENT_GAP = 12;

  // Track + its percentage readout, grouped so the text rides along with
  // the track when it's anchored to a touch point instead of centered.
  const trackAndPercentage = (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: PERCENT_GAP }}>
      <Button
        width={activeTrackW} height={height}
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
          width={activeTrackW}
          icon={<VolumeIcon style={{ width: 18, height: 18}} fill="#f5f5f7" stroke="none" />}
        />
      </Button>

      <Text style={{ width: PERCENT_W, fontSize: 18, color: '#94a3b8' }}>
        {`${Math.round(vol * 100)}%`}
      </Text>
    </Box>
  );

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      <BackButton to="splitted" animation="fade" />

      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {/* <Sep /> */}
        {anchor
          ? <Box style={{ width: activeTrackW + PERCENT_GAP + PERCENT_W, height }} />
          : trackAndPercentage}
      </Box>

      {anchor && (
        // Opened via long-press-and-drag: the track (and its percentage
        // readout) render where the touch was, not centered, and at the
        // smaller ANCHOR_TRACK_W. Positioned as a direct sibling of
        // BackButton — not nested inside the centered inner Box above — so
        // `left` is measured from this layer's own root origin, the same
        // coordinate space anchor.x was captured in. See
        // store/audioTrackAnchor.ts for why trackLeft = touchX -
        // vol*ANCHOR_TRACK_W lands the knob exactly on the touch point.
        <Box style={{ position: 'absolute', left: anchor.x, top: 0, height }}>
          {trackAndPercentage}
        </Box>
      )}
    </Box>
  );
}
