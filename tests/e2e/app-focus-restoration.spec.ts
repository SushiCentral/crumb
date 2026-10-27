import { expect, test, type Page } from '@playwright/test';
import {
  appStub,
  focusEditor,
  newFile,
  openApp,
  openFileViaShortcut,
} from './app-vim-helpers';

/**
 * Intent-aware focus restoration for app surfaces layered over the editor.
 *
 * Escape/Done and executed commands that do not hand off focus return to the
 * editor that invoked the surface. An outside click keeps the user's chosen
 * focus. Commands that open Settings, Search, Quick Open, a native dialog, or a
 * new/split editor hand focus to that destination, and stale deferred
 * restoration is abandoned if the user focuses something else first.
 */

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+p');
  await expect(page.locator('.palette-input')).toBeFocused();
}

async function runPaletteCommand(page: Page, query: string): Promise<void> {
  await openPalette(page);
  await page.locator('.palette-input').fill(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('.command-palette')).toHaveCount(0);
}

function activeEditorContent(page: Page) {
  return page.locator('.editor-pane.active .cm-content');
}

test.describe('palette focus restoration', () => {
  test('Escape returns focus to the invoking editor', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await openPalette(page);
    await page.keyboard.press('Escape');

    await expect(page.locator('.command-palette')).toHaveCount(0);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('an outside click closes the palette without stealing focus back', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await openPalette(page);
    await page.locator('.palette-overlay').click({ position: { x: 8, y: 8 } });

    await expect(page.locator('.command-palette')).toHaveCount(0);
    await expect(page.locator('.cm-content')).not.toBeFocused();
  });

  test('an executed inline command returns focus to the invoking editor', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await runPaletteCommand(page, 'word wrap');

    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
  });

  test('an outside click on Settings leaves focus where the user clicked', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.press('Control+,');
    await expect(page.locator('.settings-modal')).toBeVisible();
    await page.locator('.settings-overlay').click({ position: { x: 8, y: 8 } });

    await expect(page.locator('.settings-modal')).toHaveCount(0);
    await expect(page.locator('.cm-content')).not.toBeFocused();
  });
});

test.describe('palette direction handoffs', () => {
  test('Ctrl+P and the palette Search Files command use the shared palette surface', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.press('Control+p');
    const palette = page.locator('.command-palette');
    const fileSearch = page.getByRole('combobox', { name: 'Search files' });
    await expect(palette).toBeVisible();
    await expect(fileSearch).toBeFocused();
    await expect(page.locator('.top-bar-actions .quick-open')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(activeEditorContent(page)).toBeFocused();

    await openPalette(page);
    await page.keyboard.press('Control+p');
    await expect(fileSearch).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');

    await openPalette(page);
    await page.locator('.palette-input').fill('File: Search Files');
    await page.keyboard.press('Enter');
    await expect(palette).toBeVisible();
    await expect(fileSearch).toBeFocused();
    await expect(page.locator('.palette-back')).toBeVisible();

    await page.getByRole('button', { name: 'Back to commands' }).click();
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
  });

  test('Settings receives focus, and cancelling it returns to the invoking editor', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await runPaletteCommand(page, 'open settings');

    await expect(page.locator('.settings-modal')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Appearance' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-modal')).toHaveCount(0);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('Find in Files hands focus to the search input', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await runPaletteCommand(page, 'find in files');

    await expect(page.locator('.search-input')).toBeFocused();
    await expect(page.locator('.cm-content')).not.toBeFocused();
  });

  test('the Find in Files shortcut hands focus to the search input', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.press('Control+Shift+f');

    await expect(page.locator('.search-input')).toBeFocused();
    await expect(page.locator('.cm-content')).not.toBeFocused();
  });

  test('Quick Open receives focus, and Escape returns to the invoking editor', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await openPalette(page);
    await page.locator('.palette-input').fill('File: Search Files');
    await page.keyboard.press('Enter');
    const quickOpenInput = page.getByRole('combobox', { name: 'Search files' });
    await expect(quickOpenInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(quickOpenInput).toHaveCount(0);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('New File waits for the destination editor to be ready', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await runPaletteCommand(page, 'File: New File');

    await expect(page.locator('.editor-tab')).toHaveCount(2);
    await expect(page.locator('.editor-pane.active .cm-content')).toBeFocused();
    await page.keyboard.press('i');
    await page.keyboard.type('new destination');
    await page.keyboard.press('Escape');
    await expect(page.locator('.editor-pane.active .cm-content')).toContainText('new destination');
  });

  test('Open Active File in Split View focuses the new pane and tracks it as the invoker', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await runPaletteCommand(page, 'open active file in split');

    await expect(page.locator('.editor-pane')).toHaveCount(2);
    const secondPane = page.locator('.editor-pane').nth(1);
    await expect(secondPane.locator('.cm-content')).toBeFocused();

    await openPalette(page);
    await page.keyboard.press('Escape');

    await expect(secondPane.locator('.cm-content')).toBeFocused();
    await expect(page.locator('.editor-pane').nth(0).locator('.cm-content')).not.toBeFocused();
  });

  test('cancelling a native open dialog returns focus to the invoking editor', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await runPaletteCommand(page, 'File: Open File');

    await expect.poll(async () => (await appStub(page)).openCalls).toBe(1);
    await expect(page.locator('.editor-tab')).toHaveCount(1);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('resolving a native open dialog focuses the opened file', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/native-focus.ts'],
      files: { '/tmp/native-focus.ts': 'const native = true;\n' },
    });
    await newFile(page);
    await focusEditor(page);

    await runPaletteCommand(page, 'File: Open File');

    await expect(page.locator('.editor-tab')).toHaveCount(2);
    await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText(/native-focus\.ts/);
    await expect(activeEditorContent(page)).toBeFocused();
  });
});

