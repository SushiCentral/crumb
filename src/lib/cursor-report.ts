import type { CursorInfo } from './editor-extensions.ts';

/**
 * Status-bar cursor reporting.
 *
 * Every selection change used to publish a cursor snapshot on the next animation
 * frame, and App re-renders the whole window to show the new line/column. During
 * a held navigation key that costs a full App render per frame, which saturates
 * the main thread: keydowns pile up in the browser's input queue and keep moving
 * the cursor after the key is released.
 *
 * This reporter keeps the snapshot cheap: selection-only changes are coalesced
 * and published once the burst of movement settles. The editor itself still
 * paints every move immediately; only the status bar trails by `idleMs`.
 * Document edits, tab switches, and mounts use `reportNow`, so no stale snapshot
 * can overwrite a committed change.
 */

export interface CursorScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const timeoutScheduler: CursorScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface CursorReporter {
  /** Publish immediately, cancelling any pending selection-only snapshot. */
  reportNow(cursor: CursorInfo): void;
  /** Publish the latest snapshot once selection changes stop for `idleMs`. */
  reportLater(cursor: CursorInfo): void;
  /** Drop a pending snapshot (unmount). */
  cancel(): void;
}

/** How long keystroke movement must be quiet before the status bar updates. */
export const CURSOR_STATUS_IDLE_MS = 120;

export function createCursorReporter(
  emit: (cursor: CursorInfo) => void,
  idleMs: number = CURSOR_STATUS_IDLE_MS,
  scheduler: CursorScheduler = timeoutScheduler,
): CursorReporter {
  let pending: CursorInfo | null = null;
  let handle: unknown = null;

  const cancel = () => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
    pending = null;
  };

  return {
    cancel,
    reportNow(cursor) {
      // A synchronous report supersedes any deferred selection-only report, so
      // a later timer cannot overwrite it with a stale cursor.
      cancel();
      emit(cursor);
    },
    reportLater(cursor) {
      // Only the latest cursor matters; the timer restarts with the burst so a
      // long hold produces no React work at all.
      pending = cursor;
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      handle = scheduler.schedule(() => {
        handle = null;
        const next = pending;
        pending = null;
        if (next) emit(next);
      }, idleMs);
    },
  };
}
