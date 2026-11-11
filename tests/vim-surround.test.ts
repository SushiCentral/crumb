import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  applySurroundEdits,
  beginSurroundInput,
  changeSurroundText,
  deleteSurroundEdits,
  deleteSurroundText,
  findEnclosingSurround,
  installVimSurroundCommands,
  normalizeLinewiseRange,
  resolveSurroundPair,
  stepSurroundInput,
  surroundEdits,
  surroundText,
  vimSurroundSuppressedByMappings,
  vimSurroundTestMultiSelectKey,
  vimSurroundTestPendingController,
  vimSurroundTestVisualState,
} from '../src/lib/vim/surround.ts';
import { resolveVimConfig } from '../src/lib/vim/extension.ts';

test('delimiter aliases resolve to their canonical pairs', () => {
  const groups: Array<[string[], string, string]> = [
    [['(', ')', 'b'], '(', ')'],
    [['[', ']'], '[', ']'],
    [['{', '}', 'B'], '{', '}'],
    [['<', '>'], '<', '>'],
    [['"'], '"', '"'],
    [["'"], "'", "'"],
    [['`'], '`', '`'],
  ];
  for (const [aliases, open, close] of groups) {
    for (const alias of aliases) {
      assert.deepEqual(resolveSurroundPair(alias), { open, close, kind: open === close ? 'quote' : 'bracket' });
    }
  }
  for (const unsupported of ['', 'x', '#', 'w', ' ']) {
    assert.equal(resolveSurroundPair(unsupported), null);
  }
});

test('surround wraps an exact range and places the cursor inside', () => {
  assert.deepEqual(surroundText('word', 0, 4, '"'), { text: '"word"', cursor: 1 });
  assert.deepEqual(surroundText('alpha beta', 6, 10, ']'), { text: 'alpha [beta]', cursor: 7 });
  assert.deepEqual(surroundText('alpha', 0, 5, 'b'), { text: '(alpha)', cursor: 1 });
  assert.deepEqual(surroundText('', 0, 0, '`'), { text: '``', cursor: 1 });
});

test('surround supports multiline ranges without normalizing whitespace', () => {
  const text = '  alpha\n\tbeta  ';
  assert.deepEqual(surroundText(text, 0, text.length, '{'), {
    text: '{  alpha\n\tbeta  }',
    cursor: 1,
  });
  assert.equal(surroundText('alpha', 0, 4, 'x'), null);
  assert.equal(surroundText('alpha', 2, 1, '"'), null);
});

test('surroundEdits is ordered and one operation remains one change set', () => {
  const edits = surroundEdits(1, 3, { open: '[', close: ']', kind: 'bracket' });
  assert.deepEqual(edits, [
    { from: 1, to: 1, insert: '[' },
    { from: 3, to: 3, insert: ']' },
  ]);
  assert.equal(applySurroundEdits('abcd', edits), 'a[bc]d');
  assert.deepEqual(deleteSurroundEdits({ openFrom: 1, closeFrom: 3, openLength: 1, closeLength: 1 }), [
    { from: 1, to: 2, insert: '' },
    { from: 3, to: 4, insert: '' },
  ]);
});

test('ds finds the closest enclosing bracket pair', () => {
  assert.deepEqual(deleteSurroundText('(alpha)', 2, '('), { text: 'alpha', cursor: 0 });
  assert.deepEqual(deleteSurroundText('(alpha)', 0, 'b'), { text: 'alpha', cursor: 0 });
  assert.deepEqual(deleteSurroundText('(alpha)', 6, ')'), { text: 'alpha', cursor: 0 });
  assert.deepEqual(deleteSurroundText('((a))', 2, '('), { text: '(a)', cursor: 1 });
  assert.deepEqual(deleteSurroundText('{a [b] c}', 4, ']'), { text: '{a b c}', cursor: 3 });
});

test('ds supports multiline balanced brackets', () => {
  assert.deepEqual(deleteSurroundText('{\na\n}', 2, '{'), { text: '\na\n', cursor: 0 });
  assert.deepEqual(deleteSurroundText('before (one\ntwo) after', 8, '('), {
    text: 'before one\ntwo after',
    cursor: 7,
  });
});

