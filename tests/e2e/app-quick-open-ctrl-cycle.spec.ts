import { expect, test, type Page } from '@playwright/test';
import { openApp, tabLabel } from './app-vim-helpers';

/**
 * Ctrl+P is both the Quick Open opener and, while the field is already active,
 * a cycle key. The opening press is consumed by App, so releasing Ctrl without
 * another press must never open a file. Extra deliberate presses move the
 * selection down and arm release-to-open.
 */

const WORKSPACE = '/workspace';
const FILES = {
  [`${WORKSPACE}/aardvark.ts`]: 'const aardvark = 0;\n',
  [`${WORKSPACE}/beta-one.ts`]: 'const one = 1;\n',
  [`${WORKSPACE}/beta-two.ts`]: 'const two = 2;\n',
  [`${WORKSPACE}/beta-three.ts`]: 'const three = 3;\n',
  [`${WORKSPACE}/beta-four.ts`]: 'const four = 4;\n',
};

async function openWorkspace(page: Page): Promise<void> {
  await openApp(page, { vim: false, openQueue: [WORKSPACE], files: FILES });
  await page.getByRole('button', { name: 'Open Folder…' }).first().click();
  await expect(page.locator('.tree-entry').filter({ hasText: 'beta-one.ts' })).toBeVisible();
}

async function openQuickOpen(page: Page) {
  await page.keyboard.press('Control+p');
  const input = page.getByRole('combobox', { name: 'Search files' });
  await expect(input).toBeFocused();
  return input;
}

test.describe('Quick Open Ctrl+P cycle', () => {
  test('the opening press does not open a file when Ctrl is released', async ({ page }) => {
    await openWorkspace(page);
    const input = await openQuickOpen(page);
    const rows = page.locator('.quick-open-result');

    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toHaveClass(/selected/);
    await expect(input).toBeFocused();
    await expect(page.locator('.command-palette')).toBeVisible();
    await expect(page.locator('.editor-tab-label')).toHaveCount(0);
  });

  test('two extra presses move down and releasing Ctrl opens the selected file', async ({ page }) => {
    await openWorkspace(page);
    // Keep Control held continuously from the opening chord to confirmation.
    await page.keyboard.down('Control');
    await page.keyboard.press('p');
    const input = page.getByRole('combobox', { name: 'Search files' });
    await expect(input).toBeFocused();
    const rows = page.locator('.quick-open-result');
    await expect(rows).toHaveCount(5);

    await page.keyboard.press('p');
    await expect(rows.nth(1)).toHaveClass(/selected/);

    await page.keyboard.press('p');
    await expect(rows.nth(2)).toHaveClass(/selected/);
    await expect(input).toHaveValue('');

    await page.keyboard.up('Control');
    await expect(tabLabel(page, 'beta-two.ts')).toHaveCount(1);
    await expect(page.locator('.command-palette')).toHaveCount(0);
  });

  test('cycling past the last file wraps to the first', async ({ page }) => {
    await openWorkspace(page);
    const input = await openQuickOpen(page);
    const rows = page.locator('.quick-open-result');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toHaveClass(/selected/);

    await page.keyboard.down('Control');
    for (let press = 0; press < 4; press += 1) await page.keyboard.press('p');
    await expect(rows.nth(4)).toHaveClass(/selected/);

    await page.keyboard.press('p');
    await expect(rows.nth(0)).toHaveClass(/selected/);
    await expect(input).toHaveValue('');

    await page.keyboard.up('Control');
    await expect(tabLabel(page, 'aardvark.ts')).toHaveCount(1);
  });

  test('an extra press keeps the active filter instead of resetting Quick Open', async ({ page }) => {
    await openWorkspace(page);
    const input = await openQuickOpen(page);
    const rows = page.locator('.quick-open-result');

    await input.fill('beta');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('beta-one.ts');

    await page.keyboard.down('Control');
    await page.keyboard.press('p');
    await expect(rows.nth(1)).toHaveClass(/selected/);
    await expect(input).toHaveValue('beta');

    await page.keyboard.up('Control');
    await expect(tabLabel(page, 'beta-two.ts')).toHaveCount(1);
  });

  test('arrows and Enter keep their normal selection and confirm behavior', async ({ page }) => {
    await openWorkspace(page);
    const input = await openQuickOpen(page);
    const rows = page.locator('.quick-open-result');

    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveClass(/selected/);
    await page.keyboard.press('ArrowUp');
    await expect(rows.nth(0)).toHaveClass(/selected/);

    await input.fill('beta');
    await expect(rows).toHaveCount(4);
    await page.keyboard.press('Enter');

    await expect(tabLabel(page, 'beta-one.ts')).toHaveCount(1);
    await expect(page.locator('.command-palette')).toHaveCount(0);
  });

  test('Escape after arming cancels and a later Ctrl release does not open', async ({ page }) => {
    await openWorkspace(page);
    await openQuickOpen(page);
    const rows = page.locator('.quick-open-result');
    await expect(rows).toHaveCount(5);

    await page.keyboard.down('Control');
    await page.keyboard.press('p');
    await expect(rows.nth(1)).toHaveClass(/selected/);

    await page.keyboard.press('Escape');
    await expect(page.locator('.quick-open')).toHaveCount(0);
    await expect(page.locator('.palette-input')).toBeFocused();

    await page.keyboard.up('Control');
    await expect(page.locator('.editor-tab-label')).toHaveCount(0);
  });

  test('an OS auto-repeat keydown is ignored rather than counted as a second press', async ({ page }) => {
    await openWorkspace(page);
    await openQuickOpen(page);
    const rows = page.locator('.quick-open-result');
    await expect(rows).toHaveCount(5);

    await page.keyboard.down('Control');
    await page.evaluate(() => {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) throw new Error('No focused element for repeat');
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        ctrlKey: true,
        repeat: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    // The first physical press opened the field; its repeat must not advance or
    // arm, so releasing Ctrl leaves the picker open on the original row.
    await expect(rows.nth(0)).toHaveClass(/selected/);
    await page.keyboard.up('Control');
    await expect(page.locator('.quick-open')).toBeVisible();
    await expect(page.locator('.editor-tab-label')).toHaveCount(0);
  });

  test('an empty result list cannot arm release-to-open', async ({ page }) => {
    await openApp(page, { vim: false });
    const input = await openQuickOpen(page);
    await expect(page.locator('.quick-open-result')).toHaveCount(0);

    await page.keyboard.down('Control');
    await page.keyboard.press('p');
    await page.keyboard.up('Control');

    await expect(input).toBeFocused();
    await expect(page.locator('.quick-open')).toBeVisible();
    await expect(page.locator('.editor-tab-label')).toHaveCount(0);
  });

  test('window blur disarms an armed cycle so its stale keyup cannot open', async ({ page }) => {
    await openWorkspace(page);
    await openQuickOpen(page);
    const rows = page.locator('.quick-open-result');
    await expect(rows).toHaveCount(5);

    await page.keyboard.down('Control');
    await page.keyboard.press('p');
    await expect(rows.nth(1)).toHaveClass(/selected/);

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('Control');

    await expect(page.locator('.quick-open')).toBeVisible();
    await expect(rows.nth(1)).toHaveClass(/selected/);
    await expect(page.locator('.editor-tab-label')).toHaveCount(0);
  });
});
