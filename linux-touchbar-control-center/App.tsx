import React from 'react';
import { KeyboardContext } from 'react-drm';
import type { KeyboardReader } from 'react-drm';
import { RouteBranch } from '@/lib/routes/RouteBranch';

// Root of the app/ file-based route tree (react-drm's renderHot mounts this
// component directly — see index.tsx). app/layout.tsx owns everything that
// used to live here: boot sequence, SafeArea, the Esc-key inset.
//
// KeyboardContext is provided here, above everything, so any component can
// read it via useContext regardless of where in the tree it sits — notably
// app/layout.tsx's useLayerToggle calls, which listen for keys *before*
// they render the nested LayerHost that would otherwise be the nearest
// provider (context only flows to descendants, so a component can't read a
// provider it renders itself).
export function App({ width, height, keyboard }: { width: number; height: number; keyboard: KeyboardReader }) {
  return (
    <KeyboardContext.Provider value={keyboard}>
      <RouteBranch segments={[]} width={width} height={height} />
    </KeyboardContext.Provider>
  );
}
