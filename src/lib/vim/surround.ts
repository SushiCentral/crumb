import {
  Vim,
  getCM,
  type ActionArgs,
  type ActionFn,
  type CodeMirror,
  type CodeMirrorV,
  type InputStateInterface,
  type OperatorArgs,
  type OperatorFn,
  type Pos,
  type actionCommand,
  type vimState,
} from '@replit/codemirror-vim';
import { Prec, type Extension, type Text } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { VimMapping } from './config.ts';
import { isVimJumpActive } from './jump.ts';

/**
 * Vim surround support for Crumb.
 *
 * The pinned @replit/codemirror-vim engine has no surround commands. Native
 * motions, counts, registers, and user mappings must keep working, so `ys` is
 * registered as a real Vim operator and `ds`/`cs` as real actions. The engine
 * still parses the motion; this module only captures the resulting range and
 * then waits for the delimiter character.
 *
 * The engine resolves `y`, `d`, and `c` as complete operators before longer
 * mappings, so `ys`/`ds`/`cs` cannot be mapCommand prefixes. A per-view
 * high-precedence keydown plugin consumes only the `s` immediately following
 * one of those operators, then either retargets the pending operator (`ys`) or
 * collects the delimiters (`ds`/`cs`).
 *
 * Delimiter input is a per-view pending state rather than an engine mapping:
 * nothing may edit the document until a valid delimiter arrives, Escape
 * cancels, and every successful surround is exactly one CodeMirror
 * transaction (one undo step).
 */

export interface SurroundPair {
  readonly open: string;
  readonly close: string;
  readonly kind: 'bracket' | 'quote';
}

const PAIRS: Readonly<Record<string, SurroundPair>> = Object.freeze({
  '(': Object.freeze({ open: '(', close: ')', kind: 'bracket' }),
  ')': Object.freeze({ open: '(', close: ')', kind: 'bracket' }),
  b: Object.freeze({ open: '(', close: ')', kind: 'bracket' }),
  '[': Object.freeze({ open: '[', close: ']', kind: 'bracket' }),
  ']': Object.freeze({ open: '[', close: ']', kind: 'bracket' }),
  '{': Object.freeze({ open: '{', close: '}', kind: 'bracket' }),
  '}': Object.freeze({ open: '{', close: '}', kind: 'bracket' }),
  B: Object.freeze({ open: '{', close: '}', kind: 'bracket' }),
  '<': Object.freeze({ open: '<', close: '>', kind: 'bracket' }),
  '>': Object.freeze({ open: '<', close: '>', kind: 'bracket' }),
  '"': Object.freeze({ open: '"', close: '"', kind: 'quote' }),
  "'": Object.freeze({ open: "'", close: "'", kind: 'quote' }),
  '`': Object.freeze({ open: '`', close: '`', kind: 'quote' }),
});

/**
 * Resolve a Vim surround delimiter character. Closing brackets are accepted as
 * aliases of their pair, matching vim-surround; `b`/`B` are the bracket
 * aliases. Any other character is not a supported delimiter.
 */
export function resolveSurroundPair(delimiter: string): SurroundPair | null {
  return PAIRS[delimiter] ?? null;
}

/**
 * A user-configured Normal-mode mapping for an operator (`y`, `d`, `c`) or a
 * surround prefix (`ys`, `ds`, `cs`), or an operator-pending `s` mapping, takes
 * precedence over the raw `s` interception. Note that the engine itself
 * resolves the single-key operator before longer mappings; this only guarantees
 * Crumb never shadows the user's configuration with its own prefix handling.
 */
export function vimSurroundSuppressedByMappings(
  mappings: readonly VimMapping[],
): boolean {
  return mappings.some(mapping => {
    // A configured operator-pending `s` owns the key that Crumb would
    // otherwise intercept after y/d/c.
    if (mapping.modes.includes('operator') && mapping.lhs === 's') return true;
    if (!mapping.modes.includes('normal')) return false;
    const lhs = mapping.lhs;
    return lhs === 'y'
      || lhs === 'd'
      || lhs === 'c'
      || lhs.startsWith('ys')
      || lhs.startsWith('ds')
      || lhs.startsWith('cs');
  });
}

export interface SurroundBounds {
  readonly openFrom: number;
  readonly closeFrom: number;
  readonly openLength: number;
  readonly closeLength: number;
}

export interface SurroundEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface SurroundTextResult {
  readonly text: string;
  readonly cursor: number;
}

