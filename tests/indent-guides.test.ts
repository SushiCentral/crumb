import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { computeIndentGuideCounts } from '../src/lib/indent-guides.ts';

function stateFor(doc: string, indentSize: 2 | 3 | 4 = 2, indentWith: 'spaces' | 'tabs' = 'spaces') {
  return EditorState.create({
    doc,
    extensions: [
      indentUnit.of(indentWith === 'tabs' ? '\t' : ' '.repeat(indentSize)),
      EditorState.tabSize.of(indentSize),
    ],
  });
}

function counts(state: EditorState, lineNumbers: readonly number[]) {
  const result = computeIndentGuideCounts(state, lineNumbers);
  return lineNumbers.map(lineNumber => result.get(lineNumber));
}

test('space indentation uses complete configured levels at widths 2, 3, and 4', () => {
  for (const size of [2, 3, 4] as const) {
    const doc = [
      'function f() {',
      `${' '.repeat(size)}if (x) {`,
      `${' '.repeat(size * 2)}y;`,
      `${' '.repeat(size)}}`,
      '}',
    ].join('\n');
    assert.deepEqual(counts(stateFor(doc, size), [1, 2, 3, 4, 5]), [0, 1, 2, 1, 0], `width ${size}`);
  }
});

test('tab indentation uses configured tab stops per level', () => {
  const doc = '\tif (x) {\n\t\ty;\n\t}';
  assert.deepEqual(counts(stateFor(doc, 4, 'tabs'), [1, 2, 3]), [1, 2, 1]);
});

test('mixed leading whitespace is measured with tab-aware columns', () => {
  const doc = '\t  a\n \t b\n\t\tc';
  // Tab size 2: "\t  " is four columns, " \t " is three, and "\t\t" is four.
  assert.deepEqual(counts(stateFor(doc, 2), [1, 2, 3]), [2, 1, 2]);
});

test('blank lines between equal indentation inherit that level', () => {
  assert.deepEqual(counts(stateFor('  a\n\n  b'), [2]), [1]);
  assert.deepEqual(counts(stateFor('   a\n\n   b'), [2]), [2]);
  assert.deepEqual(counts(stateFor('\t\ta\n\n\t\ta', 4, 'tabs'), [2]), [2]);
});

test('blank lines between differing indentation take one level past the shallower side', () => {
  // Above four columns and below two columns (unit 2) => 1 + floor(2 / 2).
  assert.deepEqual(counts(stateFor('    a\n\n  b'), [2]), [2]);
  // Above two and below four also uses the shallower side.
  assert.deepEqual(counts(stateFor('  a\n\n    b'), [2]), [2]);
  // Tabs: two levels versus one level, unit 4 => 1 + floor(4 / 4).
  assert.deepEqual(counts(stateFor('\t\ta\n\n\tb', 4, 'tabs'), [2]), [2]);
});

test('blank lines at document edges use only the existing neighbor', () => {
  assert.deepEqual(counts(stateFor('\n    a'), [1]), [2]);
  assert.deepEqual(counts(stateFor('    a\n'), [2]), [2]);
  assert.deepEqual(counts(stateFor('\n  a'), [1]), [1]);
  // Incomplete indentation only contributes complete levels at an edge.
  assert.deepEqual(counts(stateFor('\n   a'), [1]), [1]);
});

test('top-level content, top-level blank lines, and fully blank documents produce no guides', () => {
  assert.deepEqual(counts(stateFor('a\nb\nc'), [1, 2, 3]), [0, 0, 0]);
  assert.deepEqual(counts(stateFor('a\n\nb'), [2]), [0]);
  assert.deepEqual(counts(stateFor('\n\n\n'), [1, 2, 3, 4]), [0, 0, 0, 0]);
});

test('blank-line lookaround is bounded instead of scanning the whole document', () => {
  const doc = `    x${'\n'.repeat(150)}`;
  // Line 101 is 100 lines from the only content; line 102 is beyond the bound.
  assert.deepEqual(counts(stateFor(doc), [1, 2, 101, 102]), [2, 2, 2, 0]);
});

test('duplicate requested lines are evaluated once and returned once', () => {
  const result = computeIndentGuideCounts(stateFor('  a\n    b'), [2, 1, 2, 1]);
  assert.equal(result.size, 2);
  assert.equal(result.get(1), 1);
  assert.equal(result.get(2), 2);
});
