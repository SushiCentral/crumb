import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampJumpLocation,
  createJumpHistory,
  pruneJumpHistorySnapshot,
  type VimJumpLocation,
} from '../src/lib/vim/jump-history.ts';

const A = (line: number, ch = 0): VimJumpLocation => ({ documentId: 'A', line, ch });
const B = (line: number, ch = 0): VimJumpLocation => ({ documentId: 'B', line, ch });

function coordinates(locations: readonly VimJumpLocation[]): string[] {
  return locations.map(location => `${location.documentId}:${location.line}:${location.ch}`);
}

test('records one chronological cross-file list and walks backward then forward', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));
  history.record(A(40), B(7));
  history.record(B(7), B(90));

  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:40:0', 'B:7:0', 'B:90:0']);
  assert.equal(history.pointer(), 3);

  assert.deepEqual(history.walk(B(90), -1), B(7));
  assert.deepEqual(history.walk(B(7), -1), A(40));
  assert.deepEqual(history.walk(A(40), -1), A(2));
  assert.equal(history.walk(A(2), -1), undefined, 'the oldest entry is a hard stop');

  assert.deepEqual(history.walk(A(2), 1), A(40));
  assert.deepEqual(history.walk(A(40), 1), B(7));
  assert.deepEqual(history.walk(B(7), 1), B(90));
  assert.equal(history.walk(B(90), 1), undefined, 'the newest entry is a hard stop');
});

test('counts traverse the same list in both directions', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));
  history.record(A(40), B(7));
  history.record(B(7), B(90));

  assert.deepEqual(history.walk(B(90), -2), A(40));
  assert.deepEqual(history.walk(A(40), 2), B(90));
  assert.equal(history.walk(B(90), -4), undefined);
  assert.equal(history.walk(B(90), 4), undefined);
});

test('limits the list to 100 locations and keeps the pointer coherent', () => {
  const history = createJumpHistory();
  for (let line = 0; line < 149; line += 1) {
    history.record(A(line), A(line + 1));
  }

  assert.equal(history.entries().length, 100);
  assert.equal(history.entries()[0].line, 50);
  assert.equal(history.entries().at(-1)?.line, 149);
  assert.equal(history.pointer(), 99);
  assert.deepEqual(history.walk(A(149), -1), A(148));
});

test('a new jump truncates the forward branch', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));
  history.record(A(40), B(7));
  history.record(B(7), B(90));

  assert.deepEqual(history.walk(B(90), -2), A(40));
  history.record(A(40), B(50));

  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:40:0', 'B:50:0']);
  assert.equal(history.pointer(), 2);
  assert.equal(history.walk(B(50), 1), undefined);
  assert.deepEqual(history.walk(B(50), -1), A(40));
});

test('dedupes adjacent exact positions only', () => {
  const history = createJumpHistory();
  history.record(A(0), A(1));
  history.record(A(1), A(1));
  history.record(A(1), A(2));

  assert.deepEqual(coordinates(history.entries()), ['A:0:0', 'A:1:0', 'A:2:0']);

  // A repeat separated by another entry is not adjacent and is kept.
  history.record(A(2), A(0));
  assert.deepEqual(coordinates(history.entries()), ['A:0:0', 'A:1:0', 'A:2:0', 'A:0:0']);
});

test('preserves an unrecorded departure so forward returns there', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));

  // The user moved to A50 without a jump, then traversed backward.
  assert.deepEqual(history.walk(A(50), -1), A(40));
  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:40:0', 'A:50:0']);
  assert.deepEqual(history.walk(A(40), 1), A(50));
});

test('findSame is pure and only returns positions in the current document', () => {
  const history = createJumpHistory();
  history.record(A(2), B(7));
  history.record(B(7), A(40));
  history.record(A(40), B(90));

  assert.deepEqual(history.findSame(B(90), -1), B(7));
  assert.equal(history.findSame(B(7), -1), undefined, 'B7 itself is the nearest same-document entry');
  assert.deepEqual(history.findSame(A(40), -1), A(2), 'foreign entries are skipped, not returned');
  assert.deepEqual(history.findSame(A(41), -1), A(40));
  assert.equal(history.pointer(), 3, 'find must not move the traversal pointer');
});

test('corrects only the latest same-line destination column', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));

  history.correctDestination(A(40, 9));
  assert.deepEqual(history.entries().at(-1), A(40, 9));

  history.correctDestination(A(41, 12));
  assert.deepEqual(history.entries().at(-1), A(40, 9), 'a different line is not the native landing');

  history.correctDestination(B(40, 12));
  assert.deepEqual(history.entries().at(-1), A(40, 9), 'a different document is not the native landing');
});

test('updateCurrent replaces the selected landing even on another line', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));
  history.record(A(40), B(7));
  assert.deepEqual(history.walk(B(7), -1), A(40));
  assert.equal(history.pointer(), 1);

  history.updateCurrent(A(9, 3));
  assert.deepEqual(history.entries()[1], A(9, 3));
  assert.deepEqual(history.walk(A(9, 3), 1), B(7), 'the forward branch is not treated as a departure');

  history.updateCurrent(A(Number.NaN, 4));
  assert.deepEqual(history.entries()[1], A(9, 3), 'invalid landings are ignored');
});

