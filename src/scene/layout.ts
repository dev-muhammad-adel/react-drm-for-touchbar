import type { TextNode } from './types';
import { loadAddon } from '../native/load-addon';

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MeasureAddon {
  measureText(text: string, family: string, size: number, bold: boolean, italic: boolean): { width: number; height: number };
}

let _addon: MeasureAddon | null = null;
function nativeMeasure(): MeasureAddon | null {
  if (_addon) return _addon;
  try { _addon = loadAddon() as MeasureAddon; } catch { _addon = null; }
  return _addon;
}

// Yoga re-measures every text node on each layout pass; cache by the exact
// inputs that affect width so the native Pango call runs once per unique line.
const _cache = new Map<string, { w: number; h: number }>();

function heuristicWidth(text: string, fontSize: number, fontFamily: string): number {
  const charW = /iosevka/i.test(fontFamily) ? 0.58
              : /mono|courier|consolas|hack|fira code/i.test(fontFamily) ? 0.72
              : 0.63;
  return Math.ceil(text.length * fontSize * charW);
}

/**
 * Pixel size of a text node for the layout engine. Width comes from native Pango
 * metrics (the same shaping the renderer uses) so the box matches the rasterized
 * glyphs; the old per-char heuristic under-measured proportional/shaped text and
 * caused overlaps. Falls back to the heuristic if the addon can't be loaded.
 */
export function measureText(tn: TextNode): { w: number; h: number } {
  const fontSize   = tn.style?.fontSize   ?? tn.fontSize;
  const fontFamily = tn.style?.fontFamily ?? tn.fontFamily ?? '';
  const fw     = tn.style?.fontWeight;
  const bold   = fw === 'bold' || (fw !== undefined && parseInt(fw, 10) >= 700);
  const italic = tn.style?.fontStyle === 'italic';

  const key = `${fontSize}|${bold ? 1 : 0}${italic ? 1 : 0}|${fontFamily}\x1f${tn.text}`;
  const hit = _cache.get(key);
  if (hit) return hit;

  // Height stays at the established line box (~1.4× font size) — the renderer
  // centers the glyph ink within it; only width moves to real metrics here.
  const h = Math.ceil(fontSize * 1.4);
  let w: number;

  const addon = nativeMeasure();
  if (addon) {
    try { w = Math.ceil(addon.measureText(tn.text, fontFamily, fontSize, bold, italic).width); }
    catch { w = heuristicWidth(tn.text, fontSize, fontFamily); }
  } else {
    w = heuristicWidth(tn.text, fontSize, fontFamily);
  }

  const result = { w, h };
  if (_cache.size > 2000) _cache.clear();
  _cache.set(key, result);
  return result;
}
