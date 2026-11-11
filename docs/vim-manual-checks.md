# Vim enhancement manual checks

Enable Vim mode in Settings and use disposable files. Press Escape before each
example to return to Normal mode. Type command sequences without spaces;
`Ctrl+o` and `Ctrl+i` mean hold Ctrl while pressing the letter.

## Surround

Start with `alpha beta`, with the cursor on `alpha`:

1. Type `ysiw"`: expect `"alpha" beta`.
2. With the cursor inside the quotes, type `cs"'`: expect `'alpha' beta`.
3. Type `ds'`: expect `alpha beta`.
4. Type `viwS]`: expect `[alpha] beta`.
5. Press `u` once: expect `alpha beta` again.
6. Type `ysiw`, then Escape, then `l`: no delimiters should appear, and `l`
   should move normally.

Also try `yss)` on a whole line. Opening and closing bracket keys are aliases;
neither inserts extra padding. Quotes and backticks are supported, but HTML tags
and blockwise surround are not. Visual `S` now surrounds instead of changing
selected lines. Quote-pair lookup is line-local and is not a language parser.
Normal-mode surrounds have dot-repeat support; Visual `S` does not update the
repeat record, so avoid using `.` to repeat it—it can repeat an earlier edit.
Search prompts and arrow/modified-key surround motions cancel rather than run.

## Comments

Use a JavaScript `.js` file and wait for syntax highlighting. Start with:

```js
const alpha = 1;
const beta = 2;
const gamma = 3;
```

1. Type `gg0gcc`: only the first line should gain `// `.
2. Type `gcc` again: the original text should return.
3. Type `gcj`: the first two lines should gain `// `.
4. Press `u` once: both comment prefixes should disappear.
5. Type `gg0Vjgc`: the first two selected lines should be commented.

Comment syntax comes from the active language. A file without comment tokens
does not change. These checks cover the existing `gc` operator, not a new
block-comment command.

## Unified jump history

Create and open two files, A and B, each with at least 50 nonempty lines. Use
lines with at least eight characters to check column restoration.

1. In A, type `gg05l`, then `G`. Note the departure and landing positions.
2. Switch to B using Quick Open or its tab. Note the initial position, then
   type `G`.
3. Press Ctrl+o repeatedly. Expect B's departure, A's last position, then A's
   earlier departure, in chronological reverse order.
4. Press Ctrl+i repeatedly. Expect the same locations in forward order, with
   the original columns restored where the destination line is long enough.
5. After going back, make a new jump with `gg` or `G`. Ctrl+i must not return
   to the abandoned forward branch.
6. Close a file from the history and repeat navigation. Closed files must be
   skipped, not reopened or accessed through stale editor state.
7. Try rapid repeated Ctrl+o/Ctrl+i and a long-file to short-file switch. No
   crash, unexpected Open File dialog, or delayed cursor jump should occur.
8. In Insert mode, confirm Tab still indents. Bare Tab is not jump-forward.

History is session-wide and contains only open documents. Ordinary cursor
motions do not create jumps. Stored line/column positions are clamped after
edits; they do not track text inserted or removed above them. Cross-file
double-apostrophe/backtick mark navigation is outside this feature.

## Evidence boundary

The new browser regression specs are authored but intentionally not executed:
no browser or application windows are launched for automated verification.
These manual checks establish the native Tauri/WebView behavior separately
from unit tests and TypeScript checks.
