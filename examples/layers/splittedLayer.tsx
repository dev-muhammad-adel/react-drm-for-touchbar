import React from 'react';
import { execFile } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { FaChevronLeft, FaLinux } from 'react-icons/fa6';
import { useLayers } from '.';
import { MdChevronLeft, MdPlayArrow, MdSkipNext, MdVolumeUp, MdWbSunny, MdSportsEsports } from 'react-icons/md';
import { useActiveWindow } from '../useActiveWindow';

// ── Media control ─────────────────────────────────────────────────────────────

type MediaCmd = 'previous' | 'play-pause' | 'next';

function playerctl(cmd: MediaCmd): void {
  execFile('playerctl', [cmd], () => {});
}

const BTN_Y   = 8;
const BTN_H   = 44;
const BTN_W   = 52;
const BTN_GAP = 6;
// Right-aligned group: 3 buttons + 2 gaps, 10px from screen edge
const BTN_CONTAINER_X = 2008 - 3 * BTN_W - 2 * BTN_GAP - 10;

const ICON_SIZE = 32;

const MEDIA_BTNS: { icon: React.ReactElement; cmd?: MediaCmd  }[] = [
  { icon: <FaChevronLeft style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#f1f5f9" stroke="none" />,   },
  { icon: <FaLinux        style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#f1f5f9" stroke="none" />,   },
  { icon: <MdVolumeUp     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#f1f5f9" stroke="none" />,  },
  { icon: <MdWbSunny      style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#f1f5f9" stroke="none" />,  },
  { icon: <MdPlayArrow     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#f1f5f9" stroke="none" />, cmd: 'play-pause'       },
  { icon: <MdSportsEsports     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#4ade80" stroke="none" />    },
];

// ── Window accent colors ──────────────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  firefox:           '#f97316',
  'firefox-esr':     '#f97316',
  chromium:          '#4285f4',
  'google-chrome':   '#4285f4',
  brave:             '#fb923c',
  code:              '#3b82f6',
  'code-oss':        '#3b82f6',
  vscodium:          '#3b82f6',
  kitty:             '#22c55e',
  alacritty:         '#22c55e',
  foot:              '#22c55e',
  wezterm:           '#22c55e',
  spotify:           '#1db954',
  discord:           '#5865f2',
  steam:             '#4a9dd4',
  thunar:            '#64b5f6',
  nautilus:          '#64b5f6',
  obsidian:          '#7c3aed',
  mpv:               '#f59e0b',
  vlc:               '#f97316',
  telegram:          '#29b6f6',
  telegramdesktop:   '#29b6f6',
  gimp:              '#9b59b6',
  inkscape:          '#e8a020',
  blender:           '#ea7600',
};

function accentColor(cls: string): string {
  return ACCENT[cls.toLowerCase()] ?? '#38bdf8';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SplittedLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers();
  const { title, class: cls } = useActiveWindow();

  return (
    <Box  style={{justifyContent:"space-between" ,flex: 1, gap: 10}} >

      {/* ── Left: active window ── */}
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, gap: 10 }}>
        <Box style={{ width: 3, height: 34, borderRadius: 2, backgroundColor: accentColor(cls) }} />
        <Box style={{ flexDirection: 'column', gap: 2, alignSelf: 'center', height: 37 }}>
          <Text color={accentColor(cls)} fontSize={10} fontFamily="IosevkaTerm Nerd Font">{(cls || 'desktop').toUpperCase()}</Text>
          <Text color="#e2e8f0" fontSize={15} fontFamily="IosevkaTerm Nerd Font">{title || '—'}</Text>
        </Box>
      </Box>


      {/* ── Right: games + media buttons ── */}
      {/* <Box
        style={{ flexDirection: 'row' ,gap:6}}
      >
        <Button
          width={70}
          color="#1a2e1a"
          activeColor="#2a4a2a"
          onClick={() => go('games', 'slide-left')}
          style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}
        >
          <MdSportsEsports style={{ width: 28, height: 28 }} fill="#4ade80" stroke="none" />
        </Button>
      </Box> */}

      <Box
        style={{ flexDirection: 'row' ,gap:2}}
      >
        {MEDIA_BTNS.map((btn, idx) => (
          <Button
            key={`${btn.cmd}-${idx}`}
            width={idx===0?25:idx===MEDIA_BTNS.length - 1 ? 100 : 130}
               color={ idx === MEDIA_BTNS.length - 1 ? "#1a2e1a":"#4f4b4f"}
          activeColor={ idx === MEDIA_BTNS.length - 1 ? "#2a4a2a":"#666666"}

            onClick={
              idx === 0 ? () => go('media') :
              idx === 1 ? () => go('systembar') :
              idx === 2 ? () => go('audio-slider') :
              idx === 3 ? () => go('brightness-slider') :
              idx === MEDIA_BTNS.length - 1 ? () => go('games', 'slide-left') :
              () => playerctl(btn.cmd as MediaCmd)
            }
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              borderTopLeftRadius: idx === 0 ? 10 : 0,
              borderBottomLeftRadius: idx === 0 ? 10 : 0,
              borderTopRightRadius: idx === MEDIA_BTNS.length - 1 ? 10 : 0,
              borderBottomRightRadius: idx === MEDIA_BTNS.length - 1 ? 10 : 0,
            }}
          >
            {btn.icon}
          </Button>
        ))}
      </Box>

    </Box>
  );
}