/** True when the character at `index` is escaped by an odd backslash run. */
export function isSurroundEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let current = index - 1; current >= 0 && text[current] === '\\'; current -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function findEnclosingBracket(
  text: string,
  offset: number,
  pair: SurroundPair,
): SurroundBounds | null {
  let candidate: number | null = null;
  if (offset < text.length && text[offset] === pair.open && !isSurroundEscaped(text, offset)) {
    candidate = offset;
  } else {
    let depth = 0;
    for (let index = Math.min(offset, text.length) - 1; index >= 0; index -= 1) {
      if (isSurroundEscaped(text, index)) continue;
      const character = text[index];
      if (character === pair.close) {
        depth += 1;
      } else if (character === pair.open) {
        if (depth === 0) {
          candidate = index;
          break;
        }
        depth -= 1;
      }
    }
  }
  if (candidate === null) return null;

  let depth = 0;
  for (let index = candidate + 1; index < text.length; index += 1) {
    if (isSurroundEscaped(text, index)) continue;
    const character = text[index];
    if (character === pair.open) {
      depth += 1;
    } else if (character === pair.close) {
      if (depth === 0) {
        if (offset < candidate || offset > index) return null;
        return { openFrom: candidate, closeFrom: index, openLength: 1, closeLength: 1 };
      }
      depth -= 1;
    }
  }
  return null;
}

function findEnclosingQuote(
  text: string,
  offset: number,
  pair: SurroundPair,
): SurroundBounds | null {
  // Vim quotes are line-local; a quote pair never spans a newline. At offset 0
  // the cursor is on the empty first line even when the document starts with a
  // newline, so never search back into a preceding character.
  const lineStart = offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
  const newline = text.indexOf('\n', Math.max(offset, lineStart));
  const lineEnd = newline === -1 ? text.length : newline;

  const positions: number[] = [];
  for (let index = lineStart; index < lineEnd; index += 1) {
    if (text[index] === pair.open && !isSurroundEscaped(text, index)) positions.push(index);
  }

  let best: SurroundBounds | null = null;
  for (let index = 0; index + 1 < positions.length; index += 2) {
    const openFrom = positions[index];
    const closeFrom = positions[index + 1];
    if (offset < openFrom || offset > closeFrom) continue;
    if (
      best === null ||
      closeFrom - openFrom < best.closeFrom - best.openFrom
    ) {
      best = { openFrom, closeFrom, openLength: 1, closeLength: 1 };
    }
  }
  return best;
}

/**
 * Find the closest pair of `delimiter` enclosing `offset`. Brackets use
 * balanced, escape-aware nesting across lines; quotes are escape-aware and
 * same-line only. Unmatched input returns null so callers can cancel without
 * touching the document.
 */
export function findEnclosingSurround(
  text: string,
  offset: number,
  delimiter: string,
): SurroundBounds | null {
  const pair = resolveSurroundPair(delimiter);
  if (!pair) return null;
  const position = Math.max(0, Math.min(offset, text.length));
  return pair.kind === 'quote'
    ? findEnclosingQuote(text, position, pair)
    : findEnclosingBracket(text, position, pair);
}

export function surroundEdits(
  from: number,
  to: number,
  pair: SurroundPair,
): SurroundEdit[] {
  if (from === to) {
    return [{ from, to, insert: `${pair.open}${pair.close}` }];
  }
  return [
    { from, to: from, insert: pair.open },
    { from: to, to, insert: pair.close },
  ];
}

export function deleteSurroundEdits(bounds: SurroundBounds): SurroundEdit[] {
  return [
    { from: bounds.openFrom, to: bounds.openFrom + bounds.openLength, insert: '' },
    { from: bounds.closeFrom, to: bounds.closeFrom + bounds.closeLength, insert: '' },
  ];
}

export function changeSurroundEdits(
  bounds: SurroundBounds,
  pair: SurroundPair,
): SurroundEdit[] {
  return [
    { from: bounds.openFrom, to: bounds.openFrom + bounds.openLength, insert: pair.open },
    { from: bounds.closeFrom, to: bounds.closeFrom + bounds.closeLength, insert: pair.close },
  ];
}

/** Apply non-overlapping edits in descending order, preserving offsets. */
export function applySurroundEdits(
  text: string,
  edits: readonly SurroundEdit[],
): string {
  let output = text;
  const ordered = [...edits].sort((a, b) => b.from - a.from || b.to - a.to);
  for (const edit of ordered) {
    output = output.slice(0, edit.from) + edit.insert + output.slice(edit.to);
  }
  return output;
}

/** Surround `[from, to)` with `delimiter`; null when the delimiter is invalid. */
export function surroundText(
  text: string,
  from: number,
  to: number,
  delimiter: string,
): SurroundTextResult | null {
  const pair = resolveSurroundPair(delimiter);
  if (!pair || from < 0 || to < from || to > text.length) return null;
  return {
    text: applySurroundEdits(text, surroundEdits(from, to, pair)),
    cursor: from + pair.open.length,
  };
}

/** Delete the closest enclosing pair; unmatched input is a no-op. */
export function deleteSurroundText(
  text: string,
  offset: number,
  delimiter: string,
): SurroundTextResult | null {
  const bounds = findEnclosingSurround(text, offset, delimiter);
  const pair = resolveSurroundPair(delimiter);
  if (!bounds || !pair) return null;
  return {
    text: applySurroundEdits(text, deleteSurroundEdits(bounds)),
    cursor: bounds.openFrom,
  };
}