test('pruneJumpHistorySnapshot removes closed entries and repairs the pointer', () => {
  const snapshot = {
    entries: [A(2), A(40), B(7), B(90)],
    pointer: 3,
  };
  const pruned = pruneJumpHistorySnapshot(snapshot, documentId => documentId === 'A');
  assert.deepEqual(coordinates(pruned.entries), ['A:2:0', 'A:40:0']);
  assert.equal(pruned.pointer, 1);
  assert.deepEqual(snapshot.entries.map(entry => entry.documentId), ['A', 'A', 'B', 'B'], 'input is not mutated');
});

test('prune drops closed documents and repairs the pointer', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));
  history.record(A(40), B(7));
  history.record(B(7), B(90));

  history.prune(documentId => documentId === 'A');
  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:40:0']);
  assert.equal(history.pointer(), 1);

  history.prune(() => false);
  assert.equal(history.entries().length, 0);
  assert.equal(history.pointer(), -1);

  history.record(A(2), A(3));
  history.record(A(3), A(4));
  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:3:0', 'A:4:0']);
});

test('a prune that removes the current entry keeps older history usable', () => {
  const history = createJumpHistory();
  history.record(A(2), A(3));
  history.record(A(3), B(1));

  history.prune(documentId => documentId === 'A');
  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:3:0']);
  assert.equal(history.pointer(), 1, 'the pointer falls back to the newest kept predecessor');

  history.record(A(3), A(4));
  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:3:0', 'A:4:0']);
  assert.equal(history.pointer(), 2);
});

test('snapshot and restore roll a rejected navigation back exactly', () => {
  const history = createJumpHistory();
  history.record(A(2), A(40));
  history.record(A(40), B(7));
  const snapshot = history.snapshot();

  history.walk(B(7), -1);
  history.walk(A(40), -1);
  assert.equal(history.pointer(), 0);

  history.restore(snapshot);
  assert.deepEqual(coordinates(history.entries()), ['A:2:0', 'A:40:0', 'B:7:0']);
  assert.equal(history.pointer(), 2);
  assert.deepEqual(history.walk(B(7), -1), A(40));
});

test('clamps line and column against the live document', () => {
  const lengths = [12, 3, 0];
  const clamp = (location: VimJumpLocation) =>
    clampJumpLocation(location, lengths.length, line => lengths[line]);

  assert.deepEqual(clamp(A(99, 99)), A(2, 0));
  assert.deepEqual(clamp(A(-4, -9)), A(0, 0));
  assert.deepEqual(clamp(A(1, 99)), A(1, 3));
  assert.deepEqual(clamp(A(0, 4)), A(0, 4));
});

test('clamps non-finite positions instead of leaking NaN into selection math', () => {
  const lengths = [12, 4, 7];
  const clamp = (location: VimJumpLocation) =>
    clampJumpLocation(location, lengths.length, line => lengths[line]);

  assert.deepEqual(clamp(A(Number.NaN, Number.NaN)), A(0, 0));
  assert.deepEqual(clamp(A(Infinity, Infinity)), A(2, 7));
  assert.deepEqual(clamp(A(-Infinity, -Infinity)), A(0, 0));
  assert.deepEqual(
    clampJumpLocation(A(2, 5), Number.NaN, () => Number.NaN),
    A(0, 0),
    'invalid document/line-length inputs fall back to the first empty position',
  );
});

test('record ignores invalid native coordinates and normalizes fractional ones', () => {
  const history = createJumpHistory();

  history.record(A(Number.NaN, 0), A(1));
  history.record(A(0), A(1, Number.NaN));
  history.record(A(-1, 0), A(1));
  history.record(A(0), A(1, Infinity));
  assert.equal(history.entries().length, 0);

  history.record(A(1.9, 2.9), A(3.9, 4.9));
  assert.deepEqual(history.entries(), [A(1, 2), A(3, 4)]);
  assert.equal(history.walk(A(Number.NaN, 0), -1), undefined);
  assert.deepEqual(history.entries(), [A(1, 2), A(3, 4)], 'an invalid walk cannot insert a departure');

  history.correctDestination(A(Number.NaN, 99));
  assert.deepEqual(history.entries().at(-1), A(3, 4));
  history.correctDestination(A(3, 8));
  assert.deepEqual(history.entries().at(-1), A(3, 8));
});

test('walking with unrecorded departures stays bounded and keeps the pointer valid', () => {
  const history = createJumpHistory();
  history.record(A(0), A(1));

  for (let index = 0; index < 150; index += 1) {
    assert.equal(history.walk(A(500 + index), 1), undefined);
    assert.ok(
      history.entries().length <= 100,
      `history grew to ${history.entries().length} entries after ${index + 1} departures`,
    );
  }

  assert.equal(history.entries().length, 100);
  assert.equal(history.pointer(), 99, 'the pointer must follow the tail after trimming');

  const target = history.walk(A(9_999), -1);
  assert.ok(target, 'a post-trim backwards walk must still resolve from the shifted pointer');
  assert.equal(history.entries().length, 100);
  assert.equal(history.pointer(), 98);
});
