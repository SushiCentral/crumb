import { expect, test } from '@playwright/test';
import { focusEditor, openApp, openFileViaShortcut } from './app-vim-helpers';

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
