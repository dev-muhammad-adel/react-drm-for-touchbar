import { useEffect, useState } from 'react';
import dbus from 'dbus-next';

// Same /sys/class/power_supply reads as app/systembar/page.tsx's readBattery,
// polled instead of read once — battery state changes slowly, so a long
// interval is enough.

const STATE_MAP = {
  1: 'Charging',
  2: 'Discharging',
  3: 'Discharging',
  4: 'Full',
  5: 'Charging',
  6: 'Discharging',
} as const;

export type BatteryState = (typeof STATE_MAP)[keyof typeof STATE_MAP] | 'Unknown';
export interface BatteryInfo { pct: number; state: BatteryState; }

function parseBatteryState(stateNum: any): BatteryState {
  return (typeof stateNum === 'number' && stateNum in STATE_MAP)
    ? STATE_MAP[stateNum as keyof typeof STATE_MAP]
    : 'Unknown';
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

/** Battery %/state via UPower DBus, or null if there's no battery (desktop machines). */
export function useBattery(): BatteryInfo | null {
  const [bat, setBat] = useState<BatteryInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    let bus: any = null;
    let timerId: NodeJS.Timeout | null = null;

    async function setup() {
      try {
        bus = dbus.systemBus();
        const upowerObj = await bus.getProxyObject('org.freedesktop.UPower', '/org/freedesktop/UPower');
        const upower = upowerObj.getInterface('org.freedesktop.UPower');
        const devices: string[] = await (upower as any).EnumerateDevices();

        let targetProps: any = null;

        for (const devPath of devices) {
          try {
            const devObj = await bus.getProxyObject('org.freedesktop.UPower', devPath);
            const props = devObj.getInterface('org.freedesktop.DBus.Properties');
            const all = await (props as any).GetAll('org.freedesktop.UPower.Device');
            const type = all.Type?.value;
            if (type !== 2) continue; // Not a battery

            const isPowerSupply = all.PowerSupply?.value ?? false;
            const pct = Math.round(all.Percentage?.value ?? 0);
            const state = parseBatteryState(all.State?.value);

            if (isPowerSupply) {
              targetProps = props;
              if (mounted) setBat({ pct, state });
              break;
            } else if (!targetProps) {
              targetProps = props;
              if (mounted) setBat({ pct, state });
            }
          } catch { /**/ }
        }

        if (!targetProps) return;

        // Listen for property changes on the battery device
        targetProps.on('PropertiesChanged', (_iface: string, changed: Record<string, any>) => {
          if (!mounted) return;
          setBat(prev => {
            const newPct = changed.Percentage !== undefined ? Math.round(changed.Percentage.value) : prev?.pct ?? 0;
            const newState = changed.State !== undefined ? parseBatteryState(changed.State.value) : prev?.state ?? 'Unknown';
            return { pct: newPct, state: newState };
          });
        });

        // Periodic poll as safety fallback
        const poll = async () => {
          if (!mounted || !targetProps) return;
          try {
            const all = await (targetProps as any).GetAll('org.freedesktop.UPower.Device');
            const pct = Math.round(all.Percentage?.value ?? 0);
            const state = parseBatteryState(all.State?.value);
            if (mounted) setBat({ pct, state });
          } catch { /**/ }
        };

        timerId = setInterval(poll, POLL_MS);
      } catch (err) {
        console.error('Failed to initialize UPower DBus listener:', err);
      }
    }

    setup();

    return () => {
      mounted = false;
      if (timerId) clearInterval(timerId);
      if (bus) {
        try {
          bus.disconnect();
        } catch { /**/ }
      }
    };
  }, []);

  return bat;
}
