import React from 'react';
import { Box, Text, Button } from 'react-drm';
import { useLayers } from '..';
import { useActiveWindow } from '../../hooks/useActiveWindow';

export function VlcPanel({ width, height }: { width: number; height: number }) {
  const { next } = useLayers();
  const { title } = useActiveWindow();

  return (
    <Button
      width={width}
      height={height}
      color="transparent"
      activeColor="transparent"
      onClick={next}
    >
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, gap: 10 }}>
        <Box style={{ width: 3, height: 34, borderRadius: 2, backgroundColor: '#fb923c' }} />
        <Box style={{ flexDirection: 'column', gap: 2, alignSelf: 'center', height: 37 }}>
          <Text color="#fb923c" fontSize={10} fontFamily="IosevkaTerm Nerd Font">
            VLC
          </Text>
          <Text color="#e2e8f0" fontSize={15} fontFamily="IosevkaTerm Nerd Font">
            {title || 'VLC media player'}
          </Text>
          <Text color="#94a3b8" fontSize={11} fontFamily="IosevkaTerm Nerd Font">
            Focused media player
          </Text>
        </Box>
      </Box>
    </Button>
  );
}
