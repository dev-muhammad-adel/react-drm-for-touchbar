import React, { useContext, useMemo } from 'react';
import { Box, Text, Button, FKEY_CODES, KEY, DisplaySizeContext } from 'react-drm';
import { BackButton } from '@/components/BackButton';
import { keys } from '@/lib/services/keyInjector';
import { createHeldKeyHandlers } from '@/lib/services/heldKey';
import { ESC_KEY, FN_KEYS } from '@/lib/utils/configLoader';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = {
  leaving:  { outAnim: 'fade', duration: 0 },
  entering: { inAnim:  'fade', duration: 0 },
};

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

function HeldKey({ label, keyCode }: { label: string; keyCode: number }) {
  const handlers = useMemo(() => createHeldKeyHandlers(keys, keyCode), [keyCode]);

  return (
    <Button
      color="#373737"
      activeColor="#474747"
      style={keyStyle}
      {...handlers}
    >
      <Text fontSize={24} style={{ fontWeight: '700' }}>{label}</Text>
    </Button>
  );
}

export default function FnKeys({ width, height }: { width: number; height: number }) {
  // On wide displays without a physical Esc key, 'fn' mode adds Esc as the
  // first key in this row (sized like the F-keys). Uses the auto-detected
  // display width so the threshold matches App's 'all'-mode check.
  const { width: displayWidth } = useContext(DisplaySizeContext);
  const showEsc = displayWidth >= ESC_KEY.minWidth && ESC_KEY.onLayers === 'fn';

  return (
    <Box style={{ flex: 1, alignItems: 'stretch', gap: 6, paddingHorizontal: 8 , backgroundColor: '#000' }}>

      {/* <BackButton /> */}

      {showEsc && (
        <HeldKey
          key="esc"
          label="esc"
          keyCode={KEY.ESC}
        />
      )}

      {KEYS.map((key, i) => (
        <HeldKey
          key={key}
          label={key}
          keyCode={FKEY_CODES[i]}
        />
      ))}

      {FN_KEYS.extra.map(k => (
        <HeldKey
          key={k.label}
          label={k.label}
          keyCode={k.key}
        />
      ))}

    </Box>
  );
}
