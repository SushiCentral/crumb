import { Vim, vim } from '@replit/codemirror-vim';
import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { defaultVimConfig, type VimConfig } from './config.ts';
import { createMappingInstaller } from './mappings.ts';
import {
  cancelTransientInput,
  captureVimAdapter,
  getVimPublicState,
  observeVimPublicState,
  patchVimAdapter,
  restoreVimAdapter,
  type VimDocumentMarks,
  type VimPublicState,
  type VimRepeatSnapshot,
} from './lifecycle.ts';

export type { VimPublicMode, VimPublicState, VimPublicMode as VimMode } from './lifecycle.ts';

// A tiny plugin that only patches the newly created Vim adapter. It runs after
// `vim()` in the extension list, so `getCM(view)` is populated.
const adapterLifecyclePlugin = ViewPlugin.fromClass(class {
  constructor(view: EditorView) {
    patchVimAdapter(view);
  }
});

export interface VimExtension {
  /** CodeMirror extension to place in each document's EditorState. */
  readonly extension: Extension;
  /** Install this config's mappings into the engine (idempotent). */
  installMappings(): void;
  /** Remove mappings previously installed by this extension (idempotent). */
  removeMappings(): void;
  /** Typed mode and pending-input state for the active adapter. */
  getState(view: EditorView): VimPublicState;
  /** Subscribe to typed mode/pending changes; fires immediately. */
  observeState(view: EditorView, listener: (state: VimPublicState) => void): () => void;
  /** Exit insert/visual/search and clear pending keys before a lifecycle change. */
  cancelInput(view: EditorView): void;
  /** Capture session state before the caller replaces the EditorState. */
  beforeActivation(view: EditorView, documentId: string): void;
  /** Restore session state after the caller has installed the new EditorState. */
  afterActivation(view: EditorView, documentId: string): void;
  /** Drop cached marks for a document whose tab has been closed. */
  releaseDocument(documentId: string): void;
}

/**
 * Create the isolated Crumb Vim module from typed configuration.
 *
 * Callers only use this API; `@replit/codemirror-vim` and its private adapter
 * state stay inside `src/lib/vim/`.
 */
export function createVimExtension(config: VimConfig = defaultVimConfig): VimExtension {
  const mappings = createMappingInstaller(config, {
    // These are the package's public keymap entry points. The registry above
    // makes repeated installs reference-counted instead of stacking mappings.
    map: (lhs, rhs, context) => Vim.map(lhs, rhs, context),
    unmap: (lhs, context) => Vim.unmap(lhs, context),
  });

  // Compatibility store for the isolated single-adapter API used by the
  // lifecycle fixture and module tests. Crumb application code uses the
  // App-owned VimSession instead; both share the same low-level adapter
  // capture/restore primitives and never merge state by capture order.
  let repeat: VimRepeatSnapshot = { inputState: undefined, actionCommand: undefined };
  const marks = new Map<string, VimDocumentMarks>();

  return {
    extension: [vim({ status: false }), adapterLifecyclePlugin],
    installMappings: mappings.installMappings,
    removeMappings: mappings.removeMappings,
    getState: getVimPublicState,
    observeState: observeVimPublicState,
    cancelInput: cancelTransientInput,
    beforeActivation: (view, documentId) => {
      const captured = captureVimAdapter(view);
      if (!captured) return;
      repeat = captured.repeat;
      if (captured.marks.length === 0) marks.delete(documentId);
      else marks.set(documentId, { doc: captured.document, marks: captured.marks });
    },
    afterActivation: (view, documentId) => {
      const result = restoreVimAdapter(view, repeat, marks.get(documentId));
      if (result === 'stale') marks.delete(documentId);
    },
    releaseDocument: documentId => marks.delete(documentId),
  };
}
