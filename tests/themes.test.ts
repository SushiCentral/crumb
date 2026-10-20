import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTheme } from '../src/lib/themes.ts';

test('GitHub Dark and Matte Black are available as complete dark themes', () => {
  const githubDark = getTheme('github-dark');
  const matteBlack = getTheme('matte-black');

  assert.equal(githubDark.name, 'GitHub Dark');
  assert.equal(githubDark.dark, true);
  assert.equal(githubDark.colors.editor, '#0d1117');
  assert.equal(matteBlack.name, 'Matte Black');
  assert.equal(matteBlack.dark, true);
  assert.equal(matteBlack.colors.editor, '#08090b');
  for (const theme of [githubDark, matteBlack]) {
    assert.ok(theme.syntax.keyword);
    assert.ok(theme.syntax.string);
    assert.ok(theme.colors.terminal);
  }
});
