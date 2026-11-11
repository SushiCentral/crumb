# Crumb Vim Mode

Crumb's Vim mode is a native CodeMirror editing mode powered by the pinned
`@replit/codemirror-vim` 6.4.0 engine. It is not Neovim, does not run a Neovim
binary or Lua, and does not load Vimscript, user init files, or third-party Vim
plugins.

The first milestone guarantees only the command contract below. Crumb does
**not** claim full Vim or Neovim parity. CodeMirror remains the document,
selection, and undo-history owner. Crumb remains the tab, save, and filesystem
owner. Additional behavior supplied incidentally by the dependency is not part
of Crumb's compatibility promise and must not be relied on to invoke
application actions.

## Enabling and disabling

1. Open **Settings**.
2. Go to **Editor**.
3. Toggle **Vim mode**.

You can also open the command palette and choose **Editor: Enable Vim Mode** or
**Editor: Disable Vim Mode**. The command reflects the current setting and
updates it immediately; it uses the same persisted preference as Settings.

The preference is stored as `crumb.vimModeEnabled` and defaults to `false`.
There is no separate Vim settings panel in this milestone. Disabling Vim keeps
the document, cursor, CodeMirror history, committed search, registers, and
session repeat. Re-enabling starts in Normal mode. Vim session state is not
persisted across application restarts.

Toggling Vim changes only the Vim extension compartment. It does not rebuild
the `EditorState` and therefore does not discard CodeMirror undo history.

When Vim is enabled and the editor is focused, Vim receives its supported
conflicting Ctrl bindings before Crumb's capture-phase shortcuts. `Ctrl-W`
never closes a Crumb tab in that context. `Ctrl-B` is the explicit exception:
Crumb reserves the exact unshifted chord for the sidebar visibility toggle, so
it supersedes Vim's Ctrl-B page-back even in a focused Normal-mode editor.
`Ctrl-Shift-E` and `Ctrl-Shift-F` also remain Crumb's Explorer and Search
sidebar chords in that context. Settings, command palette, dialogs, terminal
input, and ordinary text inputs retain their own keyboard handling.
`Ctrl-H`, `Ctrl-J`, `Ctrl-K`, and `Ctrl-L` are reserved surface keys: Crumb and
the editor do not bind them and CodeMirror's macOS Emacs defaults and the Vim
engine's Ctrl motions do not act on them. Terminals and native text inputs still
receive those keys unchanged. On macOS, Command shortcuts remain application
shortcuts unless an explicit Vim mapping owns the key. In Normal and Visual
modes, Space starts Crumb's leader sequences instead of moving right. An
incomplete sequence expires after 10000 ms; the leader guide appears if the
sequence is still incomplete 200 ms after the initial Space, then filters as
later prefix keys arrive. The guide delay is started by the initial Space and is
not restarted by later keys. Space remains ordinary text in Insert mode and
remains a Vim motion when an operator, count, or register prefix is already
pending.

The initial leader actions are:

- `Space Space` opens the command palette.
- `Space E` or `Space e` toggles the file tree.
- `Space /` opens Search.
- `Space f f` opens Quick Open.
- `Space f s` saves the current file; `Space f S` saves all dirty files,
  stopping if a save fails or is canceled.
- `Space b d` closes the current tab through the unsaved-change confirmation;
  `Space b D` discards changes and closes it.
- `Space s w` searches the workspace for the word under the cursor as literal
  text and focuses Search. With no word under the cursor it still opens and
  focuses Search, but leaves the existing query and results unchanged.
  `Space s h` clears Vim search highlighting without forgetting the search.
- `Space u w` toggles word wrap; `Space u n` toggles line numbers. Both settings
  persist through the existing editor preferences.

The guide identifies Files, Buffers, Search, and UI submenus with a **GROUP**
badge. Entering a group shows its name and only the immediate next keys.

## Viewport jump

In Normal and Visual modes, `s` starts Crumb's Flash-inspired viewport jump
instead of Vim's substitute command. Highlights, labels, and the current target
update live as you type; there is no Enter gate. Flash uses its own literal
`ignorecase` + `smartcase` policy (ordinary Crumb `/` search is unchanged).
Choice keys are the full upstream home-row alphabet in lower and upper case
(`asdfghjklqwertyuiopzxcvbnm` plus its uppercase form). Only lowercase labels
are stable across refinements; uppercase labels are temporary spillover. Any
label character immediately following any occurrence of the query anywhere in
the document is excluded, using the same smartcase policy.

- Candidate targets must start inside the usable text viewport, excluding the
  sticky gutter. `visibleRanges` overscan does not spend labels. Labels refresh
  on vertical/horizontal scroll and resize. Flat character-cell labels overlay
  the cell immediately after each match on the same line, without shifting text.
  Labels that would be clipped or overlap another label are hidden; their
  matches stay highlighted and the current target remains reachable with Enter.
- Labels nearest the activation cursor receive keys first. Matches beyond the
  alphabet stay highlighted but unlabelled.
- Enter jumps to the next match strictly after the activation cursor, wrapping
  like upstream. A label jumps to that labelled match. Space remains query text
  while the jump is active.
