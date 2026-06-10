import { createContext } from 'react';

/** Cumulative horizontal scroll offset from all ancestor overflow:scroll containers.
 *  Button reads this to return scroll-adjusted hit-test bounds. */
const _G = global as Record<string, unknown>;
const _K = '__react_drm_ScrollOffsetContext__';
if (!_G[_K]) _G[_K] = createContext(0);
export const ScrollOffsetContext = _G[_K] as import('react').Context<number>;
