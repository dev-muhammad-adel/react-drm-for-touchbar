import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchRegistry } from '../../src/input/touch-registry';
import type { BoxNode, RootContainer } from '../../src/scene/types';

function box(style?: BoxNode['style'], children: BoxNode[] = []): BoxNode {
  return { type: 'box', color: '#000', children, style, x: 0, y: 0, width: 0, height: 0 };
}

test('absolute panel painted on top wins even when its layer mounted', () => {
  const layer = box(undefined);
  const panel = box({ position: 'absolute' });
  const root: RootContainer = { type: 'root', children: [layer, panel], width: 400, height: 40 };
  const registry = new TouchRegistry(() => root);
  const events: string[] = [];
  // Panel mounts FIRST, the media layer mounts LATER — but the panel is an
  // absolute child of a later sibling, so it paints ABOVE the layer.
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: panel,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('panel'),
  });
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: layer,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('layer'),
  });
  registry.touchStart(100, 95);
  assert.deepEqual(events, ['panel']);
});

test('later flow sibling paints above and wins the tap', () => {
  const a = box();
  const b = box();
  const root: RootContainer = { type: 'root', children: [a, b], width: 400, height: 40 };
  const registry = new TouchRegistry(() => root);
  const events: string[] = [];
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: a,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('a'),
  });
  // b registers first but is the last painted flow child -> it must win.
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: b,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('b'),
  });
  registry.touchStart(100, 95);
  assert.deepEqual(events, ['b']);
});

test('negative-z absolute paints below overlapping flow sibling inside a box', () => {
  const under = box({ position: 'absolute', zIndex: -1 });
  const above = box();
  // z-index semantics apply to a box's children (serialize groups them
  // absNeg → flow → absPos); root children are painted in plain tree order.
  const parent = box(undefined, [above, under]);
  const root: RootContainer = { type: 'root', children: [parent], width: 400, height: 40 };
  const registry = new TouchRegistry(() => root);
  const events: string[] = [];
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: under,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('under'),
  });
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: above,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('above'),
  });
  registry.touchStart(100, 95);
  assert.deepEqual(events, ['above']);
});

test('descendants paint above the node that contains them', () => {
  const child = box();
  const parent = box(undefined, [child]);
  const root: RootContainer = { type: 'root', children: [child, parent], width: 400, height: 40 };
  const registry = new TouchRegistry(() => root);
  const events: string[] = [];
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: child,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('child'),
  });
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: parent,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('parent'),
  });
  registry.touchStart(100, 95);
  assert.deepEqual(events, ['child']);
});

test('unmounted node no longer receives taps', () => {
  const a = box();
  const b = box();
  const root: RootContainer = { type: 'root', children: [a, b], width: 400, height: 40 };
  const registry = new TouchRegistry(() => root);
  const events: string[] = [];
  const keyA = Symbol();
  registry.registerGesture(keyA, {
    x: 0, y: 0, width: 0, height: 0, node: a,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('a'),
  });
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: b,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('b'),
  });
  registry.unregisterGesture(keyA);
  registry.touchStart(100, 95);
  assert.deepEqual(events, ['b']);
});

test('regions without a scene node are hit after the whole tree', () => {
  const layer = box();
  const root: RootContainer = { type: 'root', children: [layer], width: 400, height: 40 };
  const registry = new TouchRegistry(() => root);
  const events: string[] = [];
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0, node: layer,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('layer'),
  });
  registry.registerGesture(Symbol(), {
    x: 0, y: 0, width: 0, height: 0,
    getBounds: () => ({ x: 80, y: 80, width: 120, height: 40 }),
    onTouchStart: () => events.push('fixed'),
  });
  registry.touchStart(100, 95);
  assert.deepEqual(events, ['layer']);
});