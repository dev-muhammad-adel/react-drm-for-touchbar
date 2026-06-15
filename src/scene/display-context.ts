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


export interface NativeDraw { drawBars: (opts: import('../native/binding').BarsOpts) => void; }
const _K2 = '__react_drm_NativeDrawContext__';
if (!_G[_K2]) _G[_K2] = createContext<NativeDraw | null>(null);
export const NativeDrawContext = _G[_K2] as import('react').Context<NativeDraw | null>;
