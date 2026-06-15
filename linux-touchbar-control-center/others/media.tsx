/**
 * Touch Bar Media Controller
 *
 * Ultra-wide transport/timeline UI for a 2008x60 DRM display.
 *
 * Run with:
 *   sudo npx tsx linux-touchbar-control-center/media.tsx
 *
 * Controls:
 *   - Touch: previous / play-pause / next / seek bar / volume +/-
 *   - Keyboard (TTY):
 *       space = play/pause
 *       j,l   = previous/next track
 *       arrows left/right = seek -/+5s
 *       arrows up/down    = volume +/-5
 *       +/-   = volume +/-5
 *       Ctrl+C = exit
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { render, Box, Text, TouchReader } from 'react-drm';

interface Track {
  title: string;
  artist: string;
  duration: number; // seconds
}

const TRACKS: Track[] = [
  { title: 'Neon Drive', artist: 'Arc Fade', duration: 192 },
  { title: 'Glass Harbor', artist: 'Sine District', duration: 244 },
  { title: 'City Voltage', artist: 'After Frame', duration: 218 },
  { title: 'Magnetic Rain', artist: 'Delta Bloom', duration: 206 },
];

const SEEK_STEP_SEC = 5;
const VOLUME_STEP = 5;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

interface HitZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onPress: () => void;
}

function MediaBar({ width, height }: { width: number; height: number }) {
  const [trackIdx, setTrackIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [positionSec, setPositionSec] = useState(38);
  const [volume, setVolume] = useState(72);
  const [flashZone, setFlashZone] = useState<string | null>(null);

  const touchReaderRef = useRef<TouchReader | null>(null);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapRef = useRef(0);

  const track = TRACKS[trackIdx];

  const setFlash = useCallback((id: string) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashZone(id);
    flashTimerRef.current = setTimeout(() => {
      setFlashZone(null);
      flashTimerRef.current = null;
    }, 120);
  }, []);

  const prevTrack = useCallback(() => {
    setTrackIdx(prev => (prev - 1 + TRACKS.length) % TRACKS.length);
    setPositionSec(0);
    setFlash('prev');
  }, [setFlash]);

  const nextTrack = useCallback(() => {
    setTrackIdx(prev => (prev + 1) % TRACKS.length);
    setPositionSec(0);
    setFlash('next');
  }, [setFlash]);

  const togglePlay = useCallback(() => {
    setPlaying(prev => !prev);
    setFlash('play');
  }, [setFlash]);

  const seekBy = useCallback((delta: number) => {
    setPositionSec(prev => clamp(prev + delta, 0, track.duration));
    setFlash(delta < 0 ? 'seek_back' : 'seek_fwd');
  }, [track.duration, setFlash]);

  const setProgressByX = useCallback((x: number, seekX: number, seekW: number) => {
    const ratio = clamp((x - seekX) / seekW, 0, 1);
    setPositionSec(Math.round(ratio * track.duration));
    setFlash('seek_bar');
  }, [track.duration, setFlash]);

  const adjustVolume = useCallback((delta: number) => {
    setVolume(prev => clamp(prev + delta, 0, 100));
    setFlash(delta < 0 ? 'vol_down' : 'vol_up');
  }, [setFlash]);

  // Playback progression
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setPositionSec(prev => {
        if (prev >= track.duration) {
          setTrackIdx(idx => (idx + 1) % TRACKS.length);
          return 0;
        }
        return prev + 0.25;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, track.duration]);

  useEffect(() => {
    setPositionSec(prev => clamp(prev, 0, track.duration));
  }, [track.duration]);

  const ui = useMemo(() => {
    const leftW = 530;
    const btnW = 86;
    const btnH = 44;
    const btnY = 8;
    const prevX = 238;
    const playX = prevX + btnW + 8;
    const nextX = playX + btnW + 8;

    const seekX = 560;
    const seekY = 22;
    const seekW = 1038;
    const seekH = 16;

    const rightX = 1620;
    const volBtnW = 76;
    const volBtnH = 44;
    const volY = 8;
    const volDownX = rightX + 168;
    const volUpX = volDownX + volBtnW + 6;

    return {
      leftW,
      prevX,
      playX,
      nextX,
      btnW,
      btnH,
      btnY,
      seekX,
      seekY,
      seekW,
      seekH,
      rightX,
      volDownX,
      volUpX,
      volBtnW,
      volBtnH,
      volY,
    };
  }, []);

  const hitZones = useMemo<HitZone[]>(() => [
    { id: 'prev', x: ui.prevX, y: ui.btnY, w: ui.btnW, h: ui.btnH, onPress: prevTrack },
    { id: 'play', x: ui.playX, y: ui.btnY, w: ui.btnW, h: ui.btnH, onPress: togglePlay },
    { id: 'next', x: ui.nextX, y: ui.btnY, w: ui.btnW, h: ui.btnH, onPress: nextTrack },
    {
      id: 'seek_bar',
      x: ui.seekX,
      y: ui.seekY - 8,
      w: ui.seekW,
      h: ui.seekH + 16,
      onPress: () => {},
    },
    { id: 'vol_down', x: ui.volDownX, y: ui.volY, w: ui.volBtnW, h: ui.volBtnH, onPress: () => adjustVolume(-VOLUME_STEP) },
    { id: 'vol_up', x: ui.volUpX, y: ui.volY, w: ui.volBtnW, h: ui.volBtnH, onPress: () => adjustVolume(VOLUME_STEP) },
  ], [ui, prevTrack, togglePlay, nextTrack, adjustVolume]);

  const onTouch = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastTapRef.current < 80) return;
    lastTapRef.current = now;

    for (const z of hitZones) {
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) {
        if (z.id === 'seek_bar') {
          setProgressByX(x, ui.seekX, ui.seekW);
        } else {
          z.onPress();
        }
        return;
      }
    }
  }, [hitZones, setProgressByX, ui.seekX, ui.seekW]);

  // Touch input
  useEffect(() => {
    try {
      const reader = new TouchReader();
      touchReaderRef.current = reader;
      reader.start(onTouch);
    } catch (_) {
      touchReaderRef.current = null;
    }

    return () => {
      touchReaderRef.current?.stop();
      touchReaderRef.current = null;
    };
  }, [onTouch]);

  // Keyboard input fallback
  useEffect(() => {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handler = (chunk: Buffer) => {
      if (chunk[0] === 3) process.exit(0); // Ctrl+C

      // Arrow keys: ESC [ A/B/C/D
      if (chunk.length === 3 && chunk[0] === 27 && chunk[1] === 91) {
        if (chunk[2] === 65) adjustVolume(VOLUME_STEP);      // up
        if (chunk[2] === 66) adjustVolume(-VOLUME_STEP);     // down
        if (chunk[2] === 67) seekBy(SEEK_STEP_SEC);          // right
        if (chunk[2] === 68) seekBy(-SEEK_STEP_SEC);         // left
        return;
      }

      const key = chunk.toString('utf8');
      if (key === ' ') togglePlay();
      else if (key === 'j' || key === 'J') prevTrack();
      else if (key === 'l' || key === 'L') nextTrack();
      else if (key === '+' || key === '=') adjustVolume(VOLUME_STEP);
      else if (key === '-' || key === '_') adjustVolume(-VOLUME_STEP);
      else if (key === 'h' || key === 'H') seekBy(-SEEK_STEP_SEC);
      else if (key === 'k' || key === 'K') seekBy(SEEK_STEP_SEC);
    };

    process.stdin.on('data', handler);
    return () => { process.stdin.off('data', handler); };
  }, [adjustVolume, prevTrack, nextTrack, seekBy, togglePlay]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const progressRatio = clamp(positionSec / track.duration, 0, 1);
  const progressW = Math.round(ui.seekW * progressRatio);

  const btnColor = (id: string, base: string, active: string): string => {
    if (flashZone === id) return active;
    return base;
  };

  const playGlyph = playing ? '||' : '>';

  return (
    <Box x={0} y={0} width={width} height={height} color="#0b1020">

      {/* Background layers */}
      <Box x={0} y={0} width={width} height={height} color="#111827" />
      <Box x={0} y={0} width={width} height={3} color="#22d3ee" />
      <Box x={0} y={height - 3} width={width} height={3} color="#fb7185" />

      {/* Left panel: track metadata + transport */}
      <Box x={0} y={0} width={ui.leftW} height={height} color="#1f2937" />
      <Text x={12} y={6} color="#cccccc" fontSize={18} fontFamily="monospace">NOW</Text>
      <Text x={64} y={6} color="#f59e0b" fontSize={18} fontFamily="monospace">{track.title}</Text>
      <Text x={12} y={30} color="#93c5fd" fontSize={16} fontFamily="monospace">{track.artist}</Text>

      <Box x={ui.prevX} y={ui.btnY} width={ui.btnW} height={ui.btnH} color={btnColor('prev', '#111827', '#0f766e')}>
        <Text x={24} y={20} color="#d1fae5" fontSize={20} fontFamily="monospace">{'<<'}</Text>
      </Box>
      <Box x={ui.playX} y={ui.btnY} width={ui.btnW} height={ui.btnH} color={btnColor('play', '#111827', '#a855f7')}>
        <Text x={30} y={20} color="#f5d0fe" fontSize={20} fontFamily="monospace">{playGlyph}</Text>
      </Box>
      <Box x={ui.nextX} y={ui.btnY} width={ui.btnW} height={ui.btnH} color={btnColor('next', '#111827', '#0f766e')}>
        <Text x={24} y={20} color="#d1fae5" fontSize={20} fontFamily="monospace">{'>>'}</Text>
      </Box>

      {/* Timeline */}
      <Box x={ui.seekX - 2} y={0} width={ui.seekW + 4} height={height} color="#0f172a" />
      <Text x={ui.seekX + 6} y={4} color="#cbd5e1" fontSize={14} fontFamily="monospace">
        {`${fmtTime(positionSec)} / ${fmtTime(track.duration)}`}
      </Text>
      <Box x={ui.seekX} y={ui.seekY} width={ui.seekW} height={ui.seekH} color="#1e293b" />
      <Box x={ui.seekX} y={ui.seekY} width={progressW} height={ui.seekH} color={btnColor('seek_bar', '#22d3ee', '#f43f5e')} />
      <Box x={ui.seekX + progressW - 2} y={ui.seekY - 2} width={4} height={ui.seekH + 4} color="#f8fafc" />

      {/* Micro markers */}
      <Box x={ui.seekX + Math.floor(ui.seekW * 0.25)} y={ui.seekY} width={1} height={ui.seekH} color="#334155" />
      <Box x={ui.seekX + Math.floor(ui.seekW * 0.50)} y={ui.seekY} width={1} height={ui.seekH} color="#334155" />
      <Box x={ui.seekX + Math.floor(ui.seekW * 0.75)} y={ui.seekY} width={1} height={ui.seekH} color="#334155" />

      {/* Right panel: volume */}
      <Box x={ui.rightX} y={0} width={width - ui.rightX} height={height} color="#111827" />
      <Text x={ui.rightX + 10} y={8} color="#cccccc" fontSize={18} fontFamily="monospace">VOL</Text>
      <Text x={ui.rightX + 70} y={8} color="#fda4af" fontSize={18} fontFamily="monospace">{`${volume}%`}</Text>

      <Box x={ui.rightX + 10} y={34} width={150} height={10} color="#1e293b" />
      <Box x={ui.rightX + 10} y={34} width={Math.round(150 * (volume / 100))} height={10} color="#fb7185" />

      <Box x={ui.volDownX} y={ui.volY} width={ui.volBtnW} height={ui.volBtnH} color={btnColor('vol_down', '#1f2937', '#7c2d12')}>
        <Text x={30} y={20} color="#ffedd5" fontSize={22} fontFamily="monospace">-</Text>
      </Box>
      <Box x={ui.volUpX} y={ui.volY} width={ui.volBtnW} height={ui.volBtnH} color={btnColor('vol_up', '#1f2937', '#166534')}>
        <Text x={30} y={20} color="#dcfce7" fontSize={22} fontFamily="monospace">+</Text>
      </Box>

    </Box>
  );
}

