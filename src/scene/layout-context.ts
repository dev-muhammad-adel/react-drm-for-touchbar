import { createContext } from 'react';
import type { SceneNode } from './types';
import type { LayoutBox } from './layout';

export interface LayoutRef {
  current: ReadonlyMap<SceneNode, LayoutBox>;
}

// Provided by renderer.ts and updated after every commit (before layout effects run).
export const LayoutContext = createContext<LayoutRef>({ current: new Map() });
