import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, Button } from 'react-drm';
import { MdBrightness4, MdBrightness6, MdBrightness7, MdKeyboard } from 'react-icons/md';
import { BackButton } from '@/components/BackButton';
import { SliderTrack } from '@/components/SliderTrack';
import { useLayers } from './index';
import { useDisplayBrightnessControl, readBrightness, DISPLAY_DEVICE, KEYBOARD_DEVICE } from '@/lib/hooks/useBrightness';
import { applyBrightness } from '@/lib/services/brightness';

const AUTO_HIDE_MS = 5000;
const TRACK_W = 700;

interface BrightnessControlProps {
  value: number;
  icon: React.ReactNode;
  height: number;
  dragRef: React.MutableRefObject<{ x: number; v: number } | null>;
  onChange: (value: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

function BrightnessControl({
  value,
  icon,
  height,
  dragRef,
  onChange,
  onInteractionStart,
  onInteractionEnd,
}: BrightnessControlProps) {
  function clamp(v: number) { return Math.max(0, Math.min(1, v)); }

  function onMove(x: number) {
    if (!dragRef.current) return;
    const next = clamp(dragRef.current.v + (x - dragRef.current.x) / TRACK_W);
    onChange(next);
    dragRef.current = { x, v: next };
  }

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Button
        width={TRACK_W}
        height={height}
        color="transparent"
        activeColor="transparent"
        style={{ justifyContent: 'center', alignItems: 'center' }}
        onTouchStart={(x) => {
          onInteractionStart();
          dragRef.current = { x, v: value };
        }}
        onTouchMove={onMove}
        onTouchEnd={() => {
          dragRef.current = null;
          onInteractionEnd();
        }}
      >
        <SliderTrack fill={value} width={TRACK_W} icon={icon} />
      </Button>

      <Text style={{ width: 52, fontSize: 18, color: '#94a3b8', fontFamily: 'IosevkaTerm Nerd Font' }}>
        {`${Math.round(value * 100)}%`}
      </Text>
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BrightnessSliderLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers();
  const { brightness: displayBrightness, setBrightness: updateDisplay, syncBrightness } = useDisplayBrightnessControl();
  const [keyboardBrightness, setKeyboardBrightness] = useState(() => readBrightness(KEYBOARD_DEVICE));
  const displayDrag = useRef<{ x: number; v: number } | null>(null);
  const keyboardDrag = useRef<{ x: number; v: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHideTimer() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      displayDrag.current = null;
      keyboardDrag.current = null;
      go('splitted', 'slide-down');
    }, AUTO_HIDE_MS);
  }

  // Reset the inactivity countdown on every display-brightness change — covers
  // both a drag on this layer's own track and one still being driven by the
  // splitted layer's brightness button (long-press-and-drag), which never
  // touches this track directly so onInteractionStart/End below never fire.
  useEffect(() => {
    scheduleHide();
  }, [displayBrightness]);

  useEffect(() => {
    scheduleHide();
    const id = setInterval(() => {
      if (!displayDrag.current) {
        const current = readBrightness(DISPLAY_DEVICE);
        syncBrightness(previous => Math.abs(previous - current) > 0.01 ? current : previous);
      }
      if (!keyboardDrag.current) {
        const current = readBrightness(KEYBOARD_DEVICE);
        setKeyboardBrightness(previous => Math.abs(previous - current) > 0.01 ? current : previous);
      }
    }, 500);
    return () => {
      clearHideTimer();
      clearInterval(id);
    };
  }, []);

  function updateKeyboard(value: number) {
    setKeyboardBrightness(value);
    applyBrightness(KEYBOARD_DEVICE, value, 0);
  }

  const DisplayIcon = displayBrightness < 0.3
    ? MdBrightness4
    : displayBrightness < 0.7
      ? MdBrightness6
      : MdBrightness7;

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      <BackButton to="splitted" animation="slide-down" />
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <BrightnessControl
          value={keyboardBrightness}
          icon={<MdKeyboard style={{ width: 18, height: 18 }} fill="#f5f5f7" stroke="none" />}
          height={height}
          dragRef={keyboardDrag}
          onChange={updateKeyboard}
          onInteractionStart={clearHideTimer}
          onInteractionEnd={scheduleHide}
        />
        <BrightnessControl
          value={displayBrightness}
          icon={<DisplayIcon style={{ width: 18, height: 18 }} fill="#f5f5f7" stroke="none" />}
          height={height}
          dragRef={displayDrag}
          onChange={updateDisplay}
          onInteractionStart={clearHideTimer}
          onInteractionEnd={scheduleHide}
        />
      </Box>
    </Box>
  );
}
