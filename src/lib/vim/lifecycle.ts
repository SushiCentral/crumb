import { getCM, Vim, type CodeMirror, type Marker, type vimState } from '@replit/codemirror-vim';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Crumb's isolated compatibility layer for @replit/codemirror-vim.
 *
 * `EditorView.setState()` destroys and recreates every view plugin. The Vim
 * engine is a module singleton, but the adapter state (`cm.state.vim`) is
 * created by that view plugin and is therefore discarded on every tab switch.
 * This file owns the narrow amount of version-locked glue that carries the
 * explicitly approved session data across that boundary:
 *
 * - dot repeat command state (per adapter in the engine, session-wide in Vim)
 * - buffer-local lowercase marks (live Marker objects, so re-created per adapter)
 * - search query/direction cancellation (globals mutated incrementally by the prompt)
 *
 * Verified against @replit/codemirror-vim@6.4.0 and
 * @replit/codemirror-vim-core@0.1.0. None of these fields or hooks are a
 * stable public API; keep every access in this directory and re-verify on
 * every version bump.
 */

export type VimPublicMode =
  | 'normal'
  | 'insert'
  | 'replace'
  | 'visual'
  | 'visual-line'
  | 'visual-block'
  | 'search'
  | 'command'
  | 'inactive';

export interface VimPublicState {
  readonly mode: VimPublicMode;
  readonly pending: string;
}

export type VimWriteHandler = () => void;
export type VimQuitHandler = (force: boolean) => void;
export type VimWriteQuitHandler = () => void;

export interface VimAdapterHandlers {
  readonly write?: VimWriteHandler;
  readonly quit?: VimQuitHandler;
  readonly writeQuit?: VimWriteQuitHandler;
}

export interface VimRegisterSnapshot {
  readonly text: string;
  readonly linewise: boolean;
  readonly blockwise: boolean;
}

interface VimHostAdapter extends CodeMirror {
  __crumbVimWrite?: VimWriteHandler;
  __crumbVimQuit?: VimQuitHandler;
  __crumbVimWriteQuit?: VimWriteQuitHandler;
}

/**
 * Handlers are registered per EditorView, not per engine adapter. A tab switch
 * installs a fresh adapter through `EditorView.setState()`, so `patchVimAdapter`
 * reapplies these handlers to every adapter created for the same view.
 */
const adapterHandlers = new WeakMap<EditorView, VimAdapterHandlers>();

/** Plain engine positions. The bridge never stores adapter-bound markers. */
export interface VimJumpPoint {
  line: number;
  ch: number;
}

/**
 * Session-owned jump behavior. The lifecycle layer owns method replacement so
 * every adapter/global reset dispatches into the same session history, while
 * still supporting fixture adapters that have no session handler.
 */
export interface VimJumpBridgeHandlers {
  add(cm: CodeMirror, oldCur: VimJumpPoint, newCur: VimJumpPoint): void;
  move(cm: CodeMirror, signedCount: number): void;
  find(cm: CodeMirror, offset: number): VimJumpPoint | null;
  /** Fix a native landing column after lifecycle goal-column correction. */
  correct(cm: CodeMirror, landing: VimJumpPoint): void;
}

export interface VimJumpMarkerLike {
  find(): VimJumpPoint | null | undefined;
}

export interface VimJumpListLike {
  cachedCursor?: VimJumpPoint;
  add(cm: CodeMirror, oldCur: VimJumpPoint, newCur: VimJumpPoint): void;
  move(cm: CodeMirror, offset: number): VimJumpMarkerLike | undefined;
  find(cm: CodeMirror, offset: number): VimJumpPoint | null | undefined;
}

const adapterViews = new WeakMap<CodeMirror, EditorView>();
const jumpHandlers = new WeakMap<EditorView, VimJumpBridgeHandlers>();
const registeredJumpViews = new Set<EditorView>();
const patchedJumpLists = new WeakSet<object>();
const jumpVersions = new WeakMap<CodeMirror, number>();

interface FallbackJumpState {
  entries: VimJumpPoint[];
  pointer: number;
}

const fallbackJumpStates = new WeakMap<CodeMirror, FallbackJumpState>();
const FALLBACK_JUMP_LIMIT = 100;

function jumpPointEqual(a: VimJumpPoint, b: VimJumpPoint): boolean {
  return a.line === b.line && a.ch === b.ch;
}

function clampFallbackJumpPoint(cm: CodeMirror, point: VimJumpPoint): VimJumpPoint {
  const lineCount = typeof cm.lineCount === 'function' ? cm.lineCount() : point.line + 1;
  const line = Math.min(Math.max(0, point.line), Math.max(0, lineCount - 1));
  const text = typeof cm.getLine === 'function' ? cm.getLine(line) : '';
  const ch = Math.min(Math.max(0, point.ch), typeof text === 'string' ? text.length : point.ch);
  return { line, ch };
}

function fallbackJumpState(cm: CodeMirror): FallbackJumpState {
  let state = fallbackJumpStates.get(cm);
  if (!state) {
    state = { entries: [], pointer: -1 };
    fallbackJumpStates.set(cm, state);
  }
  return state;
}

function fallbackPush(state: FallbackJumpState, point: VimJumpPoint): void {
  const last = state.entries[state.entries.length - 1];
  if (last && jumpPointEqual(last, point)) {
    state.pointer = state.entries.length - 1;
    return;
  }
  state.entries.push({ ...point });
  if (state.entries.length > FALLBACK_JUMP_LIMIT) {
    state.entries.splice(0, state.entries.length - FALLBACK_JUMP_LIMIT);
  }
  state.pointer = state.entries.length - 1;
}

