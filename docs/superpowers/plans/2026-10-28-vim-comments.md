# Vim Comment Coverage Plan

> **Scope:** bounded regression coverage for the pinned Vim engine's `gc` comment operator plus the narrow Crumb-owned operator replacement required by its Visual-mode return-value defect.

**Status:** implemented in this lane; E2E execution and full validation belong to the parent.

**Files**
- `src/lib/vim/comments.ts` (new): Crumb-owned `toggleComment` operator replacement. Returns the top selected line's first non-blank when Visual `gc` leaves the engine's `newHead` undefined; normal motions keep the engine object unchanged.
- `tests/vim-comments.test.ts` (new): Node/fake-adapter regression for forward, upward/reversed, multi-range, normal passthrough, no-edit/no-token, and whitespace fallback cases.
- `tests/e2e/vim-comments.spec.ts` (updated): real `Editor` coverage for `gcc`, `gcj`, forward/upward Visual-line `gc`, counted `2gcc`, collapsed cursor after Visual `gc`, and single-step undo; minimal Vim fixture coverage for no-comment-token no-op and Visual exit.
- `src/lib/vim/extension.ts` (one import + one call): installs the replacement once in the existing engine-defaults initializer.
- `docs/superpowers/plans/2026-10-28-vim-comments.md` (this file).

**Out of scope**
- Engine, lifecycle, session, surround, history, App, Editor, and fixture edits. The surround worker owns `src/lib/vim/surround.ts` and its specs; the parent settles any shared Visual-exit helper.
- Browser/Playwright execution, screenshots, and manual `nvim` runs in this lane.

---

## 1. Supported behavior and engine evidence

The pinned packages are `@replit/codemirror-vim@6.4.0` and `@replit/codemirror-vim-core` (see `package.json` / lockfile).

- Core keymap: `{ keys: 'gc', type: 'operator', operator: 'toggleComment', isEdit: true }` (`node_modules/@replit/codemirror-vim-core/vim.js`).
- Engine bridge: `toggleLineComment: cm => toggleLineComment(cm.cm6)` (`@replit/codemirror-vim/dist/index.js`).
- Operator body: `toggleComment` calls `cm.execCommand("toggleLineComment")` once and returns the operator's new head; it does not implement comment formatting itself.
- Repeating an operator (`cc`, `gcc`) changes the motion to `expandToLine` with `linewise: true`; `expandToLine` advances `line + motionArgs.repeat - 1`. A pending `2gcc` count therefore covers two lines. This is a code-path expectation, not an executed E2E result in this lane.
- CodeMirror `toggleLineComment` reads language data `commentTokens` at the selection position. JavaScript language data supplies line token `//`, so the inserted text is `// ` after the line's indentation. Without language data, `getConfig` returns `{}` and the command returns `false` without a transaction.
- Because `toggleLineComment` dispatches one transaction for all affected lines, one Vim `u` reverts a multi-line `gc` operation.

## 2. Language readiness

The real component fixture passes `path={null}`. `Editor.tsx` treats that as the untitled JavaScript buffer and dispatches `javascript()` from a mount effect; it does not go through an async `LanguageDescription.load()`.

Even so, tests must not assume the `commentTokens` facet is available on the first rendered frame. The spec waits via `expect.poll` for actual JavaScript token spans (the `const` keywords) before typing `gc`:

```ts
const keywordSpans = editor.locator('.cm-line span').filter({ hasText: 'const' });
await expect.poll(async () => keywordSpans.count()).toBeGreaterThan(0);
```

This is a state-based wait, not `waitForTimeout`. The same helper pattern would work for a path-backed language after its async `load()` resolves. If `gc` ran before the language existed, CodeMirror would return `false` and a test could report a false negative.

## 3. Exact expected text

Baseline document for the real-Editor tests:

```js
const alpha = 1;
const beta = 2;
const gamma = 3;
```

Cursor starts on line 1 (`gg`).

| Keys | Exact expected document |
|---|---|
| `gcc` | `// const alpha = 1;`<br>`const beta = 2;`<br>`const gamma = 3;` |
| `gcc` again | the original three lines, uncommented |
| `gcj` | `// const alpha = 1;`<br>`// const beta = 2;`<br>`const gamma = 3;` |
| `Vjgc` | `// const alpha = 1;`<br>`// const beta = 2;`<br>`const gamma = 3;` |
| `Vkgc` after `ggj` | same two lines commented; cursor ends on line 1, column 1 |
| `2gcc` | `// const alpha = 1;`<br>`// const beta = 2;`<br>`const gamma = 3;` |
| `gcj` then `u` | the original three lines; undo depth returns to its pre-`gcj` value |

For every Visual `gc`, the engine must report `mode: normal`, cursor line 1 / column 1, and a collapsed selection (`selected: 0`). `exitVisualMode` must not re-enter charwise Visual.

No-language no-op document:

```text
alpha beta
second line
```

| Keys | Exact expected document |
|---|---|
| `gcc` | unchanged: `alpha beta`<br>`second line`; undo depth unchanged |
| `Vjgc` | unchanged; `mode: normal`, cursor offset 0, collapsed ranges, undo depth unchanged |

## 4. Test tasks

