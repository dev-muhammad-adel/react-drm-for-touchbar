import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeldKeyHandlers } from '../lib/services/heldKey';

function setup() {
  const events: string[] = [];
  const handlers = createHeldKeyHandlers({
    keyDown: code => events.push(`down:${code}`),
    keyUp: code => events.push(`up:${code}`),
  }, 67);

  return { events, handlers };
}

test('holds a key from touch start until touch end', () => {
  const { events, handlers } = setup();

  handlers.onTouchStart();
  assert.deepEqual(events, ['down:67']);

  handlers.onTouchEnd();
  assert.deepEqual(events, ['down:67', 'up:67']);
});

test('releases a held key once when the gesture is cancelled', () => {
  const { events, handlers } = setup();

  handlers.onTouchStart();
  handlers.onTouchStart();
  handlers.onTouchCancel();
  handlers.onTouchEnd();

  assert.deepEqual(events, ['down:67', 'up:67']);
});

test('can hold the same key again after release', () => {
  const { events, handlers } = setup();

  handlers.onTouchStart();
  handlers.onTouchEnd();
  handlers.onTouchStart();
  handlers.onTouchEnd();

  assert.deepEqual(events, ['down:67', 'up:67', 'down:67', 'up:67']);
});