function fallbackAdd(cm: CodeMirror, oldCur: VimJumpPoint, newCur: VimJumpPoint): void {
  if (jumpPointEqual(oldCur, newCur)) return;
  const state = fallbackJumpState(cm);
  if (state.pointer < state.entries.length - 1) {
    state.entries.splice(state.pointer + 1);
  }
  const from = clampFallbackJumpPoint(cm, oldCur);
  const to = clampFallbackJumpPoint(cm, newCur);
  if (state.entries.length === 0) {
    fallbackPush(state, from);
    fallbackPush(state, to);
    return;
  }
  if (!jumpPointEqual(state.entries[state.pointer], from)) fallbackPush(state, from);
  fallbackPush(state, to);
}

function fallbackMove(cm: CodeMirror, offset: number): VimJumpMarkerLike | undefined {
  const state = fallbackJumpState(cm);
  if (state.entries.length === 0) return undefined;
  const step = offset < 0 ? -1 : 1;
  let pointer = Math.min(Math.max(0, state.pointer + offset), state.entries.length - 1);
  // Mirror the engine's skip of the position the cursor already occupies.
  while (pointer >= 0 && pointer < state.entries.length) {
    const point = state.entries[pointer];
    if (!jumpPointEqual(point, cm.getCursor())) break;
    pointer += step;
  }
  if (pointer < 0 || pointer >= state.entries.length) return undefined;
  state.pointer = pointer;
  const point = state.entries[pointer];
  return { find: () => ({ ...point }) };
}

function fallbackFind(cm: CodeMirror, offset: number): VimJumpPoint | null {
  const state = fallbackJumpState(cm);
  if (state.entries.length === 0) return null;
  const pointer = state.pointer + offset;
  if (pointer < 0 || pointer >= state.entries.length) return null;
  return { ...state.entries[pointer] };
}

function resolveJumpHandler(cm: CodeMirror): VimJumpBridgeHandlers | undefined {
  const view = adapterViews.get(cm);
  return view ? jumpHandlers.get(view) : undefined;
}

/**
 * Replace the live list's methods in place. The object identity is preserved so
 * the engine's `cachedCursor` (`*`/`#` origin) keeps working, and a WeakSet
 * makes repeated installs on the same object idempotent.
 */
export function installVimJumpListBridge(list: VimJumpListLike): void {
  if (patchedJumpLists.has(list)) return;
  patchedJumpLists.add(list);

  list.add = (cm, oldCur, newCur) => {
    jumpVersions.set(cm, (jumpVersions.get(cm) ?? 0) + 1);
    const handler = resolveJumpHandler(cm);
    if (handler) handler.add(cm, oldCur, newCur);
    else fallbackAdd(cm, oldCur, newCur);
  };
  list.move = (cm, offset) => {
    const handler = resolveJumpHandler(cm);
    if (handler) {
      handler.move(cm, offset);
      // The native jumpListWalk action then resets the cursor to the current
      // source position. The session activates the destination after the
      // engine stack unwinds.
      return undefined;
    }
    return fallbackMove(cm, offset);
  };
  list.find = (cm, offset) => {
    const handler = resolveJumpHandler(cm);
    if (handler) return handler.find(cm, offset);
    return fallbackFind(cm, offset);
  };
}

function currentVimJumpList(): VimJumpListLike {
  return Vim.getVimGlobalState_().jumpList as unknown as VimJumpListLike;
}

function ensureVimJumpListBridge(): void {
  installVimJumpListBridge(currentVimJumpList());
}

/**
 * Register the session jump bridge for one EditorView. The returned unsubscribe
 * is generation-safe: a stale binding cannot remove a newer handler for the
 * same view.
 */
export function registerVimJumpHandlers(
  view: EditorView,
  handlers: VimJumpBridgeHandlers,
): () => void {
  const cm = getCM(view);
  if (cm) adapterViews.set(cm, view);
  jumpHandlers.set(view, handlers);
  registeredJumpViews.add(view);
  ensureVimJumpListBridge();

  return () => {
    if (jumpHandlers.get(view) !== handlers) return;
    jumpHandlers.delete(view);
    registeredJumpViews.delete(view);
    if (registeredJumpViews.size === 0) {
      // `cachedCursor` is the engine's `*`/`#` origin. Drop it when the last
      // session view is gone rather than leaving it on a later global list.
      delete currentVimJumpList().cachedCursor;
    }
  };
}

function correctVimJumpLanding(cm: CodeMirror, landing: VimJumpPoint): void {
  resolveJumpHandler(cm)?.correct(cm, landing);
}


interface SearchSnapshot {
  query: unknown;
  reversed: boolean;
  register: string;
}

interface QuerySignature {
  source: string;
  flags: string;
}

export interface VimRepeatSnapshot {
  inputState: vimState['lastEditInputState'];
  actionCommand: vimState['lastEditActionCommand'];
}

export interface VimMarkPosition {
  name: string;
  line: number;
  ch: number;
}

export interface VimDocumentMarks {
  doc: Text;
  marks: readonly VimMarkPosition[];
}

export interface VimAdapterCapture {
  document: Text;
  repeat: VimRepeatSnapshot;
  marks: readonly VimMarkPosition[];
}

