import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import {
  captureVimAdapter,
  hasActiveVimAdapter,
  registerVimJumpHandlers,
  restoreVimAdapter,
  restoreVimJumpCursor,
  type VimAdapterCapture,
  type VimDocumentMarks,
  type VimJumpBridgeHandlers,
  type VimJumpPoint,
  type VimRepeatSnapshot,
  type VimRestoreResult,
} from './lifecycle.ts';
import {
  clampJumpLocation,
  createJumpHistory,
  pruneJumpHistorySnapshot,
  type VimJumpHistorySnapshot,
  type VimJumpLocation,
} from './jump-history.ts';

export type { VimJumpLocation } from './jump-history.ts';

/**
 * App-owned Vim session coordinator.
 *
 * The CodeMirror document, selection, and history stay owned by each Editor.
 * This coordinator owns only the application-session data that must outlive a
 * single adapter: dot-repeat state, document-keyed marks, one chronological
 * jump history, the one authoritative command owner across all panes, and the
 * authoritative open-document set.
 *
 * The engine's insert-repeat payload is global, so only the current owner may
 * publish repeat or marks. Inactive adapters are restored lazily when they
 * become the owner rather than broadcasting stale snapshots over the owner.
 */

export interface VimSessionAdapter {
  capture(view: EditorView): VimAdapterCapture | null;
  restore(
    view: EditorView,
    repeat: VimRepeatSnapshot,
    marks: VimDocumentMarks | undefined,
  ): VimRestoreResult;
  hasAdapter(view: EditorView): boolean;
  /** Optional override used by unit tests; production uses the lifecycle bridge. */
  registerJumps?(view: EditorView, handlers: VimJumpBridgeHandlers): () => void;
  /**
   * Narrow adapter seam for a replayed landing. Production applies the
   * selection/scroll and refreshes the private goal-column cache; tests can
   * substitute a fake.
   */
  restoreCursor?(view: EditorView, position: { line: number; ch: number }): boolean;
}

export interface VimSessionBinding {
  /** Finalize this binding's adapter if it owns the session, before it changes. */
  beforeTransition(): void;
  /** Mark the installed target state ready and restore session state if requested. */
  afterTransition(documentId: string): void;
  /** Enable/disable ownership eligibility around a Vim compartment change. */
  setEnabled(enabled: boolean): void;
  /** Finalize and unregister this binding. Safe for stale/replayed bindings. */
  detach(): void;
}

export interface RequestOwnerOptions {
  /** Restore keyboard focus to the new owner once it is ready. */
  focus?: boolean;
}

export interface VimJumpNavigation {
  /** Editor pane that now shows the target document. */
  paneId: string;
}

/** Resolve and activate an already-open document; null means reject. */
export type VimJumpNavigator = (target: VimJumpLocation) => VimJumpNavigation | null;

export interface VimSession {
  /** Attach one Editor's current view and document. Returns a generation-safe handle. */
  attachPane(paneId: string, view: EditorView, documentId: string, enabled: boolean): VimSessionBinding;
  /** Request the single application-wide command owner, or null to release it. */
  requestOwner(paneId: string | null, options?: RequestOwnerOptions): void;
  /** Drop pending focus repair when focus leaves editors for external controls. */
  cancelFocusIntent(nextFocus?: Node | null): void;
  /** Replace the authoritative open-document set from App's committed tabs. */
  reconcileDocuments(openIds: Iterable<string>): void;
  /** App-owned activation callback for cross-file jump destinations. */
  setJumpNavigator(navigator: VimJumpNavigator | null): void;
}

interface PendingJump {
  token: number;
  target: VimJumpLocation;
  sourcePaneId: string;
  targetPaneId: string | null;
  /** True while the host navigator is synchronously activating the target. */
  activating: boolean;
}

const emptyRepeat: VimRepeatSnapshot = { inputState: undefined, actionCommand: undefined };

const defaultAdapter: VimSessionAdapter = {
  capture: captureVimAdapter,
  restore: restoreVimAdapter,
  hasAdapter: hasActiveVimAdapter,
  registerJumps: registerVimJumpHandlers,
  restoreCursor: restoreVimJumpCursor,
};

