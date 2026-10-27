import type { VimPublicMode } from './lifecycle.ts';

/**
 * Pure key-ownership policy shared by App's capture-phase shortcut handler and
 * the Editor's mode-aware Tab handling. It never imports or drives the Vim
 * engine, so it can be tested without CodeMirror or a browser.
 */

export type VimFocusedSurface =
  | 'editor'
  | 'dialog'
  | 'palette'
  | 'terminal'
  | 'input'
  | 'other';

export interface VimShortcutInput {
  readonly enabled: boolean;
  readonly focusedSurface: VimFocusedSurface;
  readonly mode: VimPublicMode;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** True when the configured Vim mappings explicitly claim this key. */
  readonly mappingOwnsKey?: boolean;
  /** Used to document/verify Command-key ownership on macOS. */
  readonly isMac?: boolean;
}

/**
 * Ctrl bindings Crumb currently conflicts with and that the Vim engine handles
 * (or deliberately does nothing with, as with Ctrl-W in Normal mode).
 * Ctrl+H/J/K/L are reserved editor keys handled by the editor's own swallow
 * keymap; Ctrl+S, palette shortcuts, terminal shortcuts, and tab switching stay
 * outside this set so the application keeps owning them.
 */
const VIM_BUILTIN_CTRL_KEYS: ReadonlySet<string> = new Set([
  'w', // Vim window prefix; must never close a Crumb tab
  'o', // jump list backward
  'b', // page backward
]);

const INSERT_LIKE_MODES: ReadonlySet<VimPublicMode> = new Set<VimPublicMode>([
  'insert',
  'replace',
]);

/**
 * Should App step aside so the focused Vim editor receives this shortcut?
 *
 * App must still handle keys when Vim is disabled, when focus belongs to a
 * dialog/palette/terminal/input, when a Vim prompt is open, or for macOS
 * Command shortcuts. Configured mappings may explicitly claim a key, but
 * otherwise only the small set of conflicting Ctrl bindings is bypassed.
 */
export function shouldVimOwnShortcut(input: VimShortcutInput): boolean {
  if (!input.enabled || input.focusedSurface !== 'editor') return false;
  if (input.mode === 'inactive' || input.mode === 'search' || input.mode === 'command') return false;

  // Command/meta combinations belong to the application (notably on macOS)
  // unless a source-level Vim mapping explicitly claims the key.
  if (input.metaKey && !input.mappingOwnsKey) return false;

  if (input.mappingOwnsKey) return true;

  if (!input.ctrlKey || input.altKey || input.metaKey || input.shiftKey) return false;
  return VIM_BUILTIN_CTRL_KEYS.has(input.key.toLowerCase());
}

/**
 * In Normal/Visual modes Tab belongs to Vim (and must not trigger
 * indentWithTab). Insert/Replace keep ordinary indentation, and prompts do not
 * reach the editor keymap at all.
 */
export function shouldVimOwnTab(mode: VimPublicMode): boolean {
  if (mode === 'inactive' || mode === 'search' || mode === 'command') return false;
  return !INSERT_LIKE_MODES.has(mode);
}
