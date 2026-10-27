import { expect, test } from '@playwright/test';
import { focusEditor, newFile, openApp, openFileViaShortcut } from './app-vim-helpers';

test('Space s w searches the cursor word when Search has never mounted', async ({ page }) => {
  const workspace = '/workspace';
  const editorFile = `${workspace}/search-word-fresh.ts`;

  await openApp(page, {
    vim: true,
    openQueue: [workspace],
    files: {
      [editorFile]: 'needle = 1;\nconst needleTwo = 2;\nconst haystack = 3;\n',
    },
  });
  await page.getByRole('button', { name: 'Open Folder…' }).first().click();
  await openFileViaShortcut(page, editorFile);
  await focusEditor(page);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await page.keyboard.press('0');

  // The Search panel must be mounted for the first time by the leader action.
  await expect(page.locator('.search-panel')).toHaveCount(0);
  await expect(page.locator('.search-input')).toHaveCount(0);

  await page.keyboard.press('Space');
  await page.keyboard.press('s');
  await page.keyboard.press('w');

  const input = page.locator('.search-input');
  await expect(page.locator('.search-panel')).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('needle');
  await expect(page.getByTitle('Use Regular Expression (Alt+R)')).not.toHaveClass(/active/);
  await expect(page.locator('.search-match-row').first()).toBeVisible();
  await expect(page.locator('.search-status-bar')).toContainText('matches');
});

test('Space s w opens and focuses Search on a blank editor with no cursor word', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await expect(page.locator('.search-panel')).toHaveCount(0);

  await page.keyboard.press('Space');
  await page.keyboard.press('s');
  await page.keyboard.press('w');

  const input = page.locator('.search-input');
  await expect(page.locator('.search-panel')).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(page.locator('.search-match-row')).toHaveCount(0);
});

test('Space s w on leading whitespace opens Search without a query', async ({ page }) => {
  const editorFile = '/tmp/search-word-whitespace.ts';

  await openApp(page, {
    vim: true,
    files: { [editorFile]: '  indented = 1;\nconst needle = 2;\n' },
  });
  await openFileViaShortcut(page, editorFile);
  await focusEditor(page);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await page.keyboard.press('0');
  await expect(page.locator('.status-bar')).toContainText('Col 1');

  await page.keyboard.press('Space');
  await page.keyboard.press('s');
  await page.keyboard.press('w');

  const input = page.locator('.search-input');
  await expect(page.locator('.search-panel')).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(page.locator('.search-match-row')).toHaveCount(0);
});

test('Space s w with no cursor word keeps an existing Search query and results', async ({ page }) => {
  const workspace = '/workspace';
  const editorFile = `${workspace}/search-word-preserve.ts`;
  const otherFile = `${workspace}/search-word-preserve-other.ts`;

  await openApp(page, {
    vim: true,
    openQueue: [workspace],
    files: {
      [editorFile]: '  indented = 1;\nconst needle = 2;\n',
      [otherFile]: 'const needle = 3;\n',
    },
  });
  await page.getByRole('button', { name: 'Open Folder…' }).first().click();
  await openFileViaShortcut(page, editorFile);
  await focusEditor(page);
  await page.keyboard.type('gg0');

  // Mount Search with a real query and let the workspace results settle.
  await page.keyboard.press('Control+Shift+f');
  const input = page.locator('.search-input');
  await expect(input).toBeFocused();
  await input.fill('needle');
  await page.keyboard.press('Enter');
  const rows = page.locator('.search-match-row');
  await expect(rows).toHaveCount(2);

  // Return to the editor with the cursor on leading whitespace, where there is
  // no word for Space `s w` to request.
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.type('gg0');

  await page.keyboard.press('Space');
  await page.keyboard.press('s');
  await page.keyboard.press('w');

  await expect(page.locator('.search-panel')).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('needle');
  await expect(rows).toHaveCount(2);

  // Repeat from the editor while the whole sidebar is hidden. Reopening must
  // still preserve the existing query and results.
  await page.keyboard.press('Control+b');
  await expect(page.locator('.resize-handle.vertical')).toHaveCount(0);
  await focusEditor(page);
  await page.keyboard.type('gg0');

  await page.keyboard.press('Space');
  await page.keyboard.press('s');
  await page.keyboard.press('w');

  await expect(page.locator('.resize-handle.vertical')).toBeVisible();
  await expect(page.locator('.search-panel')).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('needle');
  await expect(rows).toHaveCount(2);
});
