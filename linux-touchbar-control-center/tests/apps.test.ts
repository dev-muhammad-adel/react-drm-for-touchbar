import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFavoriteApps } from '../lib/services/apps';

test('parses GNOME favorite desktop ids in order', () => {
  const output = "@as ['firefox_firefox.desktop', 'org.gnome.Nautilus.desktop']";
  assert.deepEqual(parseFavoriteApps(output), [
    'firefox_firefox.desktop',
    'org.gnome.Nautilus.desktop',
  ]);
});

test('accepts an empty GNOME favorite list', () => {
  assert.deepEqual(parseFavoriteApps('@as []'), []);
});
