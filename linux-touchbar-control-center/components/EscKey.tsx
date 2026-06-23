import React from 'react';
import { Box, Text, Button, KEY } from 'react-drm';
import { keys } from '../services/keyInjector';

/**
 * On-screen Esc key for wide Touch Bars that have no physical Esc.
 * Injects KEY.ESC through the shared KeyInjector, like the Fn-key row.
 */
export function EscKey({ width, height }: { width: number; height: number }) {
  return (
    <Box style={{ width,backgroundColor: '#000' }}>
      <Button
        color="#444444"
        activeColor="#555555"
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          borderTopLeftRadius:     10,
          borderBottomLeftRadius:  10,
          borderTopRightRadius:    10,
          borderBottomRightRadius: 10,
        }}
        onClick={() => keys.pressKey(KEY.ESC)}
      >
        <Text  fontSize={22} fontFamily="monospace" style={{ fontWeight: '700' }}>esc</Text>
      </Button>
    </Box>
  );
}
