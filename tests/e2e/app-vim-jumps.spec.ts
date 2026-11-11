import { expect, test, type Page } from '@playwright/test';
import {
  appStub,
  focusEditor,
  newFile,
  openApp,
  openFileViaShortcut,
  tabLabel,
} from './app-vim-helpers';

function numbered(prefix: string, lines: number): string {
  return Array.from({ length: lines }, (_, index) => `${prefix}${String(index + 1).padStart(3, '0')} ....................`)
    .join('\n')
    .concat('\n');
}

async function expectCursorAt(page: Page, line: number, column: number): Promise<void> {
  await expect(page.locator('.status-bar')).toContainText(`Ln ${line}, Col ${column}`);
}

async function expectActiveTab(page: Page, name: string): Promise<void> {
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText(new RegExp(name.replace('.', '\\.')));
}

/**
 * Native jumps and cross-file transitions share one chronological list:
 * A2 -> A40 -> B7 -> B90. Ctrl-o walks B7/A40/A2 and Ctrl-i returns
 * A40/B7/B90. The extra setup jumps in B's older history must not disturb the
 * first three backwards or forwards positions.
 */
test('Ctrl-o/Ctrl-i walk one mixed native and cross-file chronology', async ({ page }) => {
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/jump-a.ts': numbered('A', 100),
      '/tmp/jump-b.ts': numbered('B', 100),
    },
  });

  await openFileViaShortcut(page, '/tmp/jump-a.ts');
  await openFileViaShortcut(page, '/tmp/jump-b.ts');

  // Put B's cached cursor on line 7 before leaving it. `0` clears the goal
  // column left by the focusing click so `7G` tests the approved column-1
  // landing, not an inherited mouse goal.
  await focusEditor(page);
  await page.keyboard.press('0');
  await page.keyboard.type('7G');
  await expectCursorAt(page, 7, 1);

  await tabLabel(page, 'jump-a.ts').click();
  await focusEditor(page);
  await page.keyboard.press('0');
  await page.keyboard.type('2G');
  await page.keyboard.type('40G');
  await expectCursorAt(page, 40, 1);

  await tabLabel(page, 'jump-b.ts').click();
  // Focus without a pointer click: the click would move B's cached cursor and
  // insert a fake departure between B7 and B90 in the history.
  await page.locator('.cm-content').focus();
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('0');
  await page.keyboard.type('90G');
  await expectActiveTab(page, 'jump-b.ts');
  await expectCursorAt(page, 90, 1);

  await page.keyboard.press('Control+o');
  await expectActiveTab(page, 'jump-b.ts');
  await expectCursorAt(page, 7, 1);

  await page.keyboard.press('Control+o');
  await expectActiveTab(page, 'jump-a.ts');
  await expectCursorAt(page, 40, 1);

  await page.keyboard.press('Control+o');
  await expectCursorAt(page, 2, 1);

  await page.keyboard.press('Control+i');
  await expectCursorAt(page, 40, 1);

  await page.keyboard.press('Control+i');
  await expectActiveTab(page, 'jump-b.ts');
  await expectCursorAt(page, 7, 1);

  await page.keyboard.press('Control+i');
  await expectCursorAt(page, 90, 1);
});

/**
 * The engine adds the jump before lifecycle startofline correction. The bridge
 * must replace that destination column (8| is column 7 zero-based) so Ctrl-i
 * returns to the corrected landing rather than the first non-blank.
 */
test('Ctrl-i returns to the corrected goal column of a native line jump', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.type('iabcdefghij');
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await page.keyboard.type('abcdefghij');
  await page.keyboard.press('Escape');

  await page.keyboard.type('gg');
  await page.keyboard.type('8|');
  await expectCursorAt(page, 1, 8);

  await page.keyboard.type('G');
  await expectCursorAt(page, 2, 8);

  await page.keyboard.type('gg');
  await expectCursorAt(page, 1, 8);

  await page.keyboard.press('Control+o');
  await expectCursorAt(page, 2, 8);
  await page.keyboard.press('Control+i');
  await expectCursorAt(page, 1, 8);
});

/**
 * Positions are plain and deliberately not edit-tracking. A destination column
 * recorded before the line became shorter must clamp against the live document
 * instead of reusing stale adapter coordinates.
 */
test('Ctrl-i clamps a recorded long-line column after the destination shrinks', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.type('iabcdefghijklmnopqrst');
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await page.keyboard.type('uvwxyzabcdefghijklmn');
  await page.keyboard.press('Escape');

  // Make the goal explicit before both line jumps so the recorded line-1
  // landing is column 20 rather than a leftover insert-mode goal.
  await page.keyboard.type('20|');
  await page.keyboard.type('gg');
  await page.keyboard.type('20|');
  await page.keyboard.type('G');
  await expectCursorAt(page, 2, 20);

  // Shrink line 2 under the recorded destination.
  await page.keyboard.type('0');
  await page.keyboard.type('10x');

  // The edited cursor is an unrecorded departure, so the first Back targets
  // the recorded same-line destination (line2 ch19) clamped to the new length.
  await page.keyboard.press('Control+o');
  await expectCursorAt(page, 2, 11);

  await page.keyboard.press('Control+o');
  await expectCursorAt(page, 1, 20);

  await page.keyboard.press('Control+i');
  await expectCursorAt(page, 2, 11);
});

test('Ctrl-o in an editor never opens the application Open dialog', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await focusEditor(page);

  const before = await appStub(page);
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Control+i');
  const after = await appStub(page);

  expect(after.openCalls).toBe(before.openCalls);
  expect(after.saveCalls).toBe(before.saveCalls);
  await expect(page.locator('.command-palette')).toHaveCount(0);
  await expect(page.locator('.editor-tab')).toHaveCount(1);
});

test('bare Tab keeps Normal-mode Vim ownership and Insert-mode indentation', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await focusEditor(page);

  const original = await page.locator('.cm-content').innerText();
  await page.keyboard.press('Tab');
  await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
  expect(await page.locator('.cm-content').innerText()).toBe(original);

  await page.keyboard.press('i');
  await page.keyboard.press('Tab');
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-content')).toContainText('x');
  expect(await page.locator('.cm-content').innerText()).toMatch(/^\s+x/);
});
