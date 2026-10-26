# Native Vim Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable, well-documented native Vim editing mode to Crumb's existing CodeMirror editor, with Neovim-default behavior for the agreed first-milestone command set.

**Architecture:** Use `@replit/codemirror-vim@6.4.0` behind a small `src/lib/vim/` module with typed source-level configuration. CodeMirror remains the document, selection, and undo owner; App owns tabs, file saves, and one Vim session coordinator for pane command ownership, session repeat, document marks, and authoritative document closure. Keep each editor's Vim extension in its own compartment. The user approved an app-level state-coordination expansion to solve shared-pane lifecycle defects; an engine fork or CodeMirror document/history redesign remains out of scope.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, `@replit/codemirror-vim@6.4.0`, Node's built-in test runner, Playwright for focused browser integration tests, Tauri WebView manual smoke tests.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/vim/config.ts` | Typed source-level Vim mappings/options and validated defaults; no engine imports exposed to callers. |
| `src/lib/vim/extension.ts` | Compose the package extension, install configuration idempotently, and expose the Crumb-facing mode/status/lifecycle contract. |
| `src/lib/vim/lifecycle.ts` | Narrow tab/pane/toggle lifecycle adapter for preserving approved persistent Vim state and cancelling transient input. |
| `src/lib/vim/session.ts` | App-owned `VimSession` coordinator for active pane ownership, repeat/mark snapshots, and authoritative open-document reconciliation. |
| `src/lib/vim/shortcuts.ts` | Pure key/focus ownership decision used before App consumes capture-phase shortcuts. |
| `src/lib/preferences.ts` | Add persisted `vimModeEnabled` preference, default `false`. |
| `src/lib/editor-extensions.ts` | Continue defining ordinary CodeMirror extensions; make ordinary `indentWithTab` unavailable in Vim Normal/Visual contexts. |
| `src/components/Editor.tsx` | Install Vim with a dedicated `Compartment`, notify Crumb of mode/pending-state changes, and coordinate tab-state lifecycle without replacing `EditorState`. |
| `src/components/SettingsModal.tsx` | Add the enable/disable toggle to the existing Editor section only. |
| `src/components/StatusBar.tsx` | Render the small mode/pending-input status supplied by the Vim module. |
| `src/App.tsx` | Own one stable Vim session, reconcile authoritative open document IDs, request active command ownership, pass session/pane identity to editors, and consult shortcut ownership later. |
| `tests/vim-config.test.ts` | Config and persisted-toggle validation using `node:test`. |
| `tests/vim-shortcuts.test.ts` | Pure shortcut-ownership policy tests. |
| `tests/vim-engine.test.ts` | Browser-independent configuration and package-contract tests where the released API permits. |
| `tests/e2e/` and `playwright.config.ts` | Focused real-keyboard editor integration coverage. |
| `docs/vim.md` | User/developer configuration guide and the Neovim/Vim compatibility matrix with citations and known differences. |
| `THIRD_PARTY_NOTICES.md` | Preserve the Vim engine and core package MIT license notice in Crumb redistributions. |
| `docs/superpowers/specs/2026-10-26-native-vim-mode-design.md` | Approved design; update only if implementation uncovers a decision requiring user approval. |

Keep files inside `src/lib/vim/` only where each responsibility needs a focused test or lifecycle boundary; do not create a generic extension framework.

## Commit policy for every task

After a task passes its scoped checks, stop and ask the user before committing. Include the exact proposed commit message in the approval request. Do not run `git commit` until the user explicitly approves that commit. Do not stage or include unrelated changes.

### Task 1: Add the released Vim engine and establish real-editor test harness

**Files:**
- Modify: `package.json`, `package-lock.json`, `tsconfig.node.json`, `.gitignore`
- Create: `playwright.config.ts`, `tests/e2e/vim-editor.spec.ts`, `tests/e2e/vim-fixture.html`, `tests/e2e/vim-fixture.tsx`
- Test: `tests/e2e/vim-editor.spec.ts`

- [ ] **Step 1: Add a failing browser test for the editor fixture**

Create a focused fixture that mounts a real CodeMirror `EditorView` with an empty document and the Vim extension, without invoking Tauri APIs. Start with a test that types `iabc<Escape>` in the focused editor and expects its document to become `abc`. The fixture must expose the editor container by a stable `data-testid="code-editor"` and show the document through CodeMirror's DOM, not a test-only editing implementation. Actual `Editor` component integration is covered in Task 4.

The first test should have this shape:

```ts
import { expect, test } from '@playwright/test';

