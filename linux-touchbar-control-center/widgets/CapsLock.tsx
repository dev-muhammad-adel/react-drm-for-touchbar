import React from 'react';
import { Box, Text } from 'react-drm';
import { MdKeyboardCapslock } from 'react-icons/md';
import { useCapsLock } from '@/lib/hooks/useCapsLock';

export function CapsLock() {
  const on = useCapsLock();
  const color = on ? '#fde047' : '#64748b';

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Box style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
        <MdKeyboardCapslock style={{ width: 18, height: 18 }} fill={color} stroke="none" />
      </Box>
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{on ? 'ON' : 'OFF'}</Text>
    </Box>
  );
}
