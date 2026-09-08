import React from 'react';
import path from 'path';
import { Box, Button, KEY, Svg } from 'react-drm';
import {
  MdClose,
  MdBrightness4, MdBrightness7,
  MdMicOff,
  MdSearch,
  MdSkipPrevious, MdPlayArrow, MdSkipNext,
  MdVolumeOff, MdVolumeDown, MdVolumeUp,
  MdApps,
} from 'react-icons/md';
import { BackButton } from '@/components/BackButton';
import { keys } from '@/lib/services/keyInjector';
import { SELECTED_THEME } from '@/lib/theme';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = {
  leaving:  { outAnim: 'slide-right' },
  entering: { inAnim:  'slide-left' },
};

// app/media/page.tsx sits two levels under its own root in both trees
// (linux-touchbar-control-center/app/media in dev, dist/app/media once
// built, with assets/ copied alongside dist/ at build time) — same relative
// depth either way, so one formula covers both instead of a dev/built branch.
const KBD_ILLUM_DOWN_ICON = path.join(__dirname, '..', '..', 'assets', 'kbd_illum_down.svg');
const KBD_ILLUM_UP_ICON   = path.join(__dirname, '..', '..', 'assets', 'kbd_illum_up.svg');

// ── Actions ────────────────────────────────────────────────────────────────────

type Action =
  | 'Macro1'
  | 'BrightnessDown' | 'BrightnessUp'
  | 'MicMute'
  | 'Search'
  | 'IllumDown' | 'IllumUp'
  | 'PreviousSong' | 'PlayPause' | 'NextSong'
  | 'Mute' | 'VolumeDown' | 'VolumeUp'
  | 'AllApplications'
  | 'Unknown';

function run(action: Action) {
  switch (action) {
    case 'BrightnessDown':   return keys.pressKey(KEY.BRIGHTNESSDOWN);
    case 'BrightnessUp':     return keys.pressKey(KEY.BRIGHTNESSUP);
    case 'MicMute':          return keys.pressKey(KEY.MICMUTE);
    case 'Search':           return keys.pressKey(KEY.SEARCH);
    case 'IllumDown':        return keys.pressKey(KEY.KBDILLUMDOWN);
    case 'IllumUp':          return keys.pressKey(KEY.KBDILLUMUP);
    case 'PreviousSong':     return keys.pressKey(KEY.PREVIOUSSONG);
    case 'PlayPause':        return keys.pressKey(KEY.PLAYPAUSE);
    case 'NextSong':         return keys.pressKey(KEY.NEXTSONG);
    case 'Mute':             return keys.pressKey(KEY.MUTE);
    case 'VolumeDown':       return keys.pressKey(KEY.VOLUMEDOWN);
    case 'VolumeUp':         return keys.pressKey(KEY.VOLUMEUP);
    case 'AllApplications':  return keys.pressKey(KEY.LEFTMETA);
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

const ICON_SIZE = 30;

function ToolBtn({ onClick, children }: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      color={SELECTED_THEME.surface}
      activeColor={SELECTED_THEME.surfaceVariant}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderColor: SELECTED_THEME.border, borderWidth: SELECTED_THEME.borderWidth }}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export default function MediaScreen({ width, height }: { width: number; height: number }) {
  return (
    <Box style={{ flex: 1,gap: 30 }}>

      <BackButton animation="slide-right" />



      <Box style={{flexGrow:2 , gap:6}} >

      <ToolBtn onClick={() => run('BrightnessDown')}>
        <MdBrightness4 style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('BrightnessUp')}>
        <MdBrightness7 style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box>
      <Box style={{flexGrow:1}} >

      <ToolBtn onClick={() => run('MicMute')}>
        <MdMicOff style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box>
      <Box style={{flexGrow:1}} >

      <ToolBtn onClick={() => run('Search')}>
        <MdSearch style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box>

      <Box style={{flexGrow:2 , gap:6}}   >

      <ToolBtn onClick={() => run('IllumDown')}>
        <Svg src={KBD_ILLUM_DOWN_ICON} width={ICON_SIZE} height={ICON_SIZE} />
      </ToolBtn>

      <ToolBtn onClick={() => run('IllumUp')}>
        <Svg src={KBD_ILLUM_UP_ICON} width={ICON_SIZE} height={ICON_SIZE} />
      </ToolBtn>
</Box>

      <Box style={{flexGrow:3 , gap:6}} >

      <ToolBtn onClick={() => run('PreviousSong')}>
        <MdSkipPrevious style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('PlayPause')}>
        <MdPlayArrow style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('NextSong')}>
        <MdSkipNext style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box>

      <Box style={{flexGrow:3 , gap:6}} >

      <ToolBtn onClick={() => run('Mute')}>
        <MdVolumeOff style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('VolumeDown')}>
        <MdVolumeDown style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('VolumeUp')}>
        <MdVolumeUp style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box>

      <Box style={{flexGrow: 1}} >

      <ToolBtn onClick={() => run('AllApplications')}>
        <MdApps style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box> 

    </Box>
  );
}
