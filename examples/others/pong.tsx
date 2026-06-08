import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, TouchReader, useKeyPressed } from 'react-drm';

const FPS        = 60;
const TICK_MS    = 1000 / FPS;

const PADDLE_W   = 6;
const PADDLE_H   = 18;
const BALL_S     = 5;
const P_MARGIN   = 12;

const SPEED_INIT = 4.2;
const SPEED_MAX  = 9.5;
const SPEED_STEP = 0.28;
const AI_SPEED   = 2.0;
const WIN_SCORE  = 5;
const PAUSE_TICK = 55;

type Phase = 'idle' | 'playing' | 'pause' | 'won';

interface State {
  phase:     Phase;
  ballX:     number;
  ballY:     number;
  ballVX:    number;
  ballVY:    number;
  leftY:     number;
  rightY:    number;
  scoreL:    number;
  scoreR:    number;
  speed:     number;
  pauseTick: number;
  serveLeft: boolean;
  winner:    'YOU' | 'AI' | null;
}

function serve(w: number, h: number, left: boolean): Pick<State, 'ballX'|'ballY'|'ballVX'|'ballVY'|'speed'> {
  const vy = (Math.random() * 1.4 + 0.4) * (Math.random() > 0.5 ? 1 : -1);
  return {
    ballX: w / 2 - BALL_S / 2,
    ballY: h / 2 - BALL_S / 2,
    ballVX: SPEED_INIT * (left ? -1 : 1),
    ballVY: vy,
    speed: SPEED_INIT,
  };
}

function init(w: number, h: number): State {
  const sl = Math.random() > 0.5;
  return {
    phase: 'idle',
    ...serve(w, h, sl),
    leftY: h / 2, rightY: h / 2,
    scoreL: 0, scoreR: 0, speed: SPEED_INIT,
    pauseTick: 0, serveLeft: sl, winner: null,
  };
}

