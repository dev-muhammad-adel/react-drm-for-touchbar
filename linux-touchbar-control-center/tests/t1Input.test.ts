import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findT1RawTouchDevice } from '../../src/native/input';

function fixture(product: string, config: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'react-drm-t1-'));
  const device = path.join(root, '1-3');
  const hidraw = path.join(root, '1-3:2.2', '0003:05AC:8600.0001', 'hidraw', 'hidraw0');
  fs.mkdirSync(device, { recursive: true });
  fs.mkdirSync(hidraw, { recursive: true });
  fs.writeFileSync(path.join(device, 'idVendor'), '05ac');
  fs.writeFileSync(path.join(device, 'idProduct'), product);
  fs.writeFileSync(path.join(device, 'bConfigurationValue'), config);
  return root;
}

test('finds the T1 digitizer on config-2 interface 2', t => {
  const root = fixture('8600', '2');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(findT1RawTouchDevice(root), '/dev/hidraw0');
});

test('does not expose the T1 digitizer outside display mode', t => {
  const root = fixture('8600', '1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(findT1RawTouchDevice(root), null);
});

test('ignores the T2 USB id in the T1 hidraw resolver', t => {
  const root = fixture('8302', '2');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(findT1RawTouchDevice(root), null);
});
