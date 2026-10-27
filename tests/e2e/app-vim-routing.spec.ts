import { expect, test, type Page } from '@playwright/test';
import {
  appStub,
  focusEditor,
  newFile,
  openApp,
  openFileViaShortcut,
  tab,
} from './app-vim-helpers';

const TERMINAL_KEYS = [
  { key: 'Control+w', label: 'Ctrl-W', data: '\u0017' },
  { key: 'Control+o', label: 'Ctrl-O', data: '\u000f' },
  { key: 'Control+b', label: 'Ctrl-B', data: '\u0002' },
  { key: 'Control+n', label: 'Ctrl-N', data: '\u000e' },
  { key: 'Control+p', label: 'Ctrl-P', data: '\u0010' },
];

async function focusTerminal(page: Page): Promise<void> {
  await page.locator('.xterm').first().click();
  await expect(page.locator('.xterm-helper-textarea').first()).toBeFocused();
  await expect.poll(async () => (await appStub(page)).spawnCalls).toBeGreaterThan(0);
}

async function focusQuickOpen(page: Page): Promise<void> {
  const input = page.getByRole('combobox', { name: 'Search files' });
  await input.click();
  await expect(input).toBeFocused();
}

async function recordPromptKeydown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const input = document.querySelector('.cm-vim-panel input');
    if (!(input instanceof HTMLInputElement)) throw new Error('Vim prompt input is missing');
    input.addEventListener('keydown', event => {
      (window as unknown as Record<string, unknown>).__promptKey = {
        key: event.key,
        defaultPrevented: event.defaultPrevented,
      };
    });
  });
}

test.describe('terminal focus owns its Ctrl bindings', () => {
  for (const { key, label, data } of TERMINAL_KEYS) {
    test(`${label} stays in the xterm terminal instead of running an App action`, async ({ page }) => {
      await openApp(page, { vim: true });
      await newFile(page);
      await focusTerminal(page);

      await page.keyboard.press(key);

      await expect.poll(async () => (await appStub(page)).ptyInput.join('')).toContain(data);

      expect((await appStub(page)).openCalls).toBe(0);
      await expect(page.locator('.editor-tab')).toHaveCount(1);
      if (key === 'Control+b') {
        await expect(page.getByRole('button', { name: 'Toggle file explorer' })).toHaveClass(/active/);
      }
      if (key === 'Control+p') {
        await expect(page.getByRole('combobox', { name: 'Search files' })).not.toBeFocused();
      }
    });
  }
});

test('Ctrl-J closes the terminal even when terminal input is focused', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await focusTerminal(page);

  await page.keyboard.press('Control+j');

  await expect(page.locator('.bottom-panel-container')).toBeHidden();
  expect((await appStub(page)).ptyInput.join('')).not.toContain('\n');
});

test('terminal focus keeps global Ctrl-Shift-P and Ctrl-S shortcuts', async ({ page }) => {
  await openApp(page, {
    vim: true,
    openQueue: ['/tmp/terminal-save.ts'],
    files: { '/tmp/terminal-save.ts': 'terminal\n' },
  });
  await openFileViaShortcut(page, '/tmp/terminal-save.ts');
  await focusEditor(page);
  await page.keyboard.press('A');
  await page.keyboard.type(' saved');
  await page.keyboard.press('Escape');
  await focusTerminal(page);

  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await appStub(page)).writeCalls).toHaveLength(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({
    path: '/tmp/terminal-save.ts',
    status: 'resolved',
  });

  await page.keyboard.press('Control+Shift+p');
  await expect(page.locator('.command-palette')).toBeVisible();
});

test.describe('Vim prompt focus owns Ctrl-W', () => {
  test('Ctrl-W in the command prompt does not close the tab', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.type(':write foo');
    const prompt = page.locator('.cm-vim-panel input');
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await recordPromptKeydown(page);

    await page.keyboard.press('Control+w');

    await expect(page.locator('.editor-tab')).toHaveCount(1);
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__promptKey)).toMatchObject({
      key: 'w',
      defaultPrevented: false,
    });

    await page.keyboard.press('Escape');
  });

  test('Ctrl-W in the search prompt does not close the tab', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);

    await page.keyboard.type('/alpha beta');
    const prompt = page.locator('.cm-vim-panel input');
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await recordPromptKeydown(page);

    await page.keyboard.press('Control+w');

    await expect(page.locator('.editor-tab')).toHaveCount(1);
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__promptKey)).toMatchObject({
      key: 'w',
      defaultPrevented: false,
    });

    await page.keyboard.press('Escape');
  });
});

