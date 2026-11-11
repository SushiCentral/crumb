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

  for (const command of ['w!', 'wq!']) {
    await runEx(page, command);
  }

  await page.waitForTimeout(100);
  const snapshot = await appStub(page);
  expect(snapshot.saveCalls).toBe(0);
  expect(snapshot.writeCalls).toHaveLength(0);
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
});

test(':q refuses a dirty tab with a notification and no confirmation dialog', async ({ page }) => {
  await openApp(page, { vim: true, saveResult: '/tmp/dirty.ts' });
  await newFile(page);
  await appendAtEnd(page, ' changed');

  await runEx(page, 'q');

  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('.toast-item')).toContainText('has unsaved changes');
  await expect(page.locator('[role="dialog"][aria-label="Unsaved changes"]')).toHaveCount(0);
  const snapshot = await appStub(page);
  expect(snapshot.saveCalls).toBe(0);
  expect(snapshot.writeCalls).toHaveLength(0);
});

test(':q closes a clean tab without confirmation', async ({ page }) => {
  await openApp(page, { vim: true, files: { '/tmp/clean.ts': 'const clean = 1;\n' } });
  await openFileViaShortcut(page, '/tmp/clean.ts');
  await expect(page.locator('.editor-tab')).toHaveCount(1);

  await runEx(page, 'q');

  await expect(page.locator('.editor-tab')).toHaveCount(0);
  await expect(page.locator('[role="dialog"][aria-label="Unsaved changes"]')).toHaveCount(0);
});

test(':q! discards a dirty tab without confirmation', async ({ page }) => {
  await openApp(page, { vim: true });
  await newFile(page);
  await appendAtEnd(page, ' discard me');

  await runEx(page, 'q!');

  await expect(page.locator('.editor-tab')).toHaveCount(0);
  await expect(page.locator('[role="dialog"][aria-label="Unsaved changes"]')).toHaveCount(0);
  expect((await appStub(page)).writeCalls).toHaveLength(0);
});