/** Change the closest enclosing pair to `newDelimiter`; unmatched is a no-op. */
export function changeSurroundText(
  text: string,
  offset: number,
  oldDelimiter: string,
  newDelimiter: string,
): SurroundTextResult | null {
  const bounds = findEnclosingSurround(text, offset, oldDelimiter);
  const pair = resolveSurroundPair(newDelimiter);
  if (!bounds || !pair) return null;
  return {
    text: applySurroundEdits(text, changeSurroundEdits(bounds, pair)),
    cursor: bounds.openFrom,
  };
}

export type SurroundInputKind = 'surround' | 'delete' | 'change';
export type SurroundInputStage = 'delimiter' | 'from' | 'to';

export interface SurroundInputState {
  readonly kind: SurroundInputKind;
  readonly stage: SurroundInputStage;
  readonly oldDelimiter?: string;
}

export type SurroundInputStep =
  | { readonly kind: 'pending'; readonly input: SurroundInputState }
  | { readonly kind: 'cancel' }
  | {
      readonly kind: 'apply';
      readonly oldDelimiter?: string;
      readonly newDelimiter: string;
    };

export function beginSurroundInput(kind: SurroundInputKind): SurroundInputState {
  return kind === 'change'
    ? { kind, stage: 'from' }
    : { kind, stage: 'delimiter' };
}

/**
 * Advance the pending delimiter prompt. Escape, modified/named keys, and
 * unsupported delimiters cancel; a two-character `cs` prompt only advances for
 * a supported first delimiter.
 */
export function stepSurroundInput(
  state: SurroundInputState,
  key: string,
): SurroundInputStep {
  if (key === 'Escape' || key.length !== 1) return { kind: 'cancel' };
  const pair = resolveSurroundPair(key);
  if (!pair) return { kind: 'cancel' };

  if (state.kind === 'change' && state.stage === 'from') {
    return {
      kind: 'pending',
      input: { kind: 'change', stage: 'to', oldDelimiter: key },
    };
  }
  if (state.kind === 'change') {
    if (state.oldDelimiter === undefined) return { kind: 'cancel' };
    return {
      kind: 'apply',
      oldDelimiter: state.oldDelimiter,
      newDelimiter: key,
    };
  }
  if (state.kind === 'delete') {
    return { kind: 'apply', oldDelimiter: key, newDelimiter: key };
  }
  return { kind: 'apply', newDelimiter: key };
}

interface SurroundOperatorArgs extends OperatorArgs {
  crumbSurroundDelimiter?: string;
}

interface SurroundActionArgs extends ActionArgs {
  crumbSurroundOldDelimiter?: string;
  crumbSurroundNewDelimiter?: string;
}

interface SurroundRange {
  readonly from: number;
  readonly to: number;
}

interface PendingCapture {
  input: SurroundInputState;
  readonly doc: Text;
  readonly from: number;
  readonly to: number;
  readonly offset: number;
  /** The next key is part of a motion being forwarded to the engine. */
  readonly forwarding: boolean;
  sawMotionKey: boolean;
  /** Operator arguments recorded for dot repeat. */
  readonly repeatArgs?: OperatorArgs;
  /** Operator input state recorded for `yss` and `ds`/`cs` dot repeat. */
  readonly repeatInputState?: InputStateInterface;
  readonly repeatAction?: 'delete' | 'change';
  /** `yss` bypasses evalInput, so the controller records its repeat state. */
  readonly manualOperatorRepeat?: boolean;
}

const UNSAFE_FORWARD_KEYS = new Set(['x', 'X', 'D', 'C', 'Y', '~', '/', '?', ':']);

const MODIFIER_ONLY_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

/** A modifier keydown by itself is not a command and must not cancel pending input. */
function isModifierOnlyKey(event: Pick<KeyboardEvent, 'key'>): boolean {
  return MODIFIER_ONLY_KEYS.has(event.key);
}

const controllers = new WeakMap<EditorView, SurroundController>();

function adapterView(cm: CodeMirrorV): EditorView | null {
  return cm.cm6 ?? null;
}

function controllerFor(view: EditorView | null): SurroundController | null {
  if (!view) return null;
  return controllers.get(view) ?? null;
}

function macroModeIsPlaying(): boolean {
  return Boolean(Vim.getVimGlobalState_().macroModeState.isPlaying);
}

function offsetFromPos(doc: Text, position: Pos): number {
  const lineNumber = Math.max(0, Math.min(position.line, doc.lines - 1));
  const line = doc.line(lineNumber + 1);
  const ch = position.ch === Infinity ? line.length : position.ch;
  return line.from + Math.max(0, Math.min(ch, line.length));
}

function posFromOffset(doc: Text, offset: number): Pos {
  const line = doc.lineAt(Math.max(0, Math.min(offset, doc.length)));
  return { line: line.number - 1, ch: offset - line.from };
}

/**
 * Vim linewise ranges end at the start of the line after the selection. Keep
 * the delimiters before that newline and preserve indentation as written.
 */
