import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, Compartment } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { indentMore, undo, undoDepth } from '@codemirror/commands';
import { editorCoreExtensions, editorPreferenceExtensions, cursorInfo } from '../src/lib/editor-extensions.ts';
import { defaultEditorPreferences } from '../src/lib/preferences.ts';

test('explicit setup retains multiple selections and history across preference changes', () => {
  const compartment = new Compartment();
  let state = EditorState.create({ doc: 'hello', extensions: [editorCoreExtensions, compartment.of(editorPreferenceExtensions(defaultEditorPreferences))] });
  state = state.update({ changes: { from: 5, insert: '!' } }).state;
  assert.equal(undoDepth(state), 1);
  state = state.update({ effects: compartment.reconfigure(editorPreferenceExtensions({ ...defaultEditorPreferences, lineNumbers: false, bracketMatching: false })) }).state;
  assert.equal(state.facet(EditorState.allowMultipleSelections), true);
  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state; } }), true);
  assert.equal(state.doc.toString(), 'hello');
});

test('indent widths and spaces/tabs affect real indentation commands', () => {
  for (const size of [2, 3, 4]) for (const mode of ['spaces', 'tabs']) {
    let state = EditorState.create({ doc: 'hello', extensions: [editorCoreExtensions, editorPreferenceExtensions({ ...defaultEditorPreferences, indentSize: size, indentWith: mode })] });
    assert.equal(state.facet(EditorState.tabSize), size);
    assert.equal(state.facet(indentUnit), mode === 'tabs' ? '\t' : ' '.repeat(size));
    indentMore({ state, dispatch: transaction => { state = transaction.state; } });
    assert.equal(state.doc.toString(), (mode === 'tabs' ? '\t' : ' '.repeat(size)) + 'hello');
  }
});

test('cursor information reports 1-based positions, visual tab columns, and selected characters', () => {
  const state = EditorState.create({ doc: 'first\n\tabc', selection: { anchor: 7, head: 9 }, extensions: EditorState.tabSize.of(4) });
  assert.deepEqual(cursorInfo(state), { line: 2, column: 7, selected: 2 });
});
