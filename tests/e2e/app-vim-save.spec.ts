import { expect, test } from '@playwright/test';
import {
  appStub,
  focusEditor,
  newFile,
  openApp,
  openFileViaShortcut,
  runEx,
  tab,
  tabLabel,
} from './app-vim-helpers';

async function appendAtEnd(page: import('@playwright/test').Page, text: string): Promise<void> {
  await focusEditor(page);
  await page.keyboard.press('A');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test('async :w saves the originating tab after the user switches tabs', async ({ page }) => {
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/a.ts': 'const a = 1;\n',
      '/tmp/b.ts': 'const b = 1;\n',
    },
  });

  await openFileViaShortcut(page, '/tmp/a.ts');
  await openFileViaShortcut(page, '/tmp/b.ts');
  await expect(page.locator('.editor-tab')).toHaveCount(2);
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText(/b\.ts/);

  await appendAtEnd(page, ' // b');
  await page.locator('.editor-tab-label').filter({ hasText: 'a.ts' }).click();
  await appendAtEnd(page, ' // a');
  await expect(tab(page, 'a.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(tab(page, 'b.ts').locator('.editor-tab-dirty')).toHaveCount(1);

  // Return to tab two and start an asynchronous save that stays pending.
  await page.locator('.editor-tab-label').filter({ hasText: 'b.ts' }).click();
  await expect(page.locator('.cm-content')).toContainText('// b');
  await page.evaluate(() => {
    (window as unknown as Record<string, { setHoldWrites: (value: boolean) => void }>).__crumbTest.setHoldWrites(true);
  });
  await runEx(page, 'w');

  await expect.poll(async () => (await appStub(page)).writeCalls.length).toBe(1);
  const started = (await appStub(page)).writeCalls;
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ path: '/tmp/b.ts', status: 'pending' });
  expect(started[0].content).toContain('// b');

  // Switch to tab one while tab two's write is still in flight.
  await page.locator('.editor-tab-label').filter({ hasText: 'a.ts' }).click();
  await expect(page.locator('.cm-content')).toContainText('// a');

  await page.evaluate(() => {
    (window as unknown as Record<string, { releaseWrite: (index?: number) => void }>).__crumbTest.releaseWrite(0);
  });
  await expect.poll(async () => (await appStub(page)).writeCalls[0].status).toBe('resolved');

  // Only the originating tab became clean; the inactive edited tab stays dirty.
  await expect(tab(page, 'b.ts').locator('.editor-tab-dirty')).toHaveCount(0);
  await expect(tab(page, 'a.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  expect((await appStub(page)).writeCalls).toHaveLength(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({
    path: '/tmp/b.ts',
    status: 'resolved',
  });
});

test('untitled :w keeps dirty state on dialog cancel and saves on success', async ({ page }) => {
  await openApp(page, { vim: true, saveResult: null });
  await newFile(page);
  await appendAtEnd(page, ' changed');

  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
  await runEx(page, 'w');

  await expect.poll(async () => (await appStub(page)).saveCalls).toBe(1);
  expect((await appStub(page)).writeCalls).toHaveLength(0);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('.toast-item')).toHaveCount(0);

  await page.evaluate(() => {
    (window as unknown as Record<string, { setSaveResult: (value: string | null) => void }>).__crumbTest.setSaveResult('/tmp/untitled.ts');
  });
  await runEx(page, 'w');

  await expect.poll(async () => (await appStub(page)).writeCalls).toHaveLength(1);
  const write = (await appStub(page)).writeCalls[0];
  expect(write.path).toBe('/tmp/untitled.ts');
  expect(write.content).toContain('changed');
  expect(write.status).toBe('resolved');
  await expect(tab(page, 'untitled.ts').locator('.editor-tab-dirty')).toHaveCount(0);
  await expect(page.locator('.toast-item')).toContainText('Saved untitled.ts');
});

