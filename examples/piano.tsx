import React, { useState, useCallback, useEffect, useRef } from 'react';
import { spawn } from 'child_process';
import fs from 'fs';
import { Box, Text, useGestureRegion } from 'react-drm';

// ── Audio ─────────────────────────────────────────────────────────────────────

const SF2_PATHS = [
  '/usr/share/soundfonts/FluidR3_GM.sf2',
  '/usr/share/sounds/sf2/FluidR3_GM.sf2',
  '/usr/share/soundfonts/default.sf2',
];

const PULSE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  XDG_RUNTIME_DIR: '/run/user/1000',
  PULSE_SERVER:    'unix:/run/user/1000/pulse/native',
};

class FluidSynth {
  private proc: ReturnType<typeof spawn> | null = null;
  private ready = false;
  private queue: string[] = [];

  constructor(sf2: string) {
    try {
      this.proc = spawn('fluidsynth', ['-a', 'pulseaudio', '-g', '2.0', '-R', '0.6', '-C', '0', '-q', sf2], {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: PULSE_ENV,
      });
      this.proc.on('error', () => { this.proc = null; });
      this.proc.on('exit',  () => { this.proc = null; });
      setTimeout(() => {
        this.ready = true;
        this.write('prog 0 0');
        this.queue.forEach(c => this.write(c));
        this.queue = [];
      }, 350);
    } catch { this.proc = null; }
  }

  private write(line: string): void { this.proc?.stdin?.write(line + '\n'); }
  send(line: string): void { if (!this.ready) { this.queue.push(line); return; } this.write(line); }
  on(midi: number, vel = 100): void { this.send(`noteon 0 ${midi} ${vel}`); }
  off(midi: number): void           { this.send(`noteoff 0 ${midi} 0`); }
  destroy(): void { this.proc?.stdin?.end(); this.proc?.kill(); }
}

const sf2 = SF2_PATHS.find(p => { try { fs.accessSync(p); return true; } catch { return false; } });
const synth = sf2 ? new FluidSynth(sf2) : null;
if (!sf2) console.warn('[piano] No soundfont found — running silently');

const RELEASE_MS = 500;

// ── Piano geometry ────────────────────────────────────────────────────────────
//
//  2008 px:  6 px margin │ 21 × 95 px = 1995 px │ 7 px margin
//
//  White key:  95 × 58 px  (KEY_Y=1 → 1px top/bottom strip)
//  Black key:  38 × 36 px  (thin — keeps white keys easy to hit)
//
//  Hit test:  y > KEY_Y+BK_H → white keys only
//             y ≤ KEY_Y+BK_H → black keys have priority

const OCT_START = 3;
const OCT_COUNT = 3;     // C3 – B5  (21 white keys)
const KEY_W     = 95;
const KEY_H     = 58;
const KEY_Y     = 1;
const BK_W      = 38;
const BK_H      = 36;
const PIANO_X   = Math.floor((2008 - 21 * KEY_W) / 2); // = 6

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const CHROMA: [number, boolean][] = [
  [0,true],[1,false],[2,true],[3,false],[4,true],
  [5,true],[6,false],[7,true],[8,false],[9,true],[10,false],[11,true],
];

interface PianoKey {
  label: string;
  midi:  number;
  white: boolean;
  x:     number;
  w:     number;
  h:     number;
}

function buildKeys(): PianoKey[] {
  const keys: PianoKey[] = [];
  for (let oct = OCT_START; oct < OCT_START + OCT_COUNT; oct++) {
    const wb = (oct - OCT_START) * 7;
    let wi = 0;
    for (const [semi, white] of CHROMA) {
      const midi  = (oct + 1) * 12 + semi;
      const label = NOTE_NAMES[semi] + oct;
      if (white) {
        keys.push({ label, midi, white: true,
          x: PIANO_X + (wb + wi) * KEY_W, w: KEY_W - 1, h: KEY_H });
        wi++;
      } else {
        const prevX = PIANO_X + (wb + wi - 1) * KEY_W;
        keys.push({ label, midi, white: false,
          x: prevX + KEY_W - Math.floor(BK_W / 2), w: BK_W, h: BK_H });
      }
    }
  }
  return keys;
}