export function normalizeLinewiseRange(
  doc: Text,
  from: number,
  to: number,
): { from: number; to: number } {
  const first = doc.lineAt(Math.max(0, Math.min(from, doc.length)));
  const end = Math.max(first.from, Math.min(to, doc.length));
  const last = doc.lineAt(end > first.from ? end - 1 : first.from);
  return { from: first.from, to: last.to };
}

function captureOperatorRange(
  view: EditorView,
  ranges: readonly { anchor: Pos; head: Pos }[],
  args: OperatorArgs,
  vim: vimState,
): SurroundRange | null {
  // Blockwise surround has no single contiguous range. Cancel without an edit.
  if (vim.visualBlock || ranges.length !== 1) return null;
  const doc = view.state.doc;
  const range = ranges[0];
  const anchor = offsetFromPos(doc, range.anchor);
  const head = offsetFromPos(doc, range.head);
  let from = Math.min(anchor, head);
  let to = Math.max(anchor, head);
  const linewise = Boolean(args.linewise);
  if (linewise) {
    const normalized = normalizeLinewiseRange(doc, from, to);
    from = normalized.from;
    to = normalized.to;
  }
  return { from, to };
}

function commitSurround(
  view: EditorView,
  capture: PendingCapture,
  step: Extract<SurroundInputStep, { kind: 'apply' }>,
): boolean {
  if (capture.doc !== view.state.doc) return false;
  const text = view.state.doc.toString();

  let changes: SurroundEdit[];
  let cursor: number;
  if (capture.input.kind === 'surround') {
    const pair = resolveSurroundPair(step.newDelimiter);
    if (!pair) return false;
    if (capture.from < 0 || capture.to < capture.from || capture.to > text.length) {
      return false;
    }
    changes = surroundEdits(capture.from, capture.to, pair);
    cursor = capture.from + pair.open.length;
  } else {
    const oldDelimiter = step.oldDelimiter;
    if (!oldDelimiter) return false;
    if (capture.input.kind === 'delete') {
      const bounds = findEnclosingSurround(text, capture.offset, oldDelimiter);
      const pair = resolveSurroundPair(oldDelimiter);
      if (!bounds || !pair) return false;
      changes = deleteSurroundEdits(bounds);
      cursor = bounds.openFrom;
    } else {
      const bounds = findEnclosingSurround(text, capture.offset, oldDelimiter);
      const pair = resolveSurroundPair(step.newDelimiter);
      if (!bounds || !pair) return false;
      changes = changeSurroundEdits(bounds, pair);
      cursor = bounds.openFrom;
    }
  }

  view.dispatch({
    changes,
    selection: { anchor: cursor },
    scrollIntoView: true,
    // A distinct non-joinable user event keeps every surround as exactly one
    // undo step even when it follows another edit within the history group
    // delay.
    userEvent: 'input.vim.surround',
  });

  // Dot repeat: notify the engine which operation it should replay. Store the
  // delimiter(s) only after a successful edit, so an aborted or unmatched
  // operation cannot delete/surround anything later.
  const vim = getCM(view)?.state.vim;
  if (capture.repeatArgs) {
    (capture.repeatArgs as SurroundOperatorArgs).crumbSurroundDelimiter = step.newDelimiter;
  }
  if (vim && capture.repeatInputState) {
    if (capture.manualOperatorRepeat) {
      vim.lastEditInputState = capture.repeatInputState;
      vim.lastEditActionCommand = undefined;
    } else if (capture.repeatAction) {
      vim.lastEditInputState = capture.repeatInputState;
      vim.lastEditActionCommand = {
        keys: capture.repeatAction === 'delete' ? 'ds' : 'cs',
        type: 'action',
        action: capture.repeatAction === 'delete'
          ? 'crumbSurroundDelete'
          : 'crumbSurroundChange',
        actionArgs: {
          crumbSurroundOldDelimiter: step.oldDelimiter,
          crumbSurroundNewDelimiter:
            capture.input.kind === 'change' ? step.newDelimiter : undefined,
        },
      } as actionCommand;
    }
  }
  return true;
}

function resetVimPendingOperator(cm: CodeMirror): void {
  const vim = cm.state.vim;
  if (!vim) return;
  // Mirror the engine's clearInputState() without its mode-changing Escape
  // path: the operator prefix has been consumed by surround.
  const InputState = vim.inputState.constructor as new () => InputStateInterface;
  vim.inputState = new InputState();
  vim.expectLiteralNext = false;
  vim.status = '';
  cm.signal('vim-command-done', undefined);
}

