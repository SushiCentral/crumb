import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { VimMapping } from '../src/lib/vim/config.ts';
import {
  VIM_FLASH_LABELS,
  VIM_JUMP_LABELS,
  chooseFlashTarget,
  findFlashMatches,
  flashContinuationExclusions,
  isFlashCaseSensitive,
  labelFlashMatches,
  rememberFlashLabels,
} from '../src/lib/vim/jump-model.ts';
import {
  vimJumpOperatorSuppressedByMappings,
  vimJumpSuppressedByMappings,
} from '../src/lib/vim/jump.ts';

interface TraceResult {
  offset: number;
  label: string | null;
}

interface TraceStep {
  matchCount: number;
  targetOffset: number;
  targetLabel: string;
  expectedAnchorLabels: { importTime: string | null; runtime: string | null };
  results: TraceResult[];
}

interface FlashTrace {
  fixture: {
    sha256: string;
    utf16Length: number;
    viewport: { endOffset: number };
  };
  anchors: { importTime: { offset: number }; runtime: { offset: number } };
  expectedSequence: Record<string, { importTime: string | null; runtime: string | null }>;
  traces: Record<string, TraceStep>;
}

const trace = JSON.parse(
  readFileSync(new URL('./fixtures/vim-flash-traces.json', import.meta.url), 'utf8'),
) as FlashTrace;
const pythonFixtureBytes = readFileSync(
  new URL('./fixtures/vim-flash-python.py', import.meta.url),
);
const pythonFixture = pythonFixtureBytes.toString('utf8');
const viewport = { from: 0, to: trace.fixture.viewport.endOffset };

function labelsByOffset(matches: readonly { from: number; label?: string }[]): Map<number, string | null> {
  return new Map(matches.map(match => [match.from, match.label ?? null]));
}

function traceLabels(results: readonly TraceResult[]): Map<number, string | null> {
  return new Map(results.map(result => [result.offset, result.label]));
}

test('the checked-in Python fixture matches its recorded provenance', () => {
  assert.equal(
    createHash('sha256').update(pythonFixtureBytes).digest('hex'),
    trace.fixture.sha256,
  );
  assert.equal(pythonFixture.length, trace.fixture.utf16Length);
  assert.deepEqual(Object.keys(trace.traces), ['t', 'ti', 'tim', 'time']);
});

test('literal matching is viewport-bound and labels nearest first', () => {
  const text = 'alpha beta alpha gamma alpha';
  const matches = findFlashMatches(text, 'alpha', [{ from: 0, to: text.length }]);
  const labelled = labelFlashMatches(text, 'alpha', matches, 10).matches;

  assert.deepEqual(
    labelled.map(match => [match.from, match.to, match.label]),
    [
      [11, 16, 'a'],
      [0, 5, 's'],
      [23, 28, 'd'],
    ],
  );

  const visibleOnly = findFlashMatches(text, 'alpha', [{ from: 6, to: text.length }]);
  assert.deepEqual(visibleOnly.map(match => match.from), [11, 23]);
});

test('the full lower and upper home-row alphabet labels matches and extras stay unlabelled', () => {
  assert.equal(VIM_JUMP_LABELS, 'asdfghjklqwertyuiopzxcvbnm');
  assert.equal(VIM_FLASH_LABELS, 'asdfghjklqwertyuiopzxcvbnmASDFGHJKLQWERTYUIOPZXCVBNM');

  const exactly52 = 'x '.repeat(52).trimEnd();
  const fiftyTwoMatches = findFlashMatches(exactly52, 'x', [{ from: 0, to: exactly52.length }]);
  const labelled = labelFlashMatches(exactly52, 'x', fiftyTwoMatches, 102).matches;
  assert.equal(labelled.length, 52);
  assert.deepEqual(labelled.map(match => match.label), [...VIM_FLASH_LABELS]);
  assert.deepEqual(
    labelled.map(match => match.from),
    Array.from({ length: 52 }, (_, index) => 102 - index * 2),
  );

  const sixty = 'x '.repeat(60).trimEnd();
  const sixtyMatches = findFlashMatches(sixty, 'x', [{ from: 0, to: sixty.length }]);
  const extra = labelFlashMatches(sixty, 'x', sixtyMatches, 0).matches;
  assert.equal(extra.length, 60);
  assert.deepEqual(
    extra.slice(0, 52).map(match => match.label),
    [...VIM_FLASH_LABELS],
  );
  assert.deepEqual(extra.slice(52).map(match => match.label), Array(8).fill(undefined));
});

