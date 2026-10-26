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

interface SearchSnapshot {
  query: unknown;
  reversed: boolean;
  register: string;
}

interface QuerySignature {
  source: string;
  flags: string;
}

interface RepeatSnapshot {
  inputState: vimState['lastEditInputState'];
  actionCommand: vimState['lastEditActionCommand'];
}

interface MarkPosition {
  name: string;
  line: number;
  ch: number;
}

interface MarkSnapshot {
  doc: Text;
  marks: MarkPosition[];
}

// Vim's last change is session-wide, not buffer-local. Keeping the engine's
// class instances by reference avoids serializing InputState/command objects
// and keeps the global insert-change register (`macroModeState`) coherent.
let repeatSnapshot: RepeatSnapshot = { inputState: undefined, actionCommand: undefined };

// Marks are doc-owned positions, keyed by the caller's stable document id.
// They are captured before the old adapter is destroyed and re-created as new
// Marker instances in the replacement adapter.
const markSnapshots = new Map<string, MarkSnapshot>();

// Search query and direction live in the engine singleton. `/` and `?` mutate
// the direction as soon as the prompt opens, and the incremental query update
// mutates the query/register on every keystroke. Remember the committed
// direction so a cancelled prompt can be rolled back precisely.
let committedSearchDirection: boolean | null = null;

const patchedAdapters = new WeakSet<CodeMirror>();
const overlaySweeps = new WeakMap<CodeMirror, ReturnType<typeof setTimeout>>();
let searchDirectionCaptureInstalled = false;
let searchActionCaptureInstalled = false;

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
    // If a later search has already painted a different query, keep it.
    if (
      overlay && cancelledQuery &&
      (overlay.query.source !== cancelledQuery.source || overlay.query.flags !== cancelledQuery.flags)
    ) return;
    searchState?.setOverlay(null);
    cm.removeOverlay();
  }, 75);
  overlaySweeps.set(cm, timer);
}

function querySignature(query: unknown): QuerySignature | undefined {
  return query instanceof RegExp ? { source: query.source, flags: query.flags } : undefined;
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

/**
 * The stock prompt opens with `showPrompt()` passing the commit callback as the
 * second argument and an options object as the third. `openDialog` calls the
 * third argument's `onClose` whenever the dialog closes, but the engine does
 * not provide one for search. Wrapping only `/` and `?` dialogs lets us tell a
 * committed search (second callback invoked with a string) from Escape, blur,
 * or programmatic cancellation (dialog close with no commit).
 */
export function patchVimAdapter(view: EditorView): void {
  const cm = getCM(view);
  if (!cm || patchedAdapters.has(cm)) return;
  patchedAdapters.add(cm);
  syncCommittedSearchDirection();
  installSearchDirectionCapture();
  installSearchActionCapture();

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

function captureRepeatState(vim: vimState): void {
  // These are engine class instances. Holding references is intentional; the
  // global macro/insert-change state remains the single source for insert
  // repeat, so each adapter uses the same latest session change.
  repeatSnapshot = {
    inputState: vim.lastEditInputState,
    actionCommand: vim.lastEditActionCommand,
  };
}

function restoreRepeatState(vim: vimState): void {
  vim.lastEditInputState = repeatSnapshot.inputState;
  vim.lastEditActionCommand = repeatSnapshot.actionCommand;
}

function captureMarkState(vim: vimState, documentId: string, doc: Text): void {
  const marks: MarkPosition[] = [];
  for (const [name, marker] of Object.entries(vim.marks) as [string, Marker][]) {
    const pos = marker.find();
    if (pos) marks.push({ name, line: pos.line, ch: pos.ch });
    // Never carry a live Marker (which is bound to this adapter) across the
    // lifecycle boundary.
    marker.clear();
  }
  vim.marks = {};
  if (marks.length === 0) {
    // Do not retain a Text tree for a document that has no marks to restore.
    markSnapshots.delete(documentId);
    return;
  }
  markSnapshots.set(documentId, { doc, marks });
}

export function releaseDocumentMarks(documentId: string): void {
  markSnapshots.delete(documentId);
}

function restoreMarkState(cm: CodeMirror, vim: vimState, documentId: string, doc: Text): void {
  const snapshot = markSnapshots.get(documentId);
  if (!snapshot) return;
  vim.marks = {};

  // If the document changed while Vim was disabled we cannot map the old
  // positions safely without a ChangeDesc. Invalidate instead of restoring
  // marks that could point at the wrong text.
  if (!snapshot.doc.eq(doc)) {
    markSnapshots.delete(documentId);
    return;
  }

  for (const mark of snapshot.marks) {
    if (mark.line < 0 || mark.line >= doc.lines) continue;
    const line = doc.line(mark.line + 1);
    const ch = Math.min(Math.max(0, mark.ch), line.length);
    vim.marks[mark.name] = cm.setBookmark({ line: mark.line, ch });
  }
}

export function beforeDocumentActivation(view: EditorView, documentId: string): void {
  const cm = getCM(view);
  const vim = adapterVimState(view);
  if (!cm || !vim) return;

  cancelTransientInput(view);

  const activeVim = adapterVimState(view);
  if (!activeVim) return;
  captureRepeatState(activeVim);
  captureMarkState(activeVim, documentId, view.state.doc);
}

export function afterDocumentActivation(view: EditorView, documentId: string): void {
  const cm = getCM(view);
  const vim = adapterVimState(view);
  if (!cm || !vim) return;

  restoreRepeatState(vim);
  restoreMarkState(cm, vim, documentId, view.state.doc);
  vim.status = '';
  patchVimAdapter(view);
}
