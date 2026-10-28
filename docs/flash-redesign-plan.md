# Flash redesign plan

Status: implemented, verified, and accepted by the user; commit authorized.
The no-commit gate was maintained through design and user review.

## Goal

Make Crumb's Flash interaction closely match the user's configured Flash.nvim,
with a deliberate focus treatment rather than bright syntax and disconnected
orange badges. Preserve the bottom-bar `⌖ Flash:` prompt and editor focus.
Keep the requested live Visual selection preview as an intentional deviation
from upstream's non-incremental standalone default.

## Established causes

- Uppercase labels currently enter Crumb's reuse history. Upstream defaults to
  lowercase-only reuse: uppercase labels are temporary overflow, not sticky.
- Crumb uses case-sensitive matching and continuation filtering. The user's
  LazyVim uses ignorecase plus smartcase. These are Flash-local settings for
  this redesign; ordinary Crumb Vim `/` search need not change.
- Native Neovim with installed Flash b634694 reproduces `a/u` for the realistic
  Python `t -> ti -> tim -> time` trace. Crumb produces `F/y`. This is not fixed
  by banning uppercase or resetting every label on each key.
- CodeMirror visibleRanges includes rendered overscan. Offscreen candidates
  consume labels; horizontal scroll does not reposition the current badges.
- Visual previews and commits currently share a motion boundary despite having
  different semantic effects. Cleanup and restoration need explicit policies.

## Pass 1: freeze the behavioral oracle

Explorer supplies a checked-in realistic Python fixture and per-key upstream
trace (query, offsets, eligible labels, current target, case behavior). Keep
Neovim optional: normal CI replays independently recorded golden results.

Primary golden trace for import-time/runtime targets:

| Query | Import target | Runtime target |
| --- | --- | --- |
| t | Q | unlabelled |
| ti | d | u |
| tim | d | u |
| time | a | u |

Test lowercase stable reuse, uppercase non-reuse, case-insensitive continuation
exclusions, smartcase, Backspace, and label-capacity overflow. Do not hardcode
nice letters without matching the source behavior.

## Pass 2: clean behavioral boundaries

Core owner separates a small pure jump-model module from view/session effects:

- Pure matching, case policy, continuation exclusions, label reuse/allocation,
  and forward/wrapped current-target choice.
- One view-local session owns query, activation state, history, and exit reason.
- Explicit native-motion intents for preview, commit, and restoration. Preview
  must not pollute jump history, registers, or repeat state. Commit should add
  one navigable jump, not one per typed key.
- Preserve native Vim character/line/block geometry; avoid manual vim.sel patches.
- Keep transient decorations plugin-owned, never cached in EditorState.

Exit contract: Escape restores origin/view, clears Flash, and exits Visual;
successful commit retains the chosen head and Visual type; no-results clears
Flash and restores the activation head while retaining pre-existing Visual
type; empty Backspace stays active. Blur/tab/pane transfer and Vim disable
finalize/restore transient preview before the outgoing adapter is captured.
External edits invalidate candidates and clear Flash without restoring stale
offsets; mouse selection cancels Flash and preserves the user's new selection.
Destroy only removes resources and emits inactive state, never dispatches.

## Pass 3: actual onscreen geometry

Use the clipped text viewport for target eligibility, including horizontal
clipping and wrapped lines. Whole-document continuation exclusions remain
separate: offscreen query continuations must still prevent ambiguous labels.
Scrolling/resizing refreshes onscreen candidates and positions through a
measurement-safe path. Labels share one clipped, layout-neutral projection;
account for editor scale, font metrics, top/bottom edges, and overlap.

## Pass 4: quiet field, mint signal

Designer owns all visual decisions and implementation against agreed hooks:

- Darken the local editor surface while Flash is active. Recede unmatched
  syntax while retaining recognizable hues; never apply whole-editor opacity.
- Keep match text crisp, with restrained mint fill/underline. Distinguish the
  current Enter/preview target from other matches.
- Flat mint labels follow editor character-cell size and zoom, on the same line
  immediately after each match, overlaying the next cell like LazyVim without
  insertion or layout shift. No above-text badges (user revision).
- Keep native Visual selection readable and distinct from Flash match styling.
- Keep `⌖ Flash:` in the bottom bar; no lightning icon or floating input chip.
- Theme-aware dark/light tokens, reduced-motion support, complete exit cleanup.

## Ownership and sequence

1. Explorer: upstream fixture and trace evidence, read-only product scope.
2. Fixer: failing model/session/geometry tests, then bounded core implementation.
3. Designer: theme/CSS/presentation lane with no competing writes to core files.
   Agree class/token/layer hooks first; one owner writes each shared file.
4. Fixer: integration regressions after core and visual lanes reconcile.
5. Orchestrator: inspect artifacts, review screenshots, run final project checks.
6. Oracle: targeted review only for unresolved semantic/architecture risks.

## Acceptance gates

- Exact per-key oracle agreement, including the realistic final `a/u` result.
- No invisible targets spending labels; no stale badge positions on scroll.
- Real-App Ctrl+Tab regression stays green; no stale dimming/highlights/status.
- Character/line/block preview, Escape, Backspace, no-results, blur, split
  transfer, disable, external edits, and commit preserve defined Vim state.
- Inspect production screenshots: Crumb dark, another dark theme, Catppuccin
  Latte; normal/Visual, top/bottom edges, wrapping, narrow window, font/zoom.
- Tests assert intended geometry, contrast hierarchy and target mappings, not
  simply current DOM label order. Missing snapshots are not evidence of a bug;
  baselines require visual review before acceptance.
- Run focused checks during development; full unit suite, types, build and
  relevant browser suite once after reconciliation. Report limitations.
- Present screenshots and remaining deviations to the user. User satisfaction
  is the final gate. No commits during this plan or its implementation.

## Out of scope

No general editor restyle, real Neovim embedding, new dependencies, Tree-sitter
motions, remote operators, or cross-window Flash expansion. Do not silently
broaden the feature while fixing parity and presentation.