test('Unicode case folding preserves UTF-16 offsets for matches, continuation, and target', () => {
  const text = 'İ time';

  for (const [query, expectedEnd] of [['t', 3], ['ti', 4], ['tim', 5], ['time', 6]] as const) {
    const matches = findFlashMatches(text, query, [{ from: 0, to: text.length }]);
    assert.deepEqual(matches, [{ from: 2, to: expectedEnd }], query);
    assert.equal(chooseFlashTarget(matches, 0)?.from, 2, `${query} target`);
  }

  const labelled = labelFlashMatches(
    text,
    't',
    findFlashMatches(text, 't', [{ from: 0, to: text.length }]),
    0,
  ).matches;
  assert.deepEqual(labelled.map(match => [match.from, match.label]), [[2, 'a']]);

  const exclusions = flashContinuationExclusions('İ time. İ time,', 'time');
  assert.deepEqual([...exclusions].sort(), [',', '.']);
});

test('fragmented coarse ranges scan once without losing or duplicating matches', () => {
  const text = 'alpha beta alpha gamma alpha';
  const ranges = [
    { from: 11, to: 16 },
    { from: 0, to: 5 },
    { from: 10, to: 20 },
    { from: 0, to: 3 },
    { from: 23, to: 28 },
  ];

  assert.deepEqual(
    findFlashMatches(text, 'alpha', ranges).map(match => [match.from, match.to]),
    [
      [0, 5],
      [11, 16],
      [23, 28],
    ],
  );
});

test('matching uses local ignorecase plus smartcase', () => {
  const text = 'Time time TIME timeout';
  const all = findFlashMatches(text, 'time', [{ from: 0, to: text.length }]);
  assert.deepEqual(all.map(match => match.from), [0, 5, 10, 15]);

  assert.equal(isFlashCaseSensitive('time'), false);
  assert.equal(isFlashCaseSensitive('Time'), true);
  assert.deepEqual(
    findFlashMatches(text, 'Time', [{ from: 0, to: text.length }]).map(match => match.from),
    [0],
  );
  assert.deepEqual(
    findFlashMatches(text, 'TIME', [{ from: 0, to: text.length }]).map(match => match.from),
    [10],
  );
});

test('continuation exclusions honor smartcase across the whole document', () => {
  const text = 'timeA timea TimeZ timea';

  const insensitive = flashContinuationExclusions(text, 'time');
  assert.ok(insensitive.has('a'));
  assert.ok(insensitive.has('A'));
  assert.ok(insensitive.has('z'));
  assert.ok(insensitive.has('Z'));

  const sensitive = flashContinuationExclusions(text, 'Time');
  assert.ok(sensitive.has('Z'));
  assert.ok(!sensitive.has('a'));
  assert.ok(!sensitive.has('A'));
});

test('upstream Python trace labels anchors and target exactly', () => {
  const previousLabels = new Map<number, string>();
  const anchors = trace.anchors;

  for (const query of ['t', 'ti', 'tim', 'time']) {
    const expected = trace.traces[query];
    const matches = findFlashMatches(pythonFixture, query, [viewport]);
    const result = labelFlashMatches(pythonFixture, query, matches, 0, { previousLabels });

    assert.equal(result.matches.length, expected.matchCount, `${query} match count`);
    assert.equal(result.target?.from, expected.targetOffset, `${query} target offset`);
    assert.equal(result.target?.label, expected.targetLabel, `${query} target label`);

    const actualLabels = labelsByOffset(result.matches);
    const expectedLabels = traceLabels(expected.results);
    for (const [offset, label] of expectedLabels) {
      assert.equal(actualLabels.get(offset), label, `${query} label at ${offset}`);
    }

    assert.equal(
      actualLabels.get(anchors.importTime.offset),
      trace.expectedSequence[query].importTime,
      `${query} import time`,
    );
    assert.equal(
      actualLabels.get(anchors.runtime.offset),
      trace.expectedSequence[query].runtime,
      `${query} runtime`,
    );

    rememberFlashLabels(previousLabels, result.matches);
  }
});

