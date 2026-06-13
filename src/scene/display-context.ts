import { createContext } from 'react';

export interface DisplaySize {
  width: number;
  height: number;
}

// Logical display size (post-rotation) of the DRM display the renderer opened.
// Defaults to the T2 Touch Bar's 2008×60 so hooks used outside a renderer still
// get a sane scale. The singleton survives hot-reload's require-cache clearing.
const _G = global as Record<string, unknown>;
const _K = '__react_drm_DisplaySizeContext__';
if (!_G[_K]) _G[_K] = createContext<DisplaySize>({ width: 2008, height: 60 });
// Provided by renderer.ts from the live DrmDisplay dimensions.
export const DisplaySizeContext = _G[_K] as import('react').Context<DisplaySize>;
