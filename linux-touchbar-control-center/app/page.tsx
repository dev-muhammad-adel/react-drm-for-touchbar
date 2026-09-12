// The root's default layer — renders nothing; system lock → lock-layer
// navigation now lives in lib/hooks/useSystemLockNavigation (started from the
// root layout, which survives navigation).
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };

export default function RootPage() {
  return null;
}