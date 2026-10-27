import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, Compartment } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { indentMore, undo, undoDepth } from '@codemirror/commands';
import { editorCoreExtensions, editorPreferenceExtensions, cursorInfo, isEditorReservedCtrlKey } from '../src/lib/editor-extensions.ts';
import { defaultEditorPreferences } from '../src/lib/preferences.ts';
import { createVimExtension } from '../src/lib/vim/extension.ts';

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

test('Ctrl-H/J/K/L are reserved from Crumb and editor bindings', () => {
  const event = (overrides: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}) => ({
    key: 'h',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  });

  for (const key of ['h', 'j', 'k', 'l', 'H', 'J', 'K', 'L']) {
    assert.equal(isEditorReservedCtrlKey(event({ key })), true, `Ctrl-${key} must be reserved in editors`);
  }

  for (const key of ['a', 'w', 's', '`']) {
    assert.equal(isEditorReservedCtrlKey(event({ key })), false, `Ctrl-${key} must keep its existing handling`);
  }

  assert.equal(isEditorReservedCtrlKey(event({ ctrlKey: false })), false);
  assert.equal(isEditorReservedCtrlKey(event({ metaKey: true })), false);
  assert.equal(isEditorReservedCtrlKey(event({ altKey: true })), false);
  assert.equal(isEditorReservedCtrlKey(event({ shiftKey: true })), false);
});

test('a dedicated Vim compartment toggles without recreating the document, selection, or history', () => {
  const vim = createVimExtension();
  const vimCompartment = new Compartment();
  let state = EditorState.create({
    doc: 'hello',
    extensions: [editorCoreExtensions, vimCompartment.of(vim.extension)],
  });
  state = state.update({
    changes: { from: 5, insert: '!' },
    selection: { anchor: 6 },
  }).state;
  assert.equal(undoDepth(state), 1);

  state = state.update({ effects: vimCompartment.reconfigure([]) }).state;
  assert.equal(state.doc.toString(), 'hello!');
  assert.equal(state.selection.main.head, 6);
  assert.equal(undoDepth(state), 1);

  state = state.update({ effects: vimCompartment.reconfigure(vim.extension) }).state;
  assert.equal(state.doc.toString(), 'hello!');
  assert.equal(state.selection.main.head, 6);
  assert.equal(undoDepth(state), 1);

  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state; } }), true);
  assert.equal(state.doc.toString(), 'hello');
});
