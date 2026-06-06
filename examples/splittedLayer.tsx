import React from 'react';
import { execFile } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { useActiveWindow } from './useActiveWindow';

// ── Media control ─────────────────────────────────────────────────────────────

type MediaCmd = 'previous' | 'play-pause' | 'next';

function playerctl(cmd: MediaCmd): void {
  execFile('playerctl', [cmd], () => {});
}

const BTN_Y   = 8;
const BTN_H   = 44;
const BTN_W   = 86;
const BTN_GAP = 8;
// Right-aligned group: 3 buttons + 2 gaps, 10px from screen edge
const BTN_CONTAINER_X = 2008 - 3 * BTN_W - 2 * BTN_GAP - 10;

const MEDIA_BTNS: { label: string; cmd: MediaCmd }[] = [
  { label: '<<', cmd: 'previous'   },
  { label: '||', cmd: 'play-pause' },
  { label: '>>', cmd: 'next'       },
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

      {/* ── Right: media buttons — flex row, no x/y on Button ── */}
      <Box
        x={BTN_CONTAINER_X} y={BTN_Y}
        width={MEDIA_BTNS.length * BTN_W + (MEDIA_BTNS.length - 1) * BTN_GAP}
        height={BTN_H}
        color="transparent"
        style={{ flexDirection: 'row', gap: BTN_GAP }}
      >
        {MEDIA_BTNS.map((btn, i) => (
          <Button
            key={btn.cmd}
            width={BTN_W} height={BTN_H}
            color="#334155"
            activeColor="#60a5fa"
            borderColor="#64748b"
            activeBorderColor="#93c5fd"
            borderWidth={1}
            borderRadius={6}
            opacity={0.85}
            activeOpacity={1}
            onClick={() => playerctl(btn.cmd)}
          >
            <Text
              x={Math.floor((BTN_W - btn.label.length * 11) / 2)}
              y={20}
              color="#f1f5f9"
              fontSize={18}
              fontFamily="monospace"
            >
              {btn.label}
            </Text>
          </Button>
        ))}
      </Box>

    </Box>
  );
}
