/**
 * Chrome Dinosaur game — runs directly on the Touch Bar (DRM) display.
 *
 * Run with:
 *   sudo npx tsx examples/dino.tsx
 *
 * Controls:
 *   - Touch anywhere on the Touch Bar to jump / start / restart
 *   - Any keyboard key also works if stdin is a TTY
 *   - Ctrl+C to quit
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, Svg, DrmDisplay } from 'react-drm';
import { TouchReader } from '../src/native/input';

// ── SVG art ─────────────────────────────────────────────────────────────────
// Pixel-art dinosaur — 16×18 viewBox, drawn as rectangles.
function dinoSvg(fill: string, eyeFill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 18">
  <!-- body -->
  <rect x="2" y="4" width="12" height="10" rx="1" fill="${fill}"/>
  <!-- head -->
  <rect x="6" y="0" width="8" height="7" rx="1" fill="${fill}"/>
  <!-- tail -->
  <rect x="0" y="8" width="4" height="3" rx="1" fill="${fill}"/>
  <!-- legs -->
  <rect x="4" y="13" width="3" height="5" rx="1" fill="${fill}"/>
  <rect x="9" y="13" width="3" height="5" rx="1" fill="${fill}"/>
  <!-- eye -->
  <rect x="11" y="1" width="2" height="2" rx="0.5" fill="${eyeFill}"/>
  <!-- mouth -->
  <rect x="13" y="5" width="2" height="1" fill="${fill}"/>
</svg>`;
}

// Cactus — 22×30 viewBox with layered branches.
const CACTUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 30">
  <rect x="8" y="4" width="6" height="26" rx="2" fill="#16a34a"/>
  <rect x="2" y="10" width="5" height="10" rx="2" fill="#16a34a"/>
  <rect x="15" y="8" width="5" height="12" rx="2" fill="#16a34a"/>
  <rect x="3" y="10" width="3" height="7" rx="1" fill="#22c55e"/>
  <rect x="16" y="8" width="3" height="8" rx="1" fill="#22c55e"/>
  <rect x="10" y="5" width="2" height="24" rx="1" fill="#22c55e"/>
</svg>`;

const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26">
  <circle cx="13" cy="13" r="8" fill="#fbbf24"/>
  <circle cx="13" cy="13" r="4.5" fill="#fde68a"/>
</svg>`;

const CLOUD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 16">
  <ellipse cx="12" cy="9" rx="10" ry="6" fill="#cbd5e1"/>
  <ellipse cx="24" cy="7" rx="12" ry="7" fill="#e2e8f0"/>
  <ellipse cx="35" cy="9" rx="9" ry="6" fill="#cbd5e1"/>
</svg>`;

const HILL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 24">
  <path d="M0 24 L20 17 L38 19 L55 10 L72 13 L90 8 L112 12 L132 9 L140 24 Z" fill="#334155"/>
  <path d="M0 24 L24 20 L44 21 L63 15 L84 17 L106 13 L126 15 L140 24 Z" fill="#475569"/>
</svg>`;

// ── Layout constants (px) ────────────────────────────────────────────────────

const FPS          = 30;
const TICK_MS      = 1000 / FPS;

// Vertical layout (total height = 60)
const GROUND_Y     = 54;   // top edge of ground strip
const GROUND_H     = 6;    // thickness of ground

// Dinosaur (larger SVG)
const DINO_X       = 88;
const DINO_W       = 24;
const DINO_H       = 26;
const DINO_FLOOR   = GROUND_Y - DINO_H;

// Obstacle / cactus (larger)
const CACTUS_W      = 22;
const CACTUS_H      = 30;
const CACTUS_FLOOR  = GROUND_Y - CACTUS_H;

// Physics
const JUMP_VEL     = -21;
const GRAVITY      =   2.5;

// Obstacle spawning
const SPAWN_MIN    = 38;     // hard mode: shorter minimum gap
const SPAWN_RANGE  = 42;     // hard mode: tighter random spread

// Speed
const SPEED_INIT   = 7.2;    // hard mode: faster start
const SPEED_ACCEL  = 0.005;  // hard mode: faster ramp

// ── Types ────────────────────────────────────────────────────────────────────

interface Cactus {
  id: number;
  x: number;
}

interface State {
  running:     boolean;
  dead:        boolean;
  score:       number;
  dinoY:       number;
  velY:        number;
  speed:       number;
  tick:        number;
  nextSpawnAt: number;
  cacti:       Cactus[];
}

function initialState(): State {
  return {
    running:     false,
    dead:        false,
    score:       0,
    dinoY:       DINO_FLOOR,
    velY:        0,
    speed:       SPEED_INIT,
    tick:        0,
    nextSpawnAt: SPAWN_MIN + Math.floor(Math.random() * SPAWN_RANGE),
    cacti:       [],
  };
}

// ── Game component ───────────────────────────────────────────────────────────

function DinoGame({ width, height }: { width: number; height: number }) {
  const [state, setState] = useState<State>(initialState);

  // Keep a ref so event handlers always see the latest state
  const stateRef = useRef(state);
  stateRef.current = state;

  // Monotonically increasing cactus ID
  const nextIdRef = useRef(1);

  // ── jump / start / restart ────────────────────────────────────────────────
  const handleInput = useCallback(() => {
    const s = stateRef.current;

    if (s.dead) {
      // Restart
      nextIdRef.current = 1;
      setState(initialState());
      return;
    }

    if (!s.running) {
      // Start
      setState(prev => ({ ...prev, running: true }));
      return;
    }

    // Jump — only when the dino is on the ground
    if (s.dinoY >= DINO_FLOOR) {
      setState(prev => ({ ...prev, velY: JUMP_VEL }));
    }
  }, []);

  // ── Game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.running) return;

    const id = setInterval(() => {
      setState(prev => {
        if (!prev.running || prev.dead) return prev;

        const tick  = prev.tick + 1;
        const speed = prev.speed + SPEED_ACCEL;

        // Physics
        let velY  = prev.velY + GRAVITY;
        let dinoY = prev.dinoY + velY;
        if (dinoY >= DINO_FLOOR) {
          dinoY = DINO_FLOOR;
          velY  = 0;
        }

        // Move cacti
        let cacti = prev.cacti.map(c => ({ ...c, x: c.x - speed }));
        cacti = cacti.filter(c => c.x + CACTUS_W > 0);

        // Spawn
        let nextSpawnAt = prev.nextSpawnAt;
        if (tick >= prev.nextSpawnAt) {
          cacti = [...cacti, { id: nextIdRef.current++, x: width }];
          nextSpawnAt = tick + SPAWN_MIN + Math.floor(Math.random() * SPAWN_RANGE);
        }

        // Collision
        const dL = DINO_X + 3,      dR = DINO_X + DINO_W - 3;
        const dT = dinoY + 3,       dB = dinoY + DINO_H;
        const hit = cacti.some(c => {
          const cL = c.x + 2,       cR = c.x + CACTUS_W - 2;
          const cT = CACTUS_FLOOR,  cB = CACTUS_FLOOR + CACTUS_H;
          return dR > cL && dL < cR && dB > cT && dT < cB;
        });

        if (hit) {
          return { ...prev, dead: true, running: false, dinoY, velY: 0, cacti };
        }

        const score = Math.floor(tick / 6);
        return { ...prev, tick, speed, velY, dinoY, cacti, nextSpawnAt, score };
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [state.running, width]);

  // ── Touch input ───────────────────────────────────────────────────────────
  useEffect(() => {
    let reader: TouchReader | undefined;
    try {
      reader = new TouchReader();
      reader.start(() => handleInput());
    } catch (_) {
      // Touch device unavailable — keyboard only
    }
    return () => reader?.stop();
  }, [handleInput]);

  // ── Keyboard input (when stdin is a TTY) ──────────────────────────────────
  useEffect(() => {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const handler = (chunk: Buffer) => {
      if (chunk[0] === 3) process.exit(0); // Ctrl+C
      handleInput();
    };
    process.stdin.on('data', handler);
    return () => { process.stdin.off('data', handler); };
  }, [handleInput]);

  // ── Render ────────────────────────────────────────────────────────────────
  const { dinoY, cacti, score, dead, running, tick } = state;

  // Dino flashes red on death
  const dinoColor = dead ? '#ef4444' : '#4ade80';

  // Scrolling ground dots and parallax offsets
  const groundDots: number[] = [];
  for (let x = 20; x < width; x += 60) groundDots.push(x);
  const hillShift = Math.round((tick * 0.8) % 140);
  const cloudShift = Math.round((tick * 0.35) % (width + 90));

  return (
    <Box x={0} y={0} width={width} height={height} color="#0f172a">

      {/* Sky layers */}
      <Box x={0} y={0} width={width} height={18} color="#1e293b" />
      <Box x={0} y={18} width={width} height={16} color="#1f314b" />
      <Box x={0} y={34} width={width} height={20} color="#213752" />

      {/* Sun + clouds */}
      <Svg x={width - 58} y={2} width={26} height={26} src={SUN_SVG} />
      <Svg x={width - cloudShift} y={6} width={46} height={16} src={CLOUD_SVG} />
      <Svg x={width - cloudShift - 420} y={11} width={40} height={14} src={CLOUD_SVG} />

      {/* Distant hills */}
      <Svg x={-hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={140 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={280 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={420 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={560 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={700 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={840 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={980 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={1120 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={1260 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={1400 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={1540 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={1680 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={1820 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />
      <Svg x={1960 - hillShift} y={30} width={140} height={24} src={HILL_SVG} />

      {/* ── Ground ── */}
      <Box x={0} y={GROUND_Y} width={width} height={GROUND_H} color="#374151" />
      <Box x={0} y={GROUND_Y - 2} width={width} height={2} color="#94a3b8" />

      {/* Ground tick marks */}
      {groundDots.map(x => (
        <Box key={x} x={x} y={GROUND_Y} width={4} height={3} color="#4b5563" />
      ))}

      {/* ── Dinosaur ── */}
      <Svg
        x={DINO_X}
        y={Math.round(dinoY)}
        width={DINO_W}
        height={DINO_H}
        src={dinoSvg(dinoColor, '#111827')}
      />

      {/* ── Cacti ── */}
      {cacti.map(c => {
        const cx = Math.round(c.x);
        return (
          <Svg
            key={c.id}
            x={cx}
            y={CACTUS_FLOOR}
            width={CACTUS_W}
            height={CACTUS_H}
            src={CACTUS_SVG}
          />
        );
      })}

      {/* ── Score ── */}
      <Text
        x={width - 236}
        y={8}
        color="#e2e8f0"
        fontSize={26}
        fontFamily="monospace"
      >
        {`SCORE ${String(score).padStart(5, '0')}`}
      </Text>

      {/* ── Overlay messages ── */}
      {!running && !dead && (
        <Text
          x={Math.floor(width / 2) - 260}
          y={7}
          color="#facc15"
          fontSize={28}
          fontFamily="monospace"
        >
          {'TOUCH / PRESS ANY KEY TO START'}
        </Text>
      )}

      {dead && (
        <>
          <Text
            x={Math.floor(width / 2) - 110}
            y={7}
            color="#ef4444"
            fontSize={28}
            fontFamily="monospace"
          >
            {'GAME OVER'}
          </Text>
          <Text
            x={Math.floor(width / 2) + 20}
            y={7}
            color="#9ca3af"
            fontSize={24}
            fontFamily="monospace"
          >
            {'— TAP TO RESTART'}
          </Text>
        </>
      )}

    </Box>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

const device = process.argv[2] ?? '/dev/dri/card1';

let display: DrmDisplay;
try {
  display = new DrmDisplay(device);
} catch (err) {
  console.error(`[dino] Failed to open display: ${(err as Error).message}`);
  process.exit(1);
}

const rendered = render(
  <DinoGame width={display.width} height={display.height} />,
  display,
);

process.on('SIGINT', () => {
  rendered.unmount();
  display.close();
  process.exit(0);
});
