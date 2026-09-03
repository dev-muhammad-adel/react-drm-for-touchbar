import React from 'react';
import { Box, Text } from 'react-drm';
import { MdMemory } from 'react-icons/md';
import { useCpuUsage } from '@/lib/hooks/useCpuUsage';

function colorFor(pct: number): string {
  if (pct >= 85) return '#ef4444';
  if (pct >= 60) return '#fde047';
  return '#e5e7eb';
}

export function Cpu() {
  const pct = useCpuUsage();
  const color = pct === null ? '#64748b' : colorFor(pct);

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Box style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
        <MdMemory style={{ width: 18, height: 18 }} fill={color} stroke="none" />
      </Box>
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>
        {pct === null ? '--%' : `${pct}%`}
      </Text>
    </Box>
  );
}
