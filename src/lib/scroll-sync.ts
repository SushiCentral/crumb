export type ScrollRatioListener = (ratio: number) => void;

/**
 * Synchronous, module-level scroll synchronization for split panes showing the
 * same document. Exchanging ratios through React state re-rendered the whole
 * app once per scroll frame and moved the peer scrollbar one frame late, which
 * made the two bars visibly fight. Publishing through plain subscriptions
 * keeps both bars in the same frame with no React work at all.
 */

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
  // Echo suppression by value, not by time: a frame-based flag would swallow
  // a genuine user scroll that arrives within the same frame.
  let programmaticRatio: number | null = null;

  const unsubscribe = subscribeScrollRatio(tabId, ratio => {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    if (Math.abs(el.scrollTop / max - ratio) <= 0.005) return;
    programmaticRatio = ratio;
    el.scrollTop = ratio * max;
  });

  const report = () => {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    const ratio = el.scrollTop / max;
    if (programmaticRatio != null) {
      const echoed = Math.abs(ratio - programmaticRatio) <= 0.005;
      programmaticRatio = null;
      if (echoed) return;
    }
    publishScrollRatio(tabId, ratio);
  };
  el.addEventListener('scroll', report, { passive: true });

  return () => {
    el.removeEventListener('scroll', report);
    unsubscribe();
  };
}
