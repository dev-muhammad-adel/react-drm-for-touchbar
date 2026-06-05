import React, { createContext, useContext, useState } from 'react';

export interface Layer {
  name: string;
  component: React.ComponentType<{ width: number; height: number }>;
}

interface LayerCtx {
  current: string;
  /** Switch to a layer by name. */
  go: (name: string) => void;
  /** Cycle to the next layer. */
  next: () => void;
  /** Cycle to the previous layer. */
  prev: () => void;
}

const Ctx = createContext<LayerCtx>({
  current: '',
  go: () => {},
  next: () => {},
  prev: () => {},
});

/** Call from any layer component to read or change the active layer. */
export function useLayers(): LayerCtx {
  return useContext(Ctx);
}

export function LayerHost({
  layers,
  initial,
  width,
  height,
}: {
  layers: Layer[];
  initial?: string;
  width: number;
  height: number;
}) {
  const [idx, setIdx] = useState(() => {
    if (initial) {
      const i = layers.findIndex(l => l.name === initial);
      if (i >= 0) return i;
    }
    return 0;
  });

  const ctx: LayerCtx = {
    current: layers[idx]?.name ?? '',
    go:   (name) => { const i = layers.findIndex(l => l.name === name); if (i >= 0) setIdx(i); },
    next: () => setIdx(i => (i + 1) % layers.length),
    prev: () => setIdx(i => (i - 1 + layers.length) % layers.length),
  };

  const Active = layers[idx]?.component;
  if (!Active) return null;

  return (
    <Ctx.Provider value={ctx}>
      <Active width={width} height={height} />
    </Ctx.Provider>
  );
}
