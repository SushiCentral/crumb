import { expect, test, type Page } from '@playwright/test';
import { appStub, focusEditor, newFile, openApp } from './app-vim-helpers';

/**
 * Regression coverage for terminal auto-open on project open.
 *
 * The terminal panel is an explicit surface: launching Crumb or opening and
 * switching projects must never reveal it, focus it, or spawn a PTY. Users
 * still control it through the normal toggle path (Ctrl-`).
 */

async function openProject(page: Page, rootName: string): Promise<void> {
  await page.getByRole('button', { name: 'Open Folder…' }).first().click();
  await expect(page.locator('.explorer-root')).toContainText(rootName);
}

async function expectTerminalHidden(page: Page): Promise<void> {
  await expect(page.locator('.bottom-panel-container')).toBeHidden();
  await expect(page.locator('.xterm')).toHaveCount(0);
}

test('app opens with the terminal panel hidden and no PTY spawned', async ({ page }) => {
  await openApp(page, { vim: false });

  await expectTerminalHidden(page);
  expect((await appStub(page)).spawnCalls).toBe(0);
});

test('opening a project keeps the terminal hidden and does not spawn a PTY', async ({ page }) => {
  await openApp(page, {
    vim: false,
    openQueue: ['/workspace-one'],
    files: { '/workspace-one/index.ts': 'export const one = 1;\n' },
  });

  await expectTerminalHidden(page);
  expect((await appStub(page)).spawnCalls).toBe(0);

  await openProject(page, 'workspace-one');

  await expectTerminalHidden(page);
  expect((await appStub(page)).spawnCalls).toBe(0);
});

test('switching projects does not add a terminal group when the terminal is open', async ({ page }) => {
  await openApp(page, {
    vim: false,
    openQueue: ['/workspace-one', '/workspace-two'],
    files: {
      '/workspace-one/index.ts': 'export const one = 1;\n',
      '/workspace-two/index.ts': 'export const two = 2;\n',
    },
  });

  await openProject(page, 'workspace-one');

  // The user explicitly reveals the terminal; this is the only path allowed to
  // create a terminal group and spawn a PTY.
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  await expect(page.locator('.xterm-helper-textarea').first()).toBeFocused();
  await expect(page.locator('.terminal-sidebar .sidebar-item')).toHaveCount(1);
  await expect.poll(async () => (await appStub(page)).spawnCalls).toBe(1);

  await openProject(page, 'workspace-two');

  // Switching workspaces updates the workspace state only. The panel the user
  // opened stays open, with exactly the same single terminal group.
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  await expect(page.locator('.terminal-sidebar .sidebar-item')).toHaveCount(1);
  await expect.poll(async () => (await appStub(page)).spawnCalls).toBe(1);

  // Explicit close/reopen keeps the same live session and spawn count.
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeHidden();
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  await expect(page.locator('.terminal-sidebar .sidebar-item')).toHaveCount(1);
  await expect.poll(async () => (await appStub(page)).spawnCalls).toBe(1);
});

test('Ctrl-` opens on the Terminal tab and focuses its input', async ({ page }) => {
  await openApp(page, { vim: false });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  await expect(page.locator('.tab-btn.active')).toHaveText('Terminal');
  await expect(page.locator('.xterm-helper-textarea').first()).toBeFocused();

  // A user can inspect Output while the panel stays open. Toggling the panel
  // closed and back open must restore the Terminal tab and its input focus.
  await page.getByRole('button', { name: 'Output', exact: true }).click();
  await expect(page.locator('.tab-btn.active')).toHaveText('Output');
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeHidden();

  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  await expect(page.locator('.tab-btn.active')).toHaveText('Terminal');
  await expect(page.locator('.xterm-helper-textarea').first()).toBeFocused();
});

test('Ctrl-` closes an open panel and returns focus to the active editor', async ({ page }) => {
  await openApp(page, { vim: false });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  await expect(page.locator('.xterm-helper-textarea').first()).toBeFocused();

  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeHidden();
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('Ctrl-J no longer toggles the bottom panel', async ({ page }) => {
  await openApp(page, { vim: false });
  await newFile(page);
  await focusEditor(page);

  await page.keyboard.press('Control+j');
  await expect(page.locator('.bottom-panel-container')).toBeHidden();
  await expect(page.locator('.xterm')).toHaveCount(0);
  expect((await appStub(page)).spawnCalls).toBe(0);

  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  await expect(page.locator('.xterm-helper-textarea').first()).toBeFocused();

  await page.keyboard.press('Control+j');
  await expect(page.locator('.bottom-panel-container')).toBeVisible();
  // Ctrl-J reaches the shell as a line feed; it is no longer consumed by Crumb.
  await expect.poll(async () => (await appStub(page)).ptyInput.join('')).toContain('\n');
});
