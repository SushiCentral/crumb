import { expect, test } from '@playwright/test';
import { focusEditor, newFile, openApp, openFileViaShortcut } from './app-vim-helpers';

test.describe('Vim Space leader', () => {
  test('Space Space opens the existing command palette', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.press('Space');
    await page.keyboard.press('Space');

    await expect(page.locator('.command-palette')).toBeVisible();
  });

  test('Space E toggles the existing file tree state', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    const explorer = page.getByRole('button', { name: 'Toggle file explorer' });

    await expect(explorer).toHaveClass(/active/);
    await page.keyboard.press('Space');
    await page.keyboard.press('E');
    await expect(explorer).not.toHaveClass(/active/);

    await page.keyboard.press('Space');
    await page.keyboard.press('E');
    await expect(explorer).toHaveClass(/active/);
  });

  test('Space e toggles the existing file tree state alongside Space E', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    const explorer = page.getByRole('button', { name: 'Toggle file explorer' });

    await expect(explorer).toHaveClass(/active/);
    await page.keyboard.press('Space');
    await page.keyboard.press('e');
    await expect(explorer).not.toHaveClass(/active/);

    await page.keyboard.press('Space');
    await page.keyboard.press('e');
    await expect(explorer).toHaveClass(/active/);
  });

  test('Space slash opens Search with the existing focused input', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.press('Space');
    await page.keyboard.press('/');

    await expect(page.locator('.search-input')).toBeFocused();
  });

  test('Space f f opens Quick Open in file mode', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.press('Space');
    await page.keyboard.press('f');
    await page.keyboard.press('f');

    await expect(page.locator('.command-palette')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search files' })).toBeFocused();
  });

  test('an incomplete leader reveals the guide after 500ms and filters by prefix', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    const guide = page.locator('.vim-leader-guide');

    await page.keyboard.press('Space');
    await expect(guide).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(guide).toHaveCount(0);

    await expect(guide).toBeVisible({ timeout: 2000 });
    await expect(guide.locator('.vim-leader-guide-context kbd')).toHaveText(['Space']);
    await expect(guide.locator('.vim-leader-guide-key')).toHaveText(['Space', 'E / e', '/', 'f']);
    await expect(guide).toContainText('File tree');
    await expect(guide).toContainText('Search');
    // `Space f f` is a branch, so its action label appears only after `f`.
    await expect(guide).not.toContainText('Quick Open');

    await page.keyboard.press('f');
    await expect(guide.locator('.vim-leader-guide-context kbd')).toHaveText(['Space', 'f']);
    await expect(guide.locator('.vim-leader-guide-key')).toHaveText(['f']);
    await expect(guide).toContainText('Quick Open');
    await expect(guide).not.toContainText('File tree');

    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
  });

  test('blurring the editor hides the revealed guide', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    const guide = page.locator('.vim-leader-guide');

    await page.keyboard.press('Space');
    await expect(guide).toBeVisible({ timeout: 2000 });

    await page.getByRole('button', { name: 'Toggle file explorer' }).click();
    await expect(guide).toHaveCount(0);
  });

  test('a sequence completed before the delay never shows the guide', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    const guide = page.locator('.vim-leader-guide');

    await page.keyboard.press('Space');
    // Completing just before the 500ms reveal boundary must still keep the
    // guide hidden.
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');

    await expect(page.locator('.command-palette')).toBeVisible();
    await expect(guide).toHaveCount(0);
    await page.waitForTimeout(1200);
    await expect(guide).toHaveCount(0);
  });

  test('leader remains available in Visual mode', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/leader-visual.ts'],
      files: { '/tmp/leader-visual.ts': 'abc' },
    });
    await openFileViaShortcut(page, '/tmp/leader-visual.ts');
    await focusEditor(page);
    await page.keyboard.press('0');
    await page.keyboard.press('v');
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: visual');

    await page.keyboard.press('Space');
    await page.keyboard.press('Space');

    await expect(page.locator('.command-palette')).toBeVisible();
  });

  test('an incomplete sequence times out without moving the cursor or reaching Vim', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/leader-timeout.ts'],
      files: { '/tmp/leader-timeout.ts': 'abc' },
    });
    await openFileViaShortcut(page, '/tmp/leader-timeout.ts');
    await focusEditor(page);

    await page.keyboard.press('0');
    await expect(page.locator('.status-bar')).toContainText('Col 1');

    await page.keyboard.press('Space');
    // Longer than the leader's 10000ms default. The guide appears after 500ms
    // and must disappear with the expired sequence.
    const guide = page.locator('.vim-leader-guide');
    await expect(guide).toBeVisible({ timeout: 2000 });
    await page.waitForTimeout(10_100);
    await expect(guide).toHaveCount(0);

    // Runtime proof that Space never reached the engine's `<Space> -> l`
    // mapping: the cursor stayed put and no Vim command is pending.
    await expect(page.locator('.status-bar')).toContainText('Col 1');
    await expect(page.locator('.vim-status')).not.toContainText('Cmd');

    await page.keyboard.press('x');

    // If Space still moved right, x would delete "b". If the pending leader
    // input survived, x would be consumed as a cancelled leader key.
    await expect(page.locator('.cm-line').first()).toHaveText('bc');
    await expect(page.locator('.command-palette')).toHaveCount(0);
  });

  test('an unmatched leader key is consumed instead of performing the old motion', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/leader-cancel.ts'],
      files: { '/tmp/leader-cancel.ts': 'abc' },
    });
    await openFileViaShortcut(page, '/tmp/leader-cancel.ts');
    await focusEditor(page);

    await page.keyboard.press('0');
    await expect(page.locator('.status-bar')).toContainText('Col 1');

    // Space moves right by default, so Space x would delete "b" as a normal
    // motion. The leader owns the sequence and must leave the document alone.
    await page.keyboard.press('Space');
    await page.keyboard.press('x');

    await expect(page.locator('.cm-line').first()).toHaveText('abc');
  });

  test('insert mode keeps Space as ordinary text input', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/leader-insert.ts'],
      files: { '/tmp/leader-insert.ts': 'abc' },
    });
    await openFileViaShortcut(page, '/tmp/leader-insert.ts');
    await focusEditor(page);

    await page.keyboard.press('0');
    await expect(page.locator('.status-bar')).toContainText('Col 1');

    await page.keyboard.press('i');
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');

    await expect(page.locator('.cm-line').first()).toHaveText(' abc');
    await expect(page.locator('.command-palette')).toHaveCount(0);
  });

  test('Space remains the Vim motion after an engine-pending operator', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/leader-operator.ts'],
      files: { '/tmp/leader-operator.ts': 'abcd' },
    });
    await openFileViaShortcut(page, '/tmp/leader-operator.ts');
    await focusEditor(page);

    await page.keyboard.press('0');
    await expect(page.locator('.status-bar')).toContainText('Col 1');

    // d<Space> is d + right-motion. The leader must not steal Space while the
    // engine already owns a pending operator, and must not strand that operator.
    await page.keyboard.press('d');
    await page.keyboard.press('Space');

    await expect(page.locator('.cm-line').first()).toHaveText('bcd');
    await expect(page.locator('.status-bar')).toContainText('Col 1');
  });

  test('Space remains the Vim motion after a pending count without stranding it', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/leader-count.ts'],
      files: { '/tmp/leader-count.ts': 'abcd' },
    });
    await openFileViaShortcut(page, '/tmp/leader-count.ts');
    await focusEditor(page);

    await page.keyboard.press('0');
    await expect(page.locator('.status-bar')).toContainText('Col 1');

    // 2<Space> is 2 + right-motion: move to "c", then x deletes it.
    await page.keyboard.press('2');
    await page.keyboard.press('Space');
    await page.keyboard.press('x');

    await expect(page.locator('.cm-line').first()).toHaveText('abd');
  });
});
