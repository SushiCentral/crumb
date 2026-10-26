import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishScrollRatio, subscribeScrollRatio, attachScrollSync } from '../src/lib/scroll-sync.ts';

type Handler = (event?: unknown) => void;

// A plain object standing in for a scrollable element. Writes to scrollTop
// dispatch the scroll event on the next microtask, like a real element.
function fakeScroller(content: number, viewport: number) {
  const listeners = new Map<string, Set<Handler>>();
  let offset = 0;
  let pendingEmit = false;
  const emit = () => { for (const handler of Array.from(listeners.get('scroll') ?? [])) handler(); };
  // Browsers coalesce multiple scrollTop writes into one scroll event.
  const scheduleEmit = () => {
    if (pendingEmit) return;
    pendingEmit = true;
    queueMicrotask(() => {
      pendingEmit = false;
      emit();
    });
  };
  const el = {
    scrollHeight: content,
    clientHeight: viewport,
    get scrollTop() { return offset; },
    set scrollTop(value: number) {
      offset = Math.max(0, Math.min(content - viewport, value));
      scheduleEmit();
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

test('peers inside the one-pixel sync threshold stay put', async () => {
  const preview = fakeScroller(2000, 200) as unknown as HTMLElement;
  const detach = attachScrollSync(preview, 'tab-threshold');
  const before = preview.scrollTop;

  // One CSS pixel of the 1,800px scrollable range is jitter, not a move.
  publishScrollRatio('tab-threshold', 1 / 1800);
  await flush();
  assert.equal(preview.scrollTop, before);

  publishScrollRatio('tab-threshold', 0.5);
  await flush();
  assert.equal(preview.scrollTop, 900);
  detach();
});

test('the tolerance stays one CSS pixel on very long documents', async () => {
  // 1,000,000px of scrollable range: the old 0.005 ratio threshold equalled
  // 5,000px here, so it ignored real position changes.
  const pane = fakeScroller(1_000_010, 10) as unknown as HTMLElement;
  const detach = attachScrollSync(pane, 'tab-long-threshold');

  publishScrollRatio('tab-long-threshold', 0.5);
  await flush();
  assert.equal(pane.scrollTop, 500_000);

  // One pixel of jitter stays put…
  publishScrollRatio('tab-long-threshold', 500_001 / 1_000_000);
  await flush();
  assert.equal(pane.scrollTop, 500_000);

  // …while ten pixels is a real move and must be applied.
  publishScrollRatio('tab-long-threshold', 500_010 / 1_000_000);
  await flush();
  assert.ok(Math.abs(pane.scrollTop - 500_010) < 1e-6);
  detach();
});

test('a genuine scroll after a programmatic sync is published despite its tiny ratio delta', async () => {
  const left = fakeScroller(1_000_010, 10) as unknown as HTMLElement;
  const right = fakeScroller(1_000_010, 10) as unknown as HTMLElement;
  const publishes: number[] = [];
  const stop = subscribeScrollRatio('tab-long-echo', ratio => publishes.push(ratio));
  const detachLeft = attachScrollSync(left, 'tab-long-echo');
  const detachRight = attachScrollSync(right, 'tab-long-echo');

  // The peer write and the user's follow-up scroll both happen before the
  // browser delivers the coalesced scroll event. The reported offset is 200px
  // away from the assigned one, but only 0.0002 away as a ratio.
  publishScrollRatio('tab-long-echo', 0.5);
  ((right as unknown as { scroll(offset: number): void }).scroll)(500_200);
  await flush();

  assert.equal(right.scrollTop, 500_200);
  assert.equal(left.scrollTop, 500_200);
  assert.ok(publishes.some(ratio => Math.abs(ratio - 0.5002) < 1e-9));
  stop();
  detachLeft();
  detachRight();
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
