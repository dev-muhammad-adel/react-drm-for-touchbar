import { useEffect } from 'react';
import { go } from '@/lib/routes/router-registry';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };

// Root's default child (this segment's own sibling page.tsx) redirects to
// splitted on mount — a one-frame flash of nothing at boot, accepted in
// exchange for not duplicating splitted's dashboard as root's own content.
export default function RootPage() {
  useEffect(() => { go('splitted'); }, []);
  return null;
}