test(':wq saves the originating tab and closes it only after the write resolves', async ({ page }) => {
  await openApp(page, { vim: true, files: { '/tmp/wq.ts': 'const wq = 1;\n' } });
  await openFileViaShortcut(page, '/tmp/wq.ts');
  await appendAtEnd(page, ' // wq');
  await page.evaluate(() => {
    (window as unknown as Record<string, { setHoldWrites: (value: boolean) => void }>).__crumbTest.setHoldWrites(true);
  });

  await runEx(page, 'wq');

  await expect.poll(async () => (await appStub(page)).writeCalls.length).toBe(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({ path: '/tmp/wq.ts', status: 'pending' });
  // The tab stays open while the save is in flight.
  await expect(page.locator('.editor-tab')).toHaveCount(1);

  await page.evaluate(() => {
    (window as unknown as Record<string, { releaseWrite: (index?: number) => void }>).__crumbTest.releaseWrite(0);
  });

  await expect(page.locator('.editor-tab')).toHaveCount(0);
  const snapshot = await appStub(page);
  expect(snapshot.writeCalls).toHaveLength(1);
  expect(snapshot.writeCalls[0]).toMatchObject({ path: '/tmp/wq.ts', status: 'resolved' });
  expect(snapshot.writeCalls[0].content).toContain('// wq');
});

test(':wq closes only the originating tab after the user switches tabs during the held write', async ({ page }) => {
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/wq-origin.ts': 'const origin = 1;\n',
      '/tmp/wq-other.ts': 'const other = 1;\n',
    },
  });

  await openFileViaShortcut(page, '/tmp/wq-origin.ts');
  await openFileViaShortcut(page, '/tmp/wq-other.ts');
  await appendAtEnd(page, ' // other');
  await tabLabel(page, 'wq-origin.ts').click();
  await appendAtEnd(page, ' // origin');
  await expect(page.locator('.editor-tab')).toHaveCount(2);
  await expect(tab(page, 'wq-origin.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(tab(page, 'wq-other.ts').locator('.editor-tab-dirty')).toHaveCount(1);

  // Start :wq on the origin tab and leave its write pending.
  await tabLabel(page, 'wq-origin.ts').click();
  await expect(page.locator('.cm-content')).toContainText('// origin');
  await page.evaluate(() => {
    (window as unknown as Record<string, { setHoldWrites: (value: boolean) => void }>).__crumbTest.setHoldWrites(true);
  });
  await runEx(page, 'wq');

  await expect.poll(async () => (await appStub(page)).writeCalls.length).toBe(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({
    path: '/tmp/wq-origin.ts',
    status: 'pending',
  });
  expect((await appStub(page)).writeCalls[0].content).toContain('// origin');

  // The close target must stay bound to the origin tab, not the tab that is
  // active when the write resolves.
  await tabLabel(page, 'wq-other.ts').click();
  await expect(page.locator('.cm-content')).toContainText('// other');

  await page.evaluate(() => {
    (window as unknown as Record<string, { releaseWrite: (index?: number) => void }>).__crumbTest.releaseWrite(0);
  });

  await expect.poll(async () => (await appStub(page)).writeCalls[0].status).toBe('resolved');
  await expect(tab(page, 'wq-origin.ts')).toHaveCount(0);
  await expect(tab(page, 'wq-other.ts')).toHaveCount(1);
  await expect(tab(page, 'wq-other.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('// other');

  const snapshot = await appStub(page);
  expect(snapshot.writeCalls).toHaveLength(1);
  expect(snapshot.writeCalls[0]).toMatchObject({
    path: '/tmp/wq-origin.ts',
    status: 'resolved',
  });
});

test(':wq keeps the tab open when Save As is cancelled', async ({ page }) => {
  await openApp(page, { vim: true, saveResult: null });
  await newFile(page);
  await appendAtEnd(page, ' draft');

  await runEx(page, 'wq');

  await expect.poll(async () => (await appStub(page)).saveCalls).toBe(1);
  await page.waitForTimeout(100);
  const snapshot = await appStub(page);
  expect(snapshot.writeCalls).toHaveLength(0);
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('[role="dialog"][aria-label="Unsaved changes"]')).toHaveCount(0);
});

test(':wq keeps the tab open when the write fails', async ({ page }) => {
  await openApp(page, { vim: true, saveResult: '/tmp/wq-failure.ts' });
  await newFile(page);
  await appendAtEnd(page, ' changed');
  await page.evaluate(() => {
    (window as unknown as Record<string, { failNextWrite: (message: string) => void }>).__crumbTest.failNextWrite('disk is full');
  });

  await runEx(page, 'wq');

  await expect.poll(async () => (await appStub(page)).writeCalls).toHaveLength(1);
  expect((await appStub(page)).writeCalls[0]).toMatchObject({
    path: '/tmp/wq-failure.ts',
    status: 'rejected',
    error: 'disk is full',
  });
  await expect(page.locator('.toast-item')).toContainText('Could not save file');
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
});

test(':wq keeps the tab open when new edits arrive during the save', async ({ page }) => {
  await openApp(page, { vim: true, files: { '/tmp/wq-edit.ts': 'const wq = 1;\n' } });
  await openFileViaShortcut(page, '/tmp/wq-edit.ts');
  await appendAtEnd(page, ' // first');
  await page.evaluate(() => {
    (window as unknown as Record<string, { setHoldWrites: (value: boolean) => void }>).__crumbTest.setHoldWrites(true);
  });

  await runEx(page, 'wq');
  await expect.poll(async () => (await appStub(page)).writeCalls.length).toBe(1);
  expect((await appStub(page)).writeCalls[0].content).toContain('// first');
  expect((await appStub(page)).writeCalls[0].content).not.toContain('// second');

  // Edit the same tab while its save is still in flight.
  await appendAtEnd(page, ' // second');
  await page.evaluate(() => {
    (window as unknown as Record<string, { releaseWrite: (index?: number) => void }>).__crumbTest.releaseWrite(0);
  });

  await expect.poll(async () => (await appStub(page)).writeCalls[0].status).toBe('resolved');
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(tab(page, 'wq-edit.ts').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('// second');
});

test('unsupported Ex quit and write-quit forms never perform host actions', async ({ page }) => {
  await openApp(page, { vim: true, saveResult: '/tmp/unsupported-ex.ts' });
  await newFile(page);
  await appendAtEnd(page, ' changed');

  for (const command of ['1q', 'q other', 'q!!', 'wq!', 'wq other', '1wq']) {
    await runEx(page, command);
  }

  await page.waitForTimeout(100);
  const snapshot = await appStub(page);
  expect(snapshot.saveCalls).toBe(0);
  expect(snapshot.writeCalls).toHaveLength(0);
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(tab(page, 'Untitled').locator('.editor-tab-dirty')).toHaveCount(1);
  await expect(page.locator('[role="dialog"][aria-label="Unsaved changes"]')).toHaveCount(0);
});

test(':q closes only the originating pane occurrence of a shared tab', async ({ page }) => {
  await openApp(page, { vim: true, files: { '/tmp/shared.ts': 'const shared = 1;\n' } });
  await openFileViaShortcut(page, '/tmp/shared.ts');
  await focusEditor(page);

  await page.keyboard.press('Control+Shift+p');
  await page.locator('.palette-input').fill('open active file in split');
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor-pane')).toHaveCount(2);
  await expect(page.locator('.editor-tab')).toHaveCount(2);

  // Run :q in the second pane; the first pane must keep its occurrence.
  const splitPane = page.locator('.editor-pane').nth(1);
  await splitPane.locator('.cm-content').click();
  await expect(splitPane.locator('.cm-content')).toBeFocused();
  await page.keyboard.type(':q');
  await page.keyboard.press('Enter');

  await expect(page.locator('.editor-pane')).toHaveCount(1);
  await expect(page.locator('.editor-tab')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('const shared = 1;');
});
