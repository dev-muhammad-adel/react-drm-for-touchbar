import React from 'react';
import { Box } from 'react-drm';
import { Loader } from './Loader';

interface BootScreenProps {
  width: number;
  height: number;
  opacity: number;
}

export function BootScreen({ width, height, opacity }: BootScreenProps) {
  return (
    <Box width={width} height={height} style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <Loader width={120} height={height} />
    </Box>
  );
}
