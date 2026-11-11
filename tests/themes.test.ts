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

test('ordinary selected labels and primary buttons meet 4.5:1 contrast in every theme', () => {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (foreground: string, background: string) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const theme of themes) {
    assert.ok(contrast(theme.colors.text, theme.colors.selection) >= 4.5, `${theme.name}: selected text`);
    assert.ok(contrast(theme.colors.accentText, theme.colors.button) >= 4.5, `${theme.name}: button text`);
  }
});

test('color theme switches preserve the interface font and honor code font preferences', () => {
  const uiFont = themeVariables(themes[0])['--ui-font' as keyof ReturnType<typeof themeVariables>];
  for (const theme of themes) {
    const variables = themeVariables(theme, 'Fira Code');
    assert.equal(variables['--ui-font' as keyof typeof variables], uiFont, theme.name);
    assert.equal(variables['--code-font' as keyof typeof variables], "'Fira Code', monospace");
  }
});
