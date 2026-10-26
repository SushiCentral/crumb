import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createMouseGoalRefresh,
  makeCaseSensitiveVimQuery,
  neovimStartoflineColumn,
} from '../src/lib/vim/lifecycle.ts';
import { createMappingInstaller } from '../src/lib/vim/mappings.ts';
import { isArgumentlessWrite, resolveVimConfig } from '../src/lib/vim/extension.ts';

interface SemanticFixtureCase {
  id: string;
  doc: string;
  keys: string;
  expected: {
    doc: string;
    cursor: number;
    line: number;
    column: number;
    mode: string;
    pending: string;
    selection: { anchor: number; head: number };
    register: { text: string; type: string };
    undoSteps: number;
  };
}

interface SemanticFixture {
  oracle: string;
  recordedAt: string;
  cases: SemanticFixtureCase[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/vim-semantics.json', import.meta.url), 'utf8'),
) as SemanticFixture;

test('the semantic oracle is pinned to the verified Neovim version instead of a runtime dependency', () => {
  assert.match(fixture.oracle, /^Neovim \d+\.\d+\.\d+ \(nvim --clean -u NONE\)$/);
  assert.match(fixture.oracle, /Neovim 0\.12\.6/);
  assert.match(fixture.oracle, /--clean/);
  assert.ok(fixture.cases.length >= 26);
  const ids = new Set(fixture.cases.map(item => item.id));
  for (const id of [
    'Y-yanks-to-end-of-line',
    'startofline-G-initial',
    'startofline-G-preserves-column',
    'startofline-gg-after-word-motion',
    'startofline-gg-preserves-column',
    'startofline-goal-through-short-line',
    'startofline-dollar-goal-through-short-line',
    'startofline-visual-char',
    'startofline-visual-line',
    'startofline-visual-block',
    'visual-block-short-row-dollar',
    'startofline-goal-through-vertical-motion',
    'startofline-goal-after-search',
    'startofline-numeric-goal-through-short-line-j',
    'startofline-numeric-goal-through-short-line-G',
    'visual-charwise-repeat',
    'visual-linewise-repeat',
    'visual-multiline-charwise-repeat',
    'search-is-case-sensitive',
    'search-literal-parentheses',
    'search-literal-plus',
    'search-escaped-group-plus',
    'search-escaped-plus',
    'search-escaped-dot',
    'search-vim-group-and-class',
    'search-word-boundaries',
    'search-backward-question-mark',
    'search-backward-count',
    'search-backward-operator',
    'search-backward-visual',
    'character-find-count-forward-repeat',
    'character-find-count-backward-repeat',
    'character-find-till-count-both-directions',
    'count-multiplication',
    'linewise-register-kind',
    'transient-command-reset',
  ]) {
    assert.ok(ids.has(id), `missing fixture ${id}`);
  }
});

test('Y uses Neovim y$ charwise semantics, not the package linewise default', () => {
  const yank = fixture.cases.find(item => item.id === 'Y-yanks-to-end-of-line');
  assert.ok(yank);
  assert.equal(yank.expected.doc, 'aalpha betalpha beta\ngamma delta');
  assert.equal(yank.expected.register.type, 'v');
  assert.equal(yank.expected.register.text, 'alpha beta');
  assert.equal(yank.expected.undoSteps, 1);
});

test('Neovim nostartofline keeps the goal column for line jumps', () => {
  const jump = fixture.cases.find(item => item.id === 'startofline-G-preserves-column');
  const jumpBack = fixture.cases.find(item => item.id === 'startofline-gg-preserves-column');
  assert.ok(jump && jumpBack);
  assert.deepEqual([jump.expected.line, jump.expected.column, jump.expected.cursor], [3, 6, 29]);
  assert.deepEqual([jumpBack.expected.line, jumpBack.expected.column, jumpBack.expected.cursor], [1, 6, 6]);

  assert.equal(neovimStartoflineColumn(6, 2, 10), 6);
  assert.equal(neovimStartoflineColumn(Infinity, 2, 10), 9);
  assert.equal(neovimStartoflineColumn(undefined, 4, 10), 4);
  assert.equal(neovimStartoflineColumn(20, 4, 10), 9);
  assert.equal(neovimStartoflineColumn(Infinity, 0, 0), 0);
});

test('visual operators repeat the same-sized region in Normal mode', () => {
  const charwise = fixture.cases.find(item => item.id === 'visual-charwise-repeat');
  const linewise = fixture.cases.find(item => item.id === 'visual-linewise-repeat');
  const multiline = fixture.cases.find(item => item.id === 'visual-multiline-charwise-repeat');
  assert.ok(charwise && linewise && multiline);
  assert.equal(charwise.expected.doc, ' gamma');
  assert.deepEqual([charwise.expected.cursor, charwise.expected.undoSteps], [1, 2]);
  assert.equal(linewise.expected.doc, 'c\nd');
  assert.equal(linewise.expected.register.type, 'V');
  assert.equal(multiline.expected.doc, 'dd ee\njj kk');
  assert.equal(multiline.expected.register.text, 'ff gg hh\nii ');
  assert.equal(multiline.expected.undoSteps, 2);
});

test('backward search fixtures preserve count, operator, and Visual semantics', () => {
  const counted = fixture.cases.find(item => item.id === 'search-backward-count');
  const operator = fixture.cases.find(item => item.id === 'search-backward-operator');
  const visual = fixture.cases.find(item => item.id === 'search-backward-visual');
  assert.ok(counted && operator && visual);
  assert.equal(counted.expected.cursor, 11);
  assert.equal(operator.expected.doc, 'alpha beta a');
  assert.equal(operator.expected.register.text, 'beta gamm');
  assert.equal(visual.expected.mode, 'visual');
  assert.deepEqual(visual.expected.selection, { anchor: 26, head: 17 });
});

test('startofline fixtures cover initial, word-motion, short-line, and Visual goals', () => {
  const initial = fixture.cases.find(item => item.id === 'startofline-G-initial');
  const wordMotion = fixture.cases.find(item => item.id === 'startofline-gg-after-word-motion');
  const shortLine = fixture.cases.find(item => item.id === 'startofline-goal-through-short-line');
  const dollar = fixture.cases.find(item => item.id === 'startofline-dollar-goal-through-short-line');
  const visual = fixture.cases.find(item => item.id === 'startofline-visual-char');
  const visualLine = fixture.cases.find(item => item.id === 'startofline-visual-line');
  const visualBlock = fixture.cases.find(item => item.id === 'startofline-visual-block');
  assert.ok(initial && wordMotion && shortLine && dollar && visual && visualLine && visualBlock);
  assert.deepEqual([initial.expected.line, initial.expected.column], [3, 0]);
  assert.deepEqual([wordMotion.expected.line, wordMotion.expected.column], [1, 6]);
  assert.deepEqual([shortLine.expected.line, shortLine.expected.column], [1, 6]);
  assert.deepEqual([dollar.expected.line, dollar.expected.column], [3, 11]);
  assert.equal(visual.expected.doc, '  one six');
  assert.equal(visual.expected.register.text, 'two\n  three four\n  five ');
  assert.equal(visualLine.expected.doc, '  five six');
  assert.equal(visualBlock.expected.doc, 'abcdefhijk\nabcdefhijk\nabcdefhijk');
  assert.equal(visualBlock.expected.register.text, 'g\ng\ng');

  const shortRow = fixture.cases.find(item => item.id === 'visual-block-short-row-dollar');
  assert.ok(shortRow);
  assert.equal(shortRow.expected.doc, 'abcde\nab\nabcde');
  assert.equal(shortRow.expected.register.type, '\u00161');
  assert.equal(shortRow.expected.register.text, 'f\n  \nf');

  const vertical = fixture.cases.find(item => item.id === 'startofline-goal-through-vertical-motion');
  const searched = fixture.cases.find(item => item.id === 'startofline-goal-after-search');
  assert.ok(vertical && searched);
  assert.equal(vertical.expected.cursor, 20);
  assert.equal(searched.expected.cursor, 14);

  const numericJ = fixture.cases.find(item => item.id === 'startofline-numeric-goal-through-short-line-j');
  const numericG = fixture.cases.find(item => item.id === 'startofline-numeric-goal-through-short-line-G');
  assert.ok(numericJ && numericG);
  assert.deepEqual([numericJ.expected.line, numericJ.expected.column], [2, 9]);
  assert.deepEqual([numericG.expected.line, numericG.expected.column], [3, 9]);
});

test('search normalization removes case folding without rewriting engine-translated regexes', () => {
  // The engine's public pcre=false mode already translates Vim syntax. The
  // adapter must not translate a second time.
  const translated = makeCaseSensitiveVimQuery(/\(\d\+\)/i);
  assert.equal(translated.source, String.raw`\(\d\+\)`);
  assert.equal(translated.flags, '');
  assert.equal(translated.ignoreCase, false);

  const literalParens = makeCaseSensitiveVimQuery(/a\(b\)/i);
  assert.equal(literalParens.source, String.raw`a\(b\)`);

  const caseSensitive = makeCaseSensitiveVimQuery(/alpha/im);
  assert.equal(caseSensitive.source, 'alpha');
  assert.equal(caseSensitive.flags, 'm');
  assert.equal(caseSensitive.ignoreCase, false);
});

test('the oracle records a case-sensitive search and a forward/backward pair', () => {
  const missingLowercase = fixture.cases.find(item => item.id === 'search-is-case-sensitive');
  const group = fixture.cases.find(item => item.id === 'search-vim-group-and-class');
  const boundary = fixture.cases.find(item => item.id === 'search-word-boundaries');
  const backward = fixture.cases.find(item => item.id === 'search-backward-question-mark');
  assert.ok(missingLowercase && group && boundary && backward);
  assert.equal(missingLowercase.expected.cursor, 9, 'lowercase alpha must not match ALPHA');
  assert.equal(group.expected.cursor, 6);
  assert.equal(boundary.expected.cursor, 9);
  assert.equal(backward.expected.cursor, 11);
});

test('the oracle records character finding with counts and repeat direction', () => {
  const forward = fixture.cases.find(item => item.id === 'character-find-count-forward-repeat');
  const backward = fixture.cases.find(item => item.id === 'character-find-count-backward-repeat');
  const till = fixture.cases.find(item => item.id === 'character-find-till-count-both-directions');
  assert.ok(forward && backward && till);
  assert.deepEqual(
    [forward.keys, forward.expected.doc, forward.expected.line, forward.expected.column, forward.expected.cursor, forward.expected.undoSteps],
    ['gg3f.;,', 'a.b.c.d.e.f', 1, 5, 5, 0],
  );
  assert.deepEqual(
    [backward.keys, backward.expected.line, backward.expected.column, backward.expected.cursor],
    ['gg$2F.;', 1, 5, 5],
  );
  assert.deepEqual(
    [till.keys, till.expected.line, till.expected.column, till.expected.cursor],
    ['gg2t.;;2T.', 1, 4, 4],
  );
});

test('counts multiply and register kinds are preserved', () => {
  const counted = fixture.cases.find(item => item.id === 'count-multiplication');
  const linewise = fixture.cases.find(item => item.id === 'linewise-register-kind');
  assert.ok(counted && linewise);
  assert.equal(counted.expected.doc, 'seven eight');
  assert.equal(counted.expected.register.type, 'v');
  assert.equal(linewise.expected.register.type, 'V');
  assert.equal(linewise.expected.register.text, 'alpha\n');
});

test('only an argumentless :w is routed to Crumb save', () => {
  assert.equal(isArgumentlessWrite({}), true);
  assert.equal(isArgumentlessWrite({ argString: '' }), true);
  assert.equal(isArgumentlessWrite({ argString: '   ' }), true);
  assert.equal(isArgumentlessWrite({ argString: ' file.txt' }), false);
  assert.equal(isArgumentlessWrite({ argString: '!' }), false);
  assert.equal(isArgumentlessWrite({ args: ['file.txt'] }), false);
  assert.equal(isArgumentlessWrite({ line: 0 }), false);
  assert.equal(isArgumentlessWrite({ lineEnd: 2 }), false);
});

test('the Crumb Vim config adds the Neovim Y mapping without changing the public default', () => {
  const resolved = resolveVimConfig({ mappings: [] });
  assert.deepEqual(resolved.mappings, [{ lhs: 'Y', rhs: 'y$', modes: ['normal'] }]);

  const userOverride = resolveVimConfig({
    mappings: [{ lhs: 'Y', rhs: 'yy', modes: ['normal'] }],
  });
  assert.deepEqual(userOverride.mappings, [{ lhs: 'Y', rhs: 'yy', modes: ['normal'] }]);

  const userVisual = resolveVimConfig({
    mappings: [{ lhs: 'Y', rhs: 'Y', modes: ['visual'] }],
  });
  assert.deepEqual(userVisual.mappings, [
    { lhs: 'Y', rhs: 'Y', modes: ['visual'] },
    { lhs: 'Y', rhs: 'y$', modes: ['normal'] },
  ]);
});

test('default Y is installed non-recursively while explicit user Y mappings stay recursive', () => {
  const calls: string[] = [];
  const engine = {
    map: (lhs: string, rhs: string, context: string) => { calls.push(`map ${context} ${lhs} ${rhs}`); },
    noremap: (lhs: string, rhs: string, context: string) => { calls.push(`noremap ${context} ${lhs} ${rhs}`); },
    unmap: (lhs: string, context: string) => { calls.push(`unmap ${context} ${lhs}`); return true; },
  };

  const preset = createMappingInstaller(resolveVimConfig({ mappings: [] }), engine, {
    isNonRecursive: (mapping, context) => mapping.lhs === 'Y' && context === 'normal',
  });
  preset.installMappings();
  assert.deepEqual(calls, ['noremap normal Y y$']);
  preset.removeMappings();

  calls.length = 0;
  const explicit = createMappingInstaller(resolveVimConfig({
    mappings: [{ lhs: 'Y', rhs: 'yy', modes: ['normal'] }],
  }), engine, {
    isNonRecursive: () => false,
  });
  explicit.installMappings();
  assert.deepEqual(calls, ['map normal Y yy']);
  explicit.removeMappings();
});

test('the mapping registry rejects opposite recursion policies for the same lhs/rhs', () => {
  const calls: string[] = [];
  const engine = {
    map: (lhs: string, rhs: string, context: string) => { calls.push(`map ${context} ${lhs} ${rhs}`); },
    noremap: (lhs: string, rhs: string, context: string) => { calls.push(`noremap ${context} ${lhs} ${rhs}`); },
    unmap: (lhs: string, context: string) => { calls.push(`unmap ${context} ${lhs}`); return true; },
  };
  const mapping = { lhs: 'Y', rhs: 'y$', modes: ['normal'] as const };

  const preset = createMappingInstaller({ mappings: [mapping] }, engine, {
    isNonRecursive: () => true,
  });
  preset.installMappings();

  const incompatible = createMappingInstaller({ mappings: [mapping] }, engine, {
    isNonRecursive: () => false,
  });
  assert.throws(() => incompatible.installMappings(), /recursi/i);
  assert.deepEqual(calls, ['noremap normal Y y$']);
  preset.removeMappings();
});

test('mouse goal refresh cleans up its listener and pending timer', async () => {
  const target = new EventTarget();
  let calls = 0;
  const cleanup = createMouseGoalRefresh(target, () => { calls += 1; });

  target.dispatchEvent(new Event('mouseup'));
  assert.equal(calls, 1);
  cleanup();
  target.dispatchEvent(new Event('mouseup'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1, 'cleanup removes the listener and cancels the pending refresh');
});

test('every fixture records register type, pending state, and undo expected values', () => {
  for (const item of fixture.cases) {
    assert.equal(typeof item.expected.pending, 'string', `${item.id} pending`);
    assert.equal(typeof item.expected.register.text, 'string', `${item.id} register text`);
    assert.match(item.expected.register.type, /^[vV\u0016]/, `${item.id} register type`);
    assert.equal(typeof item.expected.undoSteps, 'number', `${item.id} undo`);
  }
});
