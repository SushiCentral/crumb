-- Oracle recorder for tests/fixtures/vim-semantics.json.
-- Run only in developer/test environments; production tests never invoke nvim:
--   nvim --clean --headless -u NONE -l tests/fixtures/vim-semantics.oracle.lua \
--     > tests/fixtures/vim-semantics.json
-- Messages and errors go to stderr, so stdout stays valid JSON.
local required = { major = 0, minor = 12, patch = 6 }
local version = vim.version()
assert(
  version.major == required.major and version.minor == required.minor and version.patch == required.patch,
  string.format(
    'Expected Neovim %d.%d.%d, got %d.%d.%d',
    required.major, required.minor, required.patch,
    version.major, version.minor, version.patch
  )
)
local oracle = string.format(
  'Neovim %d.%d.%d (nvim --clean -u NONE)',
  version.major, version.minor, version.patch
)

local indented = '  one two\n  three four\n  five six'
local cases = {
  {
    id = 'Y-yanks-to-end-of-line',
    doc = 'alpha beta\ngamma delta',
    keys = 'ggYp',
  },
  {
    id = 'startofline-G-initial',
    doc = indented,
    keys = 'G',
  },
  {
    id = 'startofline-G-preserves-column',
    doc = indented,
    keys = 'wwG',
  },
  {
    id = 'startofline-gg-after-word-motion',
    doc = indented,
    keys = 'wwgg',
  },
  {
    id = 'startofline-gg-preserves-column',
    doc = indented,
    keys = 'wwGgg',
  },
  {
    id = 'startofline-goal-through-short-line',
    doc = '  one two\n  three four\n  x',
    keys = 'wwGgg',
  },
  {
    id = 'startofline-dollar-goal-through-short-line',
    doc = 'short\n  x\nlonglonglong',
    keys = '$GkG',
  },
  {
    id = 'startofline-visual-char',
    doc = indented,
    keys = 'wwvGd',
  },
  {
    id = 'startofline-visual-line',
    doc = indented,
    keys = 'wwVjd',
  },
  {
    id = 'startofline-visual-block',
    doc = 'abcdefghijk\nabcdefghijk\nabcdefghijk',
    keys = '6l<C-v>Gd',
  },
  {
    id = 'visual-block-short-row-dollar',
    doc = 'abcdef\nab\nabcdef',
    keys = '$<C-v>Gd',
  },
  {
    id = 'startofline-goal-through-vertical-motion',
    doc = 'abcdefghijk\nx\nabcdefghijk',
    keys = '6l2Gj',
  },
  {
    id = 'startofline-goal-after-search',
    doc = 'abcdefghijk\nx\nabcdefghijk',
    keys = '6lG/a<CR>G',
  },
  {
    id = 'startofline-numeric-goal-through-short-line-j',
    doc = 'abc\nabcdefghijklmnop\nabcdefghijklmnop',
    keys = '10|j',
  },
  {
    id = 'startofline-numeric-goal-through-short-line-G',
    doc = 'abc\nabcdefghijklmnop\nabcdefghijklmnop',
    keys = '10|G',
  },
  {
    id = 'visual-charwise-repeat',
    doc = 'alpha beta gamma',
    keys = 'ggviwdw.',
  },
  {
    id = 'visual-linewise-repeat',
    doc = 'a\nb\nc\nd',
    keys = 'ggVd.',
  },
  {
    id = 'visual-multiline-charwise-repeat',
    doc = 'aaa bbb\ncc dd ee\nff gg hh\nii jj kk',
    keys = 'ggvjlldj.',
  },
  {
    id = 'search-is-case-sensitive',
    doc = 'ALPHA BETA',
    keys = 'gg$/alpha<CR>',
  },
  {
    id = 'search-literal-parentheses',
    doc = 'xx a(b) tail',
    keys = 'gg/a(b)<CR>',
  },
  {
    id = 'search-literal-plus',
    doc = 'xx a+b tail',
    keys = 'gg/a+b<CR>',
  },
  {
    id = 'search-escaped-group-plus',
    doc = 'xx abab tail',
    keys = 'gg/\\(ab\\)\\+<CR>',
  },
  {
    id = 'search-escaped-plus',
    doc = 'xx aaab tail',
    keys = 'gg/a\\+b<CR>',
  },
  {
    id = 'search-escaped-dot',
    doc = 'xx a.b axb',
    keys = 'gg/a\\.b<CR>',
  },
  {
    id = 'search-vim-group-and-class',
    doc = 'alpha 123 beta\ngamma 456 delta',
    keys = 'gg/\\(\\d\\+\\)<CR>',
  },
  {
    id = 'search-word-boundaries',
    doc = 'alphabet beta\ngamma beta',
    keys = 'gg/\\<beta\\><CR>',
  },
  {
    id = 'search-backward-question-mark',
    doc = 'alpha beta beta',
    keys = 'gg$?beta<CR>',
  },
  {
    id = 'search-backward-count',
    doc = 'alpha beta beta beta',
    keys = 'gg$2?beta<CR>',
  },
  {
    id = 'search-backward-operator',
    doc = 'alpha beta beta gamma',
    keys = 'gg$d?beta<CR>',
  },
  {
    id = 'search-backward-visual',
    doc = 'alpha beta gamma beta delta',
    keys = 'gg$v?beta<CR>',
  },
  {
    id = 'character-find-count-forward-repeat',
    doc = 'a.b.c.d.e.f',
    keys = 'gg3f.;,',
  },
  {
    id = 'character-find-count-backward-repeat',
    doc = 'a.b.c.d.e.f',
    keys = 'gg$2F.;',
  },
  {
    id = 'character-find-till-count-both-directions',
    doc = 'a.b.c.d.e.f',
    keys = 'gg2t.;;2T.',
  },
  {
    id = 'count-multiplication',
    doc = 'one two three four five six seven eight',
    keys = 'gg2d3w',
  },
  {
    id = 'linewise-register-kind',
    doc = 'alpha\nbeta\ngamma',
    keys = 'ggyyjP',
  },
  {
    id = 'transient-command-reset',
    doc = 'alpha beta',
    keys = 'ggd<Esc>',
  },
}