test('insert mode edits the real CodeMirror document', async ({ page }) => {
  await page.goto('/tests/e2e/vim-fixture.html');
  const editor = page.getByTestId('code-editor');
  await editor.click();
  await page.keyboard.type('iabc');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.cm-content')).toContainText('abc');
});
```

- [ ] **Step 2: Install pinned test and Vim packages**

Run `npm install --save-exact @replit/codemirror-vim@6.4.0` and `npm install --save-dev @playwright/test`. Add scripts:

```json
"test:e2e": "playwright test",
"test:e2e:install": "playwright install chromium"
```

The ordinary `npm test` path must not download or launch a browser. Verify the lockfile-resolved `@replit/codemirror-vim-core` version and MIT license, and record them for `THIRD_PARTY_NOTICES.md`.

Add `/test-results/` to `.gitignore` so Playwright metadata and failure artifacts do not pollute the working tree. The configured `list`/`github` reporters do not create an HTML report directory.

- [ ] **Step 3: Configure the Vite fixture and Playwright**

Configure Playwright with `baseURL: 'http://127.0.0.1:1420'`, a `webServer` command of `npm run dev -- --host 127.0.0.1`, `reuseExistingServer: !process.env.CI`, and one project named `chromium` using `devices['Desktop Chrome']`. The initial fixture imports CodeMirror and the package directly; later editor integration tests mount `Editor` and pass its required props (`tabId`, `path`, `openTabIds`, `doc`, theme, font, wrap, preferences, and change callbacks). Do not add the fixture to the production entry point.

Add `playwright.config.ts` to the existing node-side TypeScript check (`tsconfig.node.json`) or create a focused test tsconfig if Playwright's types conflict with the Vite config; do not widen the app's production `tsconfig.json` to include browser tests.

- [ ] **Step 4: Run the test to confirm it fails before Vim is enabled**

Run `npm run test:e2e:install` once if Chromium is absent, then `npm run test:e2e -- --project=chromium`. Expected: the test fails because `iabc<Escape>` is inserted literally or the editor fixture is not wired, not because Vite failed to start.

- [ ] **Step 5: Add the smallest fixture-only Vim extension to make the behavior pass**

Temporarily mount `vim({ status: false })` in the fixture. Keep this code in the fixture until the Crumb module exists; do not add the extension directly to `editorCoreExtensions`.

- [ ] **Step 6: Verify engine basics and record any mismatch**

Extend this browser test with `3dw`, `ciw`, `vaw` + delete, named-register yank/put, `.`, `/word`, `n`, and `N`. Confirm the package's actual Neovim-default differences from the design before proceeding. If a required behavior needs a broad fork, stop and ask instead of continuing to add integration code.

Run: `npm run test:e2e -- --project=chromium`

Expected: all fixture tests pass or produce a precise, documented engine gap that can be corrected with a bounded adapter.

### Task 2: Add typed Vim configuration and preference parsing

**Files:**
- Create: `src/lib/vim/config.ts`, `tests/vim-config.test.ts`, `tests/vim-config.types.ts`
- Modify: `src/lib/preferences.ts`, `tests/preferences.test.ts`, `package.json`

- [ ] **Step 1: Write failing preference and config tests**

Assert that missing `crumb.vimModeEnabled` reads as `false`, the strings `true` and `false` are parsed correctly, invalid values fall back to `false`, and the default mapping list is empty and immutable from callers.

Test the public config shape using a Normal mapping `lhs: "Y"`, `rhs: "y$"`, `modes: ["normal"]`, and an Insert mapping `lhs: "jj"`, `rhs: "<Esc>"`, `modes: ["insert"]`.

Add a compile-only fixture with `@ts-expect-error` assertions for an unsupported mode literal and writes/pushes to readonly config fields. Add a `test:types` script that type-checks only this fixture; keep browser tests and config fixtures out of the production `tsconfig.json`.

- [ ] **Step 2: Run tests and confirm failures**

Run `node --test tests/preferences.test.ts tests/vim-config.test.ts`.

Expected: failures identify the missing persisted field and config exports.

- [ ] **Step 3: Implement the preference field and typed config**

Extend `EditorPreferences` with `vimModeEnabled: boolean`; set its default to `false`; parse it using `readBoolean(read('crumb.vimModeEnabled'), false)`. Define the public config as:

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

export const defaultVimConfig: VimConfig = Object.freeze({
  mappings: Object.freeze([]),
});
```

