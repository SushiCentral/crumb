import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-vim-helpers';

/**
 * Pointer hover must not steal the filtered selection while the pointer is
 * stationary. Rows move underneath the cursor when the query changes (and
 * WebKit can replay a zero-delta mousemove after layout/scroll work), so only a
 * genuine coordinate change may hand selection to a row.
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
  await openApp(page, { vim: true, openQueue: [WORKSPACE], files: FILES });
  await page.getByRole('button', { name: 'Open Folder…' }).first().click();
  await expect(page.locator('.tree-entry').filter({ hasText: 'beta-one.ts' })).toBeVisible();
}

async function pointAt(page: Page, locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot point at a hidden element');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Several steps guarantee at least one move event with a real coordinate
  // change even if the first event is treated as a zero-delta replay.
  await page.mouse.move(point.x, point.y, { steps: 4 });
  return point;
}

test.describe('Quick Open pointer selection', () => {
  test('a query change keeps the top filtered result under a stationary pointer', async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press('Control+p');

    const input = page.getByRole('combobox', { name: 'Search files' });
    const rows = page.locator('.quick-open-result');
    await expect(input).toBeFocused();
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText('aardvark.ts');

    const stationary = await pointAt(page, rows.nth(1));
    await expect(rows.nth(1)).toHaveClass(/selected/);

    // Keyboard-only query change; the pointer has not moved. The reordered rows
    // must not trigger hover selection, which used to happen through
    // onMouseEnter on the row that slid under the cursor.
    await page.keyboard.type('beta');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('beta-one.ts');
    await expect(rows.nth(0)).toHaveClass(/selected/);

    // Browsers re-evaluate hover after the list reflows under a stationary
    // pointer and emit a boundary event for the row that is now there. Replay
    // that boundary event: beta-one moved from row 1 to row 0, so beta-two now
    // sits at the pointer's old row and must not take the selection.
    await rows.nth(1).dispatchEvent('mouseover', {
      bubbles: true,
      clientX: stationary.x,
      clientY: stationary.y,
    });
    await expect(rows.nth(0)).toHaveClass(/selected/);
    await expect(page.locator('.quick-open-result.selected')).toHaveCount(1);
  });

  test('zero-delta moves are ignored while real movement still selects a row', async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press('Control+p');

    const rows = page.locator('.quick-open-result');
    await expect(rows).toHaveCount(5);

    const stationary = await pointAt(page, rows.nth(1));
    await expect(rows.nth(1)).toHaveClass(/selected/);

    await rows.nth(3).dispatchEvent('mousemove', { clientX: stationary.x, clientY: stationary.y });
    await expect(rows.nth(1)).toHaveClass(/selected/);

    await pointAt(page, rows.nth(3));
    await expect(rows.nth(3)).toHaveClass(/selected/);
  });
});

test.describe('Command Palette pointer selection', () => {
  test('a synthetic zero-delta move after a query change keeps the top result', async ({ page }) => {
    await openApp(page, { vim: true });
    await page.keyboard.press('Control+Shift+p');

    const input = page.locator('.palette-input');
    const options = page.locator('.palette-option');
    await expect(input).toBeFocused();
    await expect(options.nth(3)).toBeVisible();

    const stationary = await pointAt(page, options.nth(3));
    await expect(options.nth(3)).toHaveAttribute('aria-selected', 'true');

    await input.fill('appearance');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

    // WebKit can replay a move at the unchanged pointer coordinates when the
    // list reflows or scrolls. It must not select the row now under the cursor.
    await options.nth(2).dispatchEvent('mousemove', { clientX: stationary.x, clientY: stationary.y });
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

    // A real move still drives hover selection.
    await pointAt(page, options.nth(2));
    await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
  });
});