class SurroundController {
  private pending: PendingCapture | null = null;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
  }

  beginOperator(
    doc: Text,
    range: SurroundRange,
    repeatArgs: OperatorArgs,
  ): void {
    this.pending = {
      input: beginSurroundInput('surround'),
      doc,
      from: range.from,
      to: range.to,
      offset: range.from,
      forwarding: false,
      sawMotionKey: true,
      repeatArgs,
    };
  }

  /**
   * `ys` is typed as the yank operator followed by `s`. The engine resolves
   * `y` as a complete operator, so the second key is intercepted and the same
   * input state is retargeted to the surround operator. The following motion
   * keys are then forwarded to the engine normally.
   */
  beginYankPrefix(): boolean {
    const cm = getCM(this.view);
    const vim = cm?.state.vim;
    if (!cm || !vim) return false;
    const input = vim.inputState;
    input.operator = 'crumbSurround';
    input.operatorArgs = {};
    input.motion = null;
    input.motionArgs = null;
    input.operatorShortcut = undefined;
    input.keyBuffer.length = 0;
    vim.status = '';
    this.pending = {
      input: beginSurroundInput('surround'),
      doc: this.view.state.doc,
      from: 0,
      to: 0,
      offset: 0,
      forwarding: true,
      sawMotionKey: false,
      repeatArgs: input.operatorArgs,
      repeatInputState: input,
    };
    return true;
  }

  beginDeletePrefix(): boolean {
    const cm = getCM(this.view);
    const vim = cm?.state.vim;
    if (!cm || !vim) return false;
    const repeatInputState = vim.inputState;
    const offset = this.view.state.selection.main.head;
    resetVimPendingOperator(cm);
    this.pending = {
      input: beginSurroundInput('delete'),
      doc: this.view.state.doc,
      from: offset,
      to: offset,
      offset,
      forwarding: false,
      sawMotionKey: true,
      repeatInputState,
      repeatAction: 'delete',
    };
    return true;
  }

  beginChangePrefix(): boolean {
    const cm = getCM(this.view);
    const vim = cm?.state.vim;
    if (!cm || !vim) return false;
    const repeatInputState = vim.inputState;
    const offset = this.view.state.selection.main.head;
    resetVimPendingOperator(cm);
    this.pending = {
      input: beginSurroundInput('change'),
      doc: this.view.state.doc,
      from: offset,
      to: offset,
      offset,
      forwarding: false,
      sawMotionKey: true,
      repeatInputState,
      repeatAction: 'change',
    };
    return true;
  }

  /** `yss`: the second `s` selects the current line (with count). */
  private beginLineFromPrefix(capture: PendingCapture): void {
    const cm = getCM(this.view);
    const vim = cm?.state.vim;
    const input = capture.repeatInputState;
    if (!cm || !vim || !input) {
      this.cancel();
      return;
    }
    const repeat = Math.max(1, input.getRepeat());
    const doc = this.view.state.doc;
    const line = doc.lineAt(this.view.state.selection.main.head);
    const lastLine = doc.line(Math.min(doc.lines, line.number + repeat - 1));
    const from = line.from;
    const to = lastLine.to;
    const repeatArgs = (input.operatorArgs ?? {}) as OperatorArgs;
    input.operator = 'crumbSurround';
    input.operatorArgs = repeatArgs;
    input.motion = 'expandToLine';
    input.motionArgs = { linewise: true, repeat };
    input.operatorShortcut = undefined;
    resetVimPendingOperator(cm);
    this.pending = {
      input: beginSurroundInput('surround'),
      doc,
      from,
      to,
      offset: from,
      forwarding: false,
      sawMotionKey: true,
      repeatArgs,
      repeatInputState: input,
      manualOperatorRepeat: true,
    };
    const start = doc.lineAt(from);
    cm.setCursor({ line: start.number - 1, ch: 0 });
  }

  beginDelete(doc: Text, offset: number, repeatInputState?: InputStateInterface): void {
    this.pending = {
      input: beginSurroundInput('delete'),
      doc,
      from: offset,
      to: offset,
      offset,
      forwarding: false,
      sawMotionKey: true,
      repeatInputState,
      repeatAction: 'delete',
    };
  }

  beginChange(doc: Text, offset: number, repeatInputState?: InputStateInterface): void {
    this.pending = {
      input: beginSurroundInput('change'),
      doc,
      from: offset,
      to: offset,
      offset,
      forwarding: false,
      sawMotionKey: true,
      repeatInputState,
      repeatAction: 'change',
    };
  }

  beginVisual(doc: Text, from: number, to: number): void {
    this.pending = {
      input: beginSurroundInput('surround'),
      doc,
      from,
      to,
      offset: from,
      forwarding: false,
      sawMotionKey: true,
    };
  }

  replaySurround(range: SurroundRange, delimiter: string, repeatArgs: OperatorArgs): boolean {
    const capture: PendingCapture = {
      input: { kind: 'surround', stage: 'delimiter' },
      doc: this.view.state.doc,
      from: range.from,
      to: range.to,
      offset: range.from,
      forwarding: false,
      sawMotionKey: true,
      repeatArgs,
    };
    return commitSurround(this.view, capture, { kind: 'apply', newDelimiter: delimiter });
  }

  replayDelete(doc: Text, offset: number, oldDelimiter: string): boolean {
    return commitSurround(
      this.view,
      {
        input: { kind: 'delete', stage: 'delimiter' },
        doc,
        from: offset,
        to: offset,
        offset,
        forwarding: false,
        sawMotionKey: true,
      },
      { kind: 'apply', oldDelimiter, newDelimiter: oldDelimiter },
    );
  }

  replayChange(
    doc: Text,
    offset: number,
    oldDelimiter: string,
    newDelimiter: string,
  ): boolean {
    return commitSurround(
      this.view,
      {
        input: { kind: 'change', stage: 'delimiter' },
        doc,
        from: offset,
        to: offset,
        offset,
        forwarding: false,
        sawMotionKey: true,
      },
      { kind: 'apply', oldDelimiter, newDelimiter },
    );
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  get pendingState(): SurroundInputState | null {
    return this.pending?.input ?? null;
  }

  cancel(): void {
    if (this.pending?.forwarding) {
      const cm = getCM(this.view);
      if (cm) resetVimPendingOperator(cm);
    }
    this.pending = null;
  }

  dispose(): void {
    this.cancel();
    if (controllers.get(this.view) === this) controllers.delete(this.view);
  }

  /** Returns true when this keydown belongs to the pending surround prompt. */
  handleKey(event: KeyboardEvent): boolean {
    const capture = this.pending;
    if (!capture) return false;
    if (capture.forwarding) return this.forwardMotionKey(capture, event);
    if (event.isComposing) return true;
    // A standalone Shift/Control/Alt/Meta/AltGraph keydown is part of a
    // modified key sequence; ignore it without dropping the pending prompt.
    if (isModifierOnlyKey(event)) return true;
    if (event.key === 'Escape') {
      this.pending = null;
      return true;
    }
    // A modified or named key cannot be a delimiter; cancel and consume it so
    // it cannot become an unrelated motion/edit.
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) {
      this.pending = null;
      return true;
    }
    if (capture.doc !== this.view.state.doc) {
      this.pending = null;
      return true;
    }

    const step = stepSurroundInput(capture.input, event.key);
    if (step.kind === 'cancel') {
      this.pending = null;
      return true;
    }
    if (step.kind === 'pending') {
      this.pending = { ...capture, input: step.input };
      // `cs` validates the old pair before asking for the replacement, so an
      // unmatched old delimiter cancels immediately instead of collecting a
      // second character that can never be applied.
      if (step.input.oldDelimiter !== undefined) {
        const text = this.view.state.doc.toString();
        if (!findEnclosingSurround(text, capture.offset, step.input.oldDelimiter)) {
          this.pending = null;
        }
      }
      return true;
    }

    this.pending = null;
    commitSurround(this.view, capture, step);
    return true;
  }

  /**
   * Forward one motion key to the already-primed surround operator. The second
   * `s` is `yss`; every other key is the engine's own motion parsing, so
   * counts, text objects, and linewise motions stay native.
   *
   * Deliberately unsupported: `/`, `?`, and `:` open engine prompts outside the
   * pending keydown capture, and named/modified keys (arrows, Ctrl chords) are
   * not motions this handler can forward; all cancel without an edit.
   */
  private forwardMotionKey(capture: PendingCapture, event: KeyboardEvent): boolean {
    if (event.isComposing) return true;
    if (isModifierOnlyKey(event)) return true;
    if (
      event.key === 'Escape' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key.length !== 1
    ) {
      this.cancel();
      return true;
    }
    const cm = getCM(this.view);
    const vim = cm?.state.vim;
    if (!cm || !vim) {
      this.cancel();
      return true;
    }
    if (!capture.sawMotionKey && event.key === 's') {
      this.beginLineFromPrefix(capture);
      return true;
    }
    // These keys resolve to operator-motions (which would edit immediately)
    // or prompts. A surround motion cannot consume them safely.
    if (UNSAFE_FORWARD_KEYS.has(event.key)) {
      this.cancel();
      return true;
    }
    capture.sawMotionKey = true;
    try {
      Vim.handleKey(cm, event.key, 'user');
    } catch {
      this.cancel();
      return true;
    }
    if (!this.pending || !this.pending.forwarding) return true;
    if (vim.inputState.operator !== 'crumbSurround') this.cancel();
    return true;
  }
}

