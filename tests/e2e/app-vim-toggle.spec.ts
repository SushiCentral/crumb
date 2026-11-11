import { expect, test } from '@playwright/test';

const vimPreference = (page: import('@playwright/test').Page) =>
  page.evaluate(() => localStorage.getItem('crumb.vimModeEnabled'));

async function openVimCommand(page: import('@playwright/test').Page) {
  await page.keyboard.press('Control+Shift+p');
  await page.locator('.palette-input').fill('vim mode');
}

test('command palette toggles and persists Vim mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New File' }).first().click();
  await expect(page.locator('.cm-editor')).toHaveCount(1);

  await openVimCommand(page);
  await expect(page.getByRole('option', { name: /Editor: Enable Vim Mode/ })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator('.command-palette')).toHaveCount(0);
  await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
  await expect.poll(() => vimPreference(page)).toBe('true');

  // The same persisted preference re-enables Vim mode for editors after reload.
  await page.reload();
  await page.getByRole('button', { name: 'New File' }).first().click();
  await expect(page.locator('.cm-editor')).toHaveCount(1);
  await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');

  await openVimCommand(page);
  await expect(page.getByRole('option', { name: /Editor: Disable Vim Mode/ })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator('.command-palette')).toHaveCount(0);
  await expect(page.locator('.vim-status')).toHaveCount(0);
  await expect(page.locator('.cm-editor')).toHaveCount(1);
  await expect.poll(() => vimPreference(page)).toBe('false');
});