- In Visual character, line, and block modes, the real Vim head is moved by a
  native preview motion as the query changes, preserving the original anchor and
  block geometry. Preview does not touch registers, repeat state, or the jump
  list. A committed jump records exactly one departure for Ctrl-O.
- Backspace recomputes matches, labels, highlights, and the preview. An empty
  query remains active with no highlights. A nonempty query with no matches
  exits Flash immediately, restores any Visual preview to the activation head,
  keeps the pre-existing Visual type, and consumes the triggering key.
- Escape restores the activation cursor and scroll view, exits Visual mode, and
  clears the selection like upstream.
- Blur, tab/pane transfer, and Vim disable restore a transient Visual preview
  before session capture. External edits drop Flash without restoring stale
  offsets. Mouse selection cancels Flash and keeps the new selection. Destroy
  only removes resources and emits an inactive state.
- There is no floating editor prompt chip. Crumb's UI can consume
  `VimFlashState` through `onFlashStateChange({ query, matchCount })`; the
  callback receives null on completion, cancellation, and teardown. A visually
  hidden live region announces the same state without taking focus.
- Highlights are plugin-owned transient decorations, so a cached EditorState
  restored by a tab switch cannot bring stale matches back.
- Explicit Normal or Visual `s` mappings suppress the jump; pending counts,
  registers, operators, and Vim prompts keep their native keys.
- This is viewport-local only. There is no remote, Tree-sitter, cross-window, or
  search-prompt integration, and no flash.nvim dependency.

### Flash operator motion

With a Vim operator already pending, `gs` starts the same live viewport Flash
selector as an operator motion. This supports `dgs`, `cgs`, `ygs`, ordinary
`>gs`/`<gs`, and `g~gs`/`gugs`/`gUgs` where the native engine supports the
operator. Counting before or after the operator selects the Nth forward/wrapped
target for Enter; an explicit label ignores the count. The chosen label or Enter
commits one native inclusive motion to the selected match start, and the
operator then executes normally. No operator is reimplemented.

- Before confirmation, Flash is decoration-only: the cursor, document,
  registers, undo history, and jump list do not change.
- Escape, no results, blur, mouse selection, external edits, tab/pane transfer,
  and Vim disable clear Flash and the pending operator without an edit.
- Active operator Flash owns `s` before surround prefix handling, so literal
  query text and assigned `s` labels are never mistaken for `ds`/`cs`/`ys`.
  Idle surround prefixes remain unchanged.
- Actual modified chords (such as Ctrl-D/F or Ctrl-arrow) cancel Flash and the
  pending operator before Vim sees them. Pure modifier keydowns are ignored, so
  Shift-assisted query text still works. Application Ctrl-Tab remains available
  after the operator is already cleared.
- Configured `dgs`/`cgs`/`ygs`-style operators are unchanged; an explicit
  operator-pending `gs` mapping wins over Crumb. `ds`, `cs`, `ys`, `yss`, and
  Visual `S` continue to belong to surround.
- Native dot-repeat cannot safely replay this absolute selector target after
  document changes. A committed Flash operator clears only that adapter's
  last-edit repeat snapshot, so `.` does not repeat the selector or a `cgs`
  insert payload. Canceling Flash preserves the previous ordinary `.` repeat.
  No stale absolute target is retained.

## Closing with Ex commands

- `:q` closes the current tab occurrence in the originating editor pane only if
  it has no unsaved changes; otherwise it refuses the close.
- `:q!` discards unsaved changes and closes that tab occurrence.
- `:wq` saves the originating tab, then closes it only if saving succeeds and
  no newer unsaved changes remain. Canceling Save As or a write failure keeps
  the tab open, even if focus moved to another tab during the save.

These commands do not accept ranges or file arguments. They close Crumb tabs,
not the application. `:noh` and `:nohlsearch` clear Vim search highlighting;
`n` and `N` can still repeat the committed search.

## Typed configuration

The public configuration shape is in `src/lib/vim/config.ts`:

```ts
export type VimMappingMode = 'normal' | 'insert' | 'visual' | 'operator';

export interface VimMapping {
  readonly lhs: string;
  readonly rhs: string;
  readonly modes: readonly VimMappingMode[];
}

export interface VimConfig {
  readonly mappings: readonly VimMapping[];
}
```

`defaultVimConfig` is frozen and contains an empty mapping list. Crumb's Vim
module adds the Neovim default `Y -> y$` normal-mode mapping when the caller has
not explicitly configured normal-mode `Y`. The default mapping is installed
non-recursively; an explicit user mapping for `Y` is kept and installed as a
normal user mapping.

Mappings are source-level configuration, not a runtime user-config file. Pass
a `VimConfig` to each `Editor` through its optional `vimConfig` prop. The
mapping installer is shared and reference-counted across split panes:
installing the same mapping twice does not stack it, and conflicting right-hand
sides or incompatible recursion policies are rejected. `operator` maps to the
engine's operator-pending context. An explicit `s` mapping in Normal or Visual
mode keeps ownership of `s` and disables Crumb's viewport jump prompt.

