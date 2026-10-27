import { Vim, vim } from '@replit/codemirror-vim';
import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { defaultVimConfig, type VimConfig, type VimMapping } from './config.ts';
import { createMappingInstaller } from './mappings.ts';
import {
  createVimLeaderExtension,
  vimLeaderSuppressedByMappings,
  type VimLeaderExtensionOptions,
} from './leader.ts';
import {
  cancelTransientInput,
  captureVimAdapter,
  getVimPublicState,
  getVimRegister,
  observeVimPublicState,
  patchVimAdapter,
  restoreVimAdapter,
  type VimDocumentMarks,
  type VimPublicState,
  type VimRegisterSnapshot,
  type VimRepeatSnapshot,
  type VimWriteHandler,
} from './lifecycle.ts';

export type { VimPublicMode, VimPublicState, VimPublicMode as VimMode } from './lifecycle.ts';

export interface VimExtensionOptions {
  /**
   * Invoked by an argumentless `:w`. Crumb's caller captures the originating
   * document/tab before starting its asynchronous save.
   */
  onWrite?: VimWriteHandler;
  /**
   * Route Crumb leader commands into the application's existing actions. Omit
   * to leave Space as the engine's normal right-motion.
   */
  leader?: VimLeaderExtensionOptions;
}

export interface VimWriteParameters {
  readonly argString?: string;
  readonly args?: readonly string[];
  readonly line?: number;
  readonly lineEnd?: number;
}

/** Only a bare `:w` is routed to Crumb; ranges, arguments and bangs are not. */
export function isArgumentlessWrite(params: VimWriteParameters): boolean {
  return params.line === undefined
    && params.lineEnd === undefined
    && (!params.argString || params.argString.trim().length === 0)
    && (!params.args || params.args.length === 0);
}

/**
 * Neovim's Y is `y$`. The public `defaultVimConfig` remains an empty mapping
 * list; the Crumb module adds this compatibility mapping unless the caller
 * explicitly configured the same normal-mode key.
 */
const NEOVIM_DEFAULT_MAPPINGS: readonly VimMapping[] = Object.freeze([
  Object.freeze({ lhs: 'Y', rhs: 'y$', modes: Object.freeze(['normal'] as const) }),
]);

export function resolveVimConfig(config: VimConfig): VimConfig {
  const additional = NEOVIM_DEFAULT_MAPPINGS.filter(preset =>
    !config.mappings.some(mapping =>
      mapping.lhs === preset.lhs && mapping.modes.some(mode => preset.modes.includes(mode)),
    ),
  );
  if (additional.length === 0) return config;
  return {
    mappings: Object.freeze([...config.mappings, ...additional]),
  };
}

let engineDefaultsInstalled = false;

function installVimEngineDefaults(): void {
  if (engineDefaultsInstalled) return;
  engineDefaultsInstalled = true;
  // Use the pinned engine's native Vim-regex translation. Its public
  // pcre=false mode handles literals, magic groups/quantifiers, boundaries,
  // and escaping once; the Crumb adapter only adjusts case sensitivity.
  Vim.setOption('pcre', false);
}

let writeCommandInstalled = false;

type VimExCallback = Parameters<typeof Vim.defineEx>[2];
type VimExCodeMirror = Parameters<VimExCallback>[0];

function showUnsupportedWrite(cm: VimExCodeMirror, message: string): void {
  const adapter = cm as unknown as {
    openNotification?: (node: Element, options?: Record<string, unknown>) => void;
  };
  if (!adapter.openNotification || typeof document === 'undefined') return;
  const node = document.createElement('div');
  node.className = 'cm-vim-message';
  node.textContent = message;
  adapter.openNotification(node, { bottom: true, duration: 2000 });
}

function installVimWriteCommand(): void {
  if (writeCommandInstalled) return;
  writeCommandInstalled = true;

  Vim.defineEx('write', 'w', (cm, params) => {
    if (!isArgumentlessWrite(params)) {
      showUnsupportedWrite(cm, 'Crumb Vim supports only argumentless :w');
      return;
    }
    const adapter = cm as unknown as { __crumbVimWrite?: VimWriteHandler };
    adapter.__crumbVimWrite?.();
  });
}

export interface VimExtension {
  /** CodeMirror extension to place in each document's EditorState. */
  readonly extension: Extension;
  /** Install this config's mappings into the engine (idempotent). */
  installMappings(): void;
  /** Remove mappings previously installed by this extension (idempotent). */
  removeMappings(): void;
  /** Typed mode and pending-input state for the active adapter. */
  getState(view: EditorView): VimPublicState;
  /** Read-only register snapshot for status/tests inside the module boundary. */
  getRegister(view: EditorView, name?: string): VimRegisterSnapshot | null;
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
export function createVimExtension(
  config: VimConfig = defaultVimConfig,
  options: VimExtensionOptions = {},
): VimExtension {
  installVimEngineDefaults();
  const resolvedConfig = resolveVimConfig(config);
  const hasExplicitNormalY = config.mappings.some(mapping =>
    mapping.lhs === 'Y' && mapping.modes.includes('normal'),
  );
  // An explicitly configured non-insert Space mapping keeps Vim ownership.
  // Otherwise the leader handles Space before the engine's right-motion default.
  const leader = options.leader && !vimLeaderSuppressedByMappings(resolvedConfig.mappings)
    ? createVimLeaderExtension(options.leader)
    : null;
  const mappings = createMappingInstaller(resolvedConfig, {
    // These are the package's public keymap entry points. The registry above
    // makes repeated installs reference-counted instead of stacking mappings.
    map: (lhs, rhs, context) => Vim.map(lhs, rhs, context),
    noremap: (lhs, rhs, context) => Vim.noremap(lhs, rhs, context),
    unmap: (lhs, context) => Vim.unmap(lhs, context),
  }, {
    isNonRecursive: (mapping, context) =>
      !hasExplicitNormalY && mapping.lhs === 'Y' && mapping.rhs === 'y$' && context === 'normal',
  });
  installVimWriteCommand();

  // This plugin only patches the newly created Vim adapter. It runs after
  // `vim()` in the extension list, so `getCM(view)` is populated. Its cleanup
  // removes adapter-owned DOM listeners/timers when the plugin is recreated or
  // Vim is disabled.
  const adapterLifecyclePlugin = ViewPlugin.fromClass(class {
    private cleanup: (() => void) | null = null;

    constructor(view: EditorView) {
      this.cleanup = patchVimAdapter(view, options.onWrite);
    }

    destroy() {
      this.cleanup?.();
      this.cleanup = null;
    }
  });

  // Compatibility store for the isolated single-adapter API used by the
  // lifecycle fixture and module tests. Crumb application code uses the
  // App-owned VimSession instead; both share the same low-level adapter
  // capture/restore primitives and never merge state by capture order.
  let repeat: VimRepeatSnapshot = { inputState: undefined, actionCommand: undefined };
  const marks = new Map<string, VimDocumentMarks>();

  return {
    extension: [
      ...(leader ? [leader] : []),
      vim({ status: false }),
      adapterLifecyclePlugin,
    ],
    installMappings: mappings.installMappings,
    removeMappings: mappings.removeMappings,
    getState: getVimPublicState,
    getRegister: getVimRegister,
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