test('a failed :w reports the error and leaves the tab dirty', async ({ page }) => {
  await openApp(page, { vim: true, saveResult: '/tmp/failure.ts' });
  await newFile(page);
  await appendAtEnd(page, ' changed');

  await page.evaluate(() => {
    (window as unknown as Record<string, { failNextWrite: (message: string) => void }>).__crumbTest.failNextWrite('disk is full');
  });
  await runEx(page, 'w');

  await expect.poll(async () => (await appStub(page)).writeCalls).toHaveLength(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({
    path: '/tmp/failure.ts',
    status: 'rejected',
    error: 'disk is full',
  });
  await expect(page.locator('.toast-item')).toContainText('Could not save file');
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
});

test('a held save dialog resolves against the originating untitled tab after switching tabs', async ({ page }) => {
  await openApp(page, {
    vim: true,
    saveResult: null,
    files: { '/tmp/other.ts': 'const other = 1;\n' },
  });

  await newFile(page);
  await appendAtEnd(page, ' origin');
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);

  await openFileViaShortcut(page, '/tmp/other.ts');
  await appendAtEnd(page, ' // other');
  await expect(page.locator('.editor-tab')).toHaveCount(2);
  await expect(tab(page, 'other.ts').locator('.editor-tab-dirty')).toHaveCount(1);

  // Return to the originating untitled tab and start a save whose dialog is
  // deliberately held open.
  await tabLabel(page, 'Untitled').click();
  await page.evaluate(() => {
    (window as unknown as Record<string, { setHoldSaveDialog: (value: boolean) => void }>).__crumbTest.setHoldSaveDialog(true);
  });
  await runEx(page, 'w');

  await expect.poll(async () => (await appStub(page)).pendingSaveDialogs).toBe(1);
  expect((await appStub(page)).writeCalls).toHaveLength(0);

  // Switch to the other tab while the save dialog is still pending.
  await tabLabel(page, 'other.ts').click();
  await expect(page.locator('.cm-content')).toContainText('// other');

  await page.evaluate(() => {
    (window as unknown as Record<string, { resolveSaveDialog: (path: string | null) => void }>).__crumbTest.resolveSaveDialog('/tmp/untitled.ts');
  });

  await expect.poll(async () => (await appStub(page)).writeCalls).toHaveLength(1);
  const write = (await appStub(page)).writeCalls[0];
  expect(write).toMatchObject({ path: '/tmp/untitled.ts', status: 'resolved' });
  expect(write.content).toContain('origin');
  expect(write.content).not.toContain('// other');

  // The originating tab adopted the chosen path and became clean; the other
  // dirty tab was not written or cleaned by this save.
  await expect(tab(page, 'untitled.ts').locator('.editor-tab-dirty')).toHaveCount(0);
  await expect(tab(page, 'other.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('.toast-item')).toContainText('Saved untitled.ts');
});

test('cancelling a held save dialog leaves the originating tab dirty and another tab untouched', async ({ page }) => {
  await openApp(page, {
    vim: true,
    saveResult: null,
    files: { '/tmp/other.ts': 'const other = 1;\n' },
  });

  await newFile(page);
  await appendAtEnd(page, ' draft');
  await openFileViaShortcut(page, '/tmp/other.ts');
  await appendAtEnd(page, ' // other');
  await expect(tab(page, 'other.ts').locator('.editor-tab-dirty')).toHaveCount(1);

  await tabLabel(page, 'Untitled').click();
  await page.evaluate(() => {
    (window as unknown as Record<string, { setHoldSaveDialog: (value: boolean) => void }>).__crumbTest.setHoldSaveDialog(true);
  });
  await runEx(page, 'w');

  await expect.poll(async () => (await appStub(page)).pendingSaveDialogs).toBe(1);
  await tabLabel(page, 'other.ts').click();
  await expect(page.locator('.cm-content')).toContainText('// other');

  await page.evaluate(() => {
    (window as unknown as Record<string, { cancelSaveDialog: () => void }>).__crumbTest.cancelSaveDialog();
  });

  await expect.poll(async () => (await appStub(page)).pendingSaveDialogs).toBe(0);
  await page.waitForTimeout(100);
  const snapshot = await appStub(page);
  expect(snapshot.writeCalls).toHaveLength(0);
  expect(snapshot.saveCalls).toBe(1);
  await expect(tabLabel(page, 'Untitled')).toHaveCount(1);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(tab(page, 'other.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('.toast-item')).toHaveCount(0);
});

test('a pending filesystem write failure after switching tabs leaves the originating tab dirty without touching the other tab', async ({ page }) => {
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/a.ts': 'const a = 1;\n',
      '/tmp/b.ts': 'const b = 1;\n',
    },
  });

  await openFileViaShortcut(page, '/tmp/a.ts');
  await openFileViaShortcut(page, '/tmp/b.ts');
  await appendAtEnd(page, ' // b');
  await tabLabel(page, 'a.ts').click();
  await appendAtEnd(page, ' // a');
  await expect(tab(page, 'a.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(tab(page, 'b.ts').locator('.editor-tab-dirty')).toHaveCount(1);

  await page.evaluate(() => {
    (window as unknown as Record<string, { setHoldWrites: (value: boolean) => void }>).__crumbTest.setHoldWrites(true);
  });
  await runEx(page, 'w');

  await expect.poll(async () => (await appStub(page)).writeCalls.length).toBe(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({ path: '/tmp/a.ts', status: 'pending' });

  // The write is still in flight when the user moves to the other tab.
  await tabLabel(page, 'b.ts').click();
  await expect(page.locator('.cm-content')).toContainText('// b');

  await page.evaluate(() => {
    (window as unknown as Record<string, { rejectWrite: (message: string) => void }>).__crumbTest.rejectWrite('disk is full');
  });

  await expect.poll(async () => (await appStub(page)).writeCalls[0].status).toBe('rejected');
  await expect(page.locator('.toast-item')).toContainText('Could not save file');
  await expect(page.locator('.toast-item')).toContainText('disk is full');

  // The failed originating tab keeps its unsaved state; the other tab is
  // neither written nor cleaned.
  await expect(tab(page, 'a.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(tab(page, 'b.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  const snapshot = await appStub(page);
  expect(snapshot.writeCalls).toHaveLength(1);
  expect(snapshot.writeCalls[0]).toMatchObject({ path: '/tmp/a.ts', status: 'rejected', error: 'disk is full' });
});

test('unsupported Ex writes never invoke the save dialog or filesystem', async ({ page }) => {
  await openApp(page, { vim: true, saveResult: '/tmp/unsupported.ts' });
  await newFile(page);
  await appendAtEnd(page, ' changed');

  await runEx(page, 'w other.txt');
  await expect(page.locator('.cm-vim-message')).toContainText('only argumentless :w');

  for (const command of ['w!', 'wq', 'q']) {
    await runEx(page, command);
  }

  await page.waitForTimeout(100);
  const snapshot = await appStub(page);
  expect(snapshot.saveCalls).toBe(0);
  expect(snapshot.writeCalls).toHaveLength(0);
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
});
