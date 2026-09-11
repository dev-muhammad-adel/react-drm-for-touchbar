import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRouter } from '../lib/routes/router-registry';
import { currentRoute, resolveLockNavigation, LOCK_LAYER, HOME_LAYER } from '../lib/lock/navigation';

interface FakeRouter {
  current: string;
  go(_name: string, _opts?: unknown): unknown;
  next(_opts?: unknown): unknown;
  prev(_opts?: unknown): unknown;
}

function fake(current: string): FakeRouter {
  return {
    current,
    go: () => {},
    next: () => {},
    prev: () => {},
  };
}

test('currentRoute walks a single root layer', () => {
  registerRouter('', fake('splitted'));
  assert.equal(currentRoute(), 'splitted');
});

test('currentRoute walks nested registered branches', () => {
  registerRouter('', fake('splitted'));
  registerRouter('splitted', fake('browser'));
  assert.equal(currentRoute(), 'splitted/browser');

  registerRouter('splitted/browser', fake('kbd'));
  assert.equal(currentRoute(), 'splitted/browser/kbd');
});

test('currentRoute stops at an unregistered branch', () => {
  registerRouter('', fake('splitted'));
  registerRouter('splitted', fake('browser'));
  registerRouter('splitted/browser', fake('kbd'));
  // Simulate a deeper level that routes to a branch that never registered.
  registerRouter('splitted/browser/kbd', fake('pages'));
  registerRouter('splitted/browser/kbd/pages', fake('media'));
  assert.equal(currentRoute(), 'splitted/browser/kbd/pages/media');
});

test('currentRoute is empty when no root is registered', () => {
  registerRouter('', null);
  assert.equal(currentRoute(), '');
});

test('currentRoute stops at an empty current', () => {
  registerRouter('', fake(''));
  assert.equal(currentRoute(), '');
});

test('lock from a normal layer remembers it and targets the lock layer', () => {
  assert.deepEqual(resolveLockNavigation(true, null, 'splitted/browser'), {
    kind: 'lock',
    goto: LOCK_LAYER,
    remember: 'splitted/browser',
  });
});

test('lock while already on the lock layer keeps the previous memory', () => {
  assert.deepEqual(resolveLockNavigation(true, 'splitted/browser', LOCK_LAYER), {
    kind: 'lock',
    goto: LOCK_LAYER,
    remember: 'splitted/browser',
  });
});

test('unlock restores the remembered layer', () => {
  assert.deepEqual(resolveLockNavigation(false, 'splitted/browser', LOCK_LAYER), {
    kind: 'unlock',
    goto: 'splitted/browser',
  });
});

test('unlock without a remembered layer falls back to home', () => {
  assert.deepEqual(resolveLockNavigation(false, null, LOCK_LAYER), {
    kind: 'unlock',
    goto: HOME_LAYER,
  });
});

test('locked with no current layer does not record the lock layer as its own previous', () => {
  assert.deepEqual(resolveLockNavigation(true, null, ''), {
    kind: 'lock',
    goto: LOCK_LAYER,
    remember: null,
  });
});