class VimSurroundViewPlugin {
  private readonly controller: SurroundController;
  private readonly view: EditorView;
  private readonly suppressPrefixInterception: boolean;

  constructor(
    view: EditorView,
    options: { suppressPrefixInterception?: boolean } = {},
  ) {
    this.view = view;
    this.suppressPrefixInterception = options.suppressPrefixInterception === true;
    this.controller = new SurroundController(view);
    controllers.set(view, this.controller);
  }

  handleKey(event: KeyboardEvent): boolean {
    // Active Flash owns every query/label key, including `s` after an operator
    // prefix. Without this guard, `dgs` followed by a literal `s` would be
    // mistaken for a surround prefix.
    if (isVimJumpActive(this.view)) return false;
    if (this.controller.hasPending) {
      // A pending surround must never survive losing the adapter (Vim disabled
      // or a tab switch) or entering an insert/prompt mode.
      const vim = getCM(this.view)?.state.vim;
      if (!vim || vim.insertMode) {
        this.controller.cancel();
        return true;
      }
      return this.controller.handleKey(event);
    }
    if (this.suppressPrefixInterception) return false;
    return this.beginPrefix(event);
  }

  /**
   * The engine resolves `y`, `d`, and `c` as complete operators, so a `ys`,
   * `ds`, or `cs` mapping can never be reached. Intercept only the `s` key that
   * immediately follows one of those operators; every other `s` stays native.
   */
  private beginPrefix(event: KeyboardEvent): boolean {
    if (event.isComposing || event.repeat) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key !== 's') return false;