export type VimRestoreResult = 'applied' | 'stale' | 'unavailable';

/**
 * The engine's public `pcre=false` option translates Vim regex syntax once,
 * natively. This adapter only removes the engine's proactive `ignorecase`
 * flag so Neovim's default case-sensitive search is preserved. Callers must
 * not translate the source again.
 */
export function makeCaseSensitiveVimQuery(query: RegExp): RegExp {
  return new RegExp(query.source, query.flags.replace(/i/g, ''));
}

/**
 * Neovim's default `nostartofline` preserves the goal column for `gg`, `G`,
 * `H`, `M`, and `L`. The package always jumps to the first non-blank. The
 * engine stores the goal column in `lastHPos`; `Infinity` means the `$`
 * column (the last character of a non-empty line).
 */
export function neovimStartoflineColumn(
  lastHPos: number | undefined,
  currentColumn: number,
  lineLength: number,
): number {
  const lastCharacter = Math.max(0, lineLength - 1);
  if (lastHPos === Infinity) return lastCharacter;
  const goal = lastHPos === undefined ? currentColumn : lastHPos;
  return Math.min(Math.max(0, goal), lastCharacter);
}

// Search query and direction live in the engine singleton. `/` and `?` mutate
// the direction as soon as the prompt opens, and the incremental query update
// mutates the query/register on every keystroke. Remember the committed
// direction so a cancelled prompt can be rolled back precisely.
let committedSearchDirection: boolean | null = null;

const patchedAdapters = new WeakSet<CodeMirror>();
const overlaySweeps = new WeakMap<CodeMirror, ReturnType<typeof setTimeout>>();
let searchDirectionCaptureInstalled = false;
let searchActionCaptureInstalled = false;
let startoflineCaptureInstalled = false;

function cancelOverlaySweep(cm: CodeMirror): void {
  const timer = overlaySweeps.get(cm);
  if (timer === undefined) return;
  clearTimeout(timer);
  overlaySweeps.delete(cm);
}

/**
 * core vim.js:5419-5422 assigns `searchState.highlightTimeout` the previously
 * cleared global id *before* starting the new 50ms timer, so that field is not
 * the live timer id. We cannot reach the module-private live id without
 * leaving/re-entering Vim mode, which would discard adapter state. Instead,
 * remove any repaint just after that timer deadline; the guard prevents this
 * cleanup from touching an overlay started by a later search.
 */
function sweepCancelledSearchOverlay(cm: CodeMirror, cancelledQuery: QuerySignature | undefined): void {
  cancelOverlaySweep(cm);
  const timer = setTimeout(() => {
    overlaySweeps.delete(cm);
    if (!cm.state.vim) return;
    const searchState = cm.state.vim.searchState_;
    const overlay = searchState?.getOverlay();
    // If a later search has already painted a different query, keep it. The
    // overlay owns the engine's raw query; compare it after applying the same
    // case-sensitivity/translation normalization as the cancellation snapshot.
    const overlayQuery = querySignature(overlay?.query);
    if (
      overlay && cancelledQuery && overlayQuery &&
      (overlayQuery.source !== cancelledQuery.source || overlayQuery.flags !== cancelledQuery.flags)
    ) return;
    searchState?.setOverlay(null);
    cm.removeOverlay();
  }, 75);
  overlaySweeps.set(cm, timer);
}

function querySignature(query: unknown): QuerySignature | undefined {
  if (!(query instanceof RegExp)) return undefined;
  const normalized = makeCaseSensitiveVimQuery(query);
  return { source: normalized.source, flags: normalized.flags };
}

/**
 * Mapped searches (for example `:nmap z ?beta<CR>`) run through the engine's
 * private virtual prompt and never call `cm.openDialog`, so the wrapped prompt
 * cannot cache their committed direction. The outer key path is observable,
 * and when it finishes without a real dialog open the global direction is the
 * committed one. A mapping that leaves a prompt open opens a real dialog at
 * the end, so it is deliberately skipped here.
 */
function installSearchDirectionCapture(): void {
  if (searchDirectionCaptureInstalled) return;
  searchDirectionCaptureInstalled = true;

  const original = Vim.multiSelectHandleKey;
  Vim.multiSelectHandleKey = ((cm, key, origin) => {
    const result = original(cm, key, origin);
    const adapter = cm as unknown as CodeMirror;
    if (!adapter.state.dialog) {
      committedSearchDirection = Boolean(Vim.getVimGlobalState_().isReversed);
    }
    return result;
  }) as typeof Vim.multiSelectHandleKey;
}

/**
 * Observe whether the engine actually scheduled a search highlight, rather
 * than interpreting raw keys. This distinguishes real `n`/`N`/mapped searches
 * from literal `n` arguments (`fn`, `mn`, `rn`) and mappings such as `n -> h`.
 *
 * core highlightSearchMatches() (vim.js:5419-5422) always assigns
 * `searchState.highlightTimeout` from the engine's private timer slot. A change
 * in that observed slot means a new search repaint was scheduled and now owns
 * the overlay, so a pending cancellation sweep must be superseded. `gn`/`gN`,
 * literal arguments, and no-query `n` leave the slot unchanged.
 */
