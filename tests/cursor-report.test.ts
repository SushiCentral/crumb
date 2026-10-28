import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCursorReporter, CURSOR_STATUS_IDLE_MS, type CursorScheduler } from '../src/lib/cursor-report.ts';
import type { CursorInfo } from '../src/lib/editor-extensions.ts';

interface FakeScheduler extends CursorScheduler {
  runAll(): void;
  pending(): number;
}

function fakeScheduler(): FakeScheduler {
  let nextId = 1;
  const tasks = new Map<number, () => void>();
  return {
    schedule(callback) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, callback);
      return id;
    },
    cancel(handle) {
      tasks.delete(handle as number);
    },
    runAll() {
      for (const [id, callback] of [...tasks]) {
        tasks.delete(id);
        callback();
      }
    },
    pending() {
      return tasks.size;
    },
  };
}

const cursor = (line: number): CursorInfo => ({ line, column: 1, selected: 0 });

function recorder() {
  const emitted: CursorInfo[] = [];
  return { emitted, emit: (value: CursorInfo) => emitted.push(value) };
}

test('the status-bar idle delay is short enough to feel live', () => {
  assert.equal(CURSOR_STATUS_IDLE_MS, 120);
});

test('a burst of selection changes publishes once, with the latest cursor', () => {
  const scheduler = fakeScheduler();
  const { emitted, emit } = recorder();
  const reporter = createCursorReporter(emit, 120, scheduler);

  for (let line = 1; line <= 10; line += 1) reporter.reportLater(cursor(line));
  assert.deepEqual(emitted, []);
  assert.equal(scheduler.pending(), 1);

  scheduler.runAll();
  assert.deepEqual(emitted, [cursor(10)]);
  assert.equal(scheduler.pending(), 0);
});

test('each new movement restarts the idle window', () => {
  const scheduler = fakeScheduler();
  const { emitted, emit } = recorder();
  const reporter = createCursorReporter(emit, 120, scheduler);

  reporter.reportLater(cursor(1));
  scheduler.runAll();
  reporter.reportLater(cursor(2));
  // A late cursor must not be published while the burst is still moving.
  reporter.reportLater(cursor(3));
  assert.deepEqual(emitted, [cursor(1)]);
  scheduler.runAll();
  assert.deepEqual(emitted, [cursor(1), cursor(3)]);
});

test('a synchronous report supersedes a pending selection snapshot', () => {
  const scheduler = fakeScheduler();
  const { emitted, emit } = recorder();
  const reporter = createCursorReporter(emit, 120, scheduler);

  reporter.reportLater(cursor(4));
  reporter.reportNow(cursor(9));
  assert.deepEqual(emitted, [cursor(9)]);
  assert.equal(scheduler.pending(), 0);

  scheduler.runAll();
  assert.deepEqual(emitted, [cursor(9)]);
});

test('a synchronous report during a long hold cancels the trailing timer', () => {
  const scheduler = fakeScheduler();
  const { emitted, emit } = recorder();
  const reporter = createCursorReporter(emit, 120, scheduler);

  reporter.reportLater(cursor(7));
  reporter.reportNow(cursor(8));
  reporter.reportLater(cursor(9));
  assert.deepEqual(emitted, [cursor(8)]);

  scheduler.runAll();
  assert.deepEqual(emitted, [cursor(8), cursor(9)]);
});

test('cancel drops a pending snapshot without publishing', () => {
  const scheduler = fakeScheduler();
  const { emitted, emit } = recorder();
  const reporter = createCursorReporter(emit, 120, scheduler);

  reporter.reportLater(cursor(5));
  reporter.cancel();
  assert.equal(scheduler.pending(), 0);
  scheduler.runAll();
  assert.deepEqual(emitted, []);
});

test('repeated synchronous reports are never coalesced', () => {
  const scheduler = fakeScheduler();
  const { emitted, emit } = recorder();
  const reporter = createCursorReporter(emit, 120, scheduler);

  reporter.reportNow(cursor(1));
  reporter.reportNow(cursor(2));
  assert.deepEqual(emitted, [cursor(1), cursor(2)]);
  assert.equal(scheduler.pending(), 0);
});
