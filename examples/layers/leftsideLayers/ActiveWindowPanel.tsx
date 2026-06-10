import React from 'react';
import { Box, Text, Button } from 'react-drm';
import { useLayers } from '..';
import { useActiveWindow } from '../../useActiveWindow';

const ACCENT: Record<string, string> = {
  firefox: '#f97316',
  'firefox-esr': '#f97316',
  chromium: '#4285f4',
  'google-chrome': '#4285f4',
  brave: '#fb923c',
  code: '#3b82f6',
  'code-oss': '#3b82f6',
  vscodium: '#3b82f6',
  kitty: '#22c55e',
  alacritty: '#22c55e',
  foot: '#22c55e',
  wezterm: '#22c55e',
  spotify: '#1db954',
  discord: '#5865f2',
  steam: '#4a9dd4',
  thunar: '#64b5f6',
  nautilus: '#64b5f6',
  obsidian: '#7c3aed',
  mpv: '#f59e0b',
  vlc: '#f97316',
  telegram: '#29b6f6',
  telegramdesktop: '#29b6f6',
  gimp: '#9b59b6',
  inkscape: '#e8a020',
  blender: '#ea7600',
};

function accentColor(cls: string): string {
  return ACCENT[cls.toLowerCase()] ?? '#38bdf8';
}

export function ActiveWindowPanel({ width, height }: { width: number; height: number }) {
  const { next } = useLayers();
  const { title, class: cls } = useActiveWindow();
  const color = accentColor(cls);

  return (
    <Button
      width={width}
      height={height}
      color="transparent"
      activeColor="transparent"
      onClick={next}
    >
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, gap: 10 }}>
        <Box style={{ width: 3, height: 34, borderRadius: 2, backgroundColor: color }} />
        <Box style={{ flexDirection: 'column', gap: 2, alignSelf: 'center', height: 37 }}>
          <Text color={color} fontSize={10} fontFamily="IosevkaTerm Nerd Font">
            {(cls || 'desktop').toUpperCase()}
          </Text>
          <Text color="#e2e8f0" fontSize={15} fontFamily="IosevkaTerm Nerd Font">
            {title || 'No active title'}
          </Text>
          <Text color="#94a3b8" fontSize={11} fontFamily="IosevkaTerm Nerd Font">
            Tap to cycle left cards
          </Text>
        </Box>
      </Box>
    </Button>
  );
}
