# Vim Surround Implementation Plan

**Goal:** Add `ys`, `ds`, `cs`, and Visual `S` surround support to Crumb's Vim mode without forking `@replit/codemirror-vim-core` and without changing native motion/count/mapping precedence.

**Scope:** `src/lib/vim/surround.ts`, surround-only wiring in `src/lib/vim/extension.ts`, `tests/vim-surround.test.ts`, `tests/e2e/vim-surround.spec.ts`.

**Approved behaviour:**
- `ys{motion}{delimiter}` uses a custom Vim operator (`Vim.defineOperator`), so motions, counts, and text objects stay native.
- `yss` targets the current line (with count).
- `ds{old}` and `cs{old}{new}` use custom Vim actions for dot repeat and matching semantics.
- Visual `S` (replaces the engine's change-lines mapping) for charwise and linewise selections; blockwise selections cancel without edits.
- Pairs: `( ) b`, `[ ]`, `{ } B`, `< >`, `"`, `'`, `` ` ``.
- Balanced/escape-aware bracket matching; escape-aware same-line quotes; closest enclosing pair.
- Pending delimiter input is captured by a per-view `Prec.highest` keydown plugin installed before the leader and the engine: Escape/invalid delimiter/blur/destroy/tab switch/Vim disable cancel with no document change.
- One applied surround is one CodeMirror transaction, hence one undo step.
- Dot repeat: `ys` stores its delimiter on the recorded operator input state; `ds`/`cs` replace the recorded action command with a delimiter-bearing copy. Replayed invocations apply synchronously inside the engine operation. Aborted operations leave no delimiter, so `.` is a safe no-op. Visual `S` dot repeat is not implemented (documented limitation).
- No tags, whitespace normalization, or custom delimiter prompts.
- A Normal-mode user mapping for `y`/`d`/`c` or `ys`/`ds`/`cs`, or an operator-pending `s` mapping, suppresses the raw prefix interception so Crumb never shadows the configured keys. The engine's own prefix resolution still means a multi-key `ys`/`ds`/`cs` mapping cannot itself fire; this is documented rather than emulated.
- `ys` motion forwarding deliberately cancels for `/`, `?`, `:` prompts and for named/modified keys (arrows, Ctrl chords); none can leave a half-applied operation.
- Dot repeat is supported for `ys`, `yss`, `ds`, and `cs`. Visual `S` is not recorded for dot repeat; `.` continues to repeat the previous engine edit.
- Visual `S` exits Visual mode with the engine default `moveHead=true`, collapsing the CodeMirror selection. This prevents `multiSelectHandleKey` / `handleExternalSelection` from re-entering charwise Visual mode after the action; it applies to blockwise cancellation and to the char/line pending prompt.
- Regression coverage: a real-engine Node test (mock CM adapter, no browser) covers blockwise `S` collapsing to Normal, and authored E2E covers charwise Escape and linewise invalid-delimiter cancellation.
- Known test/runtime distinctions: `w` from inside a quoted word lands on the closing quote because Vim treats punctuation as a word; pending-register `"` in manual notes is unverified input-method behavior (dead key/IME/text input bypasses the keydown pending handler), not a standard-key regression.
- Standalone modifier-only keydowns (`Shift`, `Control`, `Alt`, `Meta`, `AltGraph`) never cancel or dispatch surround input. They are consumed/ignored in both the delimiter prompt and native-motion forwarding, so Shift-held quoted delimiters and shifted motions (`S`, `W`) work; actual modified printable/named shortcuts, Escape, and unsupported named keys still cancel.

**Engine note discovered during implementation:** `Vim.mapCommand('ys', 'operator', ...)`, `mapCommand('ds', 'action', ...)`, and `mapCommand('cs', 'action', ...)` are unreachable prefixes. The engine immediately resolves `y`/`d`/`c` as complete single-key operators before checking longer mappings, so `s` never matches the longer command. The keydown plugin therefore consumes the `s` that immediately follows a pending yank/delete/change operator, retargets the operator (`ys`) or enters the delimiter prompt (`ds`/`cs`), and forwards the remaining motion keys to the engine. Visual `S` is a single key and is mapped normally.

**Verification:** pure transform/state-machine unit tests plus `npm run test:types`. E2E spec is authored but not executed by this task; the parent owns the unified suite run.
