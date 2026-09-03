import React from 'react';
import { Box, Text } from 'react-drm';
import { WiDaySunny, WiCloud, WiFog, WiRain, WiSnow, WiThunderstorm, WiNa } from 'react-icons/wi';
import { useWeather } from '@/lib/hooks/useWeather';

// WMO weather codes (what Open-Meteo's `current.weather_code` returns),
// collapsed down to the handful of icons worth distinguishing on a bar this
// small — see https://open-meteo.com/en/docs for the full table. Each
// condition gets its own accent color so the icon reads at a glance instead
// of everything blending into one flat gray.
function conditionFor(code: number): { Icon: typeof WiDaySunny; color: string } {
  if (code === 0) return { Icon: WiDaySunny, color: '#fbbf24' };
  if (code <= 3) return { Icon: WiCloud, color: '#94a3b8' };
  if (code === 45 || code === 48) return { Icon: WiFog, color: '#cbd5e1' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { Icon: WiRain, color: '#60a5fa' };
  if (code >= 71 && code <= 77) return { Icon: WiSnow, color: '#e0f2fe' };
  if (code >= 95) return { Icon: WiThunderstorm, color: '#a78bfa' };
  return { Icon: WiNa, color: '#64748b' };
}

export function Weather() {
  const weather = useWeather();
  const { Icon, color } = conditionFor(weather?.code ?? -1);

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Box style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <Icon style={{ width: 22, height: 22 }} fill={color} stroke="none" />
      </Box>
      <Text style={{ color: '#f1f5f9', fontSize: 15, fontWeight: '600' }}>
        {weather ? `${Math.round(weather.tempC)}°` : '--°'}
      </Text>
    </Box>
  );
}
