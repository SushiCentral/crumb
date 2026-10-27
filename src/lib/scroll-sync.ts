export type ScrollRatioListener = (ratio: number) => void;

/**
 * Synchronous, module-level scroll synchronization for split panes showing the
 * same document. Exchanging ratios through React state re-rendered the whole
 * app once per scroll frame and moved the peer scrollbar one frame late, which
 * made the two bars visibly fight. Publishing through plain subscriptions
 * keeps both bars in the same frame with no React work at all.
 */

/** Positional tolerance in CSS pixels, independent of document length. */
const TOLERANCE_PX = 1;

const listeners = new Map<string, Set<ScrollRatioListener>>();

export function subscribeScrollRatio(tabId: string, listener: ScrollRatioListener): () => void {
  let registered = listeners.get(tabId);
  if (!registered) {
    registered = new Set();
    listeners.set(tabId, registered);
  }
  registered.add(listener);
  return () => {
    registered.delete(listener);
    if (registered.size === 0) listeners.delete(tabId);
  };
}

export function publishScrollRatio(tabId: string, ratio: number): void {
  const registered = listeners.get(tabId);
  if (!registered) return;
  // Snapshot: handlers may unsubscribe or publish for other tabs mid-delivery.
  for (const listener of Array.from(registered)) listener(ratio);
}

export function attachScrollSync(el: HTMLElement, tabId: string): () => void {
  // Echo suppression compares the offset the browser actually accepted for a
  // programmatic write with the offset reported by the resulting scroll event.
  // A ratio-based test widens with document length (0.005 of a million-pixel
  // document is 5,000px) and can swallow a genuine user scroll.
  let expectedOffset: number | null = null;

  const unsubscribe = subscribeScrollRatio(tabId, ratio => {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    const target = ratio * max;
    if (Math.abs(el.scrollTop - target) <= TOLERANCE_PX) return;
    el.scrollTop = target;
    // Read back: browsers clamp to the scroll range and may round the value.
    expectedOffset = el.scrollTop;
  });

  const report = () => {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    if (expectedOffset != null) {
      const echoed = Math.abs(el.scrollTop - expectedOffset) <= TOLERANCE_PX;
      expectedOffset = null;
      if (echoed) return;
    }
    publishScrollRatio(tabId, el.scrollTop / max);
  };
  el.addEventListener('scroll', report, { passive: true });

  return () => {
    el.removeEventListener('scroll', report);
    unsubscribe();
  };
}