interface BindingState {
  paneId: string;
  view: EditorView;
  documentId: string;
  enabled: boolean;
  ready: boolean;
  unregisterJumps: () => void;
}

function pointLocation(documentId: string, point: VimJumpPoint): VimJumpLocation {
  return { documentId, line: point.line, ch: point.ch };
}

export function createVimSession(adapter: VimSessionAdapter = defaultAdapter): VimSession {
  let repeat: VimRepeatSnapshot = emptyRepeat;
  const marksByDocument = new Map<string, VimDocumentMarks>();
  const openDocuments = new Set<string>();
  let documentsKnown = false;

  const history = createJumpHistory();
  let jumpNavigator: VimJumpNavigator | null = null;
  let pendingJump: PendingJump | null = null;
  let pendingJumpBase: VimJumpHistorySnapshot | null = null;
  let replayingJump = false;
  let pendingDeparture: VimJumpLocation | null = null;
  let jumpToken = 0;

  const bindings = new Map<string, BindingState>();
  let requestedOwner: string | null = null;
  let ownerBinding: BindingState | null = null;
  // Dialog/prompt cleanup can synchronously focus the outgoing editor while we
  // are still capturing it. Ignore same-pane focus requests during that window
  // so they cannot restore state or reclaim ownership before finalization ends.
  let finalizingPaneId: string | null = null;
  let focusNextOwner = false;

  function isDocumentOpen(documentId: string): boolean {
    // Before App's first committed-tabs reconciliation, do not treat a newly
    // attached document as closed. After that, the committed set is law.
    return !documentsKnown || openDocuments.has(documentId);
  }

  function isCurrentBinding(state: BindingState): boolean {
    return bindings.get(state.paneId) === state;
  }

  function locationOf(state: BindingState): VimJumpLocation | null {
    const editorState = (state.view as EditorView & { state?: EditorState }).state;
    const selection = editorState?.selection?.main;
    const doc = editorState?.doc;
    if (!selection || !doc) return null;
    const offset = Math.min(Math.max(0, selection.head), doc.length);
    const line = doc.lineAt(offset);
    return {
      documentId: state.documentId,
      line: line.number - 1,
      ch: offset - line.from,
    };
  }

  function isEnabledOwner(state: BindingState): boolean {
    return state === ownerBinding && state.enabled && state.ready;
  }

  function isPublishableOwner(state: BindingState): boolean {
    return isEnabledOwner(state) && !replayingJump;
  }

  function cancelPendingJump(): void {
    if (pendingJumpBase) history.restore(pendingJumpBase);
    pendingJump = null;
    pendingJumpBase = null;
    replayingJump = false;
    jumpToken += 1;
  }

  function consumePendingJump(): void {
    pendingJump = null;
    pendingJumpBase = null;
    replayingJump = false;
    jumpToken += 1;
  }

  function applyPendingJump(pending: PendingJump, state: BindingState): boolean {
    if (pendingJump?.token !== pending.token || !isCurrentBinding(state)) return false;
    const editorState = (state.view as EditorView & { state?: EditorState }).state;
    if (!editorState) return false;

    const target = clampJumpLocation(
      pending.target,
      editorState.doc.lines,
      line => editorState.doc.line(line + 1).length,
    );
    const line = editorState.doc.line(target.line + 1);
    const offset = line.from + target.ch;

    // The selected entry is the actual landing after clamping, not the stale
    // recorded coordinate. Otherwise the next walk would mistake the clamped
    // cursor for an unrecorded departure and truncate the forward branch.
    history.updateCurrent(target);

    // Consume before applying/focusing: the focus capture requests ownership
    // synchronously and must not treat this intended handoff as external intent.
    consumePendingJump();
    const restored = adapter.restoreCursor?.(state.view, target) ?? false;
    if (!restored) {
      state.view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    }
    if (!state.view.hasFocus) state.view.focus();
    return true;
  }

  function maybeApplyPending(state: BindingState): boolean {
    const pending = pendingJump;
    if (!pending) return false;
    if (pending.targetPaneId !== state.paneId) return false;
    if (pending.target.documentId !== state.documentId) return false;
    if (state !== ownerBinding || !state.enabled || !state.ready) return false;
    return applyPendingJump(pending, state);
  }

  function pendingMatchesOwnerRequest(paneId: string | null): boolean {
    if (!pendingJump || !paneId) return false;
    // The navigator has already selected this exact pane. The target document
    // becomes visible through afterTransition; do not treat that expected
    // handoff as external intent.
    return pendingJump.targetPaneId === paneId;
  }

  function requestJumpWalk(state: BindingState, signedCount: number): void {
    // A pending jump sets replayingJump to suppress recording, but a newer
    // Ctrl-o/Ctrl-i must still be able to continue the reserved traversal.
    if (!isEnabledOwner(state)) return;
    const offset = Math.trunc(signedCount);
    if (offset === 0) return;

    // Rapid traversal must chain from the already-reserved pointer, not from
    // the still-unmoved source cursor.
    const current = pendingJump ? pendingJump.target : locationOf(state);
    if (!current) {
      cancelPendingJump();
      return;
    }

    if (!pendingJumpBase) pendingJumpBase = history.snapshot();
    const target = history.walk(current, offset);
    if (!target) {
      // A boundary traversal is a no-op. Keep a previous pending target; with
      // no pending navigation there is nothing to reserve or roll back.
      if (!pendingJump) pendingJumpBase = null;
      return;
    }

    const token = jumpToken + 1;
    jumpToken = token;
    pendingJump = {
      token,
      target,
      sourcePaneId: state.paneId,
      targetPaneId: null,
      activating: false,
    };
    replayingJump = true;
    queueMicrotask(() => {
      if (pendingJump?.token === token) activatePendingJump(token);
    });
  }

  function activatePendingJump(token: number): void {
    const pending = pendingJump;
    if (!pending || pending.token !== token) return;
    if (!jumpNavigator) {
      cancelPendingJump();
      return;
    }

    pending.activating = true;
    let navigation: VimJumpNavigation | null;
    try {
      navigation = jumpNavigator(pending.target);
    } finally {
      pending.activating = false;
    }
    if (!navigation) {
      cancelPendingJump();
      return;
    }
    if (pendingJump?.token !== token) return;

    pending.targetPaneId = navigation.paneId;
    const state = bindings.get(navigation.paneId);
    if (
      state &&
      state.documentId === pending.target.documentId &&
      state === ownerBinding &&
      state.enabled &&
      state.ready
    ) {
      applyPendingJump(pending, state);
    }
    // Otherwise the target tab activation will report through afterTransition
    // (or syncOwner for an already-active pane); there is no timer.
  }

  function jumpHandlersFor(state: BindingState): VimJumpBridgeHandlers {
    return {
      add(_cm, oldCur, newCur) {
        // A genuine native jump from the current ready owner supersedes a
        // pending replayed traversal. Programmatic replay selection does not
        // call the engine's add, so this can only be new user navigation.
        if (!isCurrentBinding(state) || !isEnabledOwner(state)) return;
        if (replayingJump) cancelPendingJump();
        history.record(
          pointLocation(state.documentId, oldCur),
          pointLocation(state.documentId, newCur),
        );
      },
      move(_cm, signedCount) {
        if (!isCurrentBinding(state)) return;
        requestJumpWalk(state, signedCount);
      },
      find(_cm, offset) {
        if (!isCurrentBinding(state) || !isPublishableOwner(state)) return null;
        const current = locationOf(state);
        if (!current) return null;
        const target = history.findSame(current, offset);
        if (!target || target.documentId !== state.documentId) return null;
        return { line: target.line, ch: target.ch };
      },
      correct(_cm, landing) {
        if (!isCurrentBinding(state) || !isPublishableOwner(state)) return;
        history.correctDestination(pointLocation(state.documentId, landing));
      },
    };
  }

  function finalizeOwner(): void {
    const binding = ownerBinding;
    if (!binding) return;
    ownerBinding = null;

    // The departure must be read while this adapter still owns the live
    // document; captureTransientInput may finish insert-mode cleanup below.
    // A replaying jump is not a user transition and must never be recorded.
    pendingDeparture = replayingJump ? null : locationOf(binding);

    finalizingPaneId = binding.paneId;
    try {
      const captured = adapter.capture(binding.view);
      if (!captured) return;

      // Repeat is session-wide and survives document closure. Marks do not: a
      // late capture after closure must never resurrect them.
      repeat = captured.repeat;
      const documentId = binding.documentId;
      if (!isDocumentOpen(documentId) || captured.marks.length === 0) {
        marksByDocument.delete(documentId);
      } else {
        marksByDocument.set(documentId, {
          doc: captured.document,
          marks: captured.marks,
        });
      }
    } finally {
      finalizingPaneId = null;
    }
  }

  function syncOwner(): void {
    if (ownerBinding) return;
    if (!requestedOwner) return;

    const binding = bindings.get(requestedOwner);
    if (!binding) return;
    if (!binding.enabled) {
      // A focus request made while Vim was disabled has no adapter handoff to
      // repair. Do not let it capture focus if Vim is enabled much later.
      focusNextOwner = false;
      return;
    }
    if (!binding.ready || !adapter.hasAdapter(binding.view)) return;

    ownerBinding = binding;
    const shouldFocus = focusNextOwner;
    focusNextOwner = false;
    const marks = isDocumentOpen(binding.documentId)
      ? marksByDocument.get(binding.documentId)
      : undefined;
    const result = adapter.restore(binding.view, repeat, marks);
    if (result === 'unavailable') {
      ownerBinding = null;
      focusNextOwner = shouldFocus;
      pendingDeparture = null;
      cancelPendingJump();
      return;
    }
    if (result === 'stale') marksByDocument.delete(binding.documentId);

    // A real document transition is the only cross-file jump recorded here;
    // same-document owner/toggle/focus changes do not advance history.
    const departure = pendingDeparture;
    pendingDeparture = null;
    if (!replayingJump && departure) {
      const destination = locationOf(binding);
      if (destination && departure.documentId !== destination.documentId) {
        history.record(departure, destination);
      }
    }

    // Selection/scroll/focus apply only after Vim state has been restored and
    // only for the current pending token. applyPendingJump consumes the token
    // before focusing, so the focus reentry cannot cancel it.
    if (!maybeApplyPending(binding) && shouldFocus && !binding.view.hasFocus) {
      binding.view.focus();
    }
  }

  function detachState(state: BindingState): void {
    if (bindings.get(state.paneId) !== state) return;
    cancelPendingJump();
    if (ownerBinding === state) finalizeOwner();
    state.ready = false;
    state.enabled = false;
    state.unregisterJumps();
    state.unregisterJumps = () => {};
    bindings.delete(state.paneId);
    // Closing/detaching is not a real document transition: never let a late
    // destination record the closed pane as a jump.
    pendingDeparture = null;
  }

  function createBinding(state: BindingState): VimSessionBinding {
    return {
      beforeTransition() {
        if (!isCurrentBinding(state)) return;
        if (pendingJump) {
          const resolvingTargetPane = pendingJump.activating && pendingJump.targetPaneId === null;
          if (!resolvingTargetPane && pendingJump.targetPaneId !== state.paneId) {
            // A transition on any other pane is unrelated external intent.
            cancelPendingJump();
          }
        }
        if (ownerBinding === state) finalizeOwner();
        state.ready = false;
      },
      afterTransition(nextDocumentId: string) {
        if (!isCurrentBinding(state)) return;
        if (pendingJump) {
          const resolvingTargetPane = pendingJump.activating && pendingJump.targetPaneId === null;
          const expected = (resolvingTargetPane || pendingJump.targetPaneId === state.paneId)
            && pendingJump.target.documentId === nextDocumentId;
          if (!expected) cancelPendingJump();
        }
        state.documentId = nextDocumentId;
        state.ready = state.enabled && adapter.hasAdapter(state.view);
        if (ownerBinding === state) {
          maybeApplyPending(state);
          return;
        }
        syncOwner();
      },
      setEnabled(enabled: boolean) {
        if (!isCurrentBinding(state)) return;
        if (!enabled) {
          cancelPendingJump();
          if (ownerBinding === state) finalizeOwner();
          // Toggling Vim is not a document jump, even if the pending departure
          // was captured by finalizeOwner just above.
          pendingDeparture = null;
        }
        state.enabled = enabled;
        state.ready = enabled && adapter.hasAdapter(state.view);
        syncOwner();
      },
      detach() {
        if (!isCurrentBinding(state)) return;
        detachState(state);
      },
    };
  }

  return {
    attachPane(paneId, view, documentId, enabled) {
      const previous = bindings.get(paneId);
      if (previous) detachState(previous);

      const state: BindingState = {
        paneId,
        view,
        documentId,
        enabled,
        ready: enabled && adapter.hasAdapter(view),
        unregisterJumps: () => {},
      };
      bindings.set(paneId, state);
      state.unregisterJumps = adapter.registerJumps?.(view, jumpHandlersFor(state)) ?? (() => {});
      syncOwner();
      return createBinding(state);
    },
    requestOwner(paneId, options) {
      if (pendingJump && !pendingMatchesOwnerRequest(paneId)) cancelPendingJump();
      // Releasing ownership to an external control is not a document jump.
      if (paneId === null) pendingDeparture = null;

      if (finalizingPaneId !== null) {
        // A different explicit request may still replace the queued target,
        // but restore happens only after finalization completes. The outgoing
        // pane's focus-restoration request is ignored entirely.
        if (paneId !== finalizingPaneId) {
          requestedOwner = paneId;
          focusNextOwner = Boolean(options?.focus);
        }
        return;
      }

      if (paneId === requestedOwner && ownerBinding?.paneId === paneId) {
        if (options?.focus && !ownerBinding.view.hasFocus) ownerBinding.view.focus();
        return;
      }

      // Publish the new intent before finalizing so synchronous focus cleanup
      // from the outgoing prompt cannot reclaim ownership.
      requestedOwner = paneId;
      focusNextOwner = Boolean(options?.focus);
      if (ownerBinding && ownerBinding.paneId !== paneId) finalizeOwner();
      syncOwner();
    },
    cancelFocusIntent(nextFocus) {
      // Moving directly to another editor is a new ownership handoff, not a
      // departure to an external control.
      if (nextFocus) {
        for (const binding of bindings.values()) {
          if (binding.view.dom.contains(nextFocus)) return;
        }
      }
      // A traversal waiting for a host transition is de-railed by explicit
      // external focus. The history pointer must roll back with it.
      if (pendingJump) cancelPendingJump();
      focusNextOwner = false;
    },
    reconcileDocuments(openIds) {
      const next = new Set(openIds);
      if (documentsKnown) {
        for (const documentId of openDocuments) {
          if (!next.has(documentId)) marksByDocument.delete(documentId);
        }
      }
      openDocuments.clear();
      for (const documentId of next) openDocuments.add(documentId);
      documentsKnown = true;

      // Attached documents are candidates even while App's committed-tab
      // reconciliation lags a newly opened document.
      const attached = new Set<string>();
      for (const binding of bindings.values()) attached.add(binding.documentId);
      const isOpen = (documentId: string) => next.has(documentId) || attached.has(documentId);

      // A pending target that just closed must be cancelled BEFORE pruning.
      // cancelPendingJump restores the pre-reservation snapshot, so pruning
      // afterwards removes the closed document from both the live list and the
      // restored pointer instead of resurrecting it.
      const targetClosed = pendingJump
        && !isOpen(pendingJump.target.documentId);
      if (targetClosed) cancelPendingJump();

      history.prune(isOpen);
      // A still-pending rollback snapshot must also follow closure; otherwise a
      // later rejection/cancel could restore an entry for the closed document.
      if (pendingJumpBase) {
        pendingJumpBase = pruneJumpHistorySnapshot(pendingJumpBase, isOpen);
      }
    },
    setJumpNavigator(navigator) {
      jumpNavigator = navigator;
    },
  };
}
