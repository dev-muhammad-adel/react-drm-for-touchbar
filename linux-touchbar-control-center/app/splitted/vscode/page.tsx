import React from 'react';
import { Box, Button } from 'react-drm';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };
import { MdUndo, MdRedo, MdSearch, MdKeyboardCommandKey } from 'react-icons/md';
import {
  VscDebugStart, VscDebugStop, VscDebugStepOver, VscDebugStepInto, VscDebugStepOut, VscGear,
} from 'react-icons/vsc';
import { useActiveWindow } from '@/lib/hooks/useActiveWindow';
import { useVsCodeKeys } from '@/lib/hooks/useVsCodeKeys';
import { SELECTED_THEME } from '@/lib/theme';

const DIM = SELECTED_THEME.textPrimary;
const GROUP_GAP = 12;
const BTN_W = 100;
const ICON_SZ = 30;

// Plain gray, matching BrowserPanel/KonsolePanel/DolphinPanel/VlcPanel — every
// other panel in this app uses the same uniform button color, so this stays
// consistent rather than being the one panel with per-group accent tinting.
// Start/Stop keep their own semantic green/red (not decorative — the same
// green=go/red=stop convention every IDE's debug toolbar uses); STOP_CLR
// matches the danger color BrowserPanel already uses for its close button.
const BTN_BG        = SELECTED_THEME.surface;
const BTN_ACTIVE_BG = SELECTED_THEME.surfaceVariant;
const GROUPS = {
  run:      { color: BTN_BG, activeColor: BTN_ACTIVE_BG },
  edit:     { color: BTN_BG, activeColor: BTN_ACTIVE_BG },
  commands: { color: BTN_BG, activeColor: BTN_ACTIVE_BG },
};
const START_CLR = { color: BTN_BG, activeColor: BTN_ACTIVE_BG };
const STOP_CLR  = { color: BTN_BG, activeColor: BTN_ACTIVE_BG };

export default function VsCodePanel({ width, height }: { width: number; height: number }) {
  const { class: windowClass } = useActiveWindow();
  const {
    run, stop, stepOver, stepInto, stepOut, undo, redo, find, commandPalette, settings,
  } = useVsCodeKeys(windowClass);

  function Btn({
    onClick,
    children,
    group,
    color,
    activeColor,
    radiusLeft = false,
    radiusRight = false,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    group: keyof typeof GROUPS;
    color?: string;
    activeColor?: string;
    radiusLeft?: boolean;
    radiusRight?: boolean;
  }) {
    return (
      <Button
        color={color ?? GROUPS[group].color}
        activeColor={activeColor ?? GROUPS[group].activeColor}
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          width: BTN_W -( SELECTED_THEME.borderWidth *2),
          height: height -( SELECTED_THEME.borderWidth *2),
          marginVertical:SELECTED_THEME.borderWidth,
          marginLeft:radiusLeft?SELECTED_THEME.borderWidth:0,
          marginRight:radiusRight?SELECTED_THEME.borderWidth:0,
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

  return (
    <Box style={{ flex: 1, flexDirection: 'row', gap: GROUP_GAP  }}>
      {/* Run/Debug */}
      <Box style={{ flexDirection: 'row', gap: SELECTED_THEME.borderWidth , backgroundColor:SELECTED_THEME.border  , borderWidth:SELECTED_THEME.borderWidth, borderColor:SELECTED_THEME.border , borderRadius:10}}>
        <Btn onClick={run} group="run" color={START_CLR.color} activeColor={START_CLR.activeColor} radiusLeft>
          <VscDebugStart style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={stop} group="run" color={STOP_CLR.color} activeColor={STOP_CLR.activeColor}>
          <VscDebugStop style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={stepOver} group="run">
          <VscDebugStepOver style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={stepInto} group="run">
          <VscDebugStepInto style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={stepOut} group="run" radiusRight>
          <VscDebugStepOut style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
      </Box>

      {/* Edit */}
      <Box style={{ flexDirection: 'row', gap: SELECTED_THEME.borderWidth , backgroundColor:SELECTED_THEME.border  , borderWidth:SELECTED_THEME.borderWidth, borderColor:SELECTED_THEME.border , borderRadius:10}}>
        <Btn onClick={undo} group="edit" radiusLeft>
          <MdUndo style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={redo} group="edit">
          <MdRedo style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={find} group="edit" radiusRight>
          <MdSearch style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
      </Box>

      {/* Commands */}
      <Box style={{ flexDirection: 'row', gap: SELECTED_THEME.borderWidth , backgroundColor:SELECTED_THEME.border  , borderWidth:SELECTED_THEME.borderWidth, borderColor:SELECTED_THEME.border , borderRadius:10}}>
        <Btn onClick={commandPalette} group="commands" radiusLeft>
          <MdKeyboardCommandKey style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={settings} group="commands" radiusRight>
          <VscGear style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
      </Box>
    </Box>
  );
}