const ALL_KEYS   = buildKeys();
const WHITE_KEYS = ALL_KEYS.filter(k =>  k.white);
const BLACK_KEYS = ALL_KEYS.filter(k => !k.white);

function hitTest(x: number, y: number): PianoKey | null {
  if (y > KEY_Y + BK_H) {
    for (const k of WHITE_KEYS) if (x >= k.x && x < k.x + k.w) return k;
    return null;
  }
  for (const k of BLACK_KEYS) if (x >= k.x && x < k.x + k.w) return k;
  for (const k of WHITE_KEYS) if (x >= k.x && x < k.x + k.w) return k;
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Piano({ width, height }: { width: number; height: number }) {
  const [active, setActive] = useState<ReadonlySet<number>>(new Set());
  const touchMidi  = useRef<number | null>(null);
  const decayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteOn = useCallback((midi: number) => {
    if (decayTimer.current) { clearTimeout(decayTimer.current); decayTimer.current = null; }
    synth?.on(midi);
    setActive(new Set([midi]));
  }, []);

  const noteOff = useCallback((midi: number) => {
    setActive(new Set());
    if (decayTimer.current) clearTimeout(decayTimer.current);
    decayTimer.current = setTimeout(() => {
      synth?.off(midi);
      decayTimer.current = null;
    }, RELEASE_MS);
  }, []);

  const press = useCallback((x: number, y: number) => {
    const key = hitTest(x, y);
    if (!key) return;
    touchMidi.current = key.midi;
    noteOn(key.midi);
  }, [noteOn]);

  const slide = useCallback((x: number, y: number) => {
    const key = hitTest(x, y);
    if (!key || key.midi === touchMidi.current) return;
    if (touchMidi.current !== null) noteOff(touchMidi.current);
    touchMidi.current = key.midi;
    noteOn(key.midi);
  }, [noteOn, noteOff]);

  const release = useCallback(() => {
    if (touchMidi.current !== null) noteOff(touchMidi.current);
    touchMidi.current = null;
  }, [noteOff]);

  useGestureRegion({
    x: 0, y: 0, width, height,
    onTouchStart: press,
    onTouchMove:  slide,
    onTouchEnd:   release,
  });

  useEffect(() => () => {
    if (decayTimer.current) clearTimeout(decayTimer.current);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box x={0} y={0} width={width} height={height} color="#080810">

      {WHITE_KEYS.map(k => {
        const on = active.has(k.midi);
        const lx = (sz: number) => k.x + Math.max(2, Math.floor((k.w - k.label.length * sz) / 2));
        return (
          <Box
            key={k.label}
            x={k.x} y={KEY_Y}
            width={k.w} height={k.h}
            color={on ? '#f59e0b' : '#c8cdd4'}
            borderColor={on ? '#b45309' : '#7a8899'}
            borderWidth={1}
          >
            <Text
              x={lx(on ? 10 : 8)}
              y={on ? KEY_Y + Math.floor(KEY_H / 2) - 9 : KEY_Y + KEY_H - 16}
              color={on ? '#7c2d12' : '#6b7280'}
              fontSize={on ? 16 : 13}
              fontFamily="monospace"
            >
              {k.label}
            </Text>
          </Box>
        );
      })}

      {BLACK_KEYS.map(k => {
        const on = active.has(k.midi);
        const lx = k.x + Math.max(1, Math.floor((k.w - k.label.length * 6.5) / 2));
        return (
          <React.Fragment key={k.label}>
            <Box
              x={k.x} y={KEY_Y}
              width={k.w} height={k.h}
              color={on ? '#7c3aed' : '#0c0c14'}
              borderColor={on ? '#a78bfa' : '#22223a'}
              borderWidth={1}
            />
            <Box
              x={k.x + 1} y={KEY_Y + 1}
              width={k.w - 2} height={2}
              color={on ? '#9d4ff7' : '#1e1e2e'}
            />
            <Text
              x={lx}
              y={KEY_Y + BK_H - 13}
              color={on ? '#e9d5ff' : '#4a4a80'}
              fontSize={11}
              fontFamily="monospace"
            >
              {k.label}
            </Text>
          </React.Fragment>
        );
      })}

    </Box>
  );
}
