import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNumber, readBoolean, clampPanelHeight, clampSidebarWidth, lineEnding, readEditorPreferences, defaultEditorPreferences } from '../src/lib/preferences.ts';

test('invalid stored preferences fall back instead of producing NaN or zero', () => {
  for (const value of [null, '', 'NaN', 'Infinity', 'broken']) assert.equal(readNumber(value, 13, 10, 24), 13);
  assert.equal(readNumber('999', 13, 10, 24), 24);
  assert.equal(readBoolean(null, true), true);
  assert.equal(readBoolean('false', true), false);
  assert.equal(readBoolean('garbage', true), true);
});

test('restored panels leave room for the editor even in short windows', () => {
  assert.equal(clampPanelHeight(9999, 600), 360);
  assert.equal(clampPanelHeight(9999, 180), 108);
  assert.equal(clampPanelHeight(10, 600), 120);
  assert.equal(clampSidebarWidth(9999, 1000), 720);
});

test('line endings reflect LF, CRLF, mixed, and a document with no newline', () => {
  assert.equal(lineEnding('a\nb\n'), 'LF');
  assert.equal(lineEnding('a\r\nb\r\n'), 'CRLF');
  assert.equal(lineEnding('a\r\nb\nc\r'), 'Mixed');
  assert.equal(lineEnding('a\rb'), 'CR');
  assert.equal(lineEnding('hello'), 'LF');
});

test('editor preferences restore individual keys and reject invalid indentation', () => {
  assert.deepEqual(readEditorPreferences(() => null), defaultEditorPreferences);
  const stored = { 'crumb.lineNumbers': 'false', 'crumb.indentSize': '3', 'crumb.indentWith': 'tabs' };
  const restored = readEditorPreferences(key => stored[key] ?? null);
  assert.equal(restored.lineNumbers, false);
  assert.equal(restored.indentSize, 3);
  assert.equal(restored.indentWith, 'tabs');
  assert.equal(readEditorPreferences(() => '999').indentSize, 2);
});
