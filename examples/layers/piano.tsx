import React from 'react';
import { Box } from 'react-drm';
import { BackButton } from '../components/BackButton';
import { Piano } from '../others/piano';

const BACK_W = 60;

export function PianoLayer({ width, height }: { width: number; height: number }) {
  return (
    <Box style={{ flex: 1, flexDirection: 'row' }}>
      <BackButton to="games" animation="slide-right" />
      <Piano width={width - BACK_W} height={height} />
    </Box>
  );
}
