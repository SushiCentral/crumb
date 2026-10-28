import { Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { VimMapping } from './config.ts';
import { isVimJumpActive } from './jump.ts';
import { getVimPublicState, type VimPublicMode } from './lifecycle.ts';

/**
 * Crumb's Vim leader.
 *
 * Space is a right-motion by default in the Vim engine. The application owns
 * Space in Normal/Visual modes instead, so the leader is handled before the Vim
 * adapter sees the key. That keeps insert mode and Vim prompts untouched and
 * lets incomplete sequences expire without leaving pending engine input behind.
 */

export type VimLeaderAction =
  | 'command-palette'
  | 'toggle-file-tree'
  | 'search'
  | 'quick-open'
  | 'save-file'
  | 'save-all'
  | 'close-tab'
  | 'force-close-tab'
  | 'search-word'
  | 'clear-search-highlight'
  | 'toggle-word-wrap'
  | 'toggle-line-numbers';

export interface VimLeaderBinding {
  readonly keys: readonly string[];
  readonly action: VimLeaderAction;
}

/**
 * How long an incomplete leader sequence stays alive after its last accepted
 * prefix key. This is deliberately longer than the guide delay so the guide can
 * remain available while the user reads it.
 */
export const VIM_LEADER_TIMEOUT_MS = 10000;

/**
 * How long the initial Space must remain incomplete before the guide appears.
 * The reveal timer is started by the initial Space and is not restarted by
 * later prefix keys.
 */
export const VIM_LEADER_GUIDE_DELAY_MS = 200;

export const VIM_LEADER_BINDINGS: readonly VimLeaderBinding[] = Object.freeze([
  Object.freeze({ keys: Object.freeze(['Space', 'Space']), action: 'command-palette' }),
  Object.freeze({ keys: Object.freeze(['Space', 'E']), action: 'toggle-file-tree' }),
  Object.freeze({ keys: Object.freeze(['Space', 'e']), action: 'toggle-file-tree' }),
  Object.freeze({ keys: Object.freeze(['Space', '/']), action: 'search' }),
  Object.freeze({ keys: Object.freeze(['Space', 'f', 'f']), action: 'quick-open' }),
  Object.freeze({ keys: Object.freeze(['Space', 'f', 's']), action: 'save-file' }),
  Object.freeze({ keys: Object.freeze(['Space', 'f', 'S']), action: 'save-all' }),
  Object.freeze({ keys: Object.freeze(['Space', 'b', 'd']), action: 'close-tab' }),
  Object.freeze({ keys: Object.freeze(['Space', 'b', 'D']), action: 'force-close-tab' }),
  Object.freeze({ keys: Object.freeze(['Space', 's', 'w']), action: 'search-word' }),
  Object.freeze({ keys: Object.freeze(['Space', 's', 'h']), action: 'clear-search-highlight' }),
  Object.freeze({ keys: Object.freeze(['Space', 'u', 'w']), action: 'toggle-word-wrap' }),
  Object.freeze({ keys: Object.freeze(['Space', 'u', 'n']), action: 'toggle-line-numbers' }),
]);

export type VimLeaderMatch =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'pending'; readonly keys: readonly string[] }
  | { readonly kind: 'action'; readonly action: VimLeaderAction; readonly keys: readonly string[] }
  | { readonly kind: 'cancelled'; readonly keys: readonly string[] };

const LEADER_START = 'Space';

