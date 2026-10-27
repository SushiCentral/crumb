import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  getVimGoalColumn,
  installVimJumpListBridge,
  registerVimJumpHandlers,
  restoreVimJumpCursor,
  type VimJumpBridgeHandlers,
  type VimJumpListLike,
  type VimJumpPoint,
} from '../src/lib/vim/lifecycle.ts';

interface FakeAdapter {
  lineCount(): number;
  getLine(line: number): string;
  getCursor(): VimJumpPoint;
}

function createFakeAdapter(text: string[]): FakeAdapter {
  return {
    lineCount: () => text.length,
    getLine: line => text[line] ?? '',
    getCursor: () => ({ line: 0, ch: 0 }),
  };
}

function createList(): VimJumpListLike {
  return {
    cachedCursor: { line: 4, ch: 2 },
    add() {},
    move: () => undefined,
    find: () => null,
  };
}

function viewFor(adapter: FakeAdapter): EditorView {
  return { cm: adapter } as unknown as EditorView;
}

test('the bridge dispatches add/move/find to the registered view handler in place', () => {
  const list = createList();
  installVimJumpListBridge(list);
  const adapter = createFakeAdapter(['alpha', 'bravo', 'charlie']);
  const view = viewFor(adapter);
  const calls: string[] = [];
  const handler: VimJumpBridgeHandlers = {
    add(_cm, oldCur, newCur) {
      calls.push(`add:${oldCur.line}:${newCur.line}`);
    },
    move(_cm, count) {
      calls.push(`move:${count}`);
    },
    find(_cm, offset) {
      calls.push(`find:${offset}`);
      return { line: 1, ch: 2 };
    },
    correct(_cm, landing) {
      calls.push(`correct:${landing.line}:${landing.ch}`);
    },
  };
  const unregister = registerVimJumpHandlers(view, handler);

  list.add(adapter as never, { line: 0, ch: 0 }, { line: 2, ch: 0 });
  assert.equal(list.move(adapter as never, -1), undefined, 'session traversal is asynchronous');
  assert.deepEqual(list.find(adapter as never, -1), { line: 1, ch: 2 });
  assert.deepEqual(list.cachedCursor, { line: 4, ch: 2 }, 'the engine-owned origin is preserved');
  assert.deepEqual(calls, ['add:0:2', 'move:-1', 'find:-1']);

  unregister();
  list.add(adapter as never, { line: 0, ch: 0 }, { line: 2, ch: 0 });
  assert.deepEqual(calls, ['add:0:2', 'move:-1', 'find:-1'], 'a stale handler no longer publishes');
});

test('an unregistered fixture adapter uses a plain adapter-local fallback', () => {
  const list = createList();
  installVimJumpListBridge(list);
  const adapter = createFakeAdapter(['alpha', 'bravo', 'charlie']);

  list.add(adapter as never, { line: 0, ch: 0 }, { line: 2, ch: 0 });
  list.add(adapter as never, { line: 2, ch: 0 }, { line: 1, ch: 3 });

  assert.deepEqual(list.find(adapter as never, -1), { line: 2, ch: 0 });
  const marker = list.move(adapter as never, -1);
  assert.ok(marker);
  assert.deepEqual(marker.find(), { line: 2, ch: 0 });
  assert.deepEqual(list.cachedCursor, { line: 4, ch: 2 });
});

test('restoreVimJumpCursor applies selection/scroll and refreshes the goal cache', () => {
  const adapter = createFakeAdapter(['alpha', 'bravo', 'charlie']);
  const state = EditorState.create({ doc: 'alpha\nbravo\ncharlie' });
  const dispatches: Array<{
    selection?: { anchor: number };
    scrollIntoView?: boolean;
  }> = [];
  const view = {
    cm: adapter,
    state,
    dispatch(spec: { selection?: { anchor: number }; scrollIntoView?: boolean }) {
      dispatches.push(spec);
    },
  } as unknown as EditorView;

  assert.equal(restoreVimJumpCursor(view, { line: 1, ch: 3 }), true);
  assert.deepEqual(dispatches[0]?.selection, { anchor: state.doc.line(2).from + 3 });
  assert.equal(dispatches[0]?.scrollIntoView, true);
  assert.equal(getVimGoalColumn(view), 3, 'the following G/gg/j/k goal is the restored column');

  // Defensive clamping and non-finite sanitization stay inside the helper.
  assert.equal(restoreVimJumpCursor(view, { line: 99, ch: 99 }), true);
  assert.equal(getVimGoalColumn(view), state.doc.line(3).length);
  assert.equal(restoreVimJumpCursor(view, { line: Number.NaN, ch: Infinity }), true);
  assert.equal(getVimGoalColumn(view), 0);

  assert.equal(restoreVimJumpCursor({ cm: null } as unknown as EditorView, { line: 0, ch: 0 }), false);
});

test('installing twice on the same object is idempotent', () => {
  const list = createList();
  installVimJumpListBridge(list);
  const add = list.add;
  installVimJumpListBridge(list);
  assert.equal(list.add, add);
});