function installSearchActionCapture(): void {
  if (searchActionCaptureInstalled) return;
  searchActionCaptureInstalled = true;

  const original = Vim.handleKey;
  Vim.handleKey = ((cm, key, origin) => {
    const adapter = cm as unknown as CodeMirror;
    const searchStateBefore = adapter.state.vim?.searchState_;
    const timerBefore = searchStateBefore?.highlightTimeout;

    // handleKey() uses `this.findKey`, so preserve the engine receiver.
    const result = original.call(Vim, cm, key, origin);

    const searchStateAfter = adapter.state.vim?.searchState_;
    const timerAfter = searchStateAfter?.highlightTimeout;
    // A defined, changed slot is the observable signal that
    // highlightSearchMatches() scheduled a new repaint. `undefined` means the
    // action cleared the timer or did not schedule one at all.
    if (timerAfter !== undefined && timerAfter !== timerBefore) {
      cancelOverlaySweep(adapter);
    }
    return result;
  }) as typeof Vim.handleKey;
}

const STARTOFLINE_MOTIONS = new Set([
  'moveToTopLine',
  'moveToMiddleLine',
  'moveToBottomLine',
  'moveToLineOrEdgeOfDocument',
]);

// Vertical motions keep the Vim goal column even when a short line clips the
// cursor. Display/page/scroll motions must keep the package's own visual
// movement unless they are one of the line-jump motions corrected below.
const GOAL_PRESERVING_MOTIONS = new Set([
  ...STARTOFLINE_MOTIONS,
  'moveByLines',
  'moveByDisplayLines',
  'moveByPage',
  'moveByScroll',
]);

// Only line jumps (and `j`/`k`, whose package path can discard the goal after
// a short-line jump) get an explicit cursor correction. `gj`, Ctrl-D, Ctrl-F,
// and Ctrl-B retain their native wrapped-line/scroll semantics when they reach
// the engine; Crumb's App reserves the exact Ctrl-B chord in editors.
const GOAL_CORRECTION_MOTIONS = new Set([
  ...STARTOFLINE_MOTIONS,
  'moveByLines',
]);

// Display/scroll/page motions must not rewrite the native cursor, but their
// landing column becomes the new logical goal for a following G/gg/j/k.
const DISPLAY_GOAL_MOTIONS = new Set([
  'moveByDisplayLines',
  'moveByScroll',
  'moveByPage',
]);

type VimGoalColumn = number | 'eol';
const vimGoalColumns = new WeakMap<CodeMirror, VimGoalColumn>();

function positionBefore(a: VimSearchPos, b: VimSearchPos): boolean {
  return a.line < b.line || (a.line === b.line && a.ch < b.ch);
}

function offsetPosition(pos: VimSearchPos, offset: number): VimSearchPos {
  return offset === 0 ? pos : { line: pos.line, ch: pos.ch + offset };
}

/**
 * Programmatic Visual range updates must look like Vim operations. Otherwise
 * the engine's cursor-activity handler treats the primary CodeMirror range as
 * an external mouse selection and overwrites `vim.sel` (which breaks block
 * operator rectangles).
 */
function applyVisualSelection(adapter: CodeMirror, apply: () => void): void {
  const operationAdapter = adapter as unknown as {
    curOp?: { isVimOp?: boolean };
    operation: (callback: () => void, force?: boolean) => unknown;
  };
  const run = () => {
    if (operationAdapter.curOp) operationAdapter.curOp.isVimOp = true;
    apply();
  };
  if (!operationAdapter.curOp) {
    operationAdapter.operation(run, true);
    return;
  }
  const previous = operationAdapter.curOp.isVimOp;
  run();
  if (operationAdapter.curOp) operationAdapter.curOp.isVimOp = previous;
}

/** Keep the engine's selected range coherent after a Visual goal-column jump. */
function updateVisualGoal(adapter: CodeMirror, vim: vimState, line: number, targetCh: number): void {
  if (!vim.sel) return;
  const anchor = vim.sel.anchor;
  const head = { line, ch: targetCh };
  vim.sel.head = head;

  if (vim.visualBlock) {
    const top = Math.min(anchor.line, head.line);
    const bottom = Math.max(anchor.line, head.line);
    let fromCh = anchor.ch;
    let toCh = head.ch;
    if (fromCh < toCh) toCh += 1;
    else fromCh += 1;
    const ranges: Array<{ anchor: VimSearchPos; head: VimSearchPos }> = [];
    for (let current = top; current <= bottom; current += 1) {
      ranges.push({
        anchor: { line: current, ch: fromCh },
        head: { line: current, ch: toCh },
      });
    }
    applyVisualSelection(adapter, () => {
      adapter.setSelections(ranges, head.line === top ? 0 : ranges.length - 1);
    });
    return;
  }

  if (vim.visualLine) {
    applyVisualSelection(adapter, () => {
      if (!positionBefore(head, anchor)) {
        adapter.setSelection(
          { line: anchor.line, ch: 0 },
          { line: head.line, ch: adapter.getLine(head.line).length },
        );
      } else {
        adapter.setSelection(
          { line: anchor.line, ch: adapter.getLine(anchor.line).length },
          { line: head.line, ch: 0 },
        );
      }
    });
    return;
  }

  const headOffset = !positionBefore(head, anchor) ? 1 : 0;
  const anchorOffset = positionBefore(head, anchor) ? 1 : 0;
  applyVisualSelection(adapter, () => {
    adapter.setSelection(
      offsetPosition(anchor, anchorOffset),
      offsetPosition(head, headOffset),
    );
  });
}

