import React from 'react';
import { Button } from 'react-drm';
import { MdCancel } from 'react-icons/md';
import { useLayers } from '../layers';
import type { LayerAnimation, SwitchOptions } from '../layers';

export function BackButton({
  to = 'splitted',
  animation,
  switchOptions,
}: {
  to?: string;
  animation?: LayerAnimation;
  switchOptions?: SwitchOptions;
}) {
  const { go } = useLayers();
  return (
    <Button
      width={60} height={60}
      color="#000" activeColor="#000"
      style={{ alignItems: 'center', justifyContent: 'center' }}
      onClick={() => go(to, switchOptions ?? animation)}
    >
      <MdCancel style={{ width: 40, height: 40 }} fill="#cccccc" stroke="none" />
    </Button>
  );
}