test.describe('ordinary text input focus owns conflicting Ctrl bindings', () => {
  test('Ctrl-W in the Search files input does not close the active tab', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusQuickOpen(page);

    await page.keyboard.press('Control+w');

    await expect(page.locator('.editor-tab')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: 'Search files' })).toBeFocused();
  });

  const CONFLICTING_KEYS = [
    { key: 'Control+o', label: 'Ctrl-O' },
    { key: 'Control+b', label: 'Ctrl-B' },
    { key: 'Control+n', label: 'Ctrl-N' },
    { key: 'Control+p', label: 'Ctrl-P' },
    { key: 'Control+j', label: 'Ctrl-J' },
  ];

  for (const { key, label } of CONFLICTING_KEYS) {
    test(`${label} in the Search files input does not run its App action`, async ({ page }) => {
      await openApp(page, { vim: true });
      await newFile(page);
      await focusQuickOpen(page);

      await page.keyboard.press(key);

      await expect(page.getByRole('combobox', { name: 'Search files' })).toBeFocused();
      await expect(page.locator('.editor-tab')).toHaveCount(1);
      expect((await appStub(page)).openCalls).toBe(0);
      await expect(page.getByRole('button', { name: 'Toggle file explorer' })).toHaveClass(/active/);
      await expect(page.locator('.bottom-panel-container')).toBeVisible();
    });
  }

  test('Search files input keeps global Ctrl-S and Ctrl-Shift-P shortcuts', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/quick-open-save.ts'],
      files: { '/tmp/quick-open-save.ts': 'quick open\n' },
    });
    await openFileViaShortcut(page, '/tmp/quick-open-save.ts');
    await focusEditor(page);
    await page.keyboard.press('A');
    await page.keyboard.type(' saved');
    await page.keyboard.press('Escape');
    await focusQuickOpen(page);

    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await appStub(page)).writeCalls).toHaveLength(1);
    expect((await appStub(page)).writeCalls[0]).toMatchObject({
      path: '/tmp/quick-open-save.ts',
      status: 'resolved',
    });

    await page.keyboard.press('Control+Shift+p');
    await expect(page.locator('.command-palette')).toBeVisible();
  });
});

test('a focused Vim editor keeps Ctrl-W/O out of App actions and Ctrl-N creates a tab', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.press('Control+w');
  await expect(page.locator('.editor-tab')).toHaveCount(1);

  await page.keyboard.press('Control+o');
  expect((await appStub(page)).openCalls).toBe(0);
  await expect(page.locator('.editor-tab')).toHaveCount(1);

  await page.keyboard.press('Control+n');
  await expect(page.locator('.editor-tab')).toHaveCount(2);
  await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
});

test('a Vim-disabled editor keeps Crumb Ctrl-W tab closing', async ({ page }) => {
  await openApp(page, { vim: false });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.press('Control+w');

  await expect(page.locator('.editor-tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New File' }).first()).toBeVisible();
});

test('command palette and settings dialog retain their own Ctrl-W handling', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.press('Control+Shift+p');
  await expect(page.locator('.command-palette')).toBeVisible();
  await expect(page.locator('.palette-input')).toBeFocused();
  await page.keyboard.press('Control+w');
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(page.locator('.command-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.command-palette')).toHaveCount(0);

  await page.keyboard.press('Control+,');
  await expect(page.locator('.settings-modal')).toBeVisible();
  await page.keyboard.press('Control+w');
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(page.locator('.settings-modal')).toBeVisible();
});

test('Ctrl-S saves the focused Vim editor without leaving Normal mode', async ({ page }) => {
  await openApp(page, {
    vim: true,
    openQueue: ['/tmp/editor-save.ts'],
    files: { '/tmp/editor-save.ts': 'const value = 1;' },
  });
  await openFileViaShortcut(page, '/tmp/editor-save.ts');
  await focusEditor(page);
  await page.keyboard.press('A');
  await page.keyboard.type(' // saved');
  await page.keyboard.press('Escape');

  await expect(tab(page, 'editor-save.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await page.keyboard.press('Control+s');

  await expect.poll(async () => (await appStub(page)).writeCalls).toHaveLength(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({
    path: '/tmp/editor-save.ts',
    content: 'const value = 1; // saved',
    status: 'resolved',
  });
  await expect(tab(page, 'editor-save.ts').locator('.editor-tab-dirty')).toHaveCount(0);
  await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
});