### Complete mapping examples

```ts
import type { VimConfig } from './lib/vim/config';

export const vimConfig: VimConfig = {
  mappings: [
    // Normal mode: Neovim-compatible Y; explicit configuration overrides the
    // built-in non-recursive default.
    { lhs: 'Y', rhs: 'y$', modes: ['normal'] },

    // Insert mode: leave insert mode without Escape.
    { lhs: 'jj', rhs: '<Esc>', modes: ['insert'] },

    // Visual mode: yank the current selection.
    { lhs: 'Q', rhs: 'y', modes: ['visual'] },

    // Operator-pending mode: make `ir` behave like the inner-parenthesis
    // text object. This is an example of the operator context, not a promise
    // of every Vim text-object alias.
    { lhs: 'ir', rhs: 'i(', modes: ['operator'] },
  ],
};
```

`lhs` is a Vim key notation string. `rhs` is the key sequence sent to the
engine. Multi-key mappings such as `jj` are supported by the pinned engine.
Mappings do not expose engine state or a generic plugin API.

The source-level Neovim `Y` default is installed with `Vim.noremap`, not
`Vim.map`. This prevents a user mapping of `y` from recursively changing the
meaning of `Y`. An explicit user mapping for normal-mode `Y` is not replaced.

## Guaranteed command matrix

This table is the first-milestone contract. **Coverage** is a cross-check against
the repository's current fixtures:

- **Full** means the row has direct behavioral coverage.
- **Partial** means at least one command in the row has a concrete fixture, but
  the listed remainder is not directly covered. The command remains in the
  guarantee; this is a test-evidence gap, not a reduction of scope.
- **Pending fixture** means the command remains guaranteed and a separate
  fixture lane will add its automated case.

“Neovim oracle” below means `tests/fixtures/vim-semantics.json`, recorded from
`nvim --clean` 0.12.6. Browser tests mount a real CodeMirror view; normal unit
tests never invoke Neovim.

