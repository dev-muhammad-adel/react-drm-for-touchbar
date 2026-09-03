import { useEffect } from 'react';
import { go } from '@/lib/routes/router-registry';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };

// Root's default child (this segment's own sibling page.tsx) redirects to
// splitted on mount — a one-frame flash of nothing at boot, accepted in
// exchange for not duplicating splitted's dashboard as root's own content.
// INITIAL_ROUTE overrides the target for dev/testing (e.g. jumping straight
// to the Custom Layer or launcher prototype) — unset in normal operation, so
// this is a no-op then and behavior is unchanged.
export default function RootPage() {
  useEffect(() => { go(process.env.INITIAL_ROUTE || 'splitted'); }, []);
  return null;
}
