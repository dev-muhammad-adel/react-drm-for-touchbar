import React from 'react';
import { execFile } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { useActiveWindow } from './useActiveWindow';

// ── Media control ─────────────────────────────────────────────────────────────

type MediaCmd = 'previous' | 'play-pause' | 'next';

function playerctl(cmd: MediaCmd): void {
  execFile('playerctl', [cmd], () => {});
}

const BTN_Y = 8;   // visual offset only
const BTN_H = 44;

const MEDIA_BTNS: { label: string; cmd: MediaCmd; x: number; w: number }[] = [
  { label: '<<', cmd: 'previous',   x: 1724, w: 86 },
  { label: '||', cmd: 'play-pause', x: 1818, w: 86 },
  { label: '>>', cmd: 'next',       x: 1912, w: 86 },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function SplittedLayer({ width, height }: { width: number; height: number }) {
  const { title, class: cls } = useActiveWindow();

  return (
    <Box x={0} y={0} width={width} height={height} color="#0d0d1a">

      {/* ── Left: active window ── */}
      <Box x={0} y={0} width={580} height={height} color="#111827" />
      <Text x={16} y={8}  color="#94a3b8" fontSize={16} fontFamily="monospace">{cls   || '—'}</Text>
      <Text x={16} y={32} color="#475569" fontSize={13} fontFamily="monospace">{title || '—'}</Text>

      {/* ── Divider ── */}
      <Box x={580} y={8} width={1} height={BTN_H} color="#1e293b" />

      {/* ── Right: media buttons ── */}
      {MEDIA_BTNS.map(btn => (
        <Button
          key={btn.cmd}
          x={btn.x} y={0}
          width={btn.w} height={height}
          color="#1e293b"
          activeColor="#1e40af"
          borderColor="#334155"
          activeBorderColor="#3b82f6"
          borderWidth={1}
          onClick={() => playerctl(btn.cmd)}
        >
          <Text
            x={btn.x + Math.floor((btn.w - btn.label.length * 11) / 2)}
            y={20}
            color="#e2e8f0"
            fontSize={18}
            fontFamily="monospace"
          >
            {btn.label}
          </Text>
        </Button>
      ))}

    </Box>
  );
}