    const cm = getCM(this.view);
    const vim = cm?.state.vim;
    if (!cm || !vim || vim.insertMode || vim.visualMode) return false;
    const input = vim.inputState;
    if (
      !input.operator ||
      input.motion ||
      input.selectedCharacter ||
      input.keyBuffer.length > 0
    ) {
      return false;
    }

    if (input.operator === 'yank') return this.controller.beginYankPrefix();
    if (input.operator === 'delete') return this.controller.beginDeletePrefix();
    if (input.operator === 'change') return this.controller.beginChangePrefix();
    return false;
  }

  cancel(): void {
    this.controller.cancel();
  }

  destroy(): void {
    this.controller.dispose();
  }
}

const surroundOperator: OperatorFn = (cm, args, ranges) => {
  const view = adapterView(cm);
  const controller = controllerFor(view);
  const vim = cm.state.vim;
  if (!view || !controller || !vim) return;

  const operatorArgs = args as SurroundOperatorArgs;
  const range = captureOperatorRange(view, ranges, args, vim);

  // Dot repeat: evalInput replays the recorded operator input state. A stored
  // delimiter means the previous operation completed; apply it synchronously.
  if (operatorArgs.crumbSurroundDelimiter !== undefined) {
    if (range) {
      controller.replaySurround(range, operatorArgs.crumbSurroundDelimiter, args);
    }
    return;
  }

  // A macro replay cannot feed the DOM keydown pending handler. Without a
  // recorded delimiter there is nothing safe to apply.
  if (macroModeIsPlaying()) {
    if (range) cm.setCursor(posFromOffset(view.state.doc, range.from));
    return;
  }

  if (!range) return;
  controller.beginOperator(view.state.doc, range, args);
  // Leave the cursor at the start of the operation while the delimiter is
  // pending, matching vim-surround rather than leaving a live selection.
  cm.setCursor(posFromOffset(view.state.doc, range.from));
};

const surroundDeleteAction: ActionFn = (cm, actionArgs, vim) => {
  const view = adapterView(cm);
  const controller = controllerFor(view);
  if (!view || !controller) return;
  const args = actionArgs as SurroundActionArgs;

  if (args.crumbSurroundOldDelimiter !== undefined) {
    controller.replayDelete(
      view.state.doc,
      view.state.selection.main.head,
      args.crumbSurroundOldDelimiter,
    );
    return;
  }
  if (macroModeIsPlaying() || vim.visualMode) return;

  controller.beginDelete(
    view.state.doc,
    view.state.selection.main.head,
    vim.inputState,
  );
};

const surroundChangeAction: ActionFn = (cm, actionArgs, vim) => {
  const view = adapterView(cm);
  const controller = controllerFor(view);
  if (!view || !controller) return;
  const args = actionArgs as SurroundActionArgs;

  if (
    args.crumbSurroundOldDelimiter !== undefined &&
    args.crumbSurroundNewDelimiter !== undefined
  ) {
    controller.replayChange(
      view.state.doc,
      view.state.selection.main.head,
      args.crumbSurroundOldDelimiter,
      args.crumbSurroundNewDelimiter,
    );
    return;
  }
  if (macroModeIsPlaying() || vim.visualMode) return;

  controller.beginChange(
    view.state.doc,
    view.state.selection.main.head,
    vim.inputState,
  );
};

const surroundVisualAction: ActionFn = (cm, _actionArgs, vim) => {
  const view = adapterView(cm);
  if (!view) return;

  // Blockwise surround is unsupported. Exit with the default `moveHead=true`
  // so the block multi-selection collapses; otherwise the adapter's
  // external-selection handler re-enters Visual mode after this action.
  if (vim.visualBlock) {
    Vim.exitVisualMode(cm);
    return;
  }
  const controller = controllerFor(view);
  if (!controller) return;
  if (!vim.visualMode) return;

  const selection = view.state.selection.main;
  let from = selection.from;
  let to = selection.to;
  const linewise = vim.visualLine;
  if (linewise) {
    const normalized = normalizeLinewiseRange(view.state.doc, from, to);
    from = normalized.from;
    to = normalized.to;
  }
  // Collapse the CodeMirror selection before waiting for the delimiter. The
  // captured offsets stay valid because the document cannot change while input
  // is pending, and the collapsed selection prevents multiSelectHandleKey's
  // external-selection check from re-entering Visual mode on cancel.
  Vim.exitVisualMode(cm);
  // Visual surround is intentionally not recorded for dot repeat; `.` keeps
  // repeating the previous engine edit.
  controller.beginVisual(view.state.doc, from, to);
};

