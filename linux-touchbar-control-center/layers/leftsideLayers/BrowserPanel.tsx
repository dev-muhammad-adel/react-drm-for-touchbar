import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Text } from 'react-drm';
import {
  MdArrowBack, MdArrowForward, MdRefresh, MdHome,
  MdAdd, MdCheck, MdClose, MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useActiveWindow } from '../../hooks/useActiveWindow';
import { useBrowserKeys } from '../../hooks/useBrowserKeys';

const DIM       = '#cccccc';
const CLOSE_CLR = '#f87171';
const CLOSE_CONFIRM_MS = 3000;
const BTN_BG = '#444444';
const BTN_ACTIVE_BG = '#555555';
const GROUP_GAP = 12;
const BTN_W = 130;

export function BrowserPanel({ width, height }: { width: number; height: number }) {
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
    color = BTN_BG,
    activeColor = BTN_ACTIVE_BG,
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
      <Box style={{ flexDirection: 'row', gap: 2 }}>
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

      <Box style={{ flexDirection: 'row', gap: 2 }}>
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
          color={confirmClose ? '#7f1d1d' : BTN_BG}
          activeColor={confirmClose ? '#991b1b' : BTN_ACTIVE_BG}
          radiusRight
        >
          {confirmClose ? (
            <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <MdCheck style={{ width: 24, height: 24 }} fill="#fff" stroke="none" />
              <Text color="#fff" fontSize={14} fontFamily="IosevkaTerm Nerd Font">CLOSE?</Text>
            </Box>
          ) : (
            <MdClose style={{ width: ICON_SZ, height: ICON_SZ }} fill={CLOSE_CLR} stroke="none" />
          )}
        </Btn>
      </Box>
    </Box>
  );
}