Only expose modes and mappings that the pinned package supports and that are in the approved design; do not expose Vim engine state or a generic plugin API.

- [ ] **Step 4: Verify preference and config tests**

Run `node --test tests/preferences.test.ts tests/vim-config.test.ts`.

Run `npm run test:types`.

Expected: all tests pass; the compile-only fixture passes with every `@ts-expect-error` used; `defaultEditorPreferences.vimModeEnabled` is `false`.

### Task 3: Build the isolated Vim module and lifecycle boundary

**Files:**
- Create: `src/lib/vim/extension.ts`, `src/lib/vim/lifecycle.ts`, `tests/vim-engine.test.ts`
- Modify: `src/components/Editor.tsx` only after module tests define the public API.

- [ ] **Step 1: Write tests for extension/config installation lifecycle**

Use real CodeMirror views in the Playwright fixture to verify: extension activation starts in Normal mode; configured mappings are installed once; toggling off removes Vim key ownership; toggling on reinstalls it once; mode changes are observable; and repeated mount/unmount does not duplicate status panels or key handlers. Add a two-state harness that swaps `EditorState` with `EditorView.setState()` and assert stock package behavior for repeat, registers, search, marks, and pending input before writing a compatibility layer.

- [ ] **Step 2: Verify current `EditorView.setState()` lifecycle failure**

With two fixture tabs, create a change in tab A, switch to B and back using the same `EditorView.setState()` path used by `Editor.tsx`, and verify document/cursor/history survive while transient mode/pending input resets. Add assertions for dot-repeat, search, registers, and local marks across the switch.

- [ ] **Step 3: Implement the module-facing API**

Keep all imports of `@replit/codemirror-vim` inside `src/lib/vim/`. Provide operations with these responsibilities: create the extension from `VimConfig`; install/remove Crumb-owned mappings idempotently; report a typed mode/pending-command snapshot; cancel transient input; preserve the approved persistent state; and release per-document snapshots when a tab closes (`releaseDocument(documentId)`). Mark snapshots are stored only for documents that actually have marks, so closed or mark-free documents do not retain their `Text` trees. Callers must not read or mutate package internals directly.

- [ ] **Step 4: Add a bounded state-preservation adapter only if needed**