local function feed(keys)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(keys, true, false, true), 'xt', false)
end

local function set_doc(lines)
  feed('<Esc><Esc>')
  vim.cmd('set undolevels=-1')
  vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
  vim.cmd('set undolevels=1000')
  vim.api.nvim_win_set_cursor(0, {1, 0})
  feed('<Esc>')
  vim.fn.setreg('"', '', 'v')
  vim.fn.setreg('/', '')
end

local function offset(pos)
  local total = 0
  for i = 1, pos[1] - 1 do
    total = total + #vim.api.nvim_buf_get_lines(0, i - 1, i, false)[1] + 1
  end
  return total + pos[2]
end

local function snapshot(case)
  local cur = vim.api.nvim_win_get_cursor(0)
  local mode = vim.api.nvim_get_mode().mode
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  local register_text = vim.fn.getreg('"')
  local register_type = vim.fn.getregtype('"')
  local t = vim.fn.undotree()
  local undo_steps = 0
  for _ in pairs(t.entries or {}) do
    if _ ~= nil then undo_steps = undo_steps + 1 end
  end

  -- During Visual mode the live anchor is `v` and the live head is the
  -- cursor. '< / '> are only updated after leaving Visual mode, so using them
  -- here would snapshot stale marks from an earlier operation.
  local selection_anchor = cur
  local selection_head = cur
  if mode == 'v' or mode == 'V' or mode == '\22' then
    local anchor = vim.fn.getpos('v')
    selection_anchor = { anchor[2], anchor[3] - 1 }
    selection_head = { cur[1], cur[2] }
  end

  return {
    id = case.id,
    doc = case.doc,
    keys = case.keys,
    expected = {
      doc = table.concat(lines, '\n'),
      cursor = offset(cur),
      line = cur[1],
      column = cur[2],
      mode = ({ n = 'normal', v = 'visual', V = 'visual-line', ['\22'] = 'visual-block', i = 'insert', R = 'replace' })[mode] or mode,
      pending = '',
      selection = {
        anchor = offset(selection_anchor),
        head = offset(selection_head),
      },
      register = { text = register_text, type = register_type },
      undoSteps = undo_steps,
    },
  }
end

local results = {}
for _, case in ipairs(cases) do
  set_doc(vim.split(case.doc, '\n', { plain = true }))
  feed(case.keys)
  results[#results + 1] = snapshot(case)
end

io.stdout:write(vim.fn.json_encode({
  oracle = oracle,
  cases = results,
  recordedAt = os.date('!%Y-%m-%dT%H:%M:%SZ'),
}) .. '\n')
io.stdout:flush()