test('ds ignores escaped brackets and reports unmatched brackets', () => {
  assert.deepEqual(deleteSurroundText('(a \\) b)', 6, '('), { text: 'a \\) b', cursor: 0 });
  assert.equal(deleteSurroundText('(alpha', 2, '('), null);
  assert.equal(deleteSurroundText('alpha)', 2, '('), null);
  assert.equal(deleteSurroundText('(a] b', 2, '('), null);
});

test('ds finds escape-aware same-line quote pairs', () => {
  assert.deepEqual(deleteSurroundText('say "hello" now', 7, '"'), {
    text: 'say hello now',
    cursor: 4,
  });
  assert.deepEqual(deleteSurroundText('"a \\" b"', 6, '"'), {
    text: 'a \\" b',
    cursor: 0,
  });
  assert.deepEqual(deleteSurroundText('"a" "b"', 5, '"'), {
    text: '"a" b',
    cursor: 4,
  });
  assert.deepEqual(deleteSurroundText("say 'hi' now", 6, "'"), {
    text: 'say hi now',
    cursor: 4,
  });
  assert.deepEqual(deleteSurroundText('say `hi` now', 6, '`'), {
    text: 'say hi now',
    cursor: 4,
  });
});

test('ds does not match unmatched or cross-line quotes', () => {
  assert.equal(deleteSurroundText('"abc', 2, '"'), null);
  assert.equal(deleteSurroundText('a "b', 3, '"'), null);
  assert.equal(deleteSurroundText('"a\nb"', 3, '"'), null);
  assert.equal(deleteSurroundText("don't", 2, "'"), null);
});

test('quote lookup at offset 0 does not inspect a following line', () => {
  assert.equal(findEnclosingSurround('\n"a"', 0, '"'), null);
  assert.equal(deleteSurroundText('\n"a"', 0, '"'), null);
  assert.deepEqual(deleteSurroundText('\n"a"', 2, '"'), {
    text: '\na',
    cursor: 1,
  });
  assert.deepEqual(deleteSurroundText('"a"\n"b"', 5, '"'), {
    text: '"a"\nb',
    cursor: 4,
  });
});

test('configured Normal-mode operator and surround-prefix mappings win', () => {
  for (const lhs of ['ys', 'ds', 'cs', 'y', 'd', 'c']) {
    const resolved = resolveVimConfig({
      mappings: [{ lhs, rhs: 'zz', modes: ['normal'] }],
    });
    assert.equal(
      vimSurroundSuppressedByMappings(resolved.mappings),
      true,
      `expected ${lhs} to suppress prefix interception`,
    );
  }

  for (const lhs of ['yw', 'dd', 'Y', 's']) {
    const resolved = resolveVimConfig({
      mappings: [{ lhs, rhs: 'zz', modes: ['normal'] }],
    });
    assert.equal(
      vimSurroundSuppressedByMappings(resolved.mappings),
      false,
      `expected ${lhs} not to suppress prefix interception`,
    );
  }
});

test('insert-only and visual-only mappings do not suppress Normal prefix handling', () => {
  for (const mode of ['insert', 'visual', 'operator'] as const) {
    const resolved = resolveVimConfig({
      mappings: [{ lhs: 'ds', rhs: 'dd', modes: [mode] }],
    });
    assert.equal(vimSurroundSuppressedByMappings(resolved.mappings), false, mode);
  }
  const mixed = resolveVimConfig({
    mappings: [{ lhs: 'ds', rhs: 'dd', modes: ['insert', 'normal'] }],
  });
  assert.equal(vimSurroundSuppressedByMappings(mixed.mappings), true);

  const operatorS = resolveVimConfig({
    mappings: [{ lhs: 's', rhs: 'w', modes: ['operator'] }],
  });
  assert.equal(vimSurroundSuppressedByMappings(operatorS.mappings), true);
});

test('ds lookup exposes the pair bounds used by the runtime', () => {
  assert.deepEqual(findEnclosingSurround('a (b [c] d) e', 6, '['), {
    openFrom: 5,
    closeFrom: 7,
    openLength: 1,
    closeLength: 1,
  });
  assert.deepEqual(findEnclosingSurround('a (b [c] d) e', 6, '('), {
    openFrom: 2,
    closeFrom: 10,
    openLength: 1,
    closeLength: 1,
  });
  assert.equal(findEnclosingSurround('plain', 2, '('), null);
});

