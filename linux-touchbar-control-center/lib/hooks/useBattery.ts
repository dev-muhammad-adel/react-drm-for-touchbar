import { useEffect, useState } from 'react';
import { readFileSync } from 'fs';

// Same /sys/class/power_supply reads as app/systembar/page.tsx's readBattery,
// polled instead of read once — battery state changes slowly, so a long
// interval is enough.

export type BatteryState = 'Charging' | 'Discharging' | 'Full' | 'Unknown';
export interface BatteryInfo { pct: number; state: BatteryState; }

function parseState(raw: string): BatteryState {
  if (raw === 'Charging') return 'Charging';
  if (raw === 'Discharging') return 'Discharging';
  if (raw === 'Full') return 'Full';
  return 'Unknown';
}

function readBattery(): BatteryInfo | null {
  for (const b of ['/sys/class/power_supply/BAT0', '/sys/class/power_supply/BAT1']) {
    try {
      const pct = parseInt(readFileSync(`${b}/capacity`, 'utf8').trim());
      const state = parseState(readFileSync(`${b}/status`, 'utf8').trim());
      return { pct, state };
    } catch { /* try next */ }
  }
  return null;
}

export function batteryColor(bat: BatteryInfo): string {
  if (bat.state === 'Charging') return '#4ade80';
  if (bat.state === 'Full') return '#34d399';
  if (bat.pct <= 10) return '#ef4444';
  if (bat.pct <= 25) return '#f87171';
  if (bat.pct <= 50) return '#fde047';
  return '#e5e7eb';
}

const POLL_MS = 30_000;

/** Battery %/state, or null if there's no battery (desktop machines). */
export function useBattery(): BatteryInfo | null {
  const [bat, setBat] = useState<BatteryInfo | null>(() => readBattery());

  useEffect(() => {
    const id = setInterval(() => setBat(readBattery()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return bat;
}