test('uppercase labels are not reused across refinements', () => {
  const previousLabels = new Map<number, string>([
    [trace.anchors.importTime.offset, 'F'],
    [trace.anchors.runtime.offset, 'u'],
  ]);
  const matches = findFlashMatches(pythonFixture, 'time', [viewport]);
  const result = labelFlashMatches(pythonFixture, 'time', matches, 0, { previousLabels });

  const labels = labelsByOffset(result.matches);
  assert.equal(labels.get(trace.anchors.importTime.offset), 'a');
  assert.equal(labels.get(trace.anchors.runtime.offset), 'u');
});

test('lowercase labels are reused before new alphabet keys', () => {
  const text = 'ab ab ab';
  const matches = findFlashMatches(text, 'ab', [{ from: 0, to: text.length }]);
  const result = labelFlashMatches(text, 'ab', matches, 0, {
    previousLabels: new Map([[6, 's']]),
  });

  assert.deepEqual(
    result.matches.map(match => [match.from, match.label]),
    [
      [0, 'a'],
      [3, 'd'],
      [6, 's'],
    ],
  );
});

test('collision filtering removes continuation characters from the label pool', () => {
  const text = 'q.a q.b q.a';
  const matches = findFlashMatches(text, 'q.', [{ from: 0, to: text.length }]);
  const result = labelFlashMatches(text, 'q.', matches, 0);

  assert.deepEqual(result.matches.map(match => match.label), ['s', 'd', 'f']);
  assert.ok(!result.matches.some(match => match.label === 'a' || match.label === 'b'));
});

test('Enter target is the next forward match from the activation cursor, wrapping', () => {
  const text = 'x x x';
  const matches = findFlashMatches(text, 'x', [{ from: 0, to: text.length }]);
  const labelled = labelFlashMatches(text, 'x', matches, 2).matches;

  assert.equal(chooseFlashTarget(labelled, 2)?.from, 4);
  assert.equal(chooseFlashTarget(labelled, 4)?.from, 0);
  assert.equal(chooseFlashTarget(labelled, 4, false), null);
});

test('counts select the Nth forward/wrapped Flash target', () => {
  const text = 'x x x x';
  const matches = findFlashMatches(text, 'x', [{ from: 0, to: text.length }]);
  const labelled = labelFlashMatches(text, 'x', matches, 0).matches;

  assert.equal(chooseFlashTarget(labelled, 0, true, 1)?.from, 2);
  assert.equal(chooseFlashTarget(labelled, 0, true, 2)?.from, 4);
  assert.equal(chooseFlashTarget(labelled, 0, true, 4)?.from, 0);
});

test('configured operator gs mappings keep ownership', () => {
  const mapping = (lhs: string, modes: VimMapping['modes']): VimMapping => ({
    lhs,
    rhs: 'l',
    modes,
  });

  assert.equal(vimJumpOperatorSuppressedByMappings([mapping('gs', ['operator'])]), true);
  assert.equal(vimJumpOperatorSuppressedByMappings([mapping('gs', ['normal'])]), false);
  assert.equal(vimJumpOperatorSuppressedByMappings([mapping('gS', ['operator'])]), false);
});

test('configured Normal or Visual s mappings keep ownership', () => {
  const mapping = (lhs: string, modes: VimMapping['modes']): VimMapping => ({
    lhs,
    rhs: 'x',
    modes,
  });

  assert.equal(vimJumpSuppressedByMappings([mapping('s', ['normal'])]), true);
  assert.equal(vimJumpSuppressedByMappings([mapping('s', ['visual'])]), true);
  assert.equal(vimJumpSuppressedByMappings([mapping('s', ['insert'])]), false);
  assert.equal(vimJumpSuppressedByMappings([mapping('S', ['normal'])]), false);
});