let surroundCommandsInstalled = false;

/**
 * Register the engine hooks and keymap entries once. `ys`, `ds`, and `cs`
 * cannot be mapCommand prefixes: the engine resolves `y`/`d`/`c` as complete
 * operators before checking longer mappings, so their second key is handled by
 * the per-view keydown plugin. Visual `S` is a single key and can be mapped
 * normally; user mappings are installed later through `Vim.map` and unshift
 * ahead of this default.
 */
export function installVimSurroundCommands(): void {
  if (surroundCommandsInstalled) return;
  surroundCommandsInstalled = true;

  Vim.defineOperator('crumbSurround', surroundOperator);
  Vim.defineAction('crumbSurroundDelete', surroundDeleteAction);
  Vim.defineAction('crumbSurroundChange', surroundChangeAction);
  Vim.defineAction('crumbSurroundVisual', surroundVisualAction);

  // Approved replacement of the engine's change-lines Visual mapping.
  Vim.mapCommand('S', 'action', 'crumbSurroundVisual', {}, { context: 'visual' });
}

export interface VimSurroundExtensionOptions {
  /**
   * Set when the user configured a Normal-mode `y`/`d`/`c`, `ys`, `ds`, or `cs`
   * mapping. Crumb then leaves the prefix to the engine instead of shadowing
   * the user's configuration with its own `s` handling.
   */
  readonly suppressPrefixInterception?: boolean;
}

/**
 * Pending delimiter input for one editor. Place this before the leader and the
 * Vim adapter so a pending surround consumes the delimiter before either can
 * interpret it as a motion or command.
 */
export function createVimSurroundExtension(
  options: VimSurroundExtensionOptions = {},
): Extension {
  installVimSurroundCommands();
  const suppressPrefixInterception = options.suppressPrefixInterception === true;
  return Prec.highest(ViewPlugin.fromClass(
    class extends VimSurroundViewPlugin {
      constructor(view: EditorView) {
        super(view, { suppressPrefixInterception });
      }
    },
    {
      eventHandlers: {
        keydown(this: VimSurroundViewPlugin, event: KeyboardEvent): boolean {
          return this.handleKey(event);
        },
        blur(this: VimSurroundViewPlugin): void {
          this.cancel();
        },
        mousedown(this: VimSurroundViewPlugin): void {
          this.cancel();
        },
      },
    },
  ));
}

/** Drop pending input for a view (lifecycle hooks and tests). */
export function clearVimSurroundPending(view: EditorView): void {
  controllerFor(view)?.cancel();
}

/**
 * @internal Non-GUI regression seam. Keeps the pinned Vim engine inside this
 * module while the Node suite drives the multi-select dispatch that can
 * otherwise re-enter Visual mode after a surround action.
 */
export function vimSurroundTestMultiSelectKey(
  cm: unknown,
  key: string,
): boolean | undefined {
  return Vim.multiSelectHandleKey(cm as Parameters<typeof Vim.multiSelectHandleKey>[0], key, 'user');
}

/** @internal Visual flags after a non-GUI surround regression sequence. */
export function vimSurroundTestVisualState(cm: unknown): {
  visualMode: boolean;
  visualBlock: boolean;
  visualLine: boolean;
} {
  const vim = (cm as CodeMirror | null)?.state.vim;
  return {
    visualMode: Boolean(vim?.visualMode),
    visualBlock: Boolean(vim?.visualBlock),
    visualLine: Boolean(vim?.visualLine),
  };
}

/** @internal Event-level controller seam for non-GUI pending-input tests. */
export interface VimSurroundTestPendingController {
  beginDelimiter(kind?: SurroundInputKind): void;
  beginForwarding(): boolean;
  handleKey(event: KeyboardEvent): boolean;
  pending(): SurroundInputState | null;
}

/** @internal */
export function vimSurroundTestPendingController(
  view: EditorView,
): VimSurroundTestPendingController {
  let controller = controllers.get(view);
  if (!controller) {
    controller = new SurroundController(view);
    controllers.set(view, controller);
  }
  const target = controller;
  return {
    beginDelimiter(kind = 'surround') {
      const offset = view.state.selection.main.head;
      if (kind === 'delete') target.beginDelete(view.state.doc, offset);
      else if (kind === 'change') target.beginChange(view.state.doc, offset);
      else target.beginOperator(view.state.doc, { from: offset, to: offset }, {});
    },
    beginForwarding: () => target.beginYankPrefix(),
    handleKey: event => target.handleKey(event),
    pending: () => target.pendingState,
  };
}

/** Pending prompt state for tests/status surfaces, or null. */
export function getVimSurroundPending(view: EditorView): SurroundInputState | null {
  return controllerFor(view)?.pendingState ?? null;
}
