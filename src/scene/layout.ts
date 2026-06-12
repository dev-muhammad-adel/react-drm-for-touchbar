import type { TextNode } from './types';

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Estimated pixel size of a text node, used by the layout engine
 * (src/scene/layout-yoga.ts). A per-family character-width heuristic — the
 * proper fix is native Pango metrics from the addon.
 */
export function measureText(tn: TextNode): { w: number; h: number } {
  const fontSize   = tn.style?.fontSize   ?? tn.fontSize;
  const fontFamily = tn.style?.fontFamily ?? tn.fontFamily;
  const charW = /iosevka/i.test(fontFamily ?? '') ? 0.58
              : /mono|courier|consolas|hack|fira code/i.test(fontFamily ?? '') ? 0.72
              : 0.63;
  return { w: Math.ceil(tn.text.length * fontSize * charW), h: Math.ceil(fontSize * 1.4) };
}