Inspect the exact 6.4.0 adapter/core source and prove the smallest version-locked compatibility seam in one Vim-module file. The package has no public snapshot API: repeat combines per-adapter command state with a global inserted-text payload; registers are already global; search query/direction are global but incremental input mutates them before commit; marks are live bookmarks tied to the old adapter. Cancellation must clear pending operators on blur (not only Escape), but ordinary prompt cancellation must reset pending input without sending another `<Esc>` so a pre-existing Visual mode survives; only lifecycle teardown exits modes. Because core assigns `searchState.highlightTimeout` a stale id, the module must remove any delayed overlay repaint after the engine's 50ms deadline. A newer action supersedes that cleanup only when the engine actually scheduled `highlightSearchMatches`; detect the search timer-slot change after the engine handles a key rather than interpreting raw keys, because literal `n` arguments (`fn`, `mn`, `rn`), mappings such as `n -> h`, no-query `n`, and `gn`/`gN` do not schedule that overlay. Mapped search commits that bypass `openDialog` must still update the cached search direction. Do not clone a whole `cm.state.vim`, transplant old bookmark objects, or rely on JSON serialization of engine classes. Add real-view tests for A edit → B `.`, A edit → B different edit → A `.`, insert/change payload repeat, committed/incremental-search cancellation, Visual-preserving cancellation, mapped search direction/overlay supersession, register put, and document-local mark mapping across switches/toggle/release. Also cover CodeMirror history across tab switches and repeated Vim destroy/recreate. Ordinary edits while Vim is off must not restore stale positions. If preserving coherent repeat/search/marks needs broad command-parser changes, rewriting engine semantics, or an unbounded private fork, stop and ask the user before proceeding.

- [ ] **Step 5: Verify lifecycle cases**

Run the focused browser suite. Expected: transient input is cancelled on tab/pane/disable transitions; `.`, committed search, registers, and marks survive as designed; view teardown leaves no stale adapter; CodeMirror history remains intact.

### Task 4: Integrate Vim settings and establish App-owned shared state

**Files:**
- Create: `src/lib/vim/session.ts`, `tests/vim-session.test.ts`, `tests/e2e/editor-shared-fixture.html`, `tests/e2e/editor-shared-fixture.tsx`, `tests/e2e/editor-shared.spec.ts`
- Modify: `src/components/Editor.tsx`, `src/components/SettingsModal.tsx`, `src/App.tsx`, `src/lib/vim/lifecycle.ts`
- Modify: `tests/editor-extensions.test.ts`, `tests/e2e/editor-component-fixture.tsx`, `tests/e2e/editor-component.spec.ts`

- [ ] **Step 1: Add failing tests for compartment and preference preservation**

Extend the compartment test to create a document, make an edit, reconfigure Vim off/on, and assert document, selection, and `undoDepth` remain unchanged. Add failing session-coordinator and real-Editor tests before implementation for: A edit → untouched B → global toggle → `.` still repeats A's latest edit; one pane changes a document mark, ownership transfers, and the receiving same-document pane jumps to the latest mark; owner unmount with a surviving pane; simultaneous final-pane removal; same-commit pane replacement with the same open document IDs; StrictMode effect replay; and late owner capture after a document has closed.

- [ ] **Step 2: Run focused tests and confirm failure**

Run `node --test tests/editor-extensions.test.ts tests/preferences.test.ts tests/vim-session.test.ts` and the focused failing browser cases.

Expected: compartment assertions fail before integration; shared-state cases reproduce the ownership, stale-mark, unmount, and document-close failures before the coordinator exists.

- [ ] **Step 3: Wire one independent Vim compartment per editor state**

Add a `VimSession` created once by App and passed with stable pane IDs to each Editor. The session has one application-wide command owner, document-owned marks, session-owned repeat, and an authoritative set of open tab IDs reconciled from committed App state. Each Editor creates its own Vim extension/installer instance and dedicated Vim `Compartment`; preserve the current ref-counted mapping ownership across split panes.

On tab/view changes, Vim disable, ownership transfer, and Editor unmount, finalize the current owner while its adapter still exists, cancel transient input, publish only owner state, then detach. Restore the next owner only after its target document/content/enabled state is installed. Inactive peers never overwrite snapshots. Ownership transfer between same-document panes converges marks before accepting commands. Document close reconciliation comes only from App's committed tab IDs, not pane effects or transient unmounts; late captures cannot revive closed marks. Do not change CodeMirror history or clone adapters.

- [ ] **Step 4: Add the Settings toggle using existing toggle semantics**

