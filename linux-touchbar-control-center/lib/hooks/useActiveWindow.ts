import { useEffect, useState } from 'react';
import type { ActiveWindow } from '@/lib/activeWindow/types';
import { getActiveWindow, subscribeActiveWindow } from '@/lib/activeWindow/store';

export type { ActiveWindow };

/**
 * The compositor's focused window (title, class, pid). All consumers share
 * one backend connection (Hyprland socket, GNOME extension D-Bus, …) — see
 * linux-touchbar-control-center/lib/activeWindow/ for the backends and ACTIVE_WINDOW in config.ts.
 */
export function useActiveWindow(): ActiveWindow {
  const [win, setWin] = useState<ActiveWindow>(getActiveWindow);

  useEffect(() => subscribeActiveWindow(setWin), []);

  return win;
}
