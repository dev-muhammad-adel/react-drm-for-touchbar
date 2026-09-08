import React, { useEffect, useRef, useState } from 'react';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };
import { Box, Button, Text } from 'react-drm';
import {
  MdArrowBack, MdArrowForward, MdRefresh, MdHome,
  MdAdd, MdCheck, MdClose, MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useActiveWindow } from '@/lib/hooks/useActiveWindow';
import { useBrowserKeys } from '@/lib/hooks/useBrowserKeys';
import { SELECTED_THEME } from '@/lib/theme';

const DIM       = SELECTED_THEME.textPrimary;
const CLOSE_CLR = SELECTED_THEME.error;
const CLOSE_CONFIRM_MS = 3000;
const GROUP_GAP = 12;
const BTN_W = 130;

export default function BrowserPanel({ width, height }: { width: number; height: number }) {
  const { class: windowClass } = useActiveWindow();
  const { back, forward, reload, home, newTab, closeTab, prevTab, nextTab } = useBrowserKeys(windowClass);
  const [confirmClose, setConfirmClose] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ICON_SZ = 32;

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function armClose() {
    if (confirmClose) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      setConfirmClose(false);
      closeTab();
      return;
    }

    setConfirmClose(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setConfirmClose(false);
    }, CLOSE_CONFIRM_MS);
  }

  function Btn({
    onClick,
    children,
    color = SELECTED_THEME.surface,
    activeColor = SELECTED_THEME.surfaceVariant,
    radiusLeft = false,
    radiusRight = false,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    color?: string;
    activeColor?: string;
    radiusLeft?: boolean;
    radiusRight?: boolean;
  }) {
    return (
      <Button
        color={color}
        activeColor={activeColor}
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
    <Box style={{ flex: 1, flexDirection: 'row', gap: GROUP_GAP }}>
      <Box style={{ flexDirection: 'row', gap: SELECTED_THEME.borderWidth , backgroundColor:SELECTED_THEME.border  , borderWidth:SELECTED_THEME.borderWidth, borderColor:SELECTED_THEME.border , borderRadius:10}}>
        <Btn onClick={back} radiusLeft>
          <MdArrowBack style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={forward}>
          <MdArrowForward style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={reload}>
          <MdRefresh style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={home} radiusRight>
          <MdHome style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
      </Box>

      <Box style={{ flexDirection: 'row', gap: SELECTED_THEME.borderWidth , backgroundColor:SELECTED_THEME.border  , borderWidth:SELECTED_THEME.borderWidth, borderColor:SELECTED_THEME.border , borderRadius:10}}>
        <Btn onClick={prevTab} radiusLeft>
          <MdChevronLeft style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={nextTab}>
          <MdChevronRight style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={newTab}>
          <MdAdd style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn
          onClick={armClose}
          color={confirmClose ? '#7f1d1d' : SELECTED_THEME.surface}
          activeColor={confirmClose ? '#991b1b' : SELECTED_THEME.surfaceVariant}
          radiusRight
        >
          {confirmClose ? (
            <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <MdCheck style={{ width: 24, height: 24 }} fill={DIM} stroke="none" />
              <Text color={DIM} fontSize={14}>CLOSE?</Text>
            </Box>
          ) : (
            <MdClose style={{ width: ICON_SZ, height: ICON_SZ }} fill={CLOSE_CLR} stroke="none" />
          )}
        </Btn>
      </Box>
    </Box>
  );
}