function refreshGoalFromCursor(cm: CodeMirror): void {
  const vim = cm.state.vim;
  const position = vim?.visualMode && vim.sel ? vim.sel.head : cm.getCursor();
  vimGoalColumns.set(cm, position.ch);
}

/**
 * Restore a session jump landing through the same adapter boundary that owns
 * the Neovim goal-column cache. A plain `view.dispatch()` moves the selection
 * but leaves `vimGoalColumns` on the old column, so a following `G`/`gg`/`j`/`k`
 * would reuse the pre-jump goal. The session calls this after replay state is
 * restored and before focus.
 */
export function restoreVimJumpCursor(
  view: EditorView,
  position: { line: number; ch: number },
): boolean {
  const cm = getCM(view);
  if (!cm) return false;
  const doc = view.state.doc;
  const requestedLine = Number.isFinite(position.line) ? Math.trunc(position.line) : 0;
  const lineNumber = Math.min(Math.max(0, requestedLine), doc.lines - 1);
  const line = doc.line(lineNumber + 1);
  const requestedCh = Number.isFinite(position.ch) ? Math.trunc(position.ch) : 0;
  const ch = Math.min(Math.max(0, requestedCh), line.length);

  view.dispatch({ selection: { anchor: line.from + ch }, scrollIntoView: true });
  vimGoalColumns.set(cm, ch);
  return true;
}

/** Read the lifecycle goal cache for focused tests/diagnostics. */
export function getVimGoalColumn(view: EditorView): number | 'eol' | undefined {
  const cm = getCM(view);
  return cm ? vimGoalColumns.get(cm) : undefined;
}

/**
 * Track host mouse selection without leaving a listener/timer behind when the
 * Vim adapter is destroyed or recreated on the same EditorView.
 */
export function createMouseGoalRefresh(target: EventTarget, refresh: () => void): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const onMouseUp = () => {
    refresh();
    if (pending !== null) clearTimeout(pending);
    // CodeMirror can finish mapping the mouse position on the next task.
    pending = setTimeout(() => {
      pending = null;
      refresh();
    }, 0);
  };
  target.addEventListener('mouseup', onMouseUp);
  return () => {
    target.removeEventListener('mouseup', onMouseUp);
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
  };
}

/**
 * Neovim defaults to `nostartofline`. The package's `gg`, `G`, `H`, `M`, and
 * `L` always go to the first non-blank, so preserve a persistent goal column
 * across those motions. The goal survives short lines and `$` (end-of-line)
 * goals, and is applied to charwise/linewise/blockwise Visual heads as well.
 *
 * BLOCKED: full Neovim `nostartofline` parity for built-in linewise operators
 * (`dG`, `cG`, `yG`, indent, and related forms) needs the package's operator
 * implementations replaced. That exceeds this narrow adapter boundary and is
 * intentionally not attempted here.
 */
function installStartoflineCapture(): void {
  if (startoflineCaptureInstalled) return;
  startoflineCaptureInstalled = true;

  const original = Vim.handleKey;
  Vim.handleKey = ((cm, key, origin) => {
    const adapter = cm as unknown as CodeMirror;
    // A global-state reset replaces the jump list object. Repair the replacement
    // before the engine can add to it, without touching the old object.
    ensureVimJumpListBridge();
    const jumpVersionBefore = jumpVersions.get(adapter) ?? 0;
    const before = adapter.state.vim;
    const beforeCursor = adapter.getCursor();
    const previousMotion = before?.lastMotion?.name;
    const goal = vimGoalColumns.get(adapter) ?? beforeCursor.ch;

    // handleKey() uses `this.findKey`, so preserve the engine receiver.
    const result = original.call(Vim, cm, key, origin);

    const after = adapter.state.vim;
    if (!after) return result;
    const cursor = adapter.getCursor();
    const motionName = after.lastMotion?.name;
    const targetMotion = motionName !== undefined && GOAL_CORRECTION_MOTIONS.has(motionName);
    const executedTarget = targetMotion && (
      motionName !== previousMotion ||
      cursor.line !== beforeCursor.line ||
      cursor.ch !== beforeCursor.ch
    );

    if (executedTarget && !after.insertMode) {
      const lineLength = adapter.getLine(cursor.line).length;
      const target = neovimStartoflineColumn(
        goal === 'eol' ? Infinity : goal,
        beforeCursor.ch,
        lineLength,
      );
      if (after.visualMode) {
        updateVisualGoal(adapter, after, cursor.line, target);
      } else if (target !== cursor.ch) {
        adapter.setCursor({ line: cursor.line, ch: target });
      }
      after.lastHPos = goal === 'eol' ? Infinity : goal;
      vimGoalColumns.set(adapter, goal);
      // Native add() recorded the engine's first-non-blank landing before this
      // correction. Replace only that just-added same-line destination; commands
      // that did not add a jump (j/k, plain edits) must never touch history.
      if ((jumpVersions.get(adapter) ?? 0) !== jumpVersionBefore) {
        const landing = after.visualMode && after.sel
          ? { line: after.sel.head.line, ch: after.sel.head.ch }
          : { line: cursor.line, ch: target };
        correctVimJumpLanding(adapter, landing);
      }
      return result;
    }

    let nextGoal = goal;
    // CodeMirror's charwise Visual head is exclusive; Vim's goal is the
    // semantic head character.
    const goalCursor = after.visualMode && after.sel ? after.sel.head : cursor;
    if (motionName && DISPLAY_GOAL_MOTIONS.has(motionName)) {
      // Keep the native display/scroll/page landing position, but synchronize
      // the logical column cache so a later G/gg does not reuse a stale column.
      nextGoal = goalCursor.ch;
    } else if (!motionName || !GOAL_PRESERVING_MOTIONS.has(motionName)) {
      if (motionName === 'moveToColumn' && typeof after.lastHPos === 'number') {
        // `10|` sets a numeric goal even when a short line clips the cursor.
        nextGoal = after.lastHPos;
      } else {
        nextGoal = motionName === 'moveToEol' ? 'eol' : goalCursor.ch;
      }
    }
    vimGoalColumns.set(adapter, nextGoal);
    return result;
  }) as typeof Vim.handleKey;
}

