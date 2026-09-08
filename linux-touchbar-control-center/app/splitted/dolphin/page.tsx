import React from 'react';
import { Box, Text, Button } from 'react-drm';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };
import {
  MdArrowBack, MdArrowForward, MdArrowUpward, MdHome,
  MdVisibility, MdVerticalSplit, MdImage,
  MdCreateNewFolder, MdTerminal, MdDelete, MdFolder,
} from 'react-icons/md';
import { useDolphin } from '@/lib/hooks/useDolphin';
import { SELECTED_THEME } from '@/lib/theme';

const ACCENT   = SELECTED_THEME.primary;
const DIM      = SELECTED_THEME.textPrimary;
const DISABLED =SELECTED_THEME.textDisabled;
const DEL_CLR  = SELECTED_THEME.error;

const BTN_W  = 56;
const CHIP_W = 140;

export default function DolphinPanel({ width, height }: { width: number; height: number }) {
  const { connected, state, places, trigger, openDir } = useDolphin();

  const ICON_SZ = Math.round(height * 0.55);

  if (!connected) {
    return (
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, gap: 10 }}>
        <Box style={{ width: 3, height: 34, borderRadius: 10, backgroundColor: ACCENT }} />
        <Text color={DIM} fontSize={14}>
          Dolphin — waiting for D-Bus…
        </Text>
      </Box>
    );
  }

  function Btn({ onClick, enabled = true, children  }: { onClick: () => void; enabled?: boolean; children: React.ReactNode }) {
    return (
      <Button
        // width={BTN_W}
        
        color={SELECTED_THEME.surface}
        activeColor={ SELECTED_THEME.surfaceVariant}
        style={{flex:1, alignItems: 'center', justifyContent: 'center', borderRadius: 10  , borderColor:SELECTED_THEME.border , borderWidth:SELECTED_THEME.borderWidth}}
        onClick={enabled ? onClick : () => {}}
      >
        {children}
      </Button>
    );
  }

  function Sep() {
    return <Box style={{ width: 1, height: height - 16, backgroundColor: SELECTED_THEME.border, marginLeft: 2, marginRight: 2 }} />;
  }

  return (
    <Box style={{ flex: 1, flexDirection: 'row', gap: 4 }}>

      {/* Navigation — back/forward dim when there is no history */}
      <Btn onClick={() => trigger('go_back')} enabled={state.canBack} >
        <MdArrowBack style={{ width: ICON_SZ, height: ICON_SZ }} fill={state.canBack ? ACCENT : DISABLED} stroke="none" />
      </Btn>
      <Btn onClick={() => trigger('go_forward')} enabled={state.canForward}>
        <MdArrowForward style={{ width: ICON_SZ, height: ICON_SZ }} fill={state.canForward ? ACCENT : DISABLED} stroke="none" />
      </Btn>
      <Btn onClick={() => trigger('go_up')}>
        <MdArrowUpward style={{ width: ICON_SZ, height: ICON_SZ }} fill={ACCENT} stroke="none" />
      </Btn>
      <Btn onClick={() => trigger('go_home')}>
        <MdHome style={{ width: ICON_SZ, height: ICON_SZ }} fill={ACCENT} stroke="none" />
      </Btn>

      <Sep />

      {/* Toggles — lit when active in dolphin */}
      <Btn onClick={() => trigger('show_hidden_files')}>
        <MdVisibility style={{ width: ICON_SZ, height: ICON_SZ }} fill={state.hidden ? ACCENT : DIM} stroke="none" />
      </Btn>
      {/* <Btn onClick={() => trigger('split_view')}>
        <MdVerticalSplit style={{ width: ICON_SZ, height: ICON_SZ }} fill={state.split ? ACCENT : DIM} stroke="none" />
      </Btn>
      <Btn onClick={() => trigger('show_preview')}>
        <MdImage style={{ width: ICON_SZ, height: ICON_SZ }} fill={state.preview ? ACCENT : DIM} stroke="none" />
      </Btn> */}

      <Sep />

      {/* File ops — trash acts on the current selection */}
      <Btn onClick={() => trigger('create_dir')}>
        <MdCreateNewFolder style={{ width: ICON_SZ, height: ICON_SZ }} fill={SELECTED_THEME.success} stroke="none" />
      </Btn>
      {/* <Btn onClick={() => trigger('open_terminal_here')}>
        <MdTerminal style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
      </Btn> */}
      <Btn onClick={() => trigger('movetotrash')}>
        <MdDelete style={{ width: ICON_SZ, height: ICON_SZ }} fill={DEL_CLR} stroke="none" />
      </Btn>

      <Sep />

      {/* Quick places from KDE's Places sidebar */}
      {places.map(p => (
        <Button
          key={p.path}
          width={CHIP_W}
          color={SELECTED_THEME.surface}
          activeColor={SELECTED_THEME.surfaceVariant}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8 , borderWidth:SELECTED_THEME.borderWidth , borderColor:SELECTED_THEME.border}}
          onClick={() => openDir(p.path)}
        >
          <MdFolder style={{ width: 18, height: 18 }} fill={SELECTED_THEME.primary} stroke="none" />
          <Text color={SELECTED_THEME.textPrimary} fontSize={13}>{p.title}</Text>
        </Button>
      ))}

    </Box>
  );
}
