/**
 * Session-owned chronological Vim jump history.
 *
 * The pinned engine keeps one native jump list per global state, but that list
 * only holds adapter-bound bookmark objects and cannot cross Crumb documents.
 * This module is the single ordered list used by both native within-file jumps
 * and Crumb file/tab transitions. It stores plain, zero-based positions only:
 * positions are clamped when restored, and edits are intentionally not tracked.
 *
 * The semantics mirror the engine's pointer model closely enough for `Ctrl-o`
 * and `Ctrl-i`:
 * - a new jump truncates the forward branch;
 * - only adjacent exact duplicates are removed;
 * - an unrecorded cursor departure is kept so the forward direction returns to
 *   where the user actually left.
 */

export interface VimJumpLocation {
  readonly documentId: string;
  readonly line: number;
  readonly ch: number;
}

export interface VimJumpHistorySnapshot {
  readonly entries: readonly VimJumpLocation[];
  readonly pointer: number;
}

export interface VimJumpHistory {
  /** Record a real jump. No-op for identical positions. */
  record(from: VimJumpLocation, to: VimJumpLocation): void;
  /**
   * Reserve the pointer for a `signedOffset` traversal and return the target.
   * Returns undefined when the traversal is out of bounds.
   */
  walk(current: VimJumpLocation, signedOffset: number): VimJumpLocation | undefined;
  /**
   * Pure lookup used by `''`/`` ` ``. Only entries in the current document are
   * considered; the history pointer is never mutated.
   */
  findSame(current: VimJumpLocation, signedOffset: number): VimJumpLocation | undefined;
  /**
   * Correct the destination column of the most recent entry after the lifecycle
   * goal-column adjustment. Only the same line is changed.
   */
  correctDestination(to: VimJumpLocation): void;
  /**
   * Replace the current (selected) entry with the actual restored landing.
   * Unlike correctDestination this may change the line, because a document can
   * have shrunk since the entry was recorded.
   */
  updateCurrent(landing: VimJumpLocation): void;
  /** Drop entries whose document is no longer open and repair the pointer. */
  prune(isDocumentOpen: (documentId: string) => boolean): void;
  snapshot(): VimJumpHistorySnapshot;
  restore(snapshot: VimJumpHistorySnapshot): void;
  /** Read-only copy, primarily for diagnostics/tests. */
  entries(): readonly VimJumpLocation[];
  /** Current pointer index, or -1 when empty. */
  pointer(): number;
}

export const DEFAULT_JUMP_HISTORY_LIMIT = 100;

function copy(location: VimJumpLocation): VimJumpLocation {
  return { documentId: location.documentId, line: location.line, ch: location.ch };
}

function samePosition(a: VimJumpLocation, b: VimJumpLocation): boolean {
  return a.documentId === b.documentId && a.line === b.line && a.ch === b.ch;
}

function isRecordableLocation(location: VimJumpLocation): boolean {
  return typeof location.documentId === 'string'
    && Number.isFinite(location.line)
    && Number.isFinite(location.ch)
    && location.line >= 0
    && location.ch >= 0;
}

function normalizeLocation(location: VimJumpLocation): VimJumpLocation {
  return {
    documentId: location.documentId,
    line: Math.trunc(location.line),
    ch: Math.trunc(location.ch),
  };
}

