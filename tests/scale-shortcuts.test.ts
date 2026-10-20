import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleShortcut, nextZoom } from '../src/lib/scale-shortcuts.ts';

const key = (value: string, shiftKey = false, code = '') => ({ key: value, code, ctrlKey: true, metaKey: false, shiftKey, altKey: false });

test('unshifted shortcuts scale the whole interface', () => {
  assert.deepEqual(scaleShortcut(key('=')), { target: 'zoom', delta: 1 });
  assert.deepEqual(scaleShortcut(key('-')), { target: 'zoom', delta: -1 });
});

test('shifted shortcuts adjust code fonts, including shifted punctuation', () => {
  for (const value of ['=', '+']) assert.deepEqual(scaleShortcut(key(value, true)), { target: 'font', delta: 1 });
  for (const value of ['-', '_']) assert.deepEqual(scaleShortcut(key(value, true)), { target: 'font', delta: -1 });
});

test('supports physical equal/minus keys, numpad, and Command without capturing ordinary typing', () => {
  assert.deepEqual(scaleShortcut(key('Dead', true, 'Equal')), { target: 'font', delta: 1 });
  assert.deepEqual(scaleShortcut(key('Add', false, 'NumpadAdd')), { target: 'zoom', delta: 1 });
  assert.deepEqual(scaleShortcut({ ...key('-'), ctrlKey: false, metaKey: true }), { target: 'zoom', delta: -1 });
  assert.equal(scaleShortcut({ ...key('='), ctrlKey: false }), null);
  assert.equal(scaleShortcut({ ...key('='), altKey: true }), null);
  assert.equal(scaleShortcut(key('s')), null);
});

test('zoom steps are bounded, reversible, and free from floating point drift', () => {
  assert.equal(nextZoom(1, 1), 1.1);
  assert.equal(nextZoom(1.1, -1), 1);
  assert.equal(nextZoom(2, 1), 2);
  assert.equal(nextZoom(0.5, -1), 0.5);
});

test('Ctrl+0 resets zoom and Ctrl+Shift+0 resets code font size', () => {
  assert.deepEqual(scaleShortcut(key('0')), { target: 'zoom', reset: true });
  assert.deepEqual(scaleShortcut(key(')', true, 'Digit0')), { target: 'font', reset: true });
  assert.deepEqual(scaleShortcut(key('0', true)), { target: 'font', reset: true });
  assert.equal(scaleShortcut({ ...key('0'), ctrlKey: false }), null);
  assert.equal(scaleShortcut({ ...key('0'), altKey: true }), null);
});