test.describe('Explorer and search result focus destinations', () => {
  async function openWorkspace(page: Page, files: Record<string, string>): Promise<void> {
    await openApp(page, {
      vim: true,
      openQueue: ['/workspace'],
      files,
    });
    await page.getByRole('button', { name: 'Open Folder…' }).first().click();
  }

  test('choosing a file in the Explorer focuses the opened editor', async ({ page }) => {
    await openWorkspace(page, {
      '/workspace/explorer-focus.ts': 'const explorer = 1;\n',
    });

    const entry = page.locator('.tree-entry').filter({ hasText: 'explorer-focus.ts' });
    await expect(entry).toBeVisible();
    await entry.click();

    await expect(page.locator('.editor-tab')).toHaveCount(1);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('choosing a search result focuses the opened editor at the match', async ({ page }) => {
    await openWorkspace(page, {
      '/workspace/search-focus.ts': 'const first = 0;\nconst needle = 1;\n',
    });

    await page.keyboard.press('Control+Shift+f');
    const searchInput = page.locator('.search-input');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('needle');
    await page.keyboard.press('Enter');

    const match = page.locator('.search-match-row').first();
    await expect(match).toBeVisible();
    await match.click();

    await expect(page.locator('.editor-tab')).toHaveCount(1);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('a file read that finishes after a newer pointer decision does not steal focus', async ({ page }) => {
    await openWorkspace(page, {
      '/workspace/delayed-focus.ts': 'const delayed = 1;\n',
    });

    const entry = page.locator('.tree-entry').filter({ hasText: 'delayed-focus.ts' });
    await expect(entry).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as Record<string, { setHoldReads: (value: boolean) => void }>).__crumbTest.setHoldReads(true);
    });

    await entry.click();
    await expect.poll(async () => (await appStub(page)).pendingReads).toBe(1);

    // Click a non-focusable surface: without an interaction epoch, the
    // completed read would see `body` as a safe default and steal focus.
    await page.locator('.top-bar-brand').click();
    await page.evaluate(() => {
      (window as unknown as Record<string, { releaseReads: () => void }>).__crumbTest.releaseReads();
    });

    await expect(page.locator('.editor-tab')).toHaveCount(1);
    await page.waitForTimeout(200);
    await expect(page.locator('.cm-content')).not.toBeFocused();
  });

  test('a delayed search result read does not jump or steal focus after a newer pointer decision', async ({ page }) => {
    await openWorkspace(page, {
      '/workspace/delayed-search.ts': 'const first = 0;\nconst needle = 1;\n',
    });

    await page.keyboard.press('Control+Shift+f');
    await page.locator('.search-input').fill('needle');
    await page.keyboard.press('Enter');
    const match = page.locator('.search-match-row').first();
    await expect(match).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as Record<string, { setHoldReads: (value: boolean) => void }>).__crumbTest.setHoldReads(true);
    });
    await match.click();
    await expect.poll(async () => (await appStub(page)).pendingReads).toBe(1);

    await page.locator('.top-bar-brand').click();
    await page.evaluate(() => {
      (window as unknown as Record<string, { releaseReads: () => void }>).__crumbTest.releaseReads();
    });

    await expect(page.locator('.editor-tab')).toHaveCount(1);
    // The line-jump timer would focus the editor after the read; the captured
    // interaction epoch must suppress that stale handoff too.
    await page.waitForTimeout(250);
    await expect(page.locator('.cm-content')).not.toBeFocused();
  });
});

test.describe('Quick Open focus destinations', () => {
  test('choosing an open file focuses that file in the destination pane', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/focus-one.ts', '/tmp/focus-two.ts'],
      files: {
        '/tmp/focus-one.ts': 'const one = 1;\n',
        '/tmp/focus-two.ts': 'const two = 2;\n',
      },
    });
    await openFileViaShortcut(page, '/tmp/focus-one.ts');
    await openFileViaShortcut(page, '/tmp/focus-two.ts');
    await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText(/focus-two\.ts/);

    await page.keyboard.press('Control+p');
    const quickOpenInput = page.getByRole('combobox', { name: 'Search files' });
    await expect(quickOpenInput).toBeFocused();
    await quickOpenInput.fill('focus-one.ts');
    await page.keyboard.press('Enter');

    await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText(/focus-one\.ts/);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('Escape returns focus to the editor', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.press('Control+p');
    const quickOpenInput = page.getByRole('combobox', { name: 'Search files' });
    await expect(quickOpenInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(quickOpenInput).toHaveCount(0);
    await expect(activeEditorContent(page)).toBeFocused();
  });

  test('an outside click closes Quick Open without focusing the editor', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    await page.keyboard.press('Control+p');
    const quickOpenInput = page.getByRole('combobox', { name: 'Search files' });
    await expect(quickOpenInput).toBeFocused();

    await page.locator('.palette-overlay').click({ position: { x: 8, y: 8 } });

    await expect(quickOpenInput).toHaveCount(0);
    await expect(page.locator('.cm-content')).not.toBeFocused();
  });
});