function isPrefix(prefix: readonly string[], keys: readonly string[]): boolean {
  return prefix.length < keys.length && prefix.every((key, index) => key === keys[index]);
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Resolve one normalized key against the pending leader sequence. A non-leader
 * key is ignored only while no sequence is active; once the leader has started,
 * unmatched keys are consumed so they cannot turn into Vim motions or edits.
 */
export function matchVimLeaderKey(
  pending: readonly string[],
  key: string,
  bindings: readonly VimLeaderBinding[] = VIM_LEADER_BINDINGS,
): VimLeaderMatch {
  if (pending.length === 0) {
    return key === LEADER_START
      ? { kind: 'pending', keys: [LEADER_START] }
      : { kind: 'ignored' };
  }

  if (key === 'Escape') return { kind: 'cancelled', keys: [] };

  const next = [...pending, key];
  for (const binding of bindings) {
    if (sameKeys(binding.keys, next)) {
      return { kind: 'action', action: binding.action, keys: next };
    }
  }
  if (bindings.some(binding => isPrefix(next, binding.keys))) {
    return { kind: 'pending', keys: next };
  }
  return { kind: 'cancelled', keys: [] };
}

/** Normalize a keydown into a case-sensitive leader token, or null if it is not leader input. */
export function vimLeaderKeyFromEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === ' ' || event.key === 'Spacebar') return LEADER_START;
  if (event.key === 'Escape') return 'Escape';
  return event.key.length === 1 ? event.key : null;
}

/** Insert/Replace and Vim prompts keep their native Space behavior. */
export function isVimLeaderMode(mode: VimPublicMode): boolean {
  return mode === 'normal'
    || mode === 'visual'
    || mode === 'visual-line'
    || mode === 'visual-block';
}

/**
 * A leader may only start when the engine has no pending count/operator/register
 * prefix. Otherwise Space belongs to that prefix (`d<Space>`, `2<Space>`) and
 * stealing it would strand the engine's input state.
 */
export function isVimLeaderStartAllowed(mode: VimPublicMode, pending: string): boolean {
  return isVimLeaderMode(mode) && pending.length === 0;
}

/**
 * An explicit non-insert Space mapping is a configured contract. Leave it to the
 * Vim engine instead of silently shadowing it with the application leader.
 * Insert-only mappings do not affect Normal/Visual Space ownership.
 */
export function vimLeaderSuppressedByMappings(mappings: readonly VimMapping[]): boolean {
  return mappings.some(mapping => {
    if (!mapping.modes.some(mode => mode !== 'insert')) return false;
    return mapping.lhs.startsWith(' ') || mapping.lhs.toLowerCase().startsWith('<space>');
  });
}

export interface VimLeaderControllerOptions {
  readonly dispatch: (action: VimLeaderAction) => void;
  readonly timeoutMs?: number;
  readonly guideDelayMs?: number;
  readonly bindings?: readonly VimLeaderBinding[];
  /** Receives the visible guide prefix, or null when the guide should hide. */
  readonly onGuideChange?: (prefix: readonly string[] | null) => void;
  readonly setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface VimLeaderController {
  /** Current pending sequence, exposed for tests and status/debug surfaces. */
  readonly pending: readonly string[];
  /** Visible guide prefix, or null while the guide is hidden. */
  readonly guidePrefix: readonly string[] | null;
  /** Returns true when the key belongs to the leader and must not continue. */
  handleKey(key: string): boolean;
  /** Cancel a pending sequence, for blur/lifecycle changes. */
  cancel(): void;
  /** Cancel and permanently stop accepting keys. */
  dispose(): void;
}

export function createVimLeaderController(options: VimLeaderControllerOptions): VimLeaderController {
  const bindings = options.bindings ?? VIM_LEADER_BINDINGS;
  const timeoutMs = options.timeoutMs ?? VIM_LEADER_TIMEOUT_MS;
  const guideDelayMs = options.guideDelayMs ?? VIM_LEADER_GUIDE_DELAY_MS;
  const schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> =
    options.setTimeout
      ?? ((callback, delay) => setTimeout(callback, delay) as ReturnType<typeof setTimeout>);
  const unschedule: (id: ReturnType<typeof setTimeout>) => void =
    options.clearTimeout ?? (id => clearTimeout(id));

  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let guideTimer: ReturnType<typeof setTimeout> | null = null;
  let guidePrefix: readonly string[] | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer === null) return;
    unschedule(timer);
    timer = null;
  };

  const clearGuideTimer = () => {
    if (guideTimer === null) return;
    unschedule(guideTimer);
    guideTimer = null;
  };

  const setGuide = (next: readonly string[] | null) => {
    if (guidePrefix === next) return;
    if (guidePrefix !== null && next !== null && sameKeys(guidePrefix, next)) return;
    guidePrefix = next === null ? null : [...next];
    options.onGuideChange?.(guidePrefix);
  };

  const reset = () => {
    pending = [];
    clearTimer();
    clearGuideTimer();
    setGuide(null);
  };

  const armTimeout = () => {
    clearTimer();
    timer = schedule(() => {
      timer = null;
      // Expiry ends the sequence and hides any visible guide.
      reset();
    }, timeoutMs);
  };

  const armGuide = () => {
    clearGuideTimer();
    guideTimer = schedule(() => {
      guideTimer = null;
      // A completed/cancelled sequence clears this timer; also guard against a
      // timer that was already queued when the sequence ended.
      if (disposed || pending.length === 0) return;
      setGuide(pending);
    }, guideDelayMs);
  };

  return {
    get pending() {
      return pending;
    },
    get guidePrefix() {
      return guidePrefix;
    },
    handleKey(key: string): boolean {
      if (disposed) return false;
      const match = matchVimLeaderKey(pending, key, bindings);
      if (match.kind === 'ignored') return false;
      if (match.kind === 'pending') {
        const starting = pending.length === 0;
        pending = [...match.keys];
        armTimeout();
        if (starting) armGuide();
        else if (guidePrefix !== null) setGuide(pending);
        return true;
      }
      reset();
      if (match.kind === 'action') options.dispatch(match.action);
      return true;
    },
    cancel: reset,
    dispose: () => {
      reset();
      disposed = true;
    },
  };
}