export function PongGame({ width, height }: { width: number; height: number }) {
  const [state, setState] = useState(() => init(width, height));
  const stateRef = useRef(state);
  stateRef.current = state;

  const touchY = useRef<number | null>(null);

  // Evdev keyboard — works regardless of terminal focus
  const upHeld    = useKeyPressed('up');
  const downHeld  = useKeyPressed('down');
  const spaceHeld = useKeyPressed('space');
  const upRef     = useRef(false);
  const downRef   = useRef(false);
  upRef.current   = upHeld;
  downRef.current = downHeld;

  const prevSpace = useRef(false);

  const startOrReset = useCallback(() => {
    const s = stateRef.current;
    if (s.winner) { setState(init(width, height)); return; }
    if (s.phase === 'idle') setState(prev => ({ ...prev, phase: 'playing' }));
  }, [width, height]);

  // Touch — track Y for left paddle
  useEffect(() => {
    let reader: TouchReader | undefined;
    try {
      reader = new TouchReader();
      reader.startWithGestures({
        onTouchStart: (_x, y) => { touchY.current = y; startOrReset(); },
        onTouchMove:  (_x, y) => { touchY.current = y; },
        onTouchEnd:   ()      => { touchY.current = null; },
      });
    } catch (_) {}
    return () => reader?.stop();
  }, [startOrReset]);

  // Space = start / reset (edge-triggered)
  useEffect(() => {
    if (spaceHeld && !prevSpace.current) startOrReset();
    prevSpace.current = spaceHeld;
  }, [spaceHeld, startOrReset]);

  // Up/down also start the game on first press
  const prevUp   = useRef(false);
  const prevDown = useRef(false);
  useEffect(() => {
    if (upHeld   && !prevUp.current)   startOrReset();
    if (downHeld && !prevDown.current) startOrReset();
    prevUp.current   = upHeld;
    prevDown.current = downHeld;
  }, [upHeld, downHeld, startOrReset]);

  // Game loop
  useEffect(() => {
    if (state.phase !== 'playing' && state.phase !== 'pause') return;

    const id = setInterval(() => {
      setState(prev => {
        if (prev.phase === 'won') return prev;

        if (prev.phase === 'pause') {
          if (prev.pauseTick <= 0) {
            const sl = !prev.serveLeft;
            return { ...prev, ...serve(width, height, sl), phase: 'playing', serveLeft: sl };
          }
          return { ...prev, pauseTick: prev.pauseTick - 1 };
        }

        let { ballX, ballY, ballVX, ballVY, leftY, rightY, speed } = prev;

        ballX += ballVX;
        ballY += ballVY;

        // Wall bounces
        if (ballY <= 0)               { ballY = 0;               ballVY =  Math.abs(ballVY); }
        if (ballY + BALL_S >= height) { ballY = height - BALL_S; ballVY = -Math.abs(ballVY); }

        // Left paddle
        const lR = P_MARGIN + PADDLE_W;
        if (ballVX < 0 && ballX <= lR && ballX + BALL_S >= P_MARGIN) {
          const top = leftY - PADDLE_H / 2;
          const bot = leftY + PADDLE_H / 2;
          if (ballY + BALL_S > top && ballY < bot) {
            const rel = (ballY + BALL_S / 2 - leftY) / (PADDLE_H / 2);
            speed  = Math.min(SPEED_MAX, speed + SPEED_STEP);
            ballVX =  speed;
            ballVY =  rel * speed * 0.75;
            ballX  =  lR;
          }
        }

        // Right paddle
        const rL = width - P_MARGIN - PADDLE_W;
        if (ballVX > 0 && ballX + BALL_S >= rL && ballX <= width - P_MARGIN) {
          const top = rightY - PADDLE_H / 2;
          const bot = rightY + PADDLE_H / 2;
          if (ballY + BALL_S > top && ballY < bot) {
            const rel = (ballY + BALL_S / 2 - rightY) / (PADDLE_H / 2);
            speed  = Math.min(SPEED_MAX, speed + SPEED_STEP);
            ballVX = -speed;
            ballVY =  rel * speed * 0.75;
            ballX  =  rL - BALL_S;
          }
        }

        // Left paddle: touch = absolute, keyboard = velocity
        if (touchY.current !== null) {
          leftY = touchY.current;
        } else {
          const dir = (upRef.current ? -1 : 0) + (downRef.current ? 1 : 0);
          leftY = leftY + dir * AI_SPEED;
        }
        leftY = Math.max(PADDLE_H / 2, Math.min(height - PADDLE_H / 2, leftY));

        // AI tracks ball
        const aiTarget = ballY + BALL_S / 2;
        const dR = aiTarget - rightY;
        rightY += Math.sign(dR) * Math.min(Math.abs(dR), AI_SPEED);
        rightY = Math.max(PADDLE_H / 2, Math.min(height - PADDLE_H / 2, rightY));

        // Scoring
        if (ballX + BALL_S < 0) {
          const scoreR = prev.scoreR + 1;
          const won = scoreR >= WIN_SCORE;
          return { ...prev, leftY, rightY, scoreR, speed,
            ballX: width / 2 - BALL_S / 2, ballY: height / 2 - BALL_S / 2, ballVX: 0, ballVY: 0,
            phase: won ? 'won' : 'pause', pauseTick: PAUSE_TICK, winner: won ? 'AI' : null };
        }
        if (ballX > width) {
          const scoreL = prev.scoreL + 1;
          const won = scoreL >= WIN_SCORE;
          return { ...prev, leftY, rightY, scoreL, speed,
            ballX: width / 2 - BALL_S / 2, ballY: height / 2 - BALL_S / 2, ballVX: 0, ballVY: 0,
            phase: won ? 'won' : 'pause', pauseTick: PAUSE_TICK, winner: won ? 'YOU' : null };
        }

        return { ...prev, ballX, ballY, ballVX, ballVY, leftY, rightY, speed };
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [state.phase, width, height]);

  // ── Render ──────────────────────────────────────────────────────────────────────
  const { ballX, ballY, leftY, rightY, scoreL, scoreR, phase, winner, pauseTick } = state;

  const mid     = Math.floor(width / 2);
  const ballVis = phase !== 'idle' && (phase !== 'pause' || pauseTick % 8 < 5);

  return (
    <Box x={0} y={0} width={width} height={height} color="#030309">

      {/* Center dashes */}
      {[5, 22, 39].map(y => (
        <Box key={y} x={mid} y={y} width={2} height={12} color="#161628" />
      ))}

      {/* Score */}
      <Text x={mid - 22} y={2} color="#334155" fontSize={14} fontFamily="monospace">
        {`${scoreL}  ${scoreR}`}
      </Text>

      {/* Left paddle (player) */}
      <Box
        x={P_MARGIN}
        y={Math.round(leftY - PADDLE_H / 2)}
        width={PADDLE_W}
        height={PADDLE_H}
        color="#4ade80"
      />

      {/* Right paddle (AI) */}
      <Box
        x={width - P_MARGIN - PADDLE_W}
        y={Math.round(rightY - PADDLE_H / 2)}
        width={PADDLE_W}
        height={PADDLE_H}
        color="#f87171"
      />

      {/* Ball */}
      {ballVis && (
        <Box
          x={Math.round(ballX)}
          y={Math.round(ballY)}
          width={BALL_S}
          height={BALL_S}
          color="#facc15"
        />
      )}

      {/* Idle prompt */}
      {phase === 'idle' && (
        <Text x={mid - 250} y={9} color="#a78bfa" fontSize={26} fontFamily="monospace">
          TAP OR ↑↓ ARROWS TO START
        </Text>
      )}

      {/* Win screen */}
      {phase === 'won' && (
        <Text
          x={mid - 165}
          y={9}
          color={winner === 'YOU' ? '#4ade80' : '#f87171'}
          fontSize={26}
          fontFamily="monospace"
        >
          {winner === 'YOU' ? 'YOU WIN!  TAP TO REPLAY' : 'AI WINS!  TAP TO REPLAY'}
        </Text>
      )}

    </Box>
  );
}