Expose `vimModeEnabled` through existing `EditorPreferences` and its generic `crumb.${key}` persistence. Add one switch to **Settings → Editor**; no dedicated Vim panel or layout redesign. Reuse `Toggle`, associate the description accessibly, and keep the copy accurate to implemented shortcut precedence. The visual change belongs to `@designer`.

- [ ] **Step 5: Verify settings and extension tests**

Run `node --test tests/editor-extensions.test.ts tests/preferences.test.ts tests/vim-session.test.ts` and `npm run test:e2e -- --project=chromium tests/e2e/editor-component.spec.ts tests/e2e/editor-shared.spec.ts tests/e2e/vim-lifecycle.spec.ts`.

Expected: default is off; toggles preserve document/cursor/history; pane mappings remain owned; repeat always represents the latest actual session edit; document marks converge at every ownership boundary; true close releases them exactly once; StrictMode/replacement effects do not release or resurrect state.

### Task 5: Route keys and status through Crumb-owned seams

**Files:**
- Create: `src/lib/vim/shortcuts.ts`, `tests/vim-shortcuts.test.ts`
- Modify: `src/App.tsx`, `src/components/Editor.tsx`, `src/components/StatusBar.tsx`, `tests/e2e/vim-editor.spec.ts`

- [ ] **Step 1: Write key-ownership policy tests**

Test a pure function with inputs for Vim enabled, editor focus, active dialog/palette/terminal, platform, and Vim mode. Required cases: Ctrl-W/O/B/N/P/J reach Vim only in enabled focused editor contexts; dialogs, command palette, terminal, and ordinary inputs retain ownership; macOS Command shortcuts remain app-owned; `Ctrl-W` never closes a Crumb tab in Vim-controlled contexts; `Tab` is not consumed by `indentWithTab` in Normal/Visual modes but retains Insert-mode indentation behavior.

- [ ] **Step 2: Run tests and confirm missing ownership policy**

Run `node --test tests/vim-shortcuts.test.ts`.

Expected: tests fail because no Vim ownership predicate exists.

- [ ] **Step 3: Implement the pure ownership policy and integrate capture handler**

Add `shouldVimOwnShortcut(input)` in `src/lib/vim/shortcuts.ts`, with a pure input record containing `enabled`, `focusedSurface`, `mode`, `key`, `ctrlKey`, `metaKey`, `altKey`, `shiftKey`, and `mappingOwnsKey`. Return `false` unless Vim is enabled and `focusedSurface === 'editor'`; return `false` for macOS `metaKey` shortcuts unless an explicit Vim mapping owns the key; otherwise return `true` only for a supported built-in Ctrl binding or configured mapping. At the top of `App.tsx`'s capture-phase key handler, before any shortcut branch calls `preventDefault()`/`stopPropagation()`, bypass the conflicting Crumb action only when the policy says the focused Vim editor owns it. Do not forward every event globally into Vim.

- [ ] **Step 4: Feed typed mode state to the existing status bar**

Pass a typed Vim status snapshot from the active editor through App to `StatusBar`. Render only mode and pending command/count/register state; no duplicate engine mode panel. Route search/command prompts through the package's existing CodeMirror panel.

- [ ] **Step 5: Verify actual keyboard routing**

Extend Playwright tests to press conflicting shortcuts and assert: Vim actions reach the editor; Crumb tabs are not unexpectedly closed; application commands remain available in command palette; dialogs and terminal still receive keys; Normal/Visual Tab never inserts indentation.

Run: `node --test tests/vim-shortcuts.test.ts && npm run test:e2e -- --project=chromium`

Expected: all shortcut and focus-context cases pass.

### Task 6: Enforce Neovim-default semantics and save integration

**Files:**
- Modify: `src/lib/vim/extension.ts`, `src/lib/vim/lifecycle.ts`, `src/App.tsx`
- Create: `tests/vim-semantics.test.ts`
- Modify: `tests/e2e/vim-editor.spec.ts`

- [ ] **Step 1: Add failing semantic fixtures**

