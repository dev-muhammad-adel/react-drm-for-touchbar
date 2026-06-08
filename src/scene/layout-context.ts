import { createContext } from 'react';
import type { SceneNode } from './types';
import type { LayoutBox } from './layout';

export interface LayoutRef {
  current: ReadonlyMap<SceneNode, LayoutBox>;
}

const _G = global as Record<string, unknown>;
const _K = '__react_drm_LayoutContext__';
if (!_G[_K]) _G[_K] = createContext<LayoutRef>({ current: new Map() });
// Provided by renderer.ts and updated after every commit (before layout effects run).
export const LayoutContext = _G[_K] as import('react').Context<LayoutRef>;
