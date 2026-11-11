import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { focusEditor, openApp, openFileViaShortcut, tabLabel } from './app-vim-helpers';

test('shows the live Flash query in the status bar without stealing editor focus', async ({ page }) => {
  await openApp(page, {
    vim: true,
    files: { '/tmp/flash-status.ts': 'needle here\nneedle there\n' },
  });
  await openFileViaShortcut(page, '/tmp/flash-status.ts');
  await focusEditor(page);

  await page.keyboard.type('sneedle');

  const status = page.locator('.status-bar');
  await expect(status).toContainText('Flash:');
  await expect(status).toContainText('needle');
  await expect(status.locator('.vim-flash-symbol')).toHaveText('⌖');
  await expect(page.locator('.cm-content')).toBeFocused();
  await expect(page.locator('.crumb-jump-prompt')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(status).not.toContainText('Flash:');
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('live Python typing updates labels, current target, and bottom bar at human pace', async ({ page }) => {
  const python = readFileSync(
    new URL('../fixtures/vim-flash-python.py', import.meta.url),
    'utf8',
  );
  await openApp(page, {
    vim: true,
    files: { '/tmp/flash-real.py': python },
  });
  await openFileViaShortcut(page, '/tmp/flash-real.py');
  await focusEditor(page);

  const status = page.locator('.status-bar');
  const editor = page.locator('.cm-editor');
  await page.keyboard.type('s');
  for (const [index, character] of [...'time'].entries()) {
    await page.keyboard.type(character, { delay: 60 });
    const query = 'time'.slice(0, index + 1);
    await expect(status).toContainText(`Flash:${query}`);
  }

  await expect(status).toContainText('time');
  await expect(editor).toHaveClass(/cm-flash-active/);
  await expect(page.locator('.crumb-flash-label-layer')).toHaveCount(1);
  await expect(page.locator('.crumb-jump-match').first()).toBeVisible();
  await expect(page.locator('.crumb-jump-label').first()).toBeVisible();
  await expect(page.locator('.crumb-jump-current')).toHaveCount(1);
  await expect(page.locator('.crumb-jump-label.is-current')).toHaveCount(1);
  await expect(page.locator('.crumb-jump-prompt')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(status).not.toContainText('Flash:');
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(editor).not.toHaveClass(/cm-flash-active/);
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('Ctrl+Tab restores no stale Flash highlights, labels, or status', async ({ page }) => {
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/flash-a.ts': 'needle here\nneedle there\n',
      '/tmp/flash-b.ts': 'other buffer\n',
    },
  });
  await openFileViaShortcut(page, '/tmp/flash-a.ts');
  await openFileViaShortcut(page, '/tmp/flash-b.ts');

  await tabLabel(page, 'flash-a.ts').click();
  await focusEditor(page);
  await page.keyboard.type('sneedle');

  const status = page.locator('.status-bar');
  await expect(status).toContainText('Flash:');
  await expect(status).toContainText('needle');
  await expect(page.locator('.crumb-jump-match')).toHaveCount(2);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(2);

  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-b.ts');
  await expect(status).not.toContainText('Flash:');
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);
  await expect(page.locator('.crumb-flash-dim')).toHaveCount(0);
  await expect(page.locator('.cm-editor.cm-flash-active')).toHaveCount(0);

  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-a.ts');
  await expect(status).not.toContainText('Flash:');
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);
  await expect(page.locator('.crumb-flash-dim')).toHaveCount(0);
  await expect(page.locator('.cm-editor.cm-flash-active')).toHaveCount(0);

  // The restored cached editor must still accept ordinary Vim input.
  await page.locator('.cm-content').focus();
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.type('iZ');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-content')).toContainText('Z');
  await expect(page.locator('.cm-content')).toContainText('needle here');
});
