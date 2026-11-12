import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLatestWinsSetter, isWriteSettling } from '../lib/services/brightness';

test('coalescing: later calls replace the pending value while a write is in flight', () => {
  const writes: number[] = [];
  let finish: (() => void) | null = null;
  const set = createLatestWinsSetter((value, done) => {
    writes.push(value);
    finish = done;
  });

  set(10);            // starts immediately
  set(20); set(30);   // coalesced while 10 is in flight
  assert.deepEqual(writes, [10]);

  finish!();          // completes 10 → only the latest target (30) is written
  assert.deepEqual(writes, [10, 30]);

  finish!();          // nothing pending afterwards
  assert.deepEqual(writes, [10, 30]);
});

test('coalescing: never more than one write in flight', () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const dones: Array<() => void> = [];
  const set = createLatestWinsSetter((_value, done) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    dones.push(() => { inFlight--; done(); });
  });

  for (let v = 0; v < 50; v++) set(v);
  assert.equal(maxInFlight, 1);

  while (dones.length) dones.shift()!();
  assert.equal(inFlight, 0);
});

test('coalescing: a fresh call after completion starts immediately', () => {
  const writes: number[] = [];
  const set = createLatestWinsSetter((value, done) => {
    writes.push(value);
    done();
  });
  set(5);
  set(7);
  assert.deepEqual(writes, [5, 7]);
});

test('settle guard: suppresses readback inside the window, adopts it afterwards', () => {
  const t = 10_000;
  assert.equal(isWriteSettling(t, t + 500), true);
  assert.equal(isWriteSettling(t, t + 1000), true); // boundary inclusive
  assert.equal(isWriteSettling(t, t + 1001), false);
});