test('cs replaces the closest pair and accepts aliases', () => {
  assert.deepEqual(changeSurroundText('(alpha)', 2, '(', '['), { text: '[alpha]', cursor: 0 });
  assert.deepEqual(changeSurroundText('(alpha)', 2, 'b', 'B'), { text: '{alpha}', cursor: 0 });
  assert.deepEqual(changeSurroundText('((a))', 2, '(', ']'), { text: '([a])', cursor: 1 });
  assert.deepEqual(changeSurroundText('"a"', 1, '"', "'"), { text: "'a'", cursor: 0 });
  assert.deepEqual(changeSurroundText('{\na\n}', 2, '{', '<'), { text: '<\na\n>', cursor: 0 });
});

test('cs leaves unmatched or unsupported input unchanged', () => {
  assert.equal(changeSurroundText('(alpha', 2, '(', '['), null);
  assert.equal(changeSurroundText('plain', 2, '(', '['), null);
  assert.equal(changeSurroundText('(alpha)', 2, '(', 'x'), null);
  assert.equal(changeSurroundText('"a\nb"', 3, '"', "'"), null);
});

test('linewise ranges keep delimiters inside the final newline', () => {
  const doc = EditorState.create({ doc: 'one\ntwo\nthree' }).doc;
  assert.deepEqual(normalizeLinewiseRange(doc, 0, 4), { from: 0, to: 3 });
  assert.deepEqual(normalizeLinewiseRange(doc, 0, 8), { from: 0, to: 7 });
  assert.deepEqual(normalizeLinewiseRange(doc, 4, 8), { from: 4, to: 7 });
  const linewise = normalizeLinewiseRange(doc, 0, 4);
  assert.deepEqual(surroundText(doc.toString(), linewise.from, linewise.to, '"'), {
    text: '"one"\ntwo\nthree',
    cursor: 1,
  });
});

test('the pending prompt applies a supported delimiter', () => {
  const surround = beginSurroundInput('surround');
  assert.deepEqual(surround, { kind: 'surround', stage: 'delimiter' });
  assert.deepEqual(stepSurroundInput(surround, '('), { kind: 'apply', newDelimiter: '(' });
  assert.deepEqual(stepSurroundInput(beginSurroundInput('delete'), ']'), {
    kind: 'apply',
    oldDelimiter: ']',
    newDelimiter: ']',
  });
});

test('the pending prompt cancels on Escape, named keys, and invalid delimiters', () => {
  for (const state of [
    beginSurroundInput('surround'),
    beginSurroundInput('delete'),
    beginSurroundInput('change'),
  ]) {
    assert.deepEqual(stepSurroundInput(state, 'Escape'), { kind: 'cancel' });
    assert.deepEqual(stepSurroundInput(state, 'ArrowLeft'), { kind: 'cancel' });
    assert.deepEqual(stepSurroundInput(state, 'x'), { kind: 'cancel' });
  }
});

test('cs collects the old delimiter before the replacement and cancels safely', () => {
  const first = stepSurroundInput(beginSurroundInput('change'), '(');
  assert.deepEqual(first, {
    kind: 'pending',
    input: { kind: 'change', stage: 'to', oldDelimiter: '(' },
  });
  assert.ok(first.kind === 'pending');
  assert.deepEqual(stepSurroundInput(first.input, '['), {
    kind: 'apply',
    oldDelimiter: '(',
    newDelimiter: '[',
  });
  assert.deepEqual(stepSurroundInput(first.input, 'Escape'), { kind: 'cancel' });
  assert.deepEqual(stepSurroundInput(first.input, 'x'), { kind: 'cancel' });
});

/**
 * Minimal real-engine adapter for the non-GUI Visual regression. It mirrors the
 * CM5 surface the pinned engine touches; no DOM or browser is involved.
 */
