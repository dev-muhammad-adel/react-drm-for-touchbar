import { useEffect, useState } from 'react';
import { loadLayout, type LoadedLayout } from '@/lib/routes/loadRoutes';

/** A segment's own layout.tsx. `undefined` while loading, `null` if the
 *  segment is a leaf with no layout.tsx of its own. */
export function useAppLayout(...segments: string[]): LoadedLayout | null | undefined {
  const [layout, setLayout] = useState<LoadedLayout | null | undefined>(undefined);
  const key = segments.join('/');

  useEffect(() => {
    let cancelled = false;
    setLayout(undefined);
    loadLayout(...segments).then(l => { if (!cancelled) setLayout(l); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return layout;
}
