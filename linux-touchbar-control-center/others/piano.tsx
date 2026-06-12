import React, { useState, useCallback, useEffect, useMemo, useRef, useContext } from 'react';
import { spawn } from 'child_process';
import fs from 'fs';
import { Box, Button, Text, LayoutContext } from 'react-drm';
import type { BoxNode } from 'react-drm';
import { registerSuspendHooks } from '../services/suspend';

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
if (!sf2) console.warn('[piano] No soundfont found — running silently');

// fluidsynth holds a running PipeWire stream to the T2 speakers (apple_bce) for
// its whole life, and any open stream during suspend-fix-t2's `rmmod -f apple-bce`
// oopses the kernel (pipewire in iowrite32, observed 2026-06-12). Spawn it only
// while a Piano is mounted — never at import time. Refcounted because layer
// transitions keep the outgoing panel instance alive while the next one mounts.
let synth: FluidSynth | null = null;
let synthUsers = 0;

function acquireSynth(): void {
  synthUsers++;
  if (!synth && sf2) synth = new FluidSynth(sf2);
}

function releaseSynth(): void {
  synthUsers--;
  if (synthUsers > 0) return;
  synthUsers = 0;
  synth?.destroy();
  synth = null;
}

// A piano open across a system suspend would keep its PipeWire stream alive
// into the apple-bce teardown (kernel Oops) — kill the synth before sleep and
// bring it back for the still-mounted piano on resume.
registerSuspendHooks('piano-audio', {
  onSleep: () => { synth?.destroy(); synth = null; },
  onResume: () => { if (synthUsers > 0 && !synth && sf2) synth = new FluidSynth(sf2); },
});

const RELEASE_MS = 500;

// ── Piano geometry ────────────────────────────────────────────────────────────
//
//  Key dimensions scale to fill `width` across 21 white keys (local coordinates).
//  White key:  keyW × 58 px  (KEY_Y=1 → 1px top/bottom strip)
//  Black key:  bkW  × 36 px  (~40% of white key width)
//
//  Hit test uses local coordinates (0-based from Piano's left edge).

const OCT_START = 3;
const OCT_COUNT = 3;  // C3 – B5  (21 white keys)
const KEY_H     = 58;
const KEY_Y     = 1;
const BK_H      = 36;

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

function buildKeys(pianoX: number, keyW: number, bkW: number): PianoKey[] {
  const keys: PianoKey[] = [];
  for (let oct = OCT_START; oct < OCT_START + OCT_COUNT; oct++) {
    const wb = (oct - OCT_START) * 7;
    let wi = 0;
    for (const [semi, white] of CHROMA) {
      const midi  = (oct + 1) * 12 + semi;
      const label = NOTE_NAMES[semi] + oct;
      if (white) {
        keys.push({ label, midi, white: true,
          x: pianoX + (wb + wi) * keyW, w: keyW - 1, h: KEY_H });
        wi++;
      } else {
        const prevX = pianoX + (wb + wi - 1) * keyW;
        keys.push({ label, midi, white: false,
          x: prevX + keyW - Math.floor(bkW / 2), w: bkW, h: BK_H });
      }
    }
  }
  return keys;
}

function hitTest(whiteKeys: PianoKey[], blackKeys: PianoKey[], x: number, y: number): PianoKey | null {
  if (y > KEY_Y + BK_H) {
    for (const k of whiteKeys) if (x >= k.x && x < k.x + k.w) return k;
    return null;
  }
  for (const k of blackKeys) if (x >= k.x && x < k.x + k.w) return k;
  for (const k of whiteKeys) if (x >= k.x && x < k.x + k.w) return k;
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Piano({ width, height }: { width: number; height: number }) {
  const keyW    = Math.floor(width / 21);
  const bkW     = Math.round(keyW * 0.4);
  const pianoX  = Math.floor((width - 21 * keyW) / 2);

  const allKeys   = useMemo(() => buildKeys(pianoX, keyW, bkW), [pianoX, keyW, bkW]);
  const whiteKeys = useMemo(() => allKeys.filter(k =>  k.white), [allKeys]);
  const blackKeys = useMemo(() => allKeys.filter(k => !k.white), [allKeys]);

  // Used to convert screen touch coordinates → local (Piano-relative) coordinates.
  const rootRef   = useRef<BoxNode | null>(null);
  const layoutCtx = useContext(LayoutContext);

  const [active, setActive] = useState<ReadonlySet<number>>(new Set());
  const touchMidi  = useRef<number | null>(null);
  const decayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    acquireSynth();
    return releaseSynth;
  }, []);

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

  const toLocal = useCallback((screenX: number) => {
    const lb = rootRef.current ? layoutCtx.current.get(rootRef.current) : null;
    return screenX - (lb?.x ?? 0);
  }, [layoutCtx]);

  const press = useCallback((sx: number, y: number) => {
    const key = hitTest(whiteKeys, blackKeys, toLocal(sx), y);
    if (!key) return;
    touchMidi.current = key.midi;
    noteOn(key.midi);
  }, [whiteKeys, blackKeys, toLocal, noteOn]);

  const slide = useCallback((sx: number, y: number) => {
    const key = hitTest(whiteKeys, blackKeys, toLocal(sx), y);
    if (!key || key.midi === touchMidi.current) return;
    if (touchMidi.current !== null) noteOff(touchMidi.current);
    touchMidi.current = key.midi;
    noteOn(key.midi);
  }, [whiteKeys, blackKeys, toLocal, noteOn, noteOff]);

  const release = useCallback(() => {
    if (touchMidi.current !== null) noteOff(touchMidi.current);
    touchMidi.current = null;
  }, [noteOff]);

  useEffect(() => () => {
    if (decayTimer.current) clearTimeout(decayTimer.current);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box ref={rootRef} style={{ flex: 1 }} color="#080810">

      {whiteKeys.map(k => {
        const on = active.has(k.midi);
        const lx = (sz: number) => Math.max(2, Math.floor((k.w - k.label.length * sz) / 2));
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
              y={on ? Math.floor(KEY_H / 2) - 9 : KEY_H - 16}
              color={on ? '#7c2d12' : '#6b7280'}
              fontSize={on ? 16 : 13}
              fontFamily="monospace"
            >
              {k.label}
            </Text>
          </Box>
        );
      })}

      {blackKeys.map(k => {
        const on = active.has(k.midi);
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
              x={k.x + Math.max(1, Math.floor((k.w - k.label.length * 6.5) / 2))}
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

      {/* Transparent touch overlay — uses getBounds() for flex-aware hit-test */}
      <Button
        style={{ position: 'absolute', left: 0, top: 0 }}
        width={width} height={height}
        color="transparent" activeColor="transparent"
        onTouchStart={press}
        onTouchMove={slide}
        onTouchEnd={release}
      />

    </Box>
  );
}
