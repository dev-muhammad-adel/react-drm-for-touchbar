/**
 * Professional Touch Bar Piano — C3 to B5, full-width
 *
 * Touch: press = note on, slide = glissando, release = note off
 * Keys:  z s x d c v g b h n j m  →  C3…B3  (chromatic)
 *        q 2 w 3 e r 5 t 6 y 7 u  →  C4…B4
 *        i                         →  C5
 *
 * Run: sudo npx tsx examples/piano.tsx [/dev/dri/card1]
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, DrmDisplay } from 'react-drm';
import { TouchReader } from '../src/native/input';
import { spawn } from 'child_process';
import fs from 'fs';

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
        this.write('prog 0 0'); // Grand Piano
        this.queue.forEach(c => this.write(c));
        this.queue = [];
      }, 350);
    } catch { this.proc = null; }
  }

  private write(line: string): void { this.proc?.stdin?.write(line + '\n'); }

  send(line: string): void {
    if (!this.ready) { this.queue.push(line); return; }
    this.write(line);
  }

  on(midi: number, vel = 100): void { this.send(`noteon 0 ${midi} ${vel}`); }
  off(midi: number): void            { this.send(`noteoff 0 ${midi} 0`);    }
  destroy(): void { this.proc?.stdin?.end(); this.proc?.kill(); }
}

const sf2Found = SF2_PATHS.find(p => { try { fs.accessSync(p); return true; } catch { return false; } });
const synth    = sf2Found ? new FluidSynth(sf2Found) : null;
if (!sf2Found) console.warn('[piano] No soundfont found — running silently');

// ── Piano geometry ────────────────────────────────────────────────────────────
//
//  2008 px:  6 px margin │ 21 × 95 px = 1995 px │ 7 px margin
//
//  White key:  95 × 58 px  (KEY_Y=1 → 1px top / 1px bottom strip)
//  Black key:  38 × 36 px  (thin — makes white keys easy to hit)
//
//  Hit test:  touch y > KEY_Y+BK_H (below black key area) → white only
//             touch y ≤ KEY_Y+BK_H → black keys have priority

const OCT_START = 3;
const OCT_COUNT = 3;     // C3 – B5
const KEY_W     = 95;    // white key width
const KEY_H     = 58;    // white key height
const KEY_Y     = 1;     // top offset (leaves 1 px top + 1 px bottom)
const BK_W      = 38;    // black key width  (38/95 ≈ 40%)
const BK_H      = 36;    // black key height (36/58 ≈ 62%)
const PIANO_X   = Math.floor((2008 - 21 * KEY_W) / 2); // = 6

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const CHROMA: [number, boolean][] = [
  [0,true],[1,false],[2,true],[3,false],[4,true],
  [5,true],[6,false],[7,true],[8,false],[9,true],[10,false],[11,true],
];

interface Key {
  label: string;   // "C4", "C#4", …
  midi:  number;
  white: boolean;
  x:     number;
  w:     number;
  h:     number;
}

function buildKeys(): Key[] {
  const keys: Key[] = [];
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
        // Centred on the boundary between the previous and next white key
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
const MIDI_MAP   = new Map(ALL_KEYS.map(k => [k.midi, k]));

// y-aware hit test: below black key area → white keys only (easier to aim)
function hitTest(x: number, y: number): Key | null {
  if (y > KEY_Y + BK_H) {
    for (const k of WHITE_KEYS) if (x >= k.x && x < k.x + k.w) return k;
    return null;
  }
  for (const k of BLACK_KEYS) if (x >= k.x && x < k.x + k.w) return k;
  for (const k of WHITE_KEYS) if (x >= k.x && x < k.x + k.w) return k;
  return null;
}

// ── Keyboard map ──────────────────────────────────────────────────────────────

const KB_MAP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  'zsxdcvgbhnjm'.split('').forEach((ch, i) => { m[ch] = (OCT_START + 1) * 12 + i; });
  'q2w3er5t6y7u'.split('').forEach((ch, i) => { m[ch] = (OCT_START + 2) * 12 + i; });
  m['i'] = (OCT_START + 3) * 12; // C5
  return m;
})();

// ── Component ─────────────────────────────────────────────────────────────────

// How long (ms) the sound lingers after releasing a key — simulates damper decay.
const RELEASE_MS = 500;

function Piano({ width, height }: { width: number; height: number }) {
  const [active, setActive] = useState<ReadonlySet<number>>(new Set());
  // autoRelease timers (keyboard): visual+audio stop together after hold time
  const holdTimers    = useRef(new Map<number, NodeJS.Timeout>());
  // decay timers (touch release): visual stops immediately, audio fades out
  const decayTimers   = useRef(new Map<number, NodeJS.Timeout>());
  const touchMidi = useRef<number | null>(null);

  const noteOn = useCallback((midi: number, autoRelease: boolean) => {
    if (!MIDI_MAP.has(midi)) return;

    // Any note currently in decay (released but still ringing) stops immediately
    // when a new key is pressed — except if it's the same note being re-struck.
    decayTimers.current.forEach((timer, decayingMidi) => {
      if (decayingMidi === midi) return; // same note: handled below
      clearTimeout(timer);
      synth?.off(decayingMidi);
    });
    // Remove all stopped decay timers (keep the same-note entry if present)
    [...decayTimers.current.keys()]
      .filter(m => m !== midi)
      .forEach(m => decayTimers.current.delete(m));

    // If this same key is in decay, cancel the pending noteoff so it keeps playing.
    const decay = decayTimers.current.get(midi);
    if (decay) { clearTimeout(decay); decayTimers.current.delete(midi); }

    synth?.on(midi);
    setActive(prev => new Set([...prev, midi]));

    if (autoRelease) {
      const prev = holdTimers.current.get(midi);
      if (prev) clearTimeout(prev);
      holdTimers.current.set(midi, setTimeout(() => {
        // Start decay: visual off immediately, audio off after RELEASE_MS
        setActive(s => { const n = new Set(s); n.delete(midi); return n; });
        decayTimers.current.set(midi, setTimeout(() => {
          synth?.off(midi);
          decayTimers.current.delete(midi);
        }, RELEASE_MS));
        holdTimers.current.delete(midi);
      }, 900));
    }
  }, []);

  const noteOff = useCallback((midi: number) => {
    // Cancel any pending hold timer (keyboard)
    const h = holdTimers.current.get(midi);
    if (h) { clearTimeout(h); holdTimers.current.delete(midi); }

    // Visual feedback: key goes dark immediately
    setActive(prev => { const s = new Set(prev); s.delete(midi); return s; });

    // Audio: let the note ring for RELEASE_MS before cutting (natural decay)
    const existing = decayTimers.current.get(midi);
    if (existing) clearTimeout(existing);
    decayTimers.current.set(midi, setTimeout(() => {
      synth?.off(midi);
      decayTimers.current.delete(midi);
    }, RELEASE_MS));
  }, []);

  // Touch: on→glissando→off
  useEffect(() => {
    let reader: TouchReader | undefined;
    try {
      reader = new TouchReader();
      reader.startWithGestures({
        onTouchStart: (x, y) => {
          const key = hitTest(x, y);
          if (!key) return;
          touchMidi.current = key.midi;
          noteOn(key.midi, false);
        },
        onTouchMove: (x, y) => {
          const key = hitTest(x, y);
          if (!key || key.midi === touchMidi.current) return;
          if (touchMidi.current !== null) noteOff(touchMidi.current);
          touchMidi.current = key.midi;
          noteOn(key.midi, false);
        },
        onTouchEnd: () => {
          if (touchMidi.current !== null) {
            noteOff(touchMidi.current);
            touchMidi.current = null;
          }
        },
      });
    } catch { /* no touch device — keyboard only */ }
    return () => reader?.stop();
  }, [noteOn, noteOff]);

  // Keyboard: auto-release after 1s
  useEffect(() => {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const handler = (buf: Buffer) => {
      if (buf[0] === 3) process.exit(0); // Ctrl+C
      rendered.wake();
      const midi = KB_MAP[buf.toString('utf8')];
      if (midi !== undefined) noteOn(midi, true);
    };
    process.stdin.on('data', handler);
    return () => { process.stdin.off('data', handler); };
  }, [noteOn]);

  useEffect(() => () => {
    holdTimers.current.forEach(clearTimeout);
    decayTimers.current.forEach(clearTimeout);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box x={0} y={0} width={width} height={height} color="#080810">

      {/* ── White keys ── */}
      {WHITE_KEYS.map(k => {
        const isActive = active.has(k.midi);
        // Center label: monospace ~7px/char inactive, ~8.5px active
        const lx = (sz: number) => k.x + Math.max(2, Math.floor((k.w - k.label.length * sz) / 2));

        return (
          <Box
            key={k.label}
            x={k.x} y={KEY_Y}
            width={k.w} height={k.h}
            color={isActive ? '#f59e0b' : '#c8cdd4'}
            borderColor={isActive ? '#b45309' : '#7a8899'}
            borderWidth={1}
          >
            {/* Note label always visible at bottom of every white key */}
            <Text
              x={lx(isActive ? 10 : 8)}
              y={isActive ? KEY_Y + Math.floor(KEY_H / 2) - 9 : KEY_Y + KEY_H - 16}
              color={isActive ? '#7c2d12' : '#6b7280'}
              fontSize={isActive ? 16 : 13}
              fontFamily="monospace"
            >
              {k.label}
            </Text>
          </Box>
        );
      })}

      {/* ── Black keys ── */}
      {BLACK_KEYS.map(k => {
        const isActive = active.has(k.midi);
        // Center label inside narrow black key
        const lx = k.x + Math.max(1, Math.floor((k.w - k.label.length * 6.5) / 2));
        return (
          <React.Fragment key={k.label}>
            <Box
              x={k.x} y={KEY_Y}
              width={k.w} height={k.h}
              color={isActive ? '#7c3aed' : '#0c0c14'}
              borderColor={isActive ? '#a78bfa' : '#22223a'}
              borderWidth={1}
            />
            {/* Top highlight strip */}
            <Box
              x={k.x + 1} y={KEY_Y + 1}
              width={k.w - 2} height={2}
              color={isActive ? '#9d4ff7' : '#1e1e2e'}
            />
            {/* Note label always visible inside every black key */}
            <Text
              x={lx}
              y={KEY_Y + BK_H - 13}
              color={isActive ? '#e9d5ff' : '#4a4a80'}
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

// ── Entry point ───────────────────────────────────────────────────────────────

const device = process.argv[2] ?? '/dev/dri/card1';

let display: DrmDisplay;
try {
  display = new DrmDisplay(device);
} catch (err) {
  console.error(`[piano] ${(err as Error).message}`);
  process.exit(1);
}

const rendered = render(
  <Piano width={display.width} height={display.height} />,
  display,
  { dimSecs: 30, offSecs: 60 }, // dim at 30s, off at 90s
);

process.on('SIGINT', () => {
  rendered.unmount();
  synth?.destroy();
  display.close();
  process.exit(0);
});

console.log('[piano] Ready — Ctrl+C to exit');
console.log('[piano] Keys: z s x d c v g b h n j m  =  C3..B3 (chromatic)');
console.log('[piano]       q 2 w 3 e r 5 t 6 y 7 u  =  C4..B4   i=C5');
