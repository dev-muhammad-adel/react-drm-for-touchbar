import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, Svg, TouchReader, useKeyPressed } from 'react-drm';
import { FaTruckMonster } from 'react-icons/fa6';

// ── SVG assets ───────────────────────────────────────────────────────────────

const BOULDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 22">
  <ellipse cx="13" cy="16" rx="11" ry="5.5" fill="#1e293b"/>
  <ellipse cx="8"  cy="12" rx="7"  ry="5.5" fill="#334155"/>
  <ellipse cx="17" cy="13" rx="6"  ry="4.5" fill="#2d3f52"/>
  <ellipse cx="13" cy="11" rx="5"  ry="4"   fill="#475569"/>
  <ellipse cx="9"  cy="10" rx="3"  ry="2.5" fill="#64748b"/>
  <ellipse cx="16" cy="11" rx="2.5" ry="2"  fill="#64748b"/>
  <ellipse cx="13" cy="8.5" rx="2" ry="1.5" fill="#94a3b8"/>
</svg>`;

// ── Layout constants ──────────────────────────────────────────────────────────

const FPS         = 30;
const TICK_MS     = 1000 / FPS;

const GROUND_Y    = 50;
const GROUND_H    = 10;

const TRUCK_X     = 85;
const TRUCK_W     = 38;
const TRUCK_H     = 22;
const TRUCK_FLOOR = GROUND_Y - TRUCK_H;   // 28

const OBS_W       = 26;
const OBS_H       = 20;
const OBS_FLOOR   = GROUND_Y - OBS_H;    // 30

const JUMP_VEL    = -21;
const GRAVITY     = 2.5;
const SPAWN_MIN   = 38;
const SPAWN_RANGE = 42;
const SPEED_INIT  = 7.2;
const SPEED_ACCEL = 0.005;

// ── Starfield (deterministic pattern) ────────────────────────────────────────

const STARS = Array.from({ length: 52 }, (_, i) => ({
  x: (i * 47 + i * i * 3) % 1900 + 20,
  y: 1 + (i * 23 + i * 7) % 22,
  w: i % 6 === 0 ? 2 : 1,
}));

// ── Types ─────────────────────────────────────────────────────────────────────

interface Obstacle { id: number; x: number; }

interface State {
  running:     boolean;
  dead:        boolean;
  score:       number;
  truckY:      number;
  velY:        number;
  speed:       number;
  tick:        number;
  nextSpawnAt: number;
  obstacles:   Obstacle[];
}

function initialState(): State {
  return {
    running: false, dead: false, score: 0,
    truckY: TRUCK_FLOOR, velY: 0, speed: SPEED_INIT, tick: 0,
    nextSpawnAt: SPAWN_MIN + Math.floor(Math.random() * SPAWN_RANGE),
    obstacles: [],
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DinoGame({ width, height }: { width: number; height: number }) {
  const [state, setState] = useState<State>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const nextId = useRef(1);

  const handleInput = useCallback(() => {
    const s = stateRef.current;
    if (s.dead)     { nextId.current = 1; setState(initialState()); return; }
    if (!s.running) { setState(prev => ({ ...prev, running: true })); return; }
    if (s.truckY >= TRUCK_FLOOR) setState(prev => ({ ...prev, velY: JUMP_VEL }));
  }, []);

  // ── Game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => {
      setState(prev => {
        if (!prev.running || prev.dead) return prev;

        const tick  = prev.tick + 1;
        const speed = prev.speed + SPEED_ACCEL;

        let velY   = prev.velY + GRAVITY;
        let truckY = prev.truckY + velY;
        if (truckY >= TRUCK_FLOOR) { truckY = TRUCK_FLOOR; velY = 0; }

        let obstacles = prev.obstacles.map(o => ({ ...o, x: o.x - speed }));
        obstacles = obstacles.filter(o => o.x + OBS_W > 0);

        let nextSpawnAt = prev.nextSpawnAt;
        if (tick >= prev.nextSpawnAt) {
          obstacles = [...obstacles, { id: nextId.current++, x: width }];
          nextSpawnAt = tick + SPAWN_MIN + Math.floor(Math.random() * SPAWN_RANGE);
        }

        // Collision (shrunk hit-boxes)
        const tL = TRUCK_X + 5,  tR = TRUCK_X + TRUCK_W - 5;
        const tT = truckY + 4,   tB = truckY + TRUCK_H - 2;
        const hit = obstacles.some(o => {
          const oL = o.x + 3,   oR = o.x + OBS_W - 3;
          const oT = OBS_FLOOR, oB = OBS_FLOOR + OBS_H;
          return tR > oL && tL < oR && tB > oT && tT < oB;
        });

        if (hit) return { ...prev, dead: true, running: false, truckY, velY: 0, obstacles };

        return { ...prev, tick, speed, velY, truckY, obstacles, nextSpawnAt, score: Math.floor(tick / 6) };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.running, width]);

  // ── Touch input ───────────────────────────────────────────────────────────
  useEffect(() => {
    let reader: TouchReader | undefined;
    try { reader = new TouchReader(); reader.start(() => handleInput()); }
    catch (_) {}
    return () => reader?.stop();
  }, [handleInput]);

  // ── Keyboard input (evdev — works regardless of terminal focus) ───────────
  const spaceHeld = useKeyPressed('space');
  const prevSpace = useRef(false);
  useEffect(() => {
    if (spaceHeld && !prevSpace.current) handleInput();
    prevSpace.current = spaceHeld;
  }, [spaceHeld, handleInput]);

  // ── Render ────────────────────────────────────────────────────────────────
  const { truckY, obstacles, score, dead, running, tick } = state;

  const truckColor = dead ? '#ef4444' : '#f59e0b';
  const dashScroll = Math.round(tick * 6) % 120;

  const roadDashes: number[] = [];
  for (let x = -dashScroll; x < width + 120; x += 120) {
    if (x + 50 > 0 && x < width) roadDashes.push(x);
  }

  const mid = Math.floor(width / 2);

  return (
    <Box x={0} y={0} width={width} height={height} color="#05050c">

      {/* Night sky */}
      <Box x={0} y={0} width={width} height={30} color="#080815" />

      {/* Stars */}
      {STARS.filter(s => s.x < width).map((s, i) => (
        <Box key={i} x={s.x} y={s.y} width={s.w} height={s.w} color="#cbd5e1" />
      ))}

      {/* Horizon glow */}
      <Box x={0} y={27} width={width} height={5}  color="#130920" />
      <Box x={0} y={32} width={width} height={4}  color="#1a0c2e" />
      <Box x={0} y={36} width={width} height={4}  color="#120820" />

      {/* Road surface */}
      <Box x={0} y={GROUND_Y}     width={width} height={GROUND_H} color="#0e0e16" />

      {/* Amber road edge */}
      <Box x={0} y={GROUND_Y - 2} width={width} height={2}        color="#92400e" />

      {/* Scrolling center dashes */}
      {roadDashes.map(x => (
        <Box key={x} x={x} y={GROUND_Y + 4} width={50} height={2} color="#1e1e30" />
      ))}

      {/* Monster Truck */}
      <Box x={TRUCK_X} y={Math.round(truckY)} width={TRUCK_W} height={TRUCK_H}>
        <FaTruckMonster style={{ width: TRUCK_W, height: TRUCK_H }} fill={truckColor} stroke="none" />
      </Box>

      {/* Obstacles (boulders) */}
      {obstacles.map(o => (
        <Svg key={o.id} x={Math.round(o.x)} y={OBS_FLOOR} width={OBS_W} height={OBS_H} src={BOULDER_SVG} />
      ))}

      {/* Score */}
      <Text x={width - 190} y={9} color="#f59e0b" fontSize={22} fontFamily="monospace">
        {`${String(score).padStart(5, '0')} m`}
      </Text>

      {/* Start message */}
      {!running && !dead && (
        <Text x={mid - 230} y={9} color="#a78bfa" fontSize={26} fontFamily="monospace">
          {'TAP OR PRESS ANY KEY TO START'}
        </Text>
      )}

      {/* Crash screen */}
      {dead && (
        <>
          <Text x={mid - 95} y={9} color="#ef4444" fontSize={26} fontFamily="monospace">CRASHED!</Text>
          <Text x={mid + 35} y={9} color="#64748b" fontSize={22} fontFamily="monospace">— TAP TO RETRY</Text>
        </>
      )}

    </Box>
  );
}
