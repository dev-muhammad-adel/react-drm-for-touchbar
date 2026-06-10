import React from 'react';
import { Box, Button } from 'react-drm';
import {
  MdArrowBack, MdArrowForward, MdRefresh,
  MdAdd, MdClose, MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useActiveWindow } from '../../useActiveWindow';
import { useBrowserKeys } from '../../hooks/useBrowserKeys';

const ACCENT    = '#f97316';
const DIM       = '#94a3b8';
const ADD_CLR   = '#4ade80';
const CLOSE_CLR = '#f87171';

export function BrowserPanel({ width, height }: { width: number; height: number }) {
  const { class: windowClass } = useActiveWindow();
  const { back, forward, reload, newTab, closeTab, prevTab, nextTab } = useBrowserKeys(windowClass);

  const ICON_SZ = Math.round(height * 0.58);

  function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    return (
      <Button
        color="#4f4b4f"
        activeColor="#666666"
        style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 8, flex: 1 }}
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
      <Btn onClick={closeTab}>
        <MdClose style={{ width: ICON_SZ, height: ICON_SZ }} fill={CLOSE_CLR} stroke="none" />
      </Btn>

    </Box>
  );
}
