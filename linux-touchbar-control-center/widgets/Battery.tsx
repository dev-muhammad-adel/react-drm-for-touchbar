import React from 'react';
import { Box, Text } from 'react-drm';
import {
  MdBatteryChargingFull, MdBatteryAlert, MdBatteryUnknown,
  MdBattery0Bar, MdBattery1Bar, MdBattery2Bar, MdBattery3Bar,
  MdBattery4Bar, MdBattery5Bar, MdBattery6Bar,
} from 'react-icons/md';
import { useBattery, batteryColor } from '@/lib/hooks/useBattery';

const BARS = [MdBattery0Bar, MdBattery1Bar, MdBattery2Bar, MdBattery3Bar, MdBattery4Bar, MdBattery5Bar, MdBattery6Bar];

export function Battery() {
  const bat = useBattery();

  if (!bat) {
    return (
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Box style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
          <MdBatteryUnknown style={{ width: 18, height: 18 }} fill="#64748b" stroke="none" />
        </Box>
        <Text style={{ color: '#64748b', fontSize: 14, fontWeight: '600' }}>--%</Text>
      </Box>
    );
  }

  const color = batteryColor(bat);
  const Icon = bat.state === 'Charging' ? MdBatteryChargingFull
    : bat.pct <= 10 ? MdBatteryAlert
    : BARS[Math.round((bat.pct / 100) * 6)];

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Box style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
        <Icon style={{ width: 18, height: 18 }} fill={color} stroke="none" />
      </Box>
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{`${bat.pct}%`}</Text>
    </Box>
  );
}
