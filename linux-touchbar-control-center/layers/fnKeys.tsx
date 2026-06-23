import React, { useContext } from 'react';
import { Box, Text, Button, KEY, DisplaySizeContext } from 'react-drm';
import { BackButton } from '../components/BackButton';
import { keys } from '../services/keyInjector';
import { ESC_KEY } from '../config';

const KEYS = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'] as const;

const keyStyle = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  borderTopLeftRadius:     10,
  borderBottomLeftRadius:  10,
  borderTopRightRadius:    10,
  borderBottomRightRadius: 10,
} as const;

export function FnKeys({ width, height }: { width: number; height: number }) {
  // On wide displays without a physical Esc key, 'fn' mode adds Esc as the
  // first key in this row (sized like the F-keys). Uses the auto-detected
  // display width so the threshold matches App's 'all'-mode check.
  const { width: displayWidth } = useContext(DisplaySizeContext);
  const showEsc = displayWidth >= ESC_KEY.minWidth && ESC_KEY.onLayers === 'fn';

  return (
    <Box style={{ flex: 1, alignItems: 'stretch', gap: 6, paddingHorizontal: 8 , backgroundColor: '#000' }}>

      {/* <BackButton /> */}

      {showEsc && (
        <Button
          key="esc"
          color="#444444"
          activeColor="#555555"
          style={keyStyle}
          onClick={() => keys.pressKey(KEY.ESC)}
        >
          <Text  fontSize={24} fontFamily="monospace" style={{ fontWeight: '700' }}>esc</Text>
        </Button>
      )}

      {KEYS.map((key, i) => (
        <Button
          key={key}
          color="#444444"
          activeColor="#555555"
          style={keyStyle}
          onClick={() => keys.pressF((i + 1) as 1|2|3|4|5|6|7|8|9|10|11|12)}
        >
          <Text  fontSize={24} fontFamily="monospace" style={{ fontWeight: '700' }}>{key}</Text>
        </Button>
      ))}

    </Box>
  );
}
