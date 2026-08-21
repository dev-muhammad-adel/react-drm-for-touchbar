import React, { useEffect, useMemo, useState } from 'react';
import type { Layer } from 'react-drm';
import { LayerHost, type LayerHostHandle } from '@/layers';
import { useAppRoutes } from '@/lib/hooks/useAppRoutes';
import { useAppLayout } from '@/lib/hooks/useAppLayout';
import { registerRouter } from '@/lib/routes/router-registry';
import type { RouteChild } from '@/lib/routes/loadRoutes';

/**
 * Renders one app/ route segment: its own layout.tsx (if any) wrapping a
 * LayerHost switching between its children, where each branch child (a
 * folder with its own layout.tsx) recurses into another RouteBranch instead
 * of being rendered as a plain leaf component. Keyboard access comes from
 * KeyboardContext (provided once at the true root in App.tsx) rather than a
 * prop threaded through every level — LayerHost already falls back to it.
 * This branch's own nested host is registered into router-registry.ts under
 * its path, so anything anywhere can drive it via go(path) — a layout.tsx
 * never needs its own ref/prop/context plumbing to reach it.
 */
export function RouteBranch({ segments, width, height }: {
  segments: string[];
  width:    number;
  height:   number;
}) {
  const rawChildren = useAppRoutes(...segments);
  const layout       = useAppLayout(...segments);
  const path = segments.join('/');

  // Captured from the LayerHost `renderHost` builds below — it only exists as
  // a descendant of the Layout we're about to render (below), so a ref is the
  // only way to reach it in the first place; registerRouter below is what
  // makes it reachable from anywhere else.
  const [router, setRouter] = useState<LayerHostHandle | null>(null);

  useEffect(() => {
    registerRouter(path, router);
    return () => registerRouter(path, null);
  }, [path, router]);

  // Memoized so its identity only changes when the actual route list changes
  // — LayerHost's own ctx memo (layers/index.tsx) is keyed on this reference,
  // and a fresh array every render here would defeat that, re-triggering the
  // ref callback below on every render and looping.
  const layers: Layer[] = useMemo(() => (rawChildren ?? []).map((c: RouteChild) => c.isBranch
    ? {
        name: c.name,
        component: ({ width: w, height: h }: { width: number; height: number }) => (
          <RouteBranch segments={[...segments, c.name]} width={w} height={h} />
        ),
        ...c.config,
      }
    : { name: c.name, component: c.component!, ...c.config }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawChildren]);

  if (rawChildren === null || layout === undefined) return null; // still loading

  const renderHost = (w: number, h: number) => (
    <LayerHost
      ref={inst => { if (inst && inst !== router) setRouter(inst); }}
      layers={layers}
      width={w} height={h}
    />
  );

  if (!layout) return renderHost(width, height);

  const Layout = layout.component;
  return <Layout width={width} height={height} path={path}>{renderHost}</Layout>;
}