export interface VimLeaderExtensionOptions extends VimLeaderControllerOptions {}

class VimLeaderViewPlugin {
  private readonly view: EditorView;
  private readonly controller: VimLeaderController;

  constructor(view: EditorView, options: VimLeaderExtensionOptions) {
    this.view = view;
    this.controller = createVimLeaderController(options);
  }

  handleKey(event: KeyboardEvent): boolean {
    if (event.isComposing || event.repeat) return false;

    const state = getVimPublicState(this.view);
    // The jump prompt owns every printable key, including Space. Do not start
    // or continue a leader sequence until the prompt has been dismissed.
    if (isVimJumpActive(this.view)) {
      this.controller.cancel();
      return false;
    }
    const continuing = this.controller.pending.length > 0;
    if (!isVimLeaderMode(state.mode)) {
      // Do not carry a Normal-mode prefix into insert mode or a Vim prompt.
      this.controller.cancel();
      return false;
    }

    // If the engine already owns an operator/count/register prefix, Space is
    // that command's right-motion. Let the engine's built-in mapping run rather
    // than starting a leader on top of a half-finished command.
    if (!continuing && !isVimLeaderStartAllowed(state.mode, state.pending)) {
      return false;
    }

    const key = vimLeaderKeyFromEvent(event);
    if (key === null) {
      // A modified/named key cannot continue a leader sequence. Drop the
      // prefix and let the key reach its normal handler.
      if (this.controller.pending.length > 0) this.controller.cancel();
      return false;
    }

    // Escape cancels the leader but still belongs to Vim, so it can leave
    // Visual mode or clear any other native state as usual.
    if (key === 'Escape' && this.controller.pending.length > 0) {
      this.controller.cancel();
      return false;
    }

    return this.controller.handleKey(key);
  }

  reset(): void {
    this.controller.cancel();
  }

  destroy(): void {
    this.controller.dispose();
  }
}

/**
 * Place this extension before the Vim adapter in the same compartment. Its
 * high-precedence keydown handler consumes leader input before the engine maps
 * Space to its right-motion default.
 */
export function createVimLeaderExtension(options: VimLeaderExtensionOptions): Extension {
  return Prec.highest(ViewPlugin.fromClass(
    class extends VimLeaderViewPlugin {
      constructor(view: EditorView) {
        super(view, options);
      }
    },
    {
      eventHandlers: {
        keydown(this: VimLeaderViewPlugin, event: KeyboardEvent): boolean {
          return this.handleKey(event);
        },
        blur(this: VimLeaderViewPlugin): void {
          this.reset();
        },
      },
    },
  ));
}
