# Native Vim Mode for Crumb — Design

## Intent

Give Crumb users a capable, configurable Vim-style editing mode without making Crumb depend on an installed Neovim executable, Lua runtime, user configuration, or extension-hosting infrastructure. Preserve Crumb's existing CodeMirror presentation and file/tab workflows. Keep the Vim implementation isolated so it can be toggled safely, debugged independently, and extended later with a dedicated settings panel.

## Goals

- Add an enable/disable control in the existing **Settings → Editor** section. Regular CodeMirror editing remains the default; Vim mode is initially disabled. Persist this toggle with Crumb's existing preference mechanism; Vim session state is not persisted across app restarts.
- Deliver the finite first-milestone command contract below: Normal/Insert/Replace and Visual character/line/block modes; listed motions, operators, text objects, registers, counts and repeat; `/` and `?` search with `n`/`N`; local marks; and argumentless `:w` through Crumb's save flow.
- Follow Neovim defaults where Vim and Neovim differ, and document intentional host-editor differences rather than claiming full Vim/Neovim parity.
- Keep configuration as typed source-level data. Expose only supported key mappings and behavior options. Document the configuration clearly so a future settings panel can edit the same resolved options.
- Keep all Vim-specific behavior behind a small module boundary, including keyboard ownership, engine lifecycle, configuration application, and mode notifications.
- Preserve regular editing, document state, cursor, and CodeMirror undo history when toggling Vim mode or switching tabs.

## Non-goals

- Running Neovim, Lua, VimScript, user init files, or third-party Vim/Neovim plugins.
- A custom editor renderer, terminal UI, generic plugin host, marketplace, extension loader, or runtime user-config file.
- A dedicated Vim settings panel or Space-leader mappings in this milestone. Space-leader support and configurable app-vs-Vim shortcut precedence are later stages; the existing Editor settings section gets only the enable/disable toggle now.
- Full command-line/Ex, macro, window-management, folding, or VimScript compatibility. Upstream engine features outside the documented first-milestone contract may exist but are not guaranteed by Crumb.
- Unrelated editor, tab, filesystem, or terminal refactoring.

## First-milestone command contract

This is the guaranteed subset. Additional behavior supplied incidentally by the dependency is not part of Crumb's compatibility promise and must not trigger unintended app actions.

| Area | Guaranteed first-milestone behavior |
|---|---|
| Modes | Normal; Insert via `i a I A o O`; Replace via `R`; Visual character/line/block via `v V Ctrl-V`; Escape and `Ctrl-[`. |
| Basic motions | `h j k l` and arrows; `0 ^ $ g_`; `w W b B e E ge gE`; `gg G`; `| %`; `{ } ( )`. |
| Character finding | `f F t T ; ,`, including counts. |
| View movement | `H M L`; `Ctrl-D/U/F/B/E/Y`. |
| Operators | `d c y > < g~ gu gU`, doubled line forms, counts, register prefixes, and search as an operator motion. |
| Direct edits | `x X s S D C Y r ~ J p P`. |
| Text objects | `iw/aw`, `iW/aW`; quotes/backticks; `i(`/`a(`, `i[`/`a[`, `i{`/`a{`, `i<`/`a<`; `ip/ap`, `is/as`. |
| Visual | Character/line/block selection and motion; operators and put; block `I/A`; `o`; `gv`. |
| Registers | Unnamed, named `a-z` and uppercase append, yank `0`, numbered deletes `1-9`, small-delete `-`, black-hole `_`, retaining character/line/block types. Explicit `+` clipboard access is best-effort/platform-dependent; no implicit unnamed-clipboard synchronization. `*` parity is deferred. |
| Counts/history | Counts and count multiplication; `.` including counted repeat; `u` and `Ctrl-R`. |
| Search | `/ ? n N`, case-sensitive by default, incremental search and wrap; test common literals, boundaries, classes, groups, and escaping. Do not claim full Neovim regex parity. |
| Marks/navigation | Local marks `m[a-z]`, `'a`, `` `a `` associated with the Crumb document. `Ctrl-O/I` only if the package's existing jump behavior passes lifecycle tests; jump-list parity is otherwise deferred. |
| Save | Argumentless `:w` invokes Crumb's save flow. |

Defer macros, expression registers, Ex substitution/ranges/arguments, `:q`/`:wq`/`:e`, Vim windows/tabs, folds, plugin commands, tag objects, and language-semantic text objects. Ordinary Space remains a Vim motion; no leader namespace is added.

## Architecture direction

Use the released `@replit/codemirror-vim@6.4.0` engine behind a Crumb-owned Vim module rather than implementing Vim semantics from scratch or writing a custom adapter over its editor-agnostic core. Keep engine-specific APIs out of `App.tsx`, `Editor.tsx`, Settings, and status components. The module owns the typed config, CodeMirror extension composition, mode/lifecycle notifications, key ownership policy, and any narrow compatibility adapter.

The dependency is MIT-licensed and permits commercial use. Preserve its copyright/license notice in redistributions. Pin and test the released package and its core dependency. The package has no public state snapshot/restore API: dot-repeat spans per-adapter and global data, registers are already global, search input mutates committed globals incrementally, and marks are bound to adapter instances. A narrowly scoped, version-locked compatibility proof is approved, with all private access hidden inside the Vim module and focused real-view tests. Do not clone entire adapters or transplant live bookmarks. If preserving approved behavior requires broad command-parser changes or a private engine fork, stop and ask for approval rather than expanding scope silently.

Conceptual flow:

```text
Settings toggle + typed VimConfig
              ↓
       Crumb Vim module
              ↓
  CodeMirror Vim engine → CodeMirror transactions/history
              ↓
     Crumb status bar + save flow
