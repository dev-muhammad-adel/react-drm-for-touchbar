import React from 'react';
import { Box } from 'react-drm';
import { BackButton } from '../components/BackButton';
import { DinoGame } from '../others/dino';

const BACK_W = 60;

export function DinoLayer({ width, height }: { width: number; height: number }) {
  const gameW   = Math.floor(width / 2) - BACK_W;
  const centerX = BACK_W + Math.floor((width - BACK_W - gameW) / 2);
  return (
    <Box style={{ flex: 1, flexDirection: 'row' }}>
      <BackButton to="games" animation="slide-right" />
      <Box x={centerX} y={0} width={gameW} height={height}>
        <DinoGame width={gameW} height={height} />
      </Box>
    </Box>
  );
}