Add cases for `Y` → `y$`; Neovim `startofline`; Visual `.` behavior; case-sensitive `/` and `?`; `n/N`; counts and count multiplication; register kinds; and transient command reset. For search, verify case distinction and basic literals/classes/groups/escaping without claiming full Vim-regex parity.

- [ ] **Step 2: Compare behavior to a pinned Neovim oracle**

Run the fixture sequences with Neovim only in developer/test environments using `--clean`; capture expected document, cursor, mode, selection shape, register type, and undo results. Store recordings as plain fixtures so normal tests do not require Neovim.

- [ ] **Step 3: Correct package defaults through the narrow module adapter**

Set supported package options and Crumb mappings centrally. Add narrow overrides for `Y`, case-sensitive search, Neovim cursor placement, and Neovim Visual repeat where package APIs permit. Do not alter the user's system configuration and do not make Neovim a runtime or CI requirement. If an override needs a substantial engine change, stop for approval.

- [ ] **Step 4: Route `:w` to Crumb save**

Connect the engine's argumentless write command to the active tab's existing `handleSaveFile` path. Preserve untitled-file save dialogs, dirty state, and failure toasts. Do not add `:q`, `:wq`, file arguments, ranges, or shell commands. Ensure an asynchronous save cannot target a tab that ceased to be active before the command resolves; capture the originating tab ID and report errors to that tab's flow.

- [ ] **Step 5: Verify save and semantics**

Run `node --test tests/vim-semantics.test.ts` and `npm run test:e2e -- --project=chromium`.

Expected: fixtures match the selected Neovim defaults in the agreed contract; `:w` saves the correct tab and failure paths remain visible; unsupported Ex commands do not trigger Crumb actions.

### Task 7: Complete documentation, integration tests, and final verification

**Files:**
- Create: `docs/vim.md`, `THIRD_PARTY_NOTICES.md`
- Modify: `tests/e2e/vim-editor.spec.ts`, `package.json`, `package-lock.json`
- Verify: `docs/superpowers/specs/2026-10-26-native-vim-mode-design.md`

- [ ] **Step 1: Write documentation from behavior fixtures**

Create `docs/vim.md` with enable/disable steps, the typed config API and complete mapping examples, the guaranteed command matrix, unsupported features, Neovim-default decisions, engine-specific differences, and direct official references. For every row in the command table, list a reference and a test fixture; do not claim full Vim/Neovim compatibility.

- [ ] **Step 2: Complete keyboard and lifecycle browser tests**

Cover two tabs, same-tab split panes, persistent registers/search/repeat/marks, transient cancellation, toggle off/on, theme changes, `:w`, unsaved/untitled saves, React StrictMode, focus, and Ctrl-W/O/B/N/P/J/save ownership. Verify Tauri-specific IME/clipboard/focus manually and record OS/WebView results in the task report.

- [ ] **Step 3: Run focused checks**

Run `node --test tests/preferences.test.ts tests/editor-extensions.test.ts tests/vim-config.test.ts tests/vim-shortcuts.test.ts tests/vim-engine.test.ts tests/vim-semantics.test.ts`.

Run `npm run test:e2e -- --project=chromium`.

Run `npm run build`.

Expected: all commands exit 0; no Vim runtime dependency is required; the package build contains no duplicate CodeMirror instances.

- [ ] **Step 4: Reconcile final scope and request commit approval**

Check the complete diff against the approved design, ensure only the listed Vim module/settings/tests/docs files changed, verify the MIT license notice is preserved for distributable builds, and report manual Tauri checks not executable in the current environment. Ask the user for explicit approval of the proposed commit message before any commit.

## User approval gates

- Do not begin implementation until the user approves this plan and selects an execution approach.
- Stop and ask before a broad engine fork, a shared document/undo redesign, a compatibility reduction from the approved command contract, or expansion into macros/Ex/window commands/runtime config.
- Ask before every commit; the user's permission to implement does not authorize commits.