```

CodeMirror remains the owner of document content, selections, and undo history. Vim owns command interpretation and the Vim-specific session state required for repeat, registers, search, and marks. App remains the owner of tabs and disk persistence.

## Configuration and activation

- Keep a typed configuration object in the Vim module; no user-editable runtime config in v1. Include only settings the selected engine demonstrably supports, such as mappings and validated behavior options.
- Resolve the Settings toggle and source-level defaults in one place. The toggle changes only the Vim extension compartment; it must not rebuild editor state or discard CodeMirror history.
- Install global mappings/configuration once, idempotently. Reconfiguration must remove or replace Crumb-owned mappings without one editor instance undoing another's configuration.
- The future settings panel should edit this same serializable configuration model, not define a second settings source of truth.
- No Space leader or leader-mapping namespace in v1; do not occupy Space with app commands.

## Keyboard and lifecycle behavior

- When Vim mode is enabled and an editor is focused, Vim receives its supported Ctrl keybindings before conflicting Crumb shortcuts. App commands remain available through the command palette and non-conflicting platform shortcuts. On macOS, Command shortcuts remain app shortcuts unless explicitly mapped. Shortcut precedence customization is deferred to the later settings stage.
- `Ctrl-W` is reserved for Vim in Vim-controlled editor contexts and must never close a Crumb tab. Unsupported continuations cancel cleanly. Vim does not gain window-management commands in v1. Dialogs, palettes, terminal input, and ordinary text inputs retain their own input.
- Tab activation enters Normal mode and cancels pending operators, counts/register prefixes, incomplete mappings, active Visual context, and unfinished search input. No partial command may execute in another tab.
- Preserve document, cursor, and existing per-pane CodeMirror undo history. Two panes showing the same tab must show synchronized content and independent, correctly mapped cursors/selections. Do not promise a unified Neovim-style undo tree across split panes. If safe same-document split undo needs a document/history redesign, stop and ask before changing that architecture.
- Preserve the last change for `.`, committed search, and registers for the Crumb application session. Preserve lowercase marks by document identity (same-tab splits share marks). Transient mode, pending operator/count/register/mapping input, Visual state, and unfinished search input are cancelled on tab activation, pane-focus transfer, or Vim disable; the newly active editor enters Normal mode. Closing a document releases its local marks. Vim session state is not persisted across app restarts.
- Disabling preserves document, cursor, history, and committed Vim session state, while removing transient input ownership/listeners/panels. Re-enabling enters Normal mode. Ordinary CodeMirror edits while Vim mode is disabled must not restore stale mark positions.
- Toggle transitions must avoid duplicate plugins, mappings, stale view references, or broken undo history.
- Crumb save remains authoritative for filesystem writes. Wire Vim's supported write action to the active tab's save path; errors and untitled files use Crumb's existing save behavior.

## Compatibility policy

Use Neovim defaults for behaviors where Vim differs, including `Y` as `y$`, Neovim's `startofline` default, Neovim's visual-repeat behavior, and case-sensitive search (`ignorecase=false`, `smartcase=false`). The dependency does not override this choice: test and correct these defaults where feasible. If matching an approved default requires a substantial regex/register-engine rewrite, stop and ask rather than silently relaxing the behavior. Record intentional engine/platform differences in `docs/vim.md` as supported/partial/deferred items. The command table above is the first-milestone contract, not all behavior exposed by the dependency.

Maintain a behavior table with columns **feature**, **Neovim/Vim help reference**, **Crumb behavior**, **test fixture**, and **known difference**. Cover the guaranteed command contract, not every keystroke supported by the dependency. Refer directly to official help sections, including motions/operators/text objects, Visual mode, registers, undo/repeat, mappings, search, and Neovim's documented differences. Use Zed Vim docs as a native-editor integration and documented-deviation reference, not as the correctness oracle.

UI ownership stays small: the existing Crumb status bar displays mode and pending command/count/register information; the engine's CodeMirror panel owns `/`, `?`, and `:` prompt input and messages. Do not add a duplicate mode panel or custom React command-line/search implementation. Escape cancels the active Vim prompt and returns focus to the editor; an active app dialog/palette retains priority.

## Verification and acceptance

Before relying on the dependency, verify the released package in Crumb with real CodeMirror views. Required cases include:

1. Normal/Insert/Replace and Visual character/line/block mode transitions; operators, motions, counts, text objects, registers, repeat, and `/ ? n N` search against Neovim-default fixtures.
2. Per-tab document/cursor/history isolation; dot-repeat, search, registers, and marks across tab switches; transient input cancellation on switch.
3. Vim toggle off/on without lost history, duplicate handlers, stale view references, or a stuck mode; settings/theme reconfiguration without destroying the Vim session unexpectedly.
4. App shortcut ownership (including Ctrl-W/O/B/N/P/J and save), command palette/dialog/terminal focus, Escape, and Tab not leaking `indentWithTab` into Normal/Visual mode. Typed mappings must be given ownership before App's capture-phase handler.
5. Split panes, same-document split synchronization, dirty state, `:w`/save integration, untitled/save failure cases, and React StrictMode mount/unmount behavior.
6. A small Playwright Chromium harness covers actual keyboard routing, tab/pane/toggle lifecycle, repeat/register/mark/search, and save. Do not download browsers during ordinary unit tests. Actual Tauri WebView smoke checks remain manual for keyboard layouts, paste/clipboard, IME/composition, and focus; Playwright WebKit is not a substitute for Tauri.

Run focused unit/configuration tests and the Playwright suite for the module, then the project checks once after reconciliation. Do not introduce a new CI platform solely for Vim mode; use existing CI if present, otherwise document the focused local command. Use Neovim only as a development/test oracle where available; production and normal CI test runs must not require it. If the package cannot meet lifecycle/shortcut acceptance without a broad fork, stop before making that architectural change.

## References

- Vim help: [motions/operators/text objects](https://vimhelp.org/motion.txt.html), [changes/registers](https://vimhelp.org/change.txt.html), [Visual mode](https://vimhelp.org/visual.txt.html), [repeat](https://vimhelp.org/repeat.txt.html), [undo](https://vimhelp.org/undo.txt.html), [mappings](https://vimhelp.org/map.txt.html), [options](https://vimhelp.org/options.txt.html), [insert mode](https://vimhelp.org/insert.txt.html).
- Neovim help: [user manual](https://neovim.io/doc/user/), [Vim differences/default mappings](https://neovim.io/doc/user/vim_diff.html), [Visual repeat](https://neovim.io/doc/user/visual.html#visual-repeat), [options](https://neovim.io/doc/user/options.html).
- Zed: [Vim mode and documented differences](https://zed.dev/docs/vim), [key bindings and contexts](https://zed.dev/docs/key-bindings).
- Candidate engine: [released `@replit/codemirror-vim` 6.4.0](https://github.com/replit/codemirror-vim/tree/v6.4.0), [package API](https://github.com/replit/codemirror-vim/blob/v6.4.0/packages/codemirror-vim/README.md), [license](https://raw.githubusercontent.com/replit/codemirror-vim/v6.4.0/LICENSE).

## Decisions made with the user

- Native CodeMirror Vim mode instead of an actual Neovim backend.
- Neovim defaults define behavior where Vim and Neovim differ.
- First milestone includes the core editing list plus `/`, `?`, `n`, `N` search.
- Space leader and a dedicated settings panel are later work.
- Typed source-level configuration now; a future settings panel will edit the same configuration model.
- Vim gets priority for conflicting keys while the enabled editor is focused; future settings can configure precedence.
- On tab switch, reset transient mode/input, but preserve repeat/search/register/mark state where feasible without a large fork.
- MIT-licensed CodeMirror Vim engine is the recommended candidate, gated by compatibility checks and a bounded lifecycle patch.
- The guaranteed command inventory is finite and listed above; macros, extended Ex, window commands, folds, plugins and language-semantic objects are deferred.
- `:w` is the only guaranteed Ex command. It uses Crumb's save flow; unsupported host-affecting commands must fail clearly rather than invoke app actions.
- Neovim-default search is case-sensitive; the unnamed register is not automatically synchronized with the system clipboard. Explicit `+` is platform-dependent; `*` is deferred.
- Same-document split panes retain independent existing CodeMirror undo histories; a shared document/history redesign needs renewed approval.
- Mode and pending-input information use Crumb's existing status bar; search/command prompts use the engine's CodeMirror panel.
- Add focused Playwright browser tests, but no new CI platform if the repository has none. Tauri IME/clipboard/focus verification stays manual.
