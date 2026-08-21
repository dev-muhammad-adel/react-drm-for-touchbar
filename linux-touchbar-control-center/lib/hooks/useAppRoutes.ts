import { useEffect, useState } from 'react';
import { loadRouteChildren, type RouteChild } from '@/lib/routes/loadRoutes';

/** Children for one app/ route segment, discovered from its subfolders. `null`
 *  until the (near-instant, local-disk) scan resolves. */
export function useAppRoutes(...segments: string[]): RouteChild[] | null {
  const [children, setChildren] = useState<RouteChild[] | null>(null);
  const key = segments.join('/');

  useEffect(() => {
    let cancelled = false;
    loadRouteChildren(...segments).then(c => { if (!cancelled) setChildren(c); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return children;
}
