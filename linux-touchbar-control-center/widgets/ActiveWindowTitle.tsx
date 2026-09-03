import React from 'react';
import { Text } from 'react-drm';
import { useActiveWindow } from '@/lib/hooks/useActiveWindow';

/**
 * Custom Layer's Active Window widget — shows the focused window's title
 * (falls back to its class, then a dash when nothing is focused). Shares
 * the single compositor connection via useActiveWindow(); see lib/activeWindow/
 * and ACTIVE_WINDOW in config.ts.
 */
export function ActiveWindowTitle() {
  const { title, class: windowClass } = useActiveWindow();
  const label = title || windowClass || '—';

  return (
    <Text style={{ color: '#e5e7eb', fontSize: 13 }}>
      {label}
    </Text>
  );
}