function adapterVimState(view: EditorView): vimState | null {
  const cm = getCM(view);
  // `state.vim` is not a stable public API; it is the adapter state this
  // module is responsible for. Access stays isolated here.
  const vim = cm?.state.vim;
  return vim ?? null;
}

function syncCommittedSearchDirection(): boolean {
  if (committedSearchDirection === null) {
    // `getVimGlobalState_()` is documented by the package as a testing hook.
    // The search prompt needs the direction before it has a chance to mutate
    // it, so this snapshot is taken when the adapter is first created.
    committedSearchDirection = Boolean(Vim.getVimGlobalState_().isReversed);
  }
  return committedSearchDirection;
}

function promptPrefix(template: Element): string {
  return (template.textContent ?? '').trimStart().charAt(0);
}

function captureSearchSnapshot(): SearchSnapshot {
  const globals = Vim.getVimGlobalState_();
  return {
    // At prompt-open time the committed query has not been touched yet; only
    // the direction has been flipped by processSearch().
    query: globals.query ?? null,
    reversed: syncCommittedSearchDirection(),
    register: globals.registerController.getRegister('/').toString(),
  };
}

function restoreSearchSnapshot(cm: CodeMirror, snapshot: SearchSnapshot, cancelledQuery?: QuerySignature): void {
  const globals = Vim.getVimGlobalState_();
  globals.query = snapshot.query;
  globals.isReversed = snapshot.reversed;
  globals.registerController.getRegister('/').setText(snapshot.register);
  committedSearchDirection = snapshot.reversed;

  // Cancel the incremental highlight immediately, then sweep once more after
  // the engine's pending 50ms timer. `searchState.highlightTimeout` is not a
  // reliable live timer id (see sweepCancelledSearchOverlay).
  const searchState = cm.state.vim?.searchState_;
  searchState?.setOverlay(null);
  cm.removeOverlay();
  sweepCancelledSearchOverlay(cm, cancelledQuery);
}

interface VimSearchPos {
  line: number;
  ch: number;
}

type VimSearchCursor = ReturnType<CodeMirror['getSearchCursor']>;

/**
 * The package's backward cursor excludes a match that overlaps the starting
 * cursor. Neovim includes the match the cursor is inside (except at its start).
 * Reposition a cursor onto that containing match during its first backward
 * step. Doing this at the cursor layer preserves counts, operators, and Visual
 * ranges because the engine's own motion/operator code sees the corrected
 * match before it acts. The prompt callback is not post-corrected.
 */
function positionAtContainingMatch(
  cm: CodeMirror,
  getCursor: (query: RegExp, pos: VimSearchPos) => VimSearchCursor,
  query: RegExp,
  pos: VimSearchPos,
): VimSearchCursor | null {
  const origin = cm.indexFromPos(pos);
  const probe = getCursor(query, { line: 0, ch: 0 });
  let targetFrom: number | null = null;
  let targetTo: number | null = null;

  while (probe.findNext()) {
    const from = probe.from();
    const to = probe.to();
    if (!from || !to) continue;
    const fromOffset = cm.indexFromPos(from);
    const toOffset = cm.indexFromPos(to);
    if (fromOffset > origin) break;
    if (fromOffset < origin && origin <= toOffset) {
      targetFrom = fromOffset;
      targetTo = toOffset;
      break;
    }
  }

  if (targetFrom === null || targetTo === null) return null;

  const positioned = getCursor(query, { line: 0, ch: 0 });
  while (positioned.findNext()) {
    const from = positioned.from();
    const to = positioned.to();
    if (
      from && to &&
      cm.indexFromPos(from) === targetFrom &&
      cm.indexFromPos(to) === targetTo
    ) {
      return positioned;
    }
  }
  return null;
}

/**
 * The stock prompt opens with `showPrompt()` passing the commit callback as the
 * second argument and an options object as the third. `openDialog` calls the
 * third argument's `onClose` whenever the dialog closes, but the engine does
 * not provide one for search. Wrapping only `/` and `?` dialogs lets us tell a
 * committed search (second callback invoked with a string) from Escape, blur,
 * or programmatic cancellation (dialog close with no commit).
 */
