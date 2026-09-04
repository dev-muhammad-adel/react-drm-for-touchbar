/**
 * CSS-like style inheritance pass for react-drm.
 *
 * Walks the scene tree top-down and stamps `_inherited` on each TextNode
 * so that measureText and serialize can resolve the effective fontFamily,
 * fontSize, and text color without each doing an ancestor walk.
 *
 * Inherited properties (matching CSS):
 *  - font-family  (falls back to 'sans-serif' at root)
 *  - font-size    (falls back to 16 at root)
 *  - color        (text color only; Box.color is background, NOT inherited)
 *
 * A Box's `style.fontFamily`, `style.fontSize`, and `style.color` (text
 * color, distinct from the Box `color` prop which is background) establish
 * an inherited value for descendants.  A child Text that explicitly sets
 * its own value wins; otherwise it receives the nearest ancestor's value.
 */

import type { SceneNode, BoxNode, TextNode, SvgContainerNode, RootContainer } from './types';

interface Inherited {
  fontFamily: string;
  fontSize: number;
  color: string;
}

const ROOT_INHERITED: Inherited = {
  fontFamily: 'sans-serif',
  fontSize: 16,
  color: 'white',
};

export function resolveInheritance(root: SceneNode | RootContainer): void {
  walk(root, ROOT_INHERITED);
}

function walk(node: SceneNode | RootContainer, inh: Inherited): void {
  if (node.type === 'text') {
    const tn = node as TextNode;
    // Text node resolves: own style > own prop > inherited.
    // Box.color is background, not inherited — only style.color (text color).
    tn._inherited = {
      fontFamily: tn.style?.fontFamily || tn.fontFamily || inh.fontFamily,
      fontSize:   tn.style?.fontSize   || tn.fontSize   || inh.fontSize,
      color:      tn.style?.color      ?? inh.color,
    };
    return;
  }

  // Non-text nodes (box, svg, gif): merge inherited values from this
  // node's style, then recurse into children.
  const next = { ...inh };
  let s: import('./style').Style | undefined;

  if (node.type === 'box') {
    s = (node as BoxNode).style;
  } else if (node.type === 'svg') {
    s = (node as SvgContainerNode).style;
  }

  if (s) {
    if (s.fontFamily !== undefined) next.fontFamily = s.fontFamily;
    if (s.fontSize   !== undefined) next.fontSize   = s.fontSize;
    // style.color = text color (background is node.color / Box.color prop).
    if (s.color      !== undefined) next.color      = s.color;
  }

  const children = (node as BoxNode | SvgContainerNode).children;
  if (children) {
    for (const child of children) {
      walk(child, next);
    }
  }
}
