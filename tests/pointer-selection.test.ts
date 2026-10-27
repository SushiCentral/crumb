import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPointerMoveGuard } from '../src/lib/pointer-selection.ts';

const move = (clientX: number, clientY: number, movementX = 1, movementY = 0) => ({
  clientX,
  clientY,
  movementX,
  movementY,
});

test('accepts a first event that carries genuine movement', () => {
  const guard = createPointerMoveGuard();
  assert.equal(guard(move(120, 80, 12, 0)), true);
});

test('rejects a synthetic zero-delta event, including when it arrives first', () => {
  const guard = createPointerMoveGuard();
  assert.equal(guard(move(120, 80, 0, 0)), false);
  assert.equal(guard(move(120, 80, 0, 0)), false);
});

test('ignores repeated coordinates even if the event claims movement', () => {
  const guard = createPointerMoveGuard();
  assert.equal(guard(move(120, 80, 12, 0)), true);
  assert.equal(guard(move(120, 80, 12, 0)), false);
  assert.equal(guard(move(120, 80, 12, 0)), false);
});

test('accepts the next event after the pointer actually moves', () => {
  const guard = createPointerMoveGuard();
  assert.equal(guard(move(120, 80, 12, 0)), true);
  assert.equal(guard(move(120, 80, 0, 0)), false);
  assert.equal(guard(move(121, 80, 1, 0)), true);
  assert.equal(guard(move(121, 96, 0, 16)), true);
});

test('rejects events without real coordinates and keeps the last real position', () => {
  const guard = createPointerMoveGuard();
  assert.equal(guard(move(150, 90, 10, 0)), true);
  assert.equal(guard({ clientX: Number.NaN, clientY: 90, movementX: 25, movementY: 0 }), false);
  assert.equal(guard({ clientX: 150, clientY: Number.POSITIVE_INFINITY, movementX: 0, movementY: 25 }), false);
  assert.equal(guard(move(0, 0, 30, 30)), false);
  // The rejected positions did not become the baseline, so a move away from
  // the last real point still counts.
  assert.equal(guard(move(151, 90, 1, 0)), true);
});
