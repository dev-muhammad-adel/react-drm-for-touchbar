import React from 'react';
import { LayerHost } from './layers';
import { SplittedLayer } from './splittedLayer';
import { Piano } from './piano';

export function App({ width, height }: { width: number; height: number }) {
  return (
    <LayerHost
      layers={[
        { name: 'splitted', component: SplittedLayer },
        // { name: 'piano',    component: Piano },
      ]}
      width={width}
      height={height}
    />
  );
}