export function patchVimAdapter(
  view: EditorView,
  handlers?: VimAdapterHandlers,
): (() => void) | null {
  const cm = getCM(view);
  if (!cm) return null;
  adapterViews.set(cm, view);
  ensureVimJumpListBridge();
  if (handlers) adapterHandlers.set(view, handlers);
  const active = handlers ?? adapterHandlers.get(view);
  const host = cm as VimHostAdapter;
  host.__crumbVimWrite = active?.write;
  host.__crumbVimQuit = active?.quit;
  host.__crumbVimWriteQuit = active?.writeQuit;
  if (patchedAdapters.has(cm)) return null;
  patchedAdapters.add(cm);
  syncCommittedSearchDirection();
  installSearchDirectionCapture();
  installSearchActionCapture();
  installStartoflineCapture();
  const cleanupMouseGoal = createMouseGoalRefresh(
    view.contentDOM,
    () => refreshGoalFromCursor(cm),
  );

  // Engine search is case-insensitive/smart-case and (with pcre=false)
  // already translates Vim regex syntax natively. Keep the committed query raw
  // and normalize only the case flag at the search/overlay boundaries.
  const originalGetSearchCursor = cm.getSearchCursor.bind(cm);
  cm.getSearchCursor = ((query: RegExp, pos: VimSearchPos) => {
    const normalized = makeCaseSensitiveVimQuery(query);
    const initial = originalGetSearchCursor(normalized, pos);
    let active = initial;
    let firstFind = true;

    const find = (back?: boolean): boolean | string[] | null | undefined => {
      if (!firstFind) return active.find(back);
      firstFind = false;
      if (!back) return active.find(back);
      const containing = positionAtContainingMatch(cm, originalGetSearchCursor, normalized, pos);
      if (!containing) return active.find(back);
      active = containing;
      return active.match;
    };

    return {
      findNext: () => find(false),
      findPrevious: () => find(true),
      find,
      from: () => active.from(),
      to: () => active.to(),
      replace: (text: string) => active.replace(text),
      get match() { return active.match; },
    } as VimSearchCursor;
  }) as typeof cm.getSearchCursor;
  const originalAddOverlay = cm.addOverlay.bind(cm);
  cm.addOverlay = ((overlay: { query?: RegExp }) => {
    if (overlay?.query instanceof RegExp) {
      return originalAddOverlay({ ...overlay, query: makeCaseSensitiveVimQuery(overlay.query) });
    }
    return originalAddOverlay(overlay as Parameters<typeof originalAddOverlay>[0]);
  }) as typeof cm.addOverlay;

  const originalOpenDialog = cm.openDialog.bind(cm) as (
    template: Element,
    callback: Function | undefined,
    options: Record<string, unknown>,
  ) => (newVal?: string) => void;

  cm.openDialog = ((template: Element, callback: Function | undefined, options: Record<string, unknown> | undefined) => {
    const prefix = promptPrefix(template);
    if (prefix !== '/' && prefix !== '?') return originalOpenDialog(template, callback, options ?? {});

    // A newer search owns the overlay now; a pending cancellation sweep from
    // an older prompt must not clear it.
    cancelOverlaySweep(cm);
    const snapshot = captureSearchSnapshot();
    let committed = false;
    let cancelledQuery: QuerySignature | undefined;

    const wrappedCallback = typeof callback === 'function'
      ? (value?: string) => {
          const result = callback(value);
          if (typeof value === 'string') {
            committed = true;
            committedSearchDirection = prefix === '?';
            cancelOverlaySweep(cm);
            refreshGoalFromCursor(cm);
          }
          return result;
        }
      : callback;

    const originalOnClose = options?.onClose;
    const originalOnKeyUp = options?.onKeyUp;
    const patchedOptions: Record<string, unknown> = {
      ...(options ?? {}),
      onKeyUp: (...args: unknown[]) => {
        const result = typeof originalOnKeyUp === 'function' ? originalOnKeyUp(...args) : undefined;
        // Record the engine's parsed incremental query rather than the raw
        // input text, so translated Vim regexes are matched correctly when
        // deciding whether a later overlay belongs to this cancelled prompt.
        cancelledQuery = querySignature(Vim.getVimGlobalState_().query);
        return result;
      },
      onClose: (dialog: HTMLElement) => {
        if (!committed) {
          restoreSearchSnapshot(cm, snapshot, cancelledQuery);
          // This is ordinary prompt cancellation, not lifecycle teardown.
          // Reset only the pending Vim input so a pre-existing Visual mode
          // survives; sending another <Esc> here would exit it.
          resetPendingInput(cm);
        }
        if (typeof originalOnClose === 'function') originalOnClose(dialog);
      },
    };

    return originalOpenDialog(template, wrappedCallback, patchedOptions);
  }) as typeof cm.openDialog;

  return cleanupMouseGoal;
}

function clearEngineInput(cm: CodeMirror): void {
  if (!cm.state.vim) return;
  // A central engine key path: exits insert/visual, cancels pending
  // operators/mappings, and avoids touching engine private timers.
  Vim.handleKey(cm, '<Esc>', 'user');
  const activeVim = cm.state.vim;
  if (activeVim) activeVim.status = '';
}

function resetPendingInput(cm: CodeMirror): void {
  const vim = cm.state.vim;
  if (!vim) return;
  // Mirror the engine's internal clearInputState() without its mode-changing
  // <Esc> path. The InputState constructor is the same class the engine uses
  // in vim.js clearInputState (post-6.4.0 re-verify).
  const current = vim.inputState;
  const InputState = current.constructor as new () => typeof current;
  vim.inputState = new InputState();
  vim.expectLiteralNext = false;
  vim.status = '';
  cm.signal('vim-command-done', undefined);
}

export function getVimRegister(view: EditorView, name = '"'): VimRegisterSnapshot | null {
  if (!getCM(view)) return null;
  const register = Vim.getRegisterController().getRegister(name) as {
    toString(): string;
    linewise?: boolean;
    blockwise?: boolean;
  };
  return {
    text: register.toString(),
    linewise: Boolean(register.linewise),
    blockwise: Boolean(register.blockwise),
  };
}

