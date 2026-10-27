import {
  Vim,
  type CM5RangeInterface,
  type CodeMirrorV,
  type OperatorFn,
  type Pos,
} from '@replit/codemirror-vim';

/**
 * The pinned engine's `gc` operator calls CodeMirror's line-comment command and
 * then returns its `newHead` argument (`@replit/codemirror-vim-core` vim.js
 * 2864-2867). In Visual mode no motion runs, so `newHead` is undefined
 * (vim.js 2016, 2063-2065). `evalInput` consequently exits Visual with
 * `moveHead = false` (vim.js 2190-2192) and does not collapse the CodeMirror
 * selection; CodeMirror's comment command preserves that ranged selection
 * (@codemirror/commands 169-175). `multiSelectHandleKey` then treats the
 * remaining selection as an external mouse selection and re-enters Visual
 * (vim.js 7155-7158, 6908-6918).
 *
 * Returning a concrete cursor only for the Visual/no-motion case makes
 * `exitVisualMode` collapse the selection before that reconciliation. Normal
 * `gcc`/`gcj`/counted motions keep the engine's `newHead` untouched, so their
 * cursor behavior is unchanged. This operator still performs exactly one
 * `toggleLineComment` command, preserving the single undo step.
 */

/** First non-whitespace column, or the line length for an all-whitespace line. */
export function firstNonBlank(text: string): number {
  const index = text.search(/\S/);
  return index === -1 ? text.length : index;
}

/**
 * The engine normally passes ranges with anchor/head already ordered, but a
 * reversed Visual selection or a future caller can still arrive backwards.
 * Resolve the topmost selected line across every range so the fallback cursor
 * is stable for charwise, linewise, block, and upward selections.
 */
export function topSelectedLine(
  ranges: readonly CM5RangeInterface[],
): number | undefined {
  let top: number | undefined;
  for (const range of ranges) {
    const line = Math.min(range.anchor.line, range.head.line);
    if (top === undefined || line < top) top = line;
  }
  return top;
}

/**
 * Cursor after a Visual `gc`: the first non-blank of the highest selected line.
 * Read the line after the comment command so inserted `// ` text cannot put the
 * cursor inside the comment marker. This mirrors the cursor returned by the
 * engine's native Visual operators (delete/indent/changeCase).
 */
export function visualCommentCursor(
  cm: Pick<CodeMirrorV, 'getLine'>,
  ranges: readonly CM5RangeInterface[],
): Pos | undefined {
  const line = topSelectedLine(ranges);
  if (line === undefined) return undefined;
  const text = cm.getLine(line) ?? '';
  return { line, ch: firstNonBlank(text) };
}

export const toggleCommentOperator: OperatorFn = (
  cm,
  _args,
  ranges,
  _oldAnchor,
  newHead,
) => {
  // Capture the mode before the command dispatch. Visual mode is still active
  // here; the engine exits it after this operator returns.
  const visual = cm.state.vim?.visualMode === true;
  cm.execCommand('toggleLineComment');

  if (newHead) return newHead;
  if (!visual) return undefined;
  return visualCommentCursor(cm, ranges);
};

let commentOperatorInstalled = false;

/** Install Crumb's `gc` operator replacement once, before any adapter runs. */
export function installVimCommentOperator(): void {
  if (commentOperatorInstalled) return;
  commentOperatorInstalled = true;
  Vim.defineOperator('toggleComment', toggleCommentOperator);
}
