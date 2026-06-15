import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Text } from 'react-drm';
import {
  MdArrowBack, MdArrowForward, MdRefresh,
  MdAdd, MdCheck, MdClose, MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useActiveWindow } from '../../hooks/useActiveWindow';
import { useBrowserKeys } from '../../hooks/useBrowserKeys';

const ACCENT    = '#f97316';
const DIM       = '#cccccc';
const ADD_CLR   = '#4ade80';
const CLOSE_CLR = '#f87171';
const CLOSE_CONFIRM_MS = 3000;

export function BrowserPanel({ width, height }: { width: number; height: number }) {
  const { class: windowClass } = useActiveWindow();
  const { back, forward, reload, newTab, closeTab, prevTab, nextTab } = useBrowserKeys(windowClass);
  const [confirmClose, setConfirmClose] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ICON_SZ = Math.round(height * 0.58);

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
    color = '#4f4b4f',
    activeColor = '#666666',
  }: {
    onClick: () => void;
    children: React.ReactNode;
    color?: string;
    activeColor?: string;
  }) {
    return (
      <Button
        color={color}
        activeColor={activeColor}
        style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 8, width: 120 }}
        onClick={onClick}
      >
        {children}
      </Button>
    );
  }

  function Sep() {
    return <Box style={{ width: 1, height: height - 16, backgroundColor: '#1e293b', marginLeft: 2, marginRight: 2 }} />;
  }

  return (
    <Box style={{ flex: 1, flexDirection: 'row', gap: 4 }}>

      <Btn onClick={back}>
        <MdArrowBack style={{ width: ICON_SZ, height: ICON_SZ }} fill={ACCENT} stroke="none" />
      </Btn>
      <Btn onClick={forward}>
        <MdArrowForward style={{ width: ICON_SZ, height: ICON_SZ }} fill={ACCENT} stroke="none" />
      </Btn>
      <Btn onClick={reload}>
        <MdRefresh style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
      </Btn>

      <Sep />

      <Btn onClick={prevTab}>
        <MdChevronLeft style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
      </Btn>
      <Btn onClick={nextTab}>
        <MdChevronRight style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
      </Btn>

      <Sep />

      <Btn onClick={newTab}>
        <MdAdd style={{ width: ICON_SZ, height: ICON_SZ }} fill={ADD_CLR} stroke="none" />
      </Btn>
      <Btn
        onClick={armClose}
        color={confirmClose ? '#7f1d1d' : '#4f4b4f'}
        activeColor={confirmClose ? '#991b1b' : '#666666'}
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
  );
}