export function getVimPublicState(view: EditorView): VimPublicState {
  const cm = getCM(view);
  const vim = adapterVimState(view);
  if (!cm || !vim) return { mode: 'inactive', pending: '' };

  const dialog = cm.state.dialog;
  // `state.dialog` is shared by prompts and transient notifications. Only a
  // prompt (which owns an input) changes the Vim mode the caller cares about.
  if (dialog?.querySelector('input')) {
    const prefix = dialog.textContent?.trimStart().charAt(0);
    return { mode: prefix === ':' ? 'command' : 'search', pending: '' };
  }
  if (vim.insertMode) return { mode: cm.state.overwrite ? 'replace' : 'insert', pending: '' };
  if (vim.visualMode) {
    return {
      mode: vim.visualBlock ? 'visual-block' : vim.visualLine ? 'visual-line' : 'visual',
      pending: '',
    };
  }
  return { mode: 'normal', pending: vim.status ?? '' };
}

const VIM_STATE_EVENTS = ['vim-mode-change', 'vim-keypress', 'vim-command-done', 'dialog'] as const;

/**
 * Observe the public mode/pending snapshot for one adapter. The package fires
 * mode, key, command-completion, and prompt-dialog signals; together they cover
 * every transition the status bar renders without polling engine internals.
 * The listener fires immediately, and a missing adapter reports `inactive`.
 */
export function observeVimPublicState(
  view: EditorView,
  listener: (state: VimPublicState) => void,
): () => void {
  const notify = () => listener(getVimPublicState(view));
  notify();

  const cm = getCM(view);
  if (!cm) return () => {};
  for (const event of VIM_STATE_EVENTS) cm.on(event, notify);
  return () => {
    for (const event of VIM_STATE_EVENTS) cm.off(event, notify);
  };
}

/**
 * Finish mode and pending-input cleanup while the adapter is still alive.
 * This must run before `EditorView.setState()`; by plugin-destroy time the
 * engine has already set `cm.state.vim` to null.
 */
export function cancelTransientInput(view: EditorView): void {
  const cm = getCM(view);
  const vim = adapterVimState(view);
  if (!cm || !vim) return;

  const dialog = cm.state.dialog;
  const input = dialog?.querySelector('input');
  if (input) {
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }));
    if (cm.state.dialog) input.blur();
  }

  const activeVim = adapterVimState(view);
  if (activeVim) {
    // Clearing the insert-mode key buffer before the adapter is destroyed
    // makes the engine's private insert-mapping timeout harmless.
    clearEngineInput(cm);
  }
}

/**
 * Finalize an adapter for an ownership/document transition while it is still
 * alive. The returned repeat references are engine class instances; callers
 * must keep them opaque and never serialize them.
 */
export function captureVimAdapter(view: EditorView): VimAdapterCapture | null {
  cancelTransientInput(view);

  const vim = adapterVimState(view);
  if (!vim) return null;

  const marks: VimMarkPosition[] = [];
  for (const [name, marker] of Object.entries(vim.marks) as [string, Marker][]) {
    const pos = marker.find();
    if (pos) marks.push({ name, line: pos.line, ch: pos.ch });
    // Never carry a live Marker (which is bound to this adapter) across the
    // lifecycle boundary.
    marker.clear();
  }
  vim.marks = {};

  return {
    document: view.state.doc,
    repeat: {
      inputState: vim.lastEditInputState,
      actionCommand: vim.lastEditActionCommand,
    },
    marks,
  };
}

/**
 * Install session-owned repeat/marks into a freshly installed adapter. Marks
 * are document-owned: a snapshot for different text is stale and must be
 * discarded rather than transplanted onto unrelated content.
 */
export function restoreVimAdapter(
  view: EditorView,
  repeat: VimRepeatSnapshot,
  marks: VimDocumentMarks | undefined,
): VimRestoreResult {
  const cm = getCM(view);
  const vim = adapterVimState(view);
  if (!cm || !vim) return 'unavailable';

  vim.lastEditInputState = repeat.inputState;
  vim.lastEditActionCommand = repeat.actionCommand;
  vim.marks = {};

  let result: VimRestoreResult = 'applied';
  if (marks) {
    const doc = view.state.doc;
    if (!marks.doc.eq(doc)) {
      result = 'stale';
    } else {
      for (const mark of marks.marks) {
        if (mark.line < 0 || mark.line >= doc.lines) continue;
        const line = doc.line(mark.line + 1);
        const ch = Math.min(Math.max(0, mark.ch), line.length);
        vim.marks[mark.name] = cm.setBookmark({ line: mark.line, ch });
      }
    }
  }

  vim.status = '';
  patchVimAdapter(view);
  return result;
}

export function hasActiveVimAdapter(view: EditorView): boolean {
  return adapterVimState(view) !== null;
}

/**
 * Run the engine's own `:nohlsearch` path for a view. It cancels the engine's
 * pending delayed-overlay repaint and clears the committed search overlay while
 * preserving the stored pattern, so `n`/`N` continue to work.
 */
export function clearVimSearchHighlight(view: EditorView): void {
  const cm = getCM(view);
  if (!cm || !cm.state.vim) return;
  Vim.handleEx(cm as Parameters<typeof Vim.handleEx>[0], 'nohlsearch');
}
