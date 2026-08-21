import React, { useEffect, useRef, useState } from 'react';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };
import { Box, Button, Text } from 'react-drm';
import {
  MdChevronLeft, MdChevronRight, MdZoomIn, MdZoomOut,
  MdRotateLeft, MdRotateRight, MdSlideshow, MdDelete, MdCheck,
} from 'react-icons/md';
import { useGwenview } from '@/lib/hooks/useGwenview';

const DIM = '#cccccc';
const TRASH_CLR = '#f87171'; // matches BrowserPanel's close-button danger color
const BTN_BG = '#373737';
const BTN_ACTIVE_BG = '#474747';
const GROUP_GAP = 12;
const BTN_W = 100;
const ICON_SZ = 30;
const TRASH_CONFIRM_MS = 3000; // same window BrowserPanel uses for its close-tab confirm

export default function GwenviewPanel({ width, height }: { width: number; height: number }) {
  const {
    filename, prev, next, zoomIn, zoomOut, rotateLeft, rotateRight, slideshow, trash,
  } = useGwenview();

  const [confirmTrash, setConfirmTrash] = useState(false);
  const trashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (trashTimer.current) clearTimeout(trashTimer.current);
  }, []);

  function armTrash() {
    if (confirmTrash) {
      if (trashTimer.current) clearTimeout(trashTimer.current);
      trashTimer.current = null;
      setConfirmTrash(false);
      trash();
      return;
    }

    setConfirmTrash(true);
    trashTimer.current = setTimeout(() => {
      trashTimer.current = null;
      setConfirmTrash(false);
    }, TRASH_CONFIRM_MS);
  }

  function Btn({
    onClick,
    children,
    color,
    activeColor,
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
        color={color ?? BTN_BG}
        activeColor={activeColor ?? BTN_ACTIVE_BG}
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
      {/* Navigation */}
      <Box style={{ flexDirection: 'row', gap: 2 }}>
        <Btn onClick={prev} radiusLeft>
          <MdChevronLeft style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={next} radiusRight>
          <MdChevronRight style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
      </Box>

      {/* Zoom / rotate */}
      <Box style={{ flexDirection: 'row', gap: 2 }}>
        <Btn onClick={zoomIn} radiusLeft>
          <MdZoomIn style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={zoomOut}>
          <MdZoomOut style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={rotateLeft}>
          <MdRotateLeft style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn onClick={rotateRight} radiusRight>
          <MdRotateRight style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
      </Box>

      {/* Slideshow / trash */}
      <Box style={{ flexDirection: 'row', gap: 2 }}>
        <Btn onClick={slideshow} radiusLeft>
          <MdSlideshow style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
        </Btn>
        <Btn
          onClick={armTrash}
          color={confirmTrash ? '#7f1d1d' : undefined}
          activeColor={confirmTrash ? '#991b1b' : undefined}
          radiusRight
        >
          {confirmTrash ? (
            <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <MdCheck style={{ width: 24, height: 24 }} fill="#fff" stroke="none" />
              <Text color="#fff" fontSize={14} fontFamily="IosevkaTerm Nerd Font">TRASH?</Text>
            </Box>
          ) : (
            <MdDelete style={{ width: ICON_SZ, height: ICON_SZ }} fill={TRASH_CLR} stroke="none" />
          )}
        </Btn>
      </Box>

      {/* Status: current filename */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
        <Text color={DIM} fontSize={12} fontFamily="IosevkaTerm Nerd Font">
          {filename || '…'}
        </Text>
      </Box>
    </Box>
  );
}
