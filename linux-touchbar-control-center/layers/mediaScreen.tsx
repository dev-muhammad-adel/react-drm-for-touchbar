import React, { useContext, useEffect, useRef, useState } from 'react';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { Box, Button, KEY, DisplaySizeContext, LayoutContext, NativeDrawContext } from 'react-drm';
import type { BoxNode } from 'react-drm';
import {
  MdSkipPrevious, MdPlayArrow, MdSkipNext,
  MdVolumeOff, MdVolumeDown, MdVolumeUp,
} from 'react-icons/md';
import { BackButton } from '../components/BackButton';
import { CAVA } from '../config';
import { keys } from '../services/keyInjector';

type Action =
  | 'PreviousSong' | 'PlayPause' | 'NextSong'
  | 'Mute' | 'VolumeDown' | 'VolumeUp';

function run(action: Action) {
  switch (action) {
    case 'PreviousSong': return keys.pressKey(KEY.PREVIOUSSONG);
    case 'PlayPause': return keys.pressKey(KEY.PLAYPAUSE);
    case 'NextSong': return keys.pressKey(KEY.NEXTSONG);
    case 'Mute': return keys.pressKey(KEY.MUTE);
    case 'VolumeDown': return keys.pressKey(KEY.VOLUMEDOWN);
    case 'VolumeUp': return keys.pressKey(KEY.VOLUMEUP);
  }
}

const ICON_SIZE = 30;
const BTN_BG = '#4f4b4f';
const BTN_ACTIVE_BG = '#666666';
const BTN_W = 130;

const VIS_BARS = CAVA.bars * 2;
const VIS_CFG = '/tmp/.react-drm-cava-media.conf';
const VIS_MAX_HEIGHT = 34;
const VIS_BAR_W = 10;
const VIS_GAP = 3;
const VIS_WIDTH = VIS_BARS * VIS_BAR_W + (VIS_BARS - 1) * VIS_GAP;

try {
  writeFileSync(VIS_CFG, [
    '[general]',
    `bars = ${VIS_BARS}`,
    `framerate = ${CAVA.framerate}`,
    '[input]',
    'method = pulse',
    'source = auto',
    '[output]',
    'method = raw',
    'raw_target = /dev/stdout',
    'data_format = binary',
    'channels = mono',
    'bit_format = 8bit',
  ].join('\n'));
} catch { /**/ }

const VIS_COLORS = Array.from({ length: VIS_BARS }, (_, i) => {
  const t = i / (VIS_BARS - 1);
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(59 + u * (236 - 59));
    g = Math.round(130 + u * (72 - 130));
    b = Math.round(246 + u * (153 - 246));
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(236 + u * (251 - 236));
    g = Math.round(72 + u * (146 - 72));
    b = Math.round(153 + u * (60 - 153));
  }
  const hex = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
});

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const VIS_RGB = VIS_COLORS.flatMap(hexRgb);
const VIS_INACTIVE_RGB = Array.from({ length: VIS_BARS }, () => hexRgb('#1e293b')).flat();

function Btn({
  onClick,
  children,
  radiusLeft = false,
  radiusRight = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  radiusLeft?: boolean;
  radiusRight?: boolean;
}) {
  return (
    <Button
      color={BTN_BG}
      activeColor={BTN_ACTIVE_BG}
      width={BTN_W}
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        borderTopLeftRadius: radiusLeft ? 10 : 0,
        borderBottomLeftRadius: radiusLeft ? 10 : 0,
        borderTopRightRadius: radiusRight ? 10 : 0,
        borderBottomRightRadius: radiusRight ? 10 : 0,
      }}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function MediaAudioVis() {
  const layoutRef = useContext(LayoutContext);
  const native = useContext(NativeDrawContext);
  const { height: dispH } = useContext(DisplaySizeContext);
  const barsRef = useRef<BoxNode>(null);
  const heightsRef = useRef<number[]>(new Array(VIS_BARS).fill(2));
  const [, force] = useState(0);

  useEffect(() => {
    let partial: Buffer = Buffer.alloc(0);
    let prev = new Array(VIS_BARS).fill(2);
    const proc = spawn('cava', ['-p', VIS_CFG]);
    proc.stdout?.on('data', (chunk: Buffer) => {
      partial = partial.length ? Buffer.concat([partial, chunk]) : chunk;
      const whole = partial.length - (partial.length % VIS_BARS);
      if (whole < VIS_BARS) return;
      const frame = partial.slice(whole - VIS_BARS, whole);
      partial = whole < partial.length ? partial.slice(whole) : Buffer.alloc(0);
      const heights = Array.from(frame, v => Math.max(2, Math.round((v / 255) * VIS_MAX_HEIGHT)));
      if (heights.every((h, i) => h === prev[i])) return;
      prev = heights;
      heightsRef.current = heights;

      const node = barsRef.current;
      const box = node ? layoutRef.current.get(node) : undefined;
      if (native && box) {
        const active = heights.some(h => h > 2);
        native.drawBars({
          x0: box.x,
          baseY: box.y + box.h,
          barW: VIS_BAR_W,
          gap: VIS_GAP,
          fullHeight: dispH,
          bg: [0, 0, 0],
          heights,
          colors: active ? VIS_RGB : VIS_INACTIVE_RGB,
        });
      } else {
        force(n => n + 1);
      }
    });
    return () => { try { proc.kill('SIGTERM'); } catch { /**/ } };
  }, [native, dispH, layoutRef]);

  const bars = heightsRef.current;
  const isActive = bars.some(h => h > 2);

  return (
    <Box style={{ width: VIS_WIDTH, alignItems: 'flex-end', justifyContent: 'flex-end', paddingBottom: 8 }}>
      <Box ref={barsRef} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: VIS_GAP }}>
        {bars.map((h, i) => (
          <Box
            key={i}
            style={{ width: VIS_BAR_W, height: h, backgroundColor: isActive ? VIS_COLORS[i] : '#1e293b' }}
          />
        ))}
      </Box>
    </Box>
  );
}

export function MediaScreen({ width, height }: { width: number; height: number }) {
  return (
    <Box style={{ flex: 1, gap: 30 }}>
      <BackButton animation="slide-right" />

      <Box style={{ flexGrow: 3, flexDirection: 'row', alignItems: 'stretch', gap: 2 }}>
        <Box style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', paddingRight: 14 }}>
          <MediaAudioVis />
        </Box>

        <Box style={{ flexDirection: 'row', gap: 2 }}>
          <Btn onClick={() => run('PreviousSong')} radiusLeft>
            <MdSkipPrevious style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />
          </Btn>
          <Btn onClick={() => run('PlayPause')}>
            <MdPlayArrow style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />
          </Btn>
          <Btn onClick={() => run('NextSong')} radiusRight>
            <MdSkipNext style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />
          </Btn>
        </Box>

        <Box style={{ flexDirection: 'row', gap: 2 }}>
          <Btn onClick={() => run('Mute')} radiusLeft>
            <MdVolumeOff style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />
          </Btn>
          <Btn onClick={() => run('VolumeDown')}>
            <MdVolumeDown style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />
          </Btn>
          <Btn onClick={() => run('VolumeUp')} radiusRight>
            <MdVolumeUp style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />
          </Btn>
        </Box>
      </Box>
    </Box>
  );
}
