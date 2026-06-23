import React from 'react';
import { Box, Text, Button, Gif } from 'react-drm';
import { useLayers } from '..';
import { useActiveWindow } from '../../hooks/useActiveWindow';
import path from 'path';

// const APP_ROOT = process.cwd();
// const BOOT_GIF_PATH = path.join(APP_ROOT, 'public', 'wildcat2.gif');

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
  'org.kde.dolphin': '#1d99f3',
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
      // onClick={next}
    >
      <Box style={{ flex: 1  , borderRadius: 10  , justifyContent: 'center' }}>
        <Box style={{ width:200,justifyContent:'center' ,flexDirection:'column' }}>
  
          {/* <Box  style={{height:20 }}>

          <Text  color={color} fontSize={16} fontFamily="IosevkaTerm Nerd Font">
            {(cls || 'desktop').toUpperCase()}
          </Text>
       
          </Box>
          */}
        </Box>
      </Box>
    </Button>
  );
}
