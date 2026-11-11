import { EditorState, countColumn, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { getIndentUnit, indentUnit } from '@codemirror/language';

// A blank line can only borrow guides from nearby content. The bound keeps a
// long run of empty lines from turning every rebuild into a document scan.
const MAX_BLANK_LOOKAROUND = 100;

const INDENT_GUIDE_CLASS = 'cm-indent-guide-line';

interface LineIndent {
  blank: boolean;
  columns: number;
}

function leadingIndentColumns(text: string, tabSize: number): number {
  const match = /^[ \t]*/.exec(text);
  return countColumn(match ? match[0] : '', tabSize);
}

function readLineIndent(state: EditorState, lineNumber: number, cache: Map<number, LineIndent>): LineIndent {
  const cached = cache.get(lineNumber);
  if (cached) return cached;
  const text = state.doc.line(lineNumber).text;
  const blank = !/\S/.test(text);
  const indent = { blank, columns: blank ? 0 : leadingIndentColumns(text, state.tabSize) };
  cache.set(lineNumber, indent);
  return indent;
}

function neighborIndent(
  state: EditorState,
  lineNumber: number,
  direction: -1 | 1,
  cache: Map<number, LineIndent>,
): number | null {
  const first = direction < 0
    ? Math.max(1, lineNumber - MAX_BLANK_LOOKAROUND)
    : Math.min(state.doc.lines, lineNumber + MAX_BLANK_LOOKAROUND);
  for (let current = lineNumber + direction;
    direction < 0 ? current >= first : current <= first;
    current += direction) {
    const line = readLineIndent(state, current, cache);
    if (!line.blank) return line.columns;
  }
  return null;
}

function blankLineGuideCount(
  state: EditorState,
  lineNumber: number,
  unit: number,
  cache: Map<number, LineIndent>,
): number {
  const above = neighborIndent(state, lineNumber, -1, cache);
  const below = neighborIndent(state, lineNumber, 1, cache);

  if (above == null && below == null) return 0;
  if (above != null && below != null) {
    return above === below
      ? Math.ceil(above / unit)
      : 1 + Math.floor(Math.min(above, below) / unit);
  }

  // At a document edge there is no second line to compare against. Show only
  // the complete levels already present in the one neighbor rather than
  // inventing a deeper level.
  return Math.floor((above ?? below ?? 0) / unit);
}

/**
 * Complete indentation levels for the requested logical lines. Blank lines are
 * resolved from their nearest non-blank neighbors; top-level and fully blank
 * documents produce no guides. The cache is scoped to one call so the view
 * plugin shares line reads across a single rebuild.
 */
export function computeIndentGuideCounts(
  state: EditorState,
  lineNumbers: Iterable<number>,
): Map<number, number> {
  const counts = new Map<number, number>();
  const unit = getIndentUnit(state);
  if (unit <= 0) {
    for (const lineNumber of new Set(lineNumbers)) counts.set(lineNumber, 0);
    return counts;
  }

  const cache = new Map<number, LineIndent>();
  for (const lineNumber of new Set(lineNumbers)) {
    const line = readLineIndent(state, lineNumber, cache);
    counts.set(
      lineNumber,
      line.blank ? blankLineGuideCount(state, lineNumber, unit, cache) : Math.floor(line.columns / unit),
    );
  }
  return counts;
}

function visibleLineNumbers(view: EditorView): number[] {
  const lines: number[] = [];
  const seen = new Set<number>();
  for (const range of view.visibleRanges) {
    const start = view.state.doc.lineAt(range.from).number;
    const end = view.state.doc.lineAt(range.to).number;
    for (let lineNumber = start; lineNumber <= end; lineNumber++) {
      if (seen.has(lineNumber)) continue;
      seen.add(lineNumber);
      lines.push(lineNumber);
    }
  }
  return lines.sort((left, right) => left - right);
}

function buildIndentGuideDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const lineNumbers = visibleLineNumbers(view);
  const counts = computeIndentGuideCounts(state, lineNumbers);
  const unit = getIndentUnit(state);
  const decorations: Range<Decoration>[] = [];

  for (const lineNumber of lineNumbers) {
    const count = counts.get(lineNumber) ?? 0;
    if (count <= 0) continue;
    decorations.push(Decoration.line({
      class: INDENT_GUIDE_CLASS,
      attributes: {
        style: `--cm-indent-count:${count};--cm-indent-step:${unit}ch`,
      },
    }).range(state.doc.line(lineNumber).from));
  }

  return Decoration.set(decorations, true);
}

class IndentGuidePlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildIndentGuideDecorations(view);
  }

  update(update: ViewUpdate) {
    const indentChanged = update.startState.tabSize !== update.state.tabSize
      || update.startState.facet(indentUnit) !== update.state.facet(indentUnit);
    // Selection-only updates must not rebuild: moving the cursor does not
    // change indentation and should not touch decorations at all.
    if (update.docChanged || update.viewportChanged || update.geometryChanged || indentChanged) {
      this.decorations = buildIndentGuideDecorations(update.view);
    }
  }
}

export function indentGuides(): Extension {
  return ViewPlugin.fromClass(IndentGuidePlugin, {
    decorations: plugin => plugin.decorations,
  });
}
