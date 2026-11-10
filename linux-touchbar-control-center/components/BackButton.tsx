import React from 'react';
import { Button } from 'react-drm';
import { MdCancel } from 'react-icons/md';
import { useLayers } from '@/layers';
import type { LayerAnimation, SwitchOptions } from '@/layers';

export function BackButton({
  to = 'splitted',
  animation,
  switchOptions,
  size = 48,
}: {
  to?: string;
  animation?: LayerAnimation;
  switchOptions?: SwitchOptions;
  /** Glyph size — the dock passes its icon size; the default matches it, so
   * the close circle is equally tall on every layer. */
  size?: number;
}) {
  const { go } = useLayers();
  return (
    <Button
      width={60} height={60}
      color="#000" activeColor="#000"
      style={{ alignItems: 'center', justifyContent: 'center' }}
      onClick={() => go(to, switchOptions ?? animation)}
    >
      <MdCancel style={{ width: size, height: size }} fill="#cccccc" stroke="none" />
    </Button>
  );
}
