import type { EditorView } from '@codemirror/view';
import {
  captureVimAdapter,
  hasActiveVimAdapter,
  restoreVimAdapter,
  type VimAdapterCapture,
  type VimDocumentMarks,
  type VimRepeatSnapshot,
  type VimRestoreResult,
} from './lifecycle.ts';

/**
 * App-owned Vim session coordinator.
 *
 * The CodeMirror document, selection, and history stay owned by each Editor.
 * This coordinator owns only the application-session data that must outlive a
 * single adapter: dot-repeat state, document-keyed marks, the one authoritative
 * command owner across all panes, and the authoritative open-document set.
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

export interface VimSession {
  /** Attach one Editor's current view and document. Returns a generation-safe handle. */
  attachPane(paneId: string, view: EditorView, documentId: string, enabled: boolean): VimSessionBinding;
  /** Request the single application-wide command owner, or null to release it. */
  requestOwner(paneId: string | null, options?: RequestOwnerOptions): void;
  /** Drop pending focus repair when focus leaves editors for external controls. */
  cancelFocusIntent(nextFocus?: Node | null): void;
  /** Replace the authoritative open-document set from App's committed tabs. */
  reconcileDocuments(openIds: Iterable<string>): void;
}

const emptyRepeat: VimRepeatSnapshot = { inputState: undefined, actionCommand: undefined };

const defaultAdapter: VimSessionAdapter = {
  capture: captureVimAdapter,
  restore: restoreVimAdapter,
  hasAdapter: hasActiveVimAdapter,
};

interface BindingState {
  paneId: string;
  view: EditorView;
  documentId: string;
  enabled: boolean;
  ready: boolean;
}

export function createVimSession(adapter: VimSessionAdapter = defaultAdapter): VimSession {
  let repeat: VimRepeatSnapshot = emptyRepeat;
  const marksByDocument = new Map<string, VimDocumentMarks>();
  const openDocuments = new Set<string>();
  let documentsKnown = false;

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

  function finalizeOwner(): void {
    const binding = ownerBinding;
    if (!binding) return;
    ownerBinding = null;

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
      return;
    }
    if (result === 'stale') marksByDocument.delete(binding.documentId);
    if (shouldFocus && !binding.view.hasFocus) binding.view.focus();
  }

  function detachState(state: BindingState): void {
    if (bindings.get(state.paneId) !== state) return;
    if (ownerBinding === state) finalizeOwner();
    state.ready = false;
    state.enabled = false;
    bindings.delete(state.paneId);
  }

  function createBinding(state: BindingState): VimSessionBinding {
    const isCurrent = () => bindings.get(state.paneId) === state;

    return {
      beforeTransition() {
        if (!isCurrent()) return;
        if (ownerBinding === state) finalizeOwner();
        state.ready = false;
      },
      afterTransition(nextDocumentId: string) {
        if (!isCurrent()) return;
        state.documentId = nextDocumentId;
        state.ready = state.enabled && adapter.hasAdapter(state.view);
        if (ownerBinding === state) return;
        syncOwner();
      },
      setEnabled(enabled: boolean) {
        if (!isCurrent()) return;
        if (!enabled && ownerBinding === state) finalizeOwner();
        state.enabled = enabled;
        state.ready = enabled && adapter.hasAdapter(state.view);
        syncOwner();
      },
      detach() {
        if (!isCurrent()) return;
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
      };
      bindings.set(paneId, state);
      syncOwner();
      return createBinding(state);
    },
    requestOwner(paneId, options) {
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
    },
  };
}
