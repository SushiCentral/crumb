import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishScrollRatio, subscribeScrollRatio, attachScrollSync } from '../src/lib/scroll-sync.ts';

type Handler = (event?: unknown) => void;

// A plain object standing in for a scrollable element. Writes to scrollTop
// dispatch the scroll event on the next microtask, like a real element.
function fakeScroller(content: number, viewport: number) {
  const listeners = new Map<string, Set<Handler>>();
  let offset = 0;
  const emit = () => { for (const handler of Array.from(listeners.get('scroll') ?? [])) handler(); };
  const el = {
    scrollHeight: content,
    clientHeight: viewport,
    get scrollTop() { return offset; },
    set scrollTop(value: number) {
      offset = value;
      queueMicrotask(emit);
    },
    addEventListener(kind: string, handler: Handler) {
      const set = listeners.get(kind) ?? new Set();
      set.add(handler);
      listeners.set(kind, set);
    },
    removeEventListener(kind: string, handler: Handler) { listeners.get(kind)?.delete(handler); },
  };
  // A user scroll: clamp like real scrolling, then dispatch through the setter.
  (el as Record<string, unknown>).scroll = (offset: number) => { el.scrollTop = Math.max(0, Math.min(content - viewport, offset)); };
  return el;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('publishes ratios synchronously to subscribers of the same tab only', () => {
  const a: number[] = [];
  const b: number[] = [];
  const stopA = subscribeScrollRatio('tab-1', ratio => a.push(ratio));
  const stopB = subscribeScrollRatio('tab-2', ratio => b.push(ratio));
  publishScrollRatio('tab-1', 0.25);
  publishScrollRatio('tab-2', 0.75);
  publishScrollRatio('unknown-tab', 0.5);
  assert.deepEqual(a, [0.25]);
  assert.deepEqual(b, [0.75]);
  stopA();
  stopB();
});

test('stopping a subscription removes delivery', () => {
  const seen: number[] = [];
  const stop = subscribeScrollRatio('tab-unsub', ratio => seen.push(ratio));
  publishScrollRatio('tab-unsub', 1);
  stop();
  publishScrollRatio('tab-unsub', 2);
  assert.deepEqual(seen, [1]);
});

test('a handler may unsubscribe or publish for another tab during delivery', () => {
  const late: number[] = [];
  const stopLate = subscribeScrollRatio('tab-loop', ratio => late.push(ratio));
  subscribeScrollRatio('tab-loop', () => {
    stopLate();
    publishScrollRatio('other-tab', 0.9);
  });
  assert.doesNotThrow(() => publishScrollRatio('tab-loop', 0.1));
  assert.deepEqual(late, [0.1]);
});

test('user scrolls move peer elements without echo feedback', async () => {
  const first = fakeScroller(2000, 200) as unknown as HTMLElement;
  const second = fakeScroller(2000, 200) as unknown as HTMLElement;
  const publishes: number[] = [];
  subscribeScrollRatio('tab-sync', ratio => publishes.push(ratio));

  const detachFirst = attachScrollSync(first, 'tab-sync');
  const detachSecond = attachScrollSync(second, 'tab-sync');

  ((first as unknown as { scroll(offset: number): void }).scroll)(900);
  await flush();
  assert.equal(first.scrollTop, 900);
  // 900/1800 == 0.5, peer target 0.5 * 1800 == 900.
  assert.equal(second.scrollTop, 900);
  // One user scroll publishes once; the programmatic peer write must not echo.
  assert.equal(publishes.length, 1);

  ((second as unknown as { scroll(offset: number): void }).scroll)(270);
  await flush();
  // 270/1800 == 0.15, peer target 0.15 * 1800 == 270.
  assert.equal(first.scrollTop, 270);
  assert.equal(second.scrollTop, 270);
  assert.equal(publishes.length, 2);

  detachFirst();
  detachSecond();
});

test('peers inside the sync threshold stay put', async () => {
  const preview = fakeScroller(2000, 200) as unknown as HTMLElement;
  const detach = attachScrollSync(preview, 'tab-threshold');
  const before = preview.scrollTop;

  // 0.004 of the scrollable range: inside the jitter threshold.
  publishScrollRatio('tab-threshold', 0.004);
  await flush();
  assert.equal(preview.scrollTop, before);

  publishScrollRatio('tab-threshold', 0.5);
  await flush();
  assert.equal(preview.scrollTop, 900);
  detach();
});

test('a fully visible document publishes nothing and cannot be moved', async () => {
  const staticPane = fakeScroller(200, 200) as unknown as HTMLElement;
  const observations: number[] = [];
  const stop = subscribeScrollRatio('tab-static', ratio => observations.push(ratio));
  const detach = attachScrollSync(staticPane, 'tab-static');

  // Scrolling a pane without room never publishes.
  ((staticPane as unknown as { scroll(offset: number): void }).scroll)(100);
  await flush();
  assert.deepEqual(observations, []);

  // A published ratio is still delivered, but the pane stays put.
  publishScrollRatio('tab-static', 0.2);
  await flush();
  assert.equal(staticPane.scrollTop, 0);
  assert.deepEqual(observations, [0.2]);
  stop();
  detach();
});

test('detached elements no longer publish or follow peers', async () => {
  const left = fakeScroller(2000, 200) as unknown as HTMLElement;
  const right = fakeScroller(2000, 200) as unknown as HTMLElement;
  const publishes: number[] = [];
  const stop = subscribeScrollRatio('tab-detached', ratio => publishes.push(ratio));
  const detachLeft = attachScrollSync(left, 'tab-detached');

  ((left as unknown as { scroll(offset: number): void }).scroll)(180);
  await flush();
  detachLeft();
  assert.equal(publishes.length, 1);

  // Attached peer no longer follows manual publishes after its source detached…
  publishScrollRatio('tab-detached', 0.25);
  await flush();
  assert.equal(right.scrollTop, 0);

  // …and a detached element never publishes again.
  publishes.length = 0;
  ((left as unknown as { scroll(offset: number): void }).scroll)(720);
  await flush();
  assert.deepEqual(publishes, []);
  stop();
  detachLeft();
});