function createSurroundEngineCM(doc: string) {
  const lines = doc.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let selection = { anchor: 0, head: 0 };

  const toOffset = (position: { line: number; ch: number }): number => {
    const line = Math.max(0, Math.min(position.line, lines.length - 1));
    return starts[line] + Math.max(0, Math.min(position.ch, lines[line].length));
  };
  const toPos = (value: number) => {
    const clamped = Math.max(0, Math.min(value, doc.length));
    let line = 0;
    while (line + 1 < lines.length && clamped >= starts[line] + lines[line].length + 1) {
      line += 1;
    }
    return { line, ch: clamped - starts[line] };
  };

  return {
    state: { vim: undefined as unknown },
    curOp: {},
    cm6: {},
    operation(callback: () => void) {
      callback();
      return true;
    },
    signal() {},
    firstLine: () => 0,
    lastLine: () => lines.length - 1,
    lineCount: () => lines.length,
    getCursor(kind?: string) {
      return toPos(kind === 'anchor' ? selection.anchor : selection.head);
    },
    setCursor(position: { line: number; ch: number } | number, ch?: number) {
      const value = typeof position === 'object'
        ? toOffset(position)
        : toOffset({ line: position, ch: ch ?? 0 });
      selection = { anchor: value, head: value };
    },
    setSelections(ranges: Array<{ anchor: { line: number; ch: number }; head: { line: number; ch: number } }>) {
      const range = ranges[0];
      selection = { anchor: toOffset(range.anchor), head: toOffset(range.head) };
    },
    setSelection(anchor: { line: number; ch: number }, head: { line: number; ch: number }) {
      selection = { anchor: toOffset(anchor), head: toOffset(head) };
    },
    getLine: (row: number) => lines[row] ?? '',
    getRange(a: { line: number; ch: number }, b: { line: number; ch: number }) {
      const from = Math.min(toOffset(a), toOffset(b));
      const to = Math.max(toOffset(a), toOffset(b));
      return doc.slice(from, to);
    },
    getSelection: () => doc.slice(
      Math.min(selection.anchor, selection.head),
      Math.max(selection.anchor, selection.head),
    ),
    replaceRange() {},
    posFromIndex: (value: number) => toPos(value),
    indexFromPos: (position: { line: number; ch: number }) => toOffset(position),
    getValue: () => doc,
    getSearchCursor: () => null,
    getScrollInfo: () => ({ left: 0, top: 0, clientHeight: 100, clientWidth: 100 }),
    charCoords: () => ({ left: 0, top: 0, bottom: 1 }),
    defaultTextHeight: () => 1,
    scrollTo() {},
    scrollIntoView() {},
    focus() {},
    openDialog() {},
    openNotification() {},
    addOverlay() {},
    removeOverlay() {},
    getOption: () => false,
    setOption() {},
    toggleOverwrite() {},
    setBookmark(position: { line: number; ch: number }) {
      return { find: () => position, clear() {} };
    },
    getBookmark: () => null,
    clearBookmark() {},
    findPosH(position: { line: number; ch: number }, amount: number) {
      return toPos(toOffset(position) + amount);
    },
    findPosV(position: { line: number; ch: number }, amount: number) {
      const line = Math.max(0, Math.min(lines.length - 1, position.line + amount));
      return { line, ch: Math.min(position.ch, lines[line].length) };
    },
    clipPos: (position: { line: number; ch: number }) => position,
    somethingSelected: () => selection.anchor !== selection.head,
    isInMultiSelectMode: () => selection.anchor !== selection.head,
    forEachSelection(callback: () => void) {
      callback();
    },
    getInputField: () => ({ addEventListener() {}, removeEventListener() {} }),
  };
}

test('Visual block S collapses the block selection and returns to Normal', () => {
  installVimSurroundCommands();
  const cm = createSurroundEngineCM('one\ntwo');

  vimSurroundTestMultiSelectKey(cm, '<C-v>');
  vimSurroundTestMultiSelectKey(cm, 'j');
  vimSurroundTestMultiSelectKey(cm, 'S');

  const vim = vimSurroundTestVisualState(cm);
  assert.equal(cm.getValue(), 'one\ntwo');
  assert.equal(vim.visualMode, false);
  assert.equal(vim.visualBlock, false);
  assert.equal(vim.visualLine, false);
  assert.equal(cm.somethingSelected(), false);
});

function keyEvent(
  key: string,
  extra: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing', boolean>> = {},
): KeyboardEvent {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...extra,
  } as unknown as KeyboardEvent;
}

function createPendingView(doc: string) {
  const state = EditorState.create({ doc });
  const dispatches: unknown[] = [];
  const view = {
    state: { doc: state.doc, selection: { main: { head: 0 } } },
    dispatch(transaction: unknown) {
      dispatches.push(transaction);
    },
  };
  return {
    view: view as unknown as Parameters<typeof vimSurroundTestPendingController>[0],
    dispatches,
  };
}