- [x] **Task 1 — real `Editor` comment toggles**
  - Open `editor-component-fixture.html?a=<doc>&vim=1`.
  - Wait for JavaScript token spans before sending `gc` keys.
  - Assert `gcc` comments line 1, a second `gcc` restores it, and mode remains `normal`.
- [x] **Task 2 — operator motion and Visual mode**
  - Assert `gcj` comments lines 1–2 and leaves line 3 unchanged.
  - Assert `Vj` reaches `visual-line`, then `gc` comments both selected lines and returns to `normal`.
- [x] **Task 3 — counted operator**
  - Assert `2gcc` comments two lines. Keep this as a normal test; the engine path supports it. If it fails, report the failing key sequence and actual document to the parent rather than weakening the assertion.
- [x] **Task 4 — undo as one operation**
  - Capture `undoDepth`, run `gcj`, assert depth increased by exactly one, press `u` once, and assert both lines and depth are restored.
- [x] **Task 5 — no comment tokens**
  - Use the existing minimal `vim-fixture.html`, which has `basicSetup` but no language extension.
  - Assert `gcc` leaves the document and undo depth unchanged and mode is `normal`.
  - Assert `Vjgc` leaves the document unchanged but still exits Visual, collapses the range, and preserves undo depth.
  - The real-Editor Visual `gc` tests assert the collapsed cursor (line 1, column 1, `selected: 0`) and include an upward `Vk` selection.

## 5. Validation

Focused Node regression (fake adapter, no browser):

```sh
node --test tests/vim-comments.test.ts
```

Typechecks (no browser):

```sh
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2022,DOM --skipLibCheck --allowImportingTsExtensions \
  tests/vim-comments.test.ts tests/e2e/vim-comments.spec.ts
```

Parent-owned full validation:

```sh
npm run test:e2e -- --project=chromium tests/e2e/vim-comments.spec.ts
```

Do not run the E2E command in the authoring lane. Do not add the spec to the production `tsconfig.json`; the repository's existing E2E specs are outside that include set.

## 6. Root-cause fix (implemented)

Pinned-engine evidence:

- `gc` maps to operator `toggleComment` (`node_modules/@replit/codemirror-vim-core/vim.js:178`).
- `toggleComment` calls `cm.execCommand("toggleLineComment")` and returns `newHead` (`vim.js:2864-2867`).
- Visual mode runs no motion, so `evalInput` never assigns `newHead` (`vim.js:2016`, `2063-2065`).
- `evalInput` then calls `exitVisualMode(cm, operatorMoveTo != null)` with `false` (`vim.js:2188-2192`), and `exitVisualMode(..., false)` clears the flags without collapsing the CodeMirror selection (`vim.js:3956-3966`).
- CodeMirror's line-comment command preserves/maps the ranged selection (`@codemirror/commands/dist/index.js:169-175`).
- `multiSelectHandleKey` reconciles the mismatch (`vim.js:7155-7158`) by calling `handleExternalSelection`, which re-enters charwise Visual and sets `visualLine = false` (`vim.js:6908-6918`).

Implementation:

- `src/lib/vim/comments.ts` replaces only `toggleComment` via `Vim.defineOperator`.
- It captures `visualMode` before the comment command, calls `execCommand('toggleLineComment')` exactly once, returns the engine's `newHead` by identity when present, and otherwise returns the top selected line's first non-blank for Visual.
- `topSelectedLine` normalizes anchor/head line order across every range, including upward/block input.
- The returned position makes core call `exitVisualMode(cm, true)`, collapsing the range before reconciliation; no edit listener or blanket mode exit is added.
- `installVimCommentOperator()` is called once from the existing engine-defaults initializer in `src/lib/vim/extension.ts` and is guarded by an idempotent flag.
- The operator does not dispatch any extra document transaction; undo remains one step, and normal `gcc`/`gcj`/`2gcc` cursor and repeat behavior are unchanged.

## 7. Limitations and known gaps

- **Plain text cannot be expressed by the real component fixture.** `editor-component-fixture.tsx` hardcodes `path={null}`, and `Editor.tsx` maps that to `javascript()`. The no-token no-op is therefore covered against `vim-fixture.html` (real CodeMirror + real Vim extension, no language), not the React `Editor`.
- **No-language no-op is engine/CodeMirror contract coverage**, not React-integration coverage. Changing the component fixture to accept a `path` or plain-text mode would be required to test the React path with no language; that fixture is out of this lane.
- **Count coverage is based on pinned source inspection** (`expandToLine` + operator repeat) and has not been executed here. If the parent's run disagrees, treat it as an upstream pinned-engine behavior finding, not a Crumb product regression, and report the exact key sequence/actual text.
- **JavaScript only.** Comment formatting and token presence are asserted for the untitled JavaScript language. Other languages' comment tokens and block-comment fallback are not covered.
- **Visual-block and multi-cursor `gc`** are covered only at the operator-return unit level, not end-to-end.
- **Comment formatting is pinned to `@codemirror/commands` behavior**: it inserts `token + " "` after the minimum indentation and removes the token plus one following space when uncommenting. The tests assert that exact text, so a dependency behavior change will surface here.
- This plan does not assert the engine's `gc` repeat (`.`) behavior or register contents.
