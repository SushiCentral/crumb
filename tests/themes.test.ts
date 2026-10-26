import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTheme, themes, themeVariables } from '../src/lib/themes.ts';

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


test('UI hierarchy stays neutral and independent of syntax highlighting in every theme', () => {
  for (const theme of themes) {
    const variables = themeVariables(theme);
    assert.equal(variables['--label-heading' as keyof typeof variables], theme.colors.text, theme.name);
    assert.equal(variables['--label-detail' as keyof typeof variables], theme.colors.muted, theme.name);
    assert.equal(variables['--label-context' as keyof typeof variables], theme.colors.muted, theme.name);
    const recolored = themeVariables({ ...theme, syntax: { ...theme.syntax, keyword: '#ff0000', operator: '#00ff00', type: '#0000ff' } });
    for (const label of ['--label-heading', '--label-active', '--label-detail', '--label-context', '--label-inactive']) {
      assert.equal(recolored[label as keyof typeof recolored], variables[label as keyof typeof variables], `${theme.name}: ${label}`);
    }
  }
});
