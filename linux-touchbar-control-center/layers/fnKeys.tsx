import React from 'react';
import { Box, Text, Button } from 'react-drm';
import { BackButton } from '../components/BackButton';
import { keys } from '../services/keyInjector';

const KEYS = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'] as const;

export function FnKeys({ width, height }: { width: number; height: number }) {
  return (
    <Box style={{ flex: 1, alignItems: 'stretch', gap: 6, paddingHorizontal: 8 }}>

      {/* <BackButton /> */}

      {KEYS.map((key, i) => (
        <Button
          key={key}
          color="#4f4b4f"
          activeColor="#666666"
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            borderTopLeftRadius:     10,
            borderBottomLeftRadius:  10,
            borderTopRightRadius:    10,
            borderBottomRightRadius: 10,
          }}
          onClick={() => keys.pressF((i + 1) as 1|2|3|4|5|6|7|8|9|10|11|12)}
        >
          <Text color="#94a3b8" fontSize={24} fontFamily="monospace" style={{ fontWeight: '700' }}>{key}</Text>
        </Button>
      ))}

    </Box>
  );
}