test('modifier-only keydowns do not cancel a pending delimiter', () => {
  const { view, dispatches } = createPendingView('ab');
  const pending = vimSurroundTestPendingController(view);
  pending.beginDelimiter();

  const modifierEvents = [
    keyEvent('Shift', { shiftKey: true }),
    keyEvent('Control', { ctrlKey: true }),
    keyEvent('Alt', { altKey: true }),
    keyEvent('Meta', { metaKey: true }),
    keyEvent('AltGraph', { ctrlKey: true, altKey: true }),
  ];
  for (const event of modifierEvents) {
    assert.equal(pending.handleKey(event), true, event.key);
    assert.notEqual(pending.pending(), null, `${event.key} must keep the prompt`);
  }
  assert.equal(dispatches.length, 0);

  // A Shift-held printable delimiter still applies.
  assert.equal(pending.handleKey(keyEvent('"', { shiftKey: true })), true);
  assert.equal(pending.pending(), null);
  assert.equal(dispatches.length, 1);
});

test('actual modified shortcuts and named keys still cancel the delimiter prompt', () => {
  for (const event of [
    keyEvent('x', { ctrlKey: true }),
    keyEvent('x', { altKey: true }),
    keyEvent('x', { metaKey: true }),
    keyEvent('ArrowLeft'),
    keyEvent('Escape'),
  ]) {
    const { view, dispatches } = createPendingView('ab');
    const pending = vimSurroundTestPendingController(view);
    pending.beginDelimiter();
    assert.equal(pending.handleKey(event), true, event.key);
    assert.equal(pending.pending(), null, event.key);
    assert.equal(dispatches.length, 0, event.key);
  }
});

test('modifier-only keydowns do not cancel a forwarded native motion', () => {
  installVimSurroundCommands();
  const { view, dispatches } = createPendingView('foo BAR');
  const cm = createSurroundEngineCM('foo BAR');
  (cm as unknown as { cm6: unknown }).cm6 = view;
  (view as unknown as { cm: unknown }).cm = cm;

  // Start from the engine's native yank operator, then retarget it to surround.
  vimSurroundTestMultiSelectKey(cm, 'y');
  const pending = vimSurroundTestPendingController(view);
  assert.equal(pending.beginForwarding(), true);

  for (const event of [
    keyEvent('Shift', { shiftKey: true }),
    keyEvent('Control', { ctrlKey: true }),
    keyEvent('Alt', { altKey: true }),
    keyEvent('Meta', { metaKey: true }),
    keyEvent('AltGraph', { ctrlKey: true, altKey: true }),
  ]) {
    assert.equal(pending.handleKey(event), true, event.key);
    assert.notEqual(pending.pending(), null, `${event.key} must keep forwarding`);
  }

  // A Shift-held W is a real motion and must complete into the delimiter prompt.
  assert.equal(pending.handleKey(keyEvent('W', { shiftKey: true })), true);
  const captured = pending.pending();
  assert.ok(captured);
  assert.equal(captured.kind, 'surround');
  assert.equal(captured.stage, 'delimiter');
  assert.equal(dispatches.length, 0);

  // Escape still cancels with no edit.
  assert.equal(pending.handleKey(keyEvent('Escape')), true);
  assert.equal(pending.pending(), null);
  assert.equal(dispatches.length, 0);
});

test('a modified printable still cancels while forwarding a motion', () => {
  installVimSurroundCommands();
  const { view } = createPendingView('foo BAR');
  const cm = createSurroundEngineCM('foo BAR');
  (cm as unknown as { cm6: unknown }).cm6 = view;
  (view as unknown as { cm: unknown }).cm = cm;

  vimSurroundTestMultiSelectKey(cm, 'y');
  const pending = vimSurroundTestPendingController(view);
  assert.equal(pending.beginForwarding(), true);
  assert.equal(pending.handleKey(keyEvent('Control', { ctrlKey: true })), true);
  assert.notEqual(pending.pending(), null);
  assert.equal(pending.handleKey(keyEvent('x', { ctrlKey: true })), true);
  assert.equal(pending.pending(), null);
});
