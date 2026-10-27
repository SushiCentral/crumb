import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleCommentOperator,
  visualCommentCursor,
} from '../src/lib/vim/comments.ts';

type OperatorCm = Parameters<typeof toggleCommentOperator>[0];
type OperatorArgs = Parameters<typeof toggleCommentOperator>[1];
type OperatorRanges = Parameters<typeof toggleCommentOperator>[2];
type OperatorPos = NonNullable<Parameters<typeof toggleCommentOperator>[4]>;

interface RangeLike {
  anchor: { line: number; ch: number };
  head: { line: number; ch: number };
}

function pos(line: number, ch: number): OperatorPos {
  return { line, ch };
}

function fakeCm(options: {
  visualMode?: boolean;
  lines?: readonly string[];
} = {}): { cm: OperatorCm; calls: string[] } {
  const calls: string[] = [];
  const cm = {
    state: { vim: { visualMode: options.visualMode ?? true } },
    execCommand(name: string) {
      calls.push(`exec:${name}`);
    },
    getLine(line: number) {
      calls.push(`getLine:${line}`);
      return options.lines?.[line] ?? '';
    },
  };
  return { cm: cm as unknown as OperatorCm, calls };
}

function runOperator(
  cm: OperatorCm,
  ranges: readonly RangeLike[],
  newHead: OperatorPos | undefined,
): ReturnType<typeof toggleCommentOperator> {
  return toggleCommentOperator(
    cm,
    {} as OperatorArgs,
    ranges as unknown as OperatorRanges,
    pos(0, 0),
    newHead,
  );
}

test('visual gc returns a concrete cursor on the top selected line', () => {
  const { cm, calls } = fakeCm({
    visualMode: true,
    lines: ['  const alpha = 1;', '  const beta = 2;', 'const gamma = 3;'],
  });

  const result = runOperator(cm, [
    { anchor: { line: 0, ch: 4 }, head: { line: 1, ch: 6 } },
  ], undefined);

  assert.deepEqual(result, { line: 0, ch: 2 });
  // Exactly the comment command plus the line read needed for the cursor.
  // No extra document transaction is issued by the operator itself.
  assert.deepEqual(calls, ['exec:toggleLineComment', 'getLine:0']);
});

test('visual gc normalizes an upward/reversed selection to the top line', () => {
  const { cm, calls } = fakeCm({
    visualMode: true,
    lines: ['\tconst alpha = 1;', '  const beta = 2;'],
  });

  const result = runOperator(cm, [
    { anchor: { line: 1, ch: 8 }, head: { line: 0, ch: 6 } },
  ], undefined);

  assert.deepEqual(result, { line: 0, ch: 1 });
  assert.deepEqual(calls, ['exec:toggleLineComment', 'getLine:0']);
});

test('visual gc picks the top line from multiple block ranges', () => {
  const { cm, calls } = fakeCm({
    visualMode: true,
    lines: ['  const alpha = 1;', '  const beta = 2;', '  const gamma = 3;'],
  });

  const result = runOperator(cm, [
    { anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 5 } },
    { anchor: { line: 2, ch: 2 }, head: { line: 2, ch: 5 } },
  ], undefined);

  assert.deepEqual(result, { line: 1, ch: 2 });
  assert.deepEqual(calls, ['exec:toggleLineComment', 'getLine:1']);
});

test('normal gc preserves the engine newHead object identity', () => {
  const newHead = pos(0, 7);
  const { cm, calls } = fakeCm({
    visualMode: false,
    lines: ['const alpha = 1;'],
  });

  const result = runOperator(cm, [
    { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 16 } },
  ], newHead);

  assert.strictEqual(result, newHead);
  assert.deepEqual(calls, ['exec:toggleLineComment']);
});

test('visual gc still returns a cursor when toggleLineComment makes no edit', () => {
  const { cm, calls } = fakeCm({
    visualMode: true,
    lines: ['alpha beta', 'second line'],
  });

  // The fake command intentionally leaves the document untouched. This is the
  // no-language/no-comment-token case: the operator must still return a cursor
  // so the engine can collapse the ranged selection while exiting Visual mode.
  const result = runOperator(cm, [
    { anchor: { line: 0, ch: 0 }, head: { line: 1, ch: 0 } },
  ], undefined);

  assert.deepEqual(result, { line: 0, ch: 0 });
  assert.equal(calls.filter(call => call === 'exec:toggleLineComment').length, 1);
});

test('visual gc falls back to the end of an all-whitespace top line', () => {
  const { cm } = fakeCm({
    visualMode: true,
    lines: ['   ', 'second line'],
  });

  const result = runOperator(cm, [
    { anchor: { line: 0, ch: 1 }, head: { line: 1, ch: 0 } },
  ], undefined);

  assert.deepEqual(result, { line: 0, ch: 3 });
});

test('visual gc returns undefined without any ranges', () => {
  const { cm } = fakeCm({ visualMode: true, lines: ['alpha'] });

  assert.equal(runOperator(cm, [], undefined), undefined);
});

test('visualCommentCursor reads only the normalized top line', () => {
  const calls: number[] = [];
  const cm = {
    getLine(line: number) {
      calls.push(line);
      return line === 1 ? '  indented' : 'unused';
    },
  };

  assert.deepEqual(
    visualCommentCursor(cm as unknown as OperatorCm, [
      { anchor: pos(2, 5), head: pos(1, 4) },
    ] as unknown as OperatorRanges),
    { line: 1, ch: 2 },
  );
  assert.deepEqual(calls, [1]);
});