| Area | Guaranteed behavior | Official reference | Fixture / evidence | Coverage and known differences |
|---|---|---|---|---|
| Modes | Normal; Insert via `i a I A o O`; Replace via `R`; Visual character/line/block via `v V Ctrl-V`; Escape and `Ctrl-[` | [Neovim insert](https://neovim.io/doc/user/insert.html#i), [Visual](https://neovim.io/doc/user/visual.html#v), [`i_CTRL-[`](https://neovim.io/doc/user/insert.html#i_CTRL-[), [Vim insert](https://vimhelp.org/insert.txt.html#i) | `tests/e2e/vim-editor.spec.ts` “insert mode edits the real CodeMirror document”; oracle `startofline-visual-char`, `startofline-visual-line`, `startofline-visual-block`; `tests/e2e/editor-component.spec.ts` mode-forwarding tests | **Partial.** Direct coverage for `i`, Escape, `v`, `V`, and `Ctrl-V`; no direct fixture for `a I A o O R Ctrl-[`. |
| Basic motions | `h j k l` and arrows; `0 ^ $ g_`; `w W b B e E ge gE`; `gg G`; `\| %`; `{ } ( )` | [Neovim motions](https://neovim.io/doc/user/motion.html#w), [Vim motions](https://vimhelp.org/motion.txt.html#w) | Oracle `startofline-G-initial`, `startofline-G-preserves-column`, `startofline-gg-after-word-motion`, `startofline-gg-preserves-column`, `startofline-numeric-goal-through-short-line-j`, `startofline-numeric-goal-through-short-line-G`; `tests/e2e/vim-editor.spec.ts` “3dw deletes three words” and “gj on a wrapped line…” | **Partial.** Direct coverage for `w`, `0`, `gg`, `G`, `\|`, `l`, and `j`; no direct fixture for `^ g_ W B e E ge gE % { } ( )`. `G`/`gg`/`H`/`M`/`L` and `j`/`k` preserve a Neovim goal column; see residuals for linewise operators. |
| Character finding | `f F t T ; ,`, including counts | [Neovim `f`](https://neovim.io/doc/user/motion.html#f), [Vim motion.txt](https://vimhelp.org/motion.txt.html#f) | Oracle `character-find-count-forward-repeat` (`gg3f.;,`), `character-find-count-backward-repeat` (`gg$2F.;`), and `character-find-till-count-both-directions` (`gg2t.;;2T.`); each is replayed by `tests/e2e/vim-editor.spec.ts` | **Full for the tested sequences.** The fixture covers all six commands, counts, and `;`/`,` repeat directions; exhaustive edge-case parity is not claimed. |
| View movement | `H M L`; `Ctrl-D/U/F/E/Y` | [Neovim scroll](https://neovim.io/doc/user/scroll.html#CTRL-D), [Vim scroll](https://vimhelp.org/scroll.txt.html#CTRL-D) | `tests/e2e/vim-editor.spec.ts` “Ctrl-D on a wrapped line follows native scroll movement”; `gj` tests cover display-line movement; `tests/e2e/app-search-keyboard.spec.ts` and `tests/e2e/app-vim-routing.spec.ts` cover the Ctrl-B sidebar exception | **Partial.** Direct coverage for `Ctrl-D` and `gj`; no direct fixture for `H M L` or `Ctrl-U/F/E/Y`. `Ctrl-B` page-back is intentionally superseded by Crumb's sidebar toggle in a focused Vim editor. Display/scroll cursor movement is native, and its landing column updates the logical goal for a later `G`. |
| Operators | `d c y > < g~ gu gU`; doubled line forms; counts; register prefixes; search as an operator motion | [Neovim change](https://neovim.io/doc/user/change.html#d), [`g~`](https://neovim.io/doc/user/change.html#g~), [`gU`](https://neovim.io/doc/user/change.html#gU) | `tests/e2e/vim-editor.spec.ts` “3dw deletes three words”, “ciw changes the inner word”, “vaw selects a word and delete removes it”, “dot repeats the last change”; oracle `count-multiplication`, `Y-yanks-to-end-of-line`, `search-backward-operator`; `tests/e2e/vim-lifecycle.spec.ts` “blurring a search prompt opened after an operator…” | **Partial.** Direct coverage for `d`, `c`, `y`, counts, a named register prefix, and `d?`; no direct fixture for `> < g~ gu gU`, all doubled line forms, or all register prefixes. **Known residual:** linewise-operator cursor placement. |
| Direct edits | `x X S D C Y r ~ J p P` (`s` is Crumb's viewport jump) | [Neovim change](https://neovim.io/doc/user/change.html#x), [`Y` default](https://neovim.io/doc/user/change.html#Y-default) | Oracle `Y-yanks-to-end-of-line`, `linewise-register-kind`; `tests/e2e/vim-editor.spec.ts` “named register keeps its text after the unnamed register changes”; `tests/e2e/vim-lifecycle.spec.ts` dot-repeat tests using `x` and `cw`; `tests/e2e/vim-jump.spec.ts` for `s` | **Partial.** Direct coverage for `Y`, `p`, `P`, `x`, and change-repeat; no direct fixture for `X S D C r ~ J`. **Known difference:** `Y` is Neovim `y$`, not the package's linewise default. `s` intentionally opens the viewport jump in Normal/Visual modes. |
| Viewport jump | `s` then a literal query; live labels/highlights; Enter commits next-forward; label jumps; Backspace recomputes; zero-result exits; Escape restores/exits Visual | Crumb-specific Flash-inspired workflow, intentionally not Neovim parity | `tests/vim-jump.test.ts` (upstream Python trace, smartcase, lowercase-only reuse, collision filtering, full alphabet, next-forward target, mapping suppression); `tests/e2e/vim-jump.spec.ts` (trace labels/targets, true viewport and horizontal scroll, current marks/hooks, Ctrl-O history, mouse/external/session-capture lifecycle, Visual preview/restore, cached-state restoration, no editor chip); `tests/e2e/app-vim-flash-status.spec.ts` (real-App human-paced Python typing, status bar, Ctrl+Tab stale-state regression) | **Full for the scoped interaction.** Up to 52 labelled matches; additional onscreen matches remain highlighted. Visual preview/commit use separate native motions so the engine owns anchors and block geometry; only commit records a jump. Operator integration is documented in its own row. No Tree-sitter, remote, or `/`/`?` integration; no flash.nvim dependency. |
| Flash operator | Pending operator + `gs`; `dgs`/`cgs`/`ygs`, `>gs`/`<gs`, case operators; count selects Nth Enter target; labels ignore count | Crumb-specific Flash-inspired operator motion, intentionally not Neovim parity | `tests/vim-jump.test.ts` (counted target choice, operator mapping suppression); `tests/e2e/vim-flash-operator.spec.ts` (forward/backward/multiline, inclusive start, registers, counts, named registers, cancellation, session capture, undo, dot limit, configured conflict); `tests/e2e/vim-surround.spec.ts` unchanged | **Full for the scoped operator motion.** One native inclusive motion reaches the match start; the engine executes/records the operator. Dot-repeat has no safe absolute-selector replay target and is a documented limit. No remote/cross-window/Tree-sitter/search integration. |
| Text objects | `iw/aw`, `iW/aW`; quotes/backticks; `i(`/`a(`, `i[`/`a[`, `i{`/`a{`, `i<`/`a<`; `ip/ap`, `is/as` | [Neovim text objects](https://neovim.io/doc/user/motion.html#iw), [Vim text objects](https://vimhelp.org/motion.txt.html#iw) | `tests/e2e/vim-editor.spec.ts` “ciw changes the inner word” and “vaw selects a word and delete removes it” | **Partial.** Direct coverage for `iw` and `aw`; the remaining listed objects are not directly fixture-covered (test-evidence gap). |
| Visual selection and operators | Character/line/block selection and motion; operators and put; block `I`/`A`; `o`; `gv` | [Neovim Visual](https://neovim.io/doc/user/visual.html#v), [Visual repeat](https://neovim.io/doc/user/visual.html#visual-repeat) | Oracle `startofline-visual-char`, `startofline-visual-line`, `startofline-visual-block`, `visual-charwise-repeat`, `visual-linewise-repeat`; `tests/e2e/vim-editor.spec.ts` `vaw` case; skipped `visual-multiline-charwise-repeat`, `startofline-visual-line`, `visual-block-short-row-dollar` | **Partial.** Direct coverage for char/line/block delete and same-size repeat. Block `I/A`, `o`, and `gv` have no direct fixture. **Known residuals:** multiline charwise Visual repeat and short-row Visual-block register/cursor. |
| Registers | Unnamed; named `a-z` and uppercase append; yank `0`; numbered deletes `1-9`; small-delete `-`; black-hole `_`; character/line/block types preserved. Explicit `+` best effort; no implicit unnamed clipboard; `*` deferred | [Neovim registers](https://neovim.io/doc/user/change.html#registers), [Vim registers](https://vimhelp.org/change.txt.html#registers) | `tests/e2e/vim-editor.spec.ts` “named register keeps its text after the unnamed register changes”; oracle `Y-yanks-to-end-of-line` (charwise), `linewise-register-kind` (linewise), `startofline-visual-block` (block); `tests/e2e/vim-lifecycle.spec.ts` “registers, search, repeat and marks survive disable/re-enable…” | **Partial.** Direct coverage for unnamed, named, char/line/block register kinds, and named paste flows. Uppercase append, numbered, small-delete, black-hole, and `+` are not directly fixture-covered. Unnamed is not synchronized with the system clipboard; `*` is deferred. |
| Counts and history | Counts and count multiplication; `.` including counted repeat; `u` and `Ctrl-R` | [Neovim counts](https://neovim.io/doc/user/intro.html#count), [repeat](https://neovim.io/doc/user/repeat.html#.), [undo](https://neovim.io/doc/user/undo.html#u) | Oracle `count-multiplication`; `tests/e2e/vim-editor.spec.ts` “3dw deletes three words” and “dot repeats the last change”; `tests/e2e/editor-component.spec.ts` undo/toggle and repeated-toggle tests; `tests/e2e/vim-lifecycle.spec.ts` dot-repeat tests | **Partial.** Direct coverage for counts, multiplication, `.`, and `u`; no direct fixture for counted `.` or `Ctrl-R`. Repeat is session-wide across panes; same-document split panes retain independent CodeMirror undo histories. |
| Search | `/ ? n N`; case-sensitive default; incremental search and wrap; common literals, classes, groups, boundaries, and escaping; no full Vim-regex parity | [Neovim search](https://neovim.io/doc/user/pattern.html#/), [`ignorecase`](https://neovim.io/doc/user/options.html#%27ignorecase%27), [`smartcase`](https://neovim.io/doc/user/options.html#%27smartcase%27) | `tests/e2e/vim-editor.spec.ts` “/word search finds matches and n/N traverse them”; oracle `search-is-case-sensitive`, `search-literal-parentheses`, `search-literal-plus`, `search-escaped-group-plus`, `search-escaped-plus`, `search-escaped-dot`, `search-vim-group-and-class`, `search-word-boundaries`, `search-backward-question-mark`, `search-backward-count`, `search-backward-operator`, `search-backward-visual`; lifecycle search cancellation tests | **Full for the approved subset; not full Vim-regex parity.** Case-sensitive engine behavior uses the package's public `pcre=false` Vim-regex translation. Supported examples are literals, `[classes]`, `\(...\)` groups, `\|` alternation, `\+`/`\?`, `\<`/`\>`, and escaped literals. `n`/`N` follow committed search direction. |
| Marks/navigation | Local marks `m[a-z]`, `'a`, `` `a `` associated with the Crumb document; `Ctrl-O/I` only if existing jump behavior passes lifecycle tests | [Neovim marks](https://neovim.io/doc/user/motion.html#m), [jump list](https://neovim.io/doc/user/motion.html#CTRL-O) | `tests/e2e/vim-lifecycle.spec.ts` “local marks survive A -> B -> A…”, mark invalidation/release tests; `tests/e2e/editor-component.spec.ts` stale-mark test; `tests/e2e/editor-shared.spec.ts` mark-ownership tests | **Partial.** Direct coverage for `m[a-z]`, `` `a ``, cross-tab/document ownership, and release on close. `'a` linewise is not directly fixture-covered. `Ctrl-O/I` remains deferred/not guaranteed. |
| Save | Argumentless `:w` invokes Crumb's existing save flow | [Neovim `:w`](https://neovim.io/doc/user/editing.html#:w) | Fixture-level: `tests/e2e/vim-editor.spec.ts` “argumentless :w invokes the save hook and unsupported Ex writes do not”; App-level stubbed Chromium integration: `tests/e2e/app-vim-save.spec.ts` (originating-tab async save after tab switch, untitled cancel/success, write failure, unsupported Ex) | **Full for the stubbed Chromium integration.** `:w` captures the originating tab ID synchronously and routes through the existing `handleSaveFile` path. Native Tauri dialog/filesystem/WebView behavior remains manually unrun. The later save/close stage adds `:q`, `:q!`, and `:wq` as documented above; file arguments, ranges, and shell commands remain unsupported. |

### Fixture index for the matrix

- Oracle cases: `tests/fixtures/vim-semantics.json`; IDs are referenced directly in the table. The fixture is generated by `tests/fixtures/vim-semantics.oracle.lua`.
- Real-editor command tests: `tests/e2e/vim-editor.spec.ts` (named tests in the table), plus `tests/e2e/vim-lifecycle.spec.ts`, `tests/e2e/editor-component.spec.ts`, and `tests/e2e/editor-shared.spec.ts` for lifecycle, state, and mark behavior.
- Unit/configuration tests: `tests/vim-semantics.test.ts`, `tests/vim-config.test.ts`, `tests/vim-engine.test.ts`, `tests/vim-session.test.ts`, `tests/vim-shortcuts.test.ts`, and `tests/vim-jump.test.ts`.

A matrix row marked **Partial** or **Pending fixture** is intentionally not
claimed as fixture-verified for every subcommand. The commands remain in the
contract; these are test-evidence gaps, not implied guarantees of full Vim
behavior.

## Neovim-default decisions

Crumb follows Neovim defaults where Vim and Neovim differ:

| Decision | Crumb behavior | Reference / evidence |
|---|---|---|
| `Y` | `Y` is `y$` (charwise to end of line), installed non-recursively; the package's linewise `Y` is overridden unless the user explicitly maps normal-mode `Y` | [Neovim `Y` default](https://neovim.io/doc/user/change.html#Y-default); oracle `Y-yanks-to-end-of-line` |
| `startofline` | `nostartofline` behavior: `G`/`gg`/`H`/`M`/`L` and logical `j`/`k` preserve a goal column through short lines; numeric `|` goals and `$` end-of-line goals are retained | [`'startofline'`](https://neovim.io/doc/user/options.html#%27startofline%27); oracle `startofline-*`, `startofline-numeric-goal-*` |
| Display and scroll motion | `gj`/`gk`, `Ctrl-D`/`Ctrl-U` and page motions keep their native wrapped-line/scroll cursor movement; their landing column becomes the logical goal for a later `G`/`gg` | `tests/e2e/vim-editor.spec.ts` wrapped-line tests |
| Search case | `ignorecase=false`, `smartcase=false`; `/` and `?` are case-sensitive | [Neovim search options](https://neovim.io/doc/user/options.html#%27ignorecase%27); oracle `search-is-case-sensitive` |
| Visual repeat | Repeating a Visual operator applies the same-size region in the supported cases; linewise/single-line charwise cases are covered | [Neovim `visual-repeat`](https://neovim.io/doc/user/visual.html#visual-repeat); oracle `visual-charwise-repeat`, `visual-linewise-repeat` |
| Clipboard | No implicit unnamed-clipboard synchronization; explicit `+` is platform-dependent; `*` is deferred | [Neovim registers](https://neovim.io/doc/user/change.html#registers) |
| `:w` | Argumentless `:w` reaches Crumb's existing save flow; `:wq` uses that flow before closing | [Neovim `:w`](https://neovim.io/doc/user/editing.html#:w) |

## Approved residuals and package-specific differences

These are known, user-approved residuals. They are reproducible and are not
promises of full Neovim parity.

1. **Linewise-operator cursor placement.** After a linewise operator such as
   `dG`, `cG`, `yG`, or indent forms, the pinned package can place the cursor at
   the first non-blank instead of preserving Neovim's goal column. Fixing this
   would require replacing package operator implementations, so Crumb does not
   patch it.
   - Fixture: `startofline-visual-line` (`tests/fixtures/vim-semantics.json`).
   - Browser suite: marked `test.fixme` as
     `Neovim semantics: startofline-visual-line (blocked: linewise operator cursor placement is engine operator parity)`.

2. **Multiline characterwise Visual repeat.** After a Visual characterwise
   operation spanning multiple lines, `.` does not reproduce Neovim's last-line
   character count. The pinned engine's Visual-repeat replay loses the last-line
   offset. Fixing it requires engine operator/repeat replay changes, not a
   narrow Crumb adapter.
   - Fixture: `visual-multiline-charwise-repeat`
     (`aaa bbb\ncc dd ee\nff gg hh\nii jj kk`, keys `ggvjlldj.`). Neovim
     expected document is `dd ee\njj kk`.
   - Browser suite: marked `test.fixme` as
     `Neovim semantics: visual-multiline-charwise-repeat (blocked: engine multiline charwise Visual repeat replay ignores the last-line character offset)`.

3. **Short-row Visual-block register/cursor mismatch.** For a block selection
   across a short row, the pinned engine's document result can match Neovim but
   its block register/cursor can differ.
   - Fixture: `visual-block-short-row-dollar`
     (`abcdef\nab\nabcdef`, exact keys `$<C-v>Gd`). Neovim records document
     `abcde\nab\nabcde`, cursor offset `4`, block register `f\n  \nf`. The
     pinned engine produces the same document with cursor offset `5` and block
     register `f\n\nf`.
   - Browser suite: marked `test.fixme` as
     `Neovim semantics: visual-block-short-row-dollar (blocked: documented engine difference for short-row Visual-block selection/register content)`.

Other package-specific differences:

- The engine is CodeMirror-based, not Neovim. It does not implement Vim
  windows, tabs, folds, terminal behavior, or all Ex commands.
- Search uses the package's public `pcre=false` mode, which translates a
  supported Vim-regex subset to JavaScript. This is not full Vim-regex or
  Neovim-regex parity; constructs outside the matrix subset are unsupported or
  incidental.
- Registers and search are global across the Crumb application session. Lowercase
  marks are document-owned and are released when the document closes. Repeat is
  session-owned; two panes showing the same tab keep independent CodeMirror
  undo histories.
- Display/scroll/page motions retain native CodeMirror movement. Crumb only
  synchronizes the logical goal used by later line jumps. The exact Ctrl-B chord
  is reserved for Crumb's sidebar toggle and does not page back in editors.
- Vim status is shown in Crumb's existing status bar. The engine's CodeMirror
  panel owns `/`, `?`, and `:` prompt input and messages. There is no duplicate
  mode panel or custom React command/search UI.
- `+` clipboard access is best-effort and platform-dependent. The unnamed
  register is not automatically synchronized with the system clipboard. `*` is
  deferred.
- The Vim package may support extra commands outside this contract. They are not
  guaranteed and must not be treated as Crumb's compatibility surface.

## Surround and jump-history additions

- `ys{motion}{delimiter}` wraps a motion's range; `ysiw"` wraps a word.
- `yss{delimiter}` wraps the current line.
- `cs{old}{new}` changes an enclosing pair; `ds{delimiter}` deletes it.
- Visual `S{delimiter}` wraps a characterwise or linewise selection, replacing
  Visual `S`'s previous change-lines action. Blockwise surround is not supported.
- Supported delimiters are `()` (`b`), `[]`, `{}` (`B`), `<>`, single/double
  quotes, and backticks. Opening/closing bracket keys are equivalent; no padding
  or indentation normalization is performed. Tags are not supported.
- Escape or an unsupported delimiter cancels without editing. Quote lookup is
  line-local; bracket lookup is balanced, not syntax-aware.
- Surround motions accept ordinary character keys and text objects, but not
  `/`/`?` prompts, arrow keys, or modified keys. Those cancel safely.
  Modifier-only key presses leave the pending surround intact, so Shift can be
  pressed separately to enter a quote or uppercase motion.
- Dot-repeat is implemented for Normal-mode `ys`, `yss`, `ds`, and `cs`, with
  browser verification still pending. Visual `S` does not replace the engine's
  dot-repeat record; `.` can still repeat the preceding engine edit instead.
- Conflicting configured mappings suppress Crumb's surround-prefix interception.
  The pinned engine still cannot execute some multi-key mappings beginning
  with its already-resolved `y`/`d`/`c` operators; suppression prevents Crumb
  from taking over but does not add support for those mappings.
- Ctrl+o/Ctrl+i navigate a single session-wide chronological history of native
  jumps and open-document transitions. Locations restore line and column in
  the invoking editor pane. Bare Tab retains its existing behavior.
- Closed documents are pruned. Positions are clamped after edits, not tracked
  through text changes. Cross-file `''`/double-backtick navigation is not added.

## Held navigation keys and scroll margins

Holding `j`/`k`/`h`/`l` or an arrow key moves continuously and stops as soon as
the key is released. Keystrokes are never filtered or rate-limited: the editor
processes every one. What made movement continue after release was the status
bar's cursor snapshot: publishing it on an animation frame re-rendered the whole
window during a hold, starving the input queue so keydowns were handled after
the keyup. Crumb now publishes that snapshot only after movement has been quiet
for 120 ms (`CURSOR_STATUS_IDLE_MS`). Document edits, tab switches and mounts
still report synchronously.

The editor keeps three lines of context above and below the cursor
(`EditorView.cursorScrollMargin`, `CURSOR_SCROLL_MARGIN_LINES`), so the view
starts scrolling before the cursor reaches the last visible line, as in VS Code.
This applies to Vim motions and native arrow keys alike and is reconfigured with
the editor font size.

The new jump history supersedes the deferred Ctrl-O/I statements in the original
milestone matrix above. Unit coverage and authored browser regression tests are
separate evidence: the new browser specs have not been executed under the
no-window constraint. See [manual checks](vim-manual-checks.md) for hands-on
verification of these additions and commenting.

## Comment operator

Comments use the current language's line-comment syntax:

- `gcc` toggles the current line; `2gcc` toggles two lines.
- `gcj` toggles the current and next line.
- Select lines with `V`, extend with `j`/`k`, then press `gc` to toggle them.
- `u` undoes the comment operation.

This uses the pinned engine's `gc` bindings and CodeMirror's comment command.
Crumb wraps the operator's Visual-mode cursor return so the engine collapses
the selection and returns to Normal instead of re-entering Visual mode.
A language without comment tokens leaves the text unchanged.
Language support must finish loading before commenting is available.
`tests/e2e/vim-comments.spec.ts` covers these cases; the new browser tests
have been authored and type-checked, but not executed under the no-window
testing constraint. Block-comment operators are not added by this change.

## Unsupported and deferred features

The following are not part of this milestone:

- Running Neovim, Lua, Vimscript, user init files, or third-party Vim plugins.
- Macros (`q`, `@`), expression registers, and `@:`/`@@` repeat.
- Ex substitution, `:g`/`:v`, ranges, file arguments, shell commands, `:e`,
  and host-affecting Ex commands other than the documented save/close commands.
- Vim windows, tabs, folds, terminal commands, tag objects, and
  language-semantic text objects.
- A dedicated Vim settings panel and configurable app-versus-Vim shortcut
  precedence.
- Full Vim/Neovim regex parity, `*` register parity, implicit unnamed-clipboard
  synchronization, and complete native Vim jump-list parity beyond the
  documented session-wide Ctrl-O/I history.
- Any promise of full Vim/Neovim compatibility. The command matrix is the
  finite first-milestone contract, not the dependency's entire feature set.

## Search regex subset

Search is case-sensitive by default and supports this documented subset through
the engine's native Vim-regex translation:

- literals and escaped literals such as `a\.b`;
- character classes such as `[0-9]`;
- magic groups `\(...\)` and alternation `\|`;
- quantifiers `\+` and `\?`;
- word boundaries `\<` and `\>`.

The following are not promised: `\v`/very-magic or other magic-mode switches,
`\zs`/`\ze`, lookarounds, arbitrary Vim-regex atoms, and exact translation of
every escaping edge case. The browser fixtures cover literal parentheses and
plus signs, escaped groups, escaped-plus, escaped dot, classes, boundaries, case
sensitivity, counts, operators, and Visual search.

## Testing, oracle, and known verification gaps

The oracle is pinned to **Neovim 0.12.6** and is recorded in developer/test
environments only. Normal unit tests and browser tests never invoke Neovim.

Regenerate the oracle with:

```sh
nvim --clean --headless -u NONE -l tests/fixtures/vim-semantics.oracle.lua \
  > tests/fixtures/vim-semantics.json
```

The recorder checks the runtime Neovim version, captures live directed Visual
anchors/heads rather than stale `'<`/`'>` marks, and records document, cursor,
line/column, mode, pending state, selection, register text/type, and undo depth.

Relevant checks:

```sh
node --test tests/vim-semantics.test.ts
node --test tests/
npm run test:types
npm run test:e2e -- --project=chromium
npm run build
```

Known verification gaps:

- `tests/e2e/app-vim-save.spec.ts` covers the stubbed Chromium application
  integration for asynchronous originating-tab save after a tab switch, untitled
  save cancel/success, write failure, and unsupported Ex writes. It uses an
  in-page Tauri stub, not a native dialog or real filesystem. Native Tauri
  dialog/filesystem behavior and WebView behavior remain **unrun**.
- Tauri WebView manual checks for IME/composition, clipboard behavior, keyboard
  layouts, focus, and OS/WebView differences remain **unrun** in this environment.
  Playwright Chromium is not a substitute for a Tauri WebView.
- Matrix rows marked **Partial** or **Pending fixture** are not fixture-verified
  for every listed subcommand. Their commands remain in the contract; these are
  test-evidence gaps, not reduced scope or full-parity claims.
- The three approved residuals above remain intentionally unpatched and are
  represented as skipped browser fixtures.

## References

- Neovim user manual: <https://neovim.io/doc/user/>
- Vim/Neovim differences: <https://neovim.io/doc/user/vim_diff.html>
  - `Y` default: <https://neovim.io/doc/user/change.html#Y-default>
- Vim help:
  - [motions/operators/text objects](https://vimhelp.org/motion.txt.html)
  - [changes/registers](https://vimhelp.org/change.txt.html)
  - [Visual mode](https://vimhelp.org/visual.txt.html)
  - [repeat](https://vimhelp.org/repeat.txt.html)
  - [undo](https://vimhelp.org/undo.txt.html)
  - [options](https://vimhelp.org/options.txt.html)
  - [insert mode](https://vimhelp.org/insert.txt.html)
- Neovim help:
  - [search](https://neovim.io/doc/user/pattern.html)
  - [marks](https://neovim.io/doc/user/motion.html)
  - [jump list](https://neovim.io/doc/user/motion.html#CTRL-O)
  - [editing/save](https://neovim.io/doc/user/editing.html)
  - [options](https://neovim.io/doc/user/options.html)
- `@replit/codemirror-vim` 6.4.0:
  [package](https://github.com/replit/codemirror-vim/tree/v6.4.0),
  [README](https://github.com/replit/codemirror-vim/blob/v6.4.0/packages/codemirror-vim/README.md),
  [license](https://raw.githubusercontent.com/replit/codemirror-vim/v6.4.0/LICENSE).
- Zed Vim documentation (native-editor integration and documented-deviation
  reference, not a correctness oracle): <https://zed.dev/docs/vim>,
  <https://zed.dev/docs/key-bindings>.
