import { EditorState, Prec, countColumn, type Extension } from '@codemirror/state';
import { lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap } from '@codemirror/view';
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap, indentUnit } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { indentGuides } from './indent-guides.ts';
import type { EditorPreferences } from './preferences.ts';

// The invariant parts of basicSetup stay outside the preferences compartment:
// toggling a display option must never discard undo history or search state.
//
// Ctrl-H/J/K/L are reserved surface keys, not editing commands. On macOS
// CodeMirror's default keymap turns Ctrl-H/K/L into Emacs editing commands, and
// the Vim engine maps them to buffer motions. A highest-precedence no-op keymap
// consumes them before either keymap can act so the editor never treats them as
// shortcuts. Terminals and native inputs are outside CodeMirror and unaffected.
export const EDITOR_RESERVED_CTRL_KEYS: ReadonlySet<string> = new Set(['h', 'j', 'k', 'l']);

export function isEditorReservedCtrlKey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && !event.shiftKey
    && EDITOR_RESERVED_CTRL_KEYS.has(event.key.toLowerCase());
}

const editorReservedCtrlKeys: Extension = Prec.highest(keymap.of(
  [...EDITOR_RESERVED_CTRL_KEYS].map(key => ({ key: `Ctrl-${key}`, run: () => true })),
));

export const editorCoreExtensions: Extension = [
  editorReservedCtrlKeys,
  highlightSpecialChars(), history(), foldGutter(), drawSelection(), dropCursor(),
  EditorState.allowMultipleSelections.of(true), indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  autocompletion(), rectangularSelection(), crosshairCursor(), highlightSelectionMatches(),
  keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
];

export function editorPreferenceExtensions(preferences: EditorPreferences): Extension {
  return [
    preferences.lineNumbers ? lineNumbers() : [],
    preferences.lineNumbers && preferences.highlightActiveLine ? highlightActiveLineGutter() : [],
    preferences.bracketMatching ? bracketMatching() : [],
    preferences.autoCloseBrackets ? [closeBrackets(), Prec.high(keymap.of(closeBracketsKeymap))] : [],
    preferences.highlightActiveLine ? highlightActiveLine() : [],
    preferences.indentGuides ? indentGuides() : [],
    indentUnit.of(preferences.indentWith === 'tabs' ? '\t' : ' '.repeat(preferences.indentSize)),
    EditorState.tabSize.of(preferences.indentSize),
  ];
}

export interface CursorInfo { line: number; column: number; selected: number }

export function cursorInfo(state: EditorState): CursorInfo {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return {
    line: line.number,
    column: countColumn(line.text.slice(0, head - line.from), state.tabSize) + 1,
    selected: state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0),
  };
}
