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

const DIM = '#cccccc';
const GROUP_GAP = 12;
const BTN_W = 100;
const ICON_SZ = 30;

// Plain gray, matching BrowserPanel/KonsolePanel/DolphinPanel/VlcPanel — every
// other panel in this app uses the same uniform button color, so this stays
// consistent rather than being the one panel with per-group accent tinting.
// Start/Stop keep their own semantic green/red (not decorative — the same
// green=go/red=stop convention every IDE's debug toolbar uses); STOP_CLR
// matches the danger color BrowserPanel already uses for its close button.
const BTN_BG        = '#373737';
const BTN_ACTIVE_BG = '#474747';
const GROUPS = {
  run:      { color: BTN_BG, activeColor: BTN_ACTIVE_BG },
  edit:     { color: BTN_BG, activeColor: BTN_ACTIVE_BG },
  commands: { color: BTN_BG, activeColor: BTN_ACTIVE_BG },
};
const START_CLR = { color: '#22c55e33', activeColor: '#22c55e66' };
const STOP_CLR  = { color: '#f8717133', activeColor: '#f8717166' };

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
          width: BTN_W,
          height: height,
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
    <Box style={{ flex: 1, flexDirection: 'row', gap: GROUP_GAP }}>
      {/* Run/Debug */}
      <Box style={{ flexDirection: 'row', gap: 2 }}>
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
      <Box style={{ flexDirection: 'row', gap: 2 }}>
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
      <Box style={{ flexDirection: 'row', gap: 2 }}>
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
