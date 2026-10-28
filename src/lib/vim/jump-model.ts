/** Pure Flash matching and label policy, independent of CodeMirror view state. */

export const VIM_JUMP_LABELS = 'asdfghjklqwertyuiopzxcvbnm';
export const VIM_FLASH_LABELS = VIM_JUMP_LABELS + VIM_JUMP_LABELS.toUpperCase();

export interface FlashRange {
  readonly from: number;
  readonly to: number;
}

export interface FlashMatch {
  readonly from: number;
  readonly to: number;
  readonly label?: string;
}

export interface FlashLabelOptions {
  readonly labels?: string;
  /** Lowercase labels carried from earlier query refinements, keyed by offset. */
  readonly previousLabels?: ReadonlyMap<number, string>;
}

export interface FlashLabelResult {
  /** Nearest-first matches, including unbounded matches without labels. */
  readonly matches: FlashMatch[];
  readonly target: FlashMatch | null;
}

/** Flash-local smartcase: any uppercase character makes this query sensitive. */
export function isFlashCaseSensitive(query: string): boolean {
  return query !== query.toLowerCase();
}

const REGEXP_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function literalPattern(query: string): string {
  return query.replace(REGEXP_ESCAPE, '\\$&');
}

function forEachLiteralMatch(
  text: string,
  query: string,
  overlapping: boolean,
  callback: (from: number, to: number) => boolean | void,
): void {
  if (query.length === 0) return;
  const caseSensitive = isFlashCaseSensitive(query);
  const regexp = new RegExp(literalPattern(query), caseSensitive ? 'gu' : 'giu');
  let match: RegExpExecArray | null;
  while ((match = regexp.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (callback(from, to) === false) return;
    if (match[0].length === 0) {
      regexp.lastIndex += 1;
    } else if (overlapping) {
      regexp.lastIndex = from + 1;
    }
  }
}

/** Find literal matches in the given coarse ranges using Flash-local smartcase. */
export function findFlashMatches(
  text: string,
  query: string,
  ranges: readonly FlashRange[],
): FlashMatch[] {
  if (query.length === 0) return [];
  const sortedRanges = ranges
    .map(range => ({
      from: Math.min(Math.max(0, Math.trunc(range.from)), text.length),
      to: Math.min(Math.max(0, Math.trunc(range.to)), text.length),
    }))
    .filter(range => range.to > range.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);

  if (sortedRanges.length === 0) return [];

  const matches: FlashMatch[] = [];
  let rangeIndex = 0;
  let hasActiveRange = false;
  let maxEnd = -1;

  forEachLiteralMatch(text, query, false, (from, to) => {
    // Enumerate once, then advance the containment frontier. Any range with
    // from <= match.from and max end >= match.to contains this match.
    while (rangeIndex < sortedRanges.length && sortedRanges[rangeIndex].from <= from) {
      hasActiveRange = true;
      maxEnd = Math.max(maxEnd, sortedRanges[rangeIndex].to);
      rangeIndex += 1;
    }
    if (hasActiveRange && maxEnd >= to) {
      matches.push({ from, to });
    }
  });

  return matches;
}

/**
 * Characters that would be ambiguous as the next label key. This scans the
 * whole document, independently of the onscreen candidate set, and follows
 * smartcase: an insensitive query removes both character cases.
 */
export function flashContinuationExclusions(text: string, query: string): Set<string> {
  const caseSensitive = isFlashCaseSensitive(query);
  const excluded = new Set<string>();
  forEachLiteralMatch(text, query, true, (_from, to) => {
    const next = text.slice(to, to + 1);
    if (next.length === 0) return;
    excluded.add(next);
    if (!caseSensitive) {
      excluded.add(next.toLowerCase());
      excluded.add(next.toUpperCase());
    }
  });
  return excluded;
}

export function flashLabelPool(
  text: string,
  query: string,
  labels: string = VIM_FLASH_LABELS,
): string[] {
  const excluded = flashContinuationExclusions(text, query);
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const label of labels) {
    if (seen.has(label) || excluded.has(label)) continue;
    seen.add(label);
    pool.push(label);
  }
  return pool;
}

/** Next match strictly after the activation cursor, wrapping like upstream. */
export function chooseFlashTarget(
  matches: readonly FlashMatch[],
  cursorOffset: number,
  wrap = true,
): FlashMatch | null {
  const ordered = [...matches].sort((a, b) => a.from - b.from || a.to - b.to);
  const forward = ordered.find(match => match.from > cursorOffset);
  if (forward) return forward;
  return wrap ? ordered[0] ?? null : null;
}

/**
 * Allocate labels nearest-first. Only lowercase labels are stable across query
 * refinements; uppercase overflow labels are temporary, matching upstream's
 * `reuse = "lowercase"` default.
 */
export function labelFlashMatches(
  text: string,
  query: string,
  matches: readonly FlashMatch[],
  cursorOffset: number,
  options: FlashLabelOptions = {},
): FlashLabelResult {
  if (matches.length === 0) return { matches: [], target: null };

  const pool = flashLabelPool(text, query, options.labels);
  const nearestFirst = [...matches].sort((a, b) => {
    const distance = Math.abs(a.from - cursorOffset) - Math.abs(b.from - cursorOffset);
    return distance !== 0 ? distance : a.from - b.from;
  });
  const assigned = new Map<number, string>();

  if (options.previousLabels) {
    for (const match of nearestFirst) {
      const previous = options.previousLabels.get(match.from);
      if (previous === undefined || previous !== previous.toLowerCase()) continue;
      const index = pool.indexOf(previous);
      if (index < 0) continue;
      pool.splice(index, 1);
      assigned.set(match.from, previous);
    }
  }

  let labelIndex = 0;
  for (const match of nearestFirst) {
    if (assigned.has(match.from)) continue;
    if (labelIndex >= pool.length) break;
    assigned.set(match.from, pool[labelIndex]);
    labelIndex += 1;
  }

  const labelled = nearestFirst.map(match => {
    const label = assigned.get(match.from);
    return label === undefined ? match : { ...match, label };
  });

  return {
    matches: labelled,
    target: chooseFlashTarget(labelled, cursorOffset),
  };
}

/** Persist only lowercase labels for later query refinements. */
export function rememberFlashLabels(
  previousLabels: Map<number, string>,
  matches: readonly FlashMatch[],
): void {
  for (const match of matches) {
    if (match.label && match.label === match.label.toLowerCase()) {
      previousLabels.set(match.from, match.label);
    }
  }
}