function finiteInteger(value: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  if (value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (value === -Infinity) return -Number.MAX_SAFE_INTEGER;
  return Math.trunc(value);
}

/**
 * Keep a location addressable in the live document. Lines are clamped to the
 * document; columns are clamped to the requested line's length. Non-finite
 * native coordinates are sanitized instead of leaking NaN into the document.
 */
export function clampJumpLocation(
  location: VimJumpLocation,
  documentLines: number,
  lineLength: (line: number) => number,
): VimJumpLocation {
  const lineCount = Number.isFinite(documentLines) ? Math.max(0, Math.trunc(documentLines)) : 0;
  const line = Math.min(
    Math.max(0, finiteInteger(location.line, 0)),
    Math.max(0, lineCount - 1),
  );
  const requestedLength = lineLength(line);
  const maxCh = Number.isFinite(requestedLength) ? Math.max(0, Math.trunc(requestedLength)) : 0;
  const ch = Math.min(Math.max(0, finiteInteger(location.ch, 0)), maxCh);
  return { documentId: location.documentId, line, ch };
}

/**
 * Prune a saved snapshot with the same pointer repair as the live history.
 * Pending-jump rollback snapshots must follow document closure; otherwise a
 * later cancel could resurrect entries for a closed document.
 */
export function pruneJumpHistorySnapshot(
  snapshot: VimJumpHistorySnapshot,
  isDocumentOpen: (documentId: string) => boolean,
): VimJumpHistorySnapshot {
  if (snapshot.entries.length === 0) return { entries: [], pointer: -1 };
  const pointer = Math.min(Math.max(-1, snapshot.pointer), snapshot.entries.length - 1);
  const currentKept = pointer >= 0 && isDocumentOpen(snapshot.entries[pointer].documentId);
  const keptBefore = snapshot.entries
    .slice(0, pointer + 1)
    .filter(entry => isDocumentOpen(entry.documentId))
    .length;
  const entries = snapshot.entries.filter(entry => isDocumentOpen(entry.documentId)).map(copy);
  if (entries.length === 0) return { entries, pointer: -1 };

  let nextPointer: number;
  if (currentKept) {
    nextPointer = Math.min(Math.max(0, keptBefore - 1), entries.length - 1);
  } else {
    nextPointer = keptBefore > 0 ? keptBefore - 1 : -1;
  }
  return { entries, pointer: nextPointer };
}

export function createJumpHistory(
  limit: number = DEFAULT_JUMP_HISTORY_LIMIT,
): VimJumpHistory {
  const boundedLimit = Math.max(
    1,
    Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_JUMP_HISTORY_LIMIT,
  );
  let entries: VimJumpLocation[] = [];
  let pointer = -1;

  function trim(): void {
    if (entries.length <= boundedLimit) return;
    const removed = entries.length - boundedLimit;
    entries = entries.slice(removed);
    pointer = Math.max(0, pointer - removed);
  }

  function truncateForward(): void {
    if (pointer < entries.length - 1) entries = entries.slice(0, pointer + 1);
  }

  function push(location: VimJumpLocation): void {
    const last = entries[entries.length - 1];
    if (last && samePosition(last, location)) {
      pointer = entries.length - 1;
      return;
    }
    entries.push(copy(location));
    pointer = entries.length - 1;
    trim();
  }

  function record(from: VimJumpLocation, to: VimJumpLocation): void {
    // Native coordinates come from the adapter; reject non-finite/negative
    // positions instead of letting NaN or an impossible line enter history.
    if (!isRecordableLocation(from) || !isRecordableLocation(to)) return;
    from = normalizeLocation(from);
    to = normalizeLocation(to);
    if (samePosition(from, to)) return;
    if (entries.length === 0) {
      entries = [copy(from)];
      pointer = 0;
      push(to);
      return;
    }
    // A prune can remove the entry the pointer addressed while keeping older
    // entries; resume from the newest surviving entry rather than discarding
    // them.
    if (pointer < 0) pointer = entries.length - 1;

    truncateForward();
    // Preserve a real departure that was not itself a recorded jump (for
    // example the cursor was moved after the last jump before this one).
    if (!samePosition(entries[pointer], from)) push(from);
    push(to);
  }

  function walk(
    current: VimJumpLocation,
    signedOffset: number,
  ): VimJumpLocation | undefined {
    if (!Number.isFinite(signedOffset) || !isRecordableLocation(current)) return undefined;
    const offset = Math.trunc(signedOffset);
    if (offset === 0 || entries.length === 0 || pointer < 0) return undefined;

    let effectivePointer = pointer;
    if (!samePosition(entries[pointer], current)) {
      // The live cursor moved without a jump. Make that departure the newest
      // entry (replacing the abandoned forward branch) so the opposite
      // traversal returns here.
      truncateForward();
      entries.push(copy(current));
      // This append must obey the same bound as record(); trim() shifts the
      // front, so recompute the effective pointer from the surviving tail.
      trim();
      effectivePointer = entries.length - 1;
      pointer = effectivePointer;
    }

    const targetPointer = effectivePointer + offset;
    if (targetPointer < 0 || targetPointer >= entries.length) {
      // Stay on the current (possibly newly preserved) departure.
      pointer = effectivePointer;
      return undefined;
    }
    pointer = targetPointer;
    return copy(entries[pointer]);
  }

  function findSame(
    current: VimJumpLocation,
    signedOffset: number,
  ): VimJumpLocation | undefined {
    if (!Number.isFinite(signedOffset) || pointer < 0 || entries.length === 0) return undefined;
    const offset = Math.trunc(signedOffset);
    if (offset === 0) return undefined;

    const step = offset < 0 ? -1 : 1;
    let remaining = Math.abs(offset);
    for (let index = pointer + step; index >= 0 && index < entries.length; index += step) {
      const entry = entries[index];
      if (entry.documentId !== current.documentId) continue;
      if (samePosition(entry, current)) continue;
      remaining -= 1;
      if (remaining === 0) return copy(entry);
    }
    return undefined;
  }

  function correctDestination(to: VimJumpLocation): void {
    if (!isRecordableLocation(to)) return;
    // Native add runs before the lifecycle goal-column correction, so only the
    // just-added tail entry can need its same-line column replaced.
    if (pointer < 0 || pointer !== entries.length - 1) return;
    const last = entries[pointer];
    if (last.documentId !== to.documentId || last.line !== to.line) return;
    entries[pointer] = { documentId: last.documentId, line: last.line, ch: to.ch };
  }

  function updateCurrent(landing: VimJumpLocation): void {
    if (!isRecordableLocation(landing) || pointer < 0 || entries.length === 0) return;
    entries[pointer] = normalizeLocation(landing);
  }

  function prune(isDocumentOpen: (documentId: string) => boolean): void {
    if (entries.length === 0) return;
    const next = pruneJumpHistorySnapshot({ entries, pointer }, isDocumentOpen);
    if (next.entries.length === entries.length) return;
    entries = next.entries.map(copy);
    pointer = next.pointer;
  }

  return {
    record,
    walk,
    findSame,
    correctDestination,
    updateCurrent,
    prune,
    snapshot() {
      return { entries: entries.map(copy), pointer };
    },
    restore(snapshot) {
      entries = snapshot.entries.map(copy);
      pointer = snapshot.entries.length === 0 || snapshot.pointer < 0
        ? -1
        : Math.min(snapshot.pointer, snapshot.entries.length - 1);
    },
    entries() {
      return entries.map(copy);
    },
    pointer() {
      return pointer;
    },
  };
}
