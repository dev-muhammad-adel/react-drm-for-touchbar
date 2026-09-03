import React from 'react';
import { Button } from 'react-drm';
import { MdMic, MdMicOff } from 'react-icons/md';
import { useMicMute } from '@/lib/hooks/useMicMute';

/**
 * The one widget here that's a control, not just a readout — tap to toggle.
 * A nested Button, same as the earlier per-widget remove/exit controls —
 * the outer DraggableWidget Button has no onClick of its own, so this tap
 * is captured cleanly regardless of edit mode. Transparent fill so it reads
 * as a plain icon rather than a button-within-a-button.
 */
export function MicMute() {
  const { muted, toggle } = useMicMute();
  const color = muted ? '#ef4444' : '#4ade80';
  const Icon = muted ? MdMicOff : MdMic;

  return (
    <Button
      width={26} height={26} color="#00000000" activeColor="#00000000"
      style={{ alignItems: 'center', justifyContent: 'center' }}
      onClick={toggle}
    >
      <Icon style={{ width: 20, height: 20 }} fill={color} stroke="none" />
    </Button>
  );
}
