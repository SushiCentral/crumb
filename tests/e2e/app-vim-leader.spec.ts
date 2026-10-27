import { expect, test, type Page } from '@playwright/test';
import {
  appStub,
  focusEditor,
  newFile,
  openApp,
  openFileViaShortcut,
  tab,
} from './app-vim-helpers';

async function pressLeader(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

async function appendAtEnd(page: Page, text: string): Promise<void> {
  await focusEditor(page);
  await page.keyboard.press('A');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

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

  test('an incomplete leader reveals the grouped guide after 200ms and filters by prefix', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    const guide = page.locator('.vim-leader-guide');

    await page.keyboard.press('Space');
    await expect(guide).toHaveCount(0);
    await page.waitForTimeout(100);
    await expect(guide).toHaveCount(0);

    await expect(guide).toBeVisible({ timeout: 2000 });
    await expect(guide.locator('.vim-leader-guide-context kbd')).toHaveText(['Space']);
    // One row per group (f/b/s/u) plus the three direct actions; the group
    // rows replace every descendant action below them.
    await expect(guide.locator('.vim-leader-guide-row')).toHaveCount(7);
    expect(sorted(await guide.locator('.vim-leader-guide-key').allTextContents()))
      .toEqual(sorted(['Space', 'E / e', '/', 'f', 'b', 's', 'u']));
    expect(sorted((await guide.locator('.vim-leader-guide-group-label').allTextContents())
      .map(text => text.replace('GROUP', '').trim())))
      .toEqual(sorted(['Files', 'Buffers', 'Search', 'UI']));
    await expect(guide.locator('.vim-leader-guide-group-badge')).toHaveText(['GROUP', 'GROUP', 'GROUP', 'GROUP']);
    await expect(guide).not.toContainText('More');
    // `e`/`E` remains a single merged alias row.
    await expect(guide.locator('.vim-leader-guide-key').filter({ hasText: /^E \/ e$/ })).toHaveCount(1);
    await expect(guide).not.toContainText('Save file');
    await expect(guide).not.toContainText('Quick Open');

    await page.keyboard.press('f');
    await expect(guide.locator('.vim-leader-guide-context kbd')).toHaveText(['Space', 'f']);
    await expect(guide.locator('.vim-leader-guide-group-heading')).toHaveText('Files');
    // Immediate next keys only, with case-sensitive rows for s/S.
    expect(sorted(await guide.locator('.vim-leader-guide-key').allTextContents()))
      .toEqual(sorted(['f', 's', 'S']));
    expect(sorted(await guide.locator('.vim-leader-guide-action').allTextContents()))
      .toEqual(sorted(['Quick Open', 'Save file', 'Save all']));
    await expect(guide).not.toContainText('File tree');

    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
  });

  test('leader guide groups show only their immediate next keys', async ({ page }) => {
    await openApp(page, { vim: true });
    await newFile(page);
    await focusEditor(page);
    const guide = page.locator('.vim-leader-guide');

    const groups = [
      { key: 'b', heading: 'Buffers', keys: ['d', 'D'], actions: ['Close tab', 'Force close tab'] },
      { key: 's', heading: 'Search', keys: ['w', 'h'], actions: ['Search word', 'Clear search highlight'] },
      { key: 'u', heading: 'UI', keys: ['w', 'n'], actions: ['Word wrap', 'Line numbers'] },
    ];

    for (const group of groups) {
      await page.keyboard.press('Escape');
      await pressLeader(page, 'Space', group.key);
      await expect(guide).toBeVisible({ timeout: 2000 });
      await expect(guide.locator('.vim-leader-guide-context kbd')).toHaveText(['Space', group.key]);
      await expect(guide.locator('.vim-leader-guide-group-heading')).toHaveText(group.heading);
      expect(sorted(await guide.locator('.vim-leader-guide-key').allTextContents()))
        .toEqual(sorted(group.keys));
      expect(sorted(await guide.locator('.vim-leader-guide-action').allTextContents()))
        .toEqual(sorted(group.actions));
      await expect(guide).not.toContainText('More');
    }

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
    // Completing just before the 200ms reveal boundary must still keep the
    // guide hidden.
    await page.waitForTimeout(100);
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
    // Longer than the leader's 10000ms default. The guide appears after 200ms
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

  test('Space f s saves the active file', async ({ page }) => {
    await openApp(page, {
      vim: true,
      files: { '/tmp/leader-save.ts': 'const value = 1;\n' },
    });
    await openFileViaShortcut(page, '/tmp/leader-save.ts');
    await appendAtEnd(page, ' // edited');

    const dirty = tab(page, 'leader-save.ts').locator('.editor-tab-dirty');
    await expect(dirty).toHaveCount(1);

    await pressLeader(page, 'Space', 'f', 's');

    await expect.poll(async () => (await appStub(page)).writeCalls.length).toBe(1);
    const write = (await appStub(page)).writeCalls[0];
    expect(write).toMatchObject({ path: '/tmp/leader-save.ts', status: 'resolved' });
    expect(write.content).toContain('// edited');
    await expect(dirty).toHaveCount(0);
  });

  test('Space f S saves every dirty named tab', async ({ page }) => {
    await openApp(page, {
      vim: true,
      files: {
        '/tmp/leader-save-all-a.ts': 'const a = 1;\n',
        '/tmp/leader-save-all-b.ts': 'const b = 1;\n',
      },
    });
    await openFileViaShortcut(page, '/tmp/leader-save-all-a.ts');
    await openFileViaShortcut(page, '/tmp/leader-save-all-b.ts');
    await appendAtEnd(page, ' // b');
    await page.locator('.editor-tab-label').filter({ hasText: 'leader-save-all-a.ts' }).click();
    await appendAtEnd(page, ' // a');

    const dirtyA = tab(page, 'leader-save-all-a.ts').locator('.editor-tab-dirty');
    const dirtyB = tab(page, 'leader-save-all-b.ts').locator('.editor-tab-dirty');
    await expect(dirtyA).toHaveCount(1);
    await expect(dirtyB).toHaveCount(1);

    await pressLeader(page, 'Space', 'f', 'S');

    await expect.poll(async () => (await appStub(page)).writeCalls.length).toBe(2);
    const writes = (await appStub(page)).writeCalls;
    expect(sorted(writes.map(write => write.path)))
      .toEqual(sorted(['/tmp/leader-save-all-a.ts', '/tmp/leader-save-all-b.ts']));
    for (const write of writes) expect(write.status).toBe('resolved');
    expect(writes.find(write => write.path.endsWith('a.ts'))?.content).toContain('// a');
    expect(writes.find(write => write.path.endsWith('b.ts'))?.content).toContain('// b');
    await expect(dirtyA).toHaveCount(0);
    await expect(dirtyB).toHaveCount(0);
  });

  test('Space b d protects a dirty buffer behind the unsaved-changes prompt', async ({ page }) => {
    await openApp(page, {
      vim: true,
      files: { '/tmp/leader-close.ts': 'const close = 1;\n' },
    });
    await openFileViaShortcut(page, '/tmp/leader-close.ts');
    await appendAtEnd(page, ' // dirty');

    await expect(tab(page, 'leader-close.ts').locator('.editor-tab-dirty')).toHaveCount(1);

    await pressLeader(page, 'Space', 'b', 'd');

    const dialog = page.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(dialog).toBeVisible();
    await expect(tab(page, 'leader-close.ts')).toHaveCount(1);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(tab(page, 'leader-close.ts')).toHaveCount(1);
    await expect(tab(page, 'leader-close.ts').locator('.editor-tab-dirty')).toHaveCount(1);
    expect((await appStub(page)).writeCalls).toHaveLength(0);
  });

  test('Space b D discards and closes a dirty buffer without prompting', async ({ page }) => {
    await openApp(page, {
      vim: true,
      files: { '/tmp/leader-discard.ts': 'const discard = 1;\n' },
    });
    await openFileViaShortcut(page, '/tmp/leader-discard.ts');
    await appendAtEnd(page, ' // dirty');

    await expect(tab(page, 'leader-discard.ts').locator('.editor-tab-dirty')).toHaveCount(1);

    await pressLeader(page, 'Space', 'b', 'D');

    await expect(page.locator('.editor-tab')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toHaveCount(0);
    expect((await appStub(page)).writeCalls).toHaveLength(0);
  });

  test('Space s w searches the workspace for the cursor word even when Search is already mounted', async ({ page }) => {
    const workspace = '/workspace';
    const editorFile = `${workspace}/leader-word.ts`;
    const otherFile = `${workspace}/leader-word-other.ts`;

    await openApp(page, {
      vim: true,
      openQueue: [workspace],
      files: {
        [editorFile]: 'needle = 1;\nconst value = 2;\nconst needleTwo = 3;\n',
        [otherFile]: 'const needle = 4;\nconst needleThree = 5;\n',
      },
    });
    await page.getByRole('button', { name: 'Open Folder…' }).first().click();
    await expect(page.locator('.tree-entry').filter({ hasText: 'leader-word.ts' })).toBeVisible();
    await openFileViaShortcut(page, editorFile);
    await focusEditor(page);
    // focusEditor clicks the content and can leave the cursor on the empty
    // trailing line. Start explicitly on the intended word.
    await page.keyboard.type('gg0');

    // Mount Search first with an empty query, then return to the Vim editor.
    await page.keyboard.press('Control+Shift+f');
    const input = page.locator('.search-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cm-content')).toBeFocused();
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
    await page.keyboard.type('gg0');

    await pressLeader(page, 'Space', 's', 'w');

    await expect(page.locator('.search-panel')).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('needle');
    // Workspace search remains literal: no regex mode is enabled implicitly.
    await expect(page.getByTitle('Use Regular Expression (Alt+R)')).not.toHaveClass(/active/);
    const rows = page.locator('.search-match-row');
    await expect(rows).toHaveCount(4);
    expect(sorted(await rows.locator('.search-line-snippet').allTextContents()))
      .toEqual(sorted([
        'needle = 1;',
        'const needleTwo = 3;',
        'const needle = 4;',
        'const needleThree = 5;',
      ]));

    // Hide the whole sidebar with Search still mounted (Ctrl+B), then invoke
    // the action from the editor to reopen and repopulate it.
    await page.keyboard.press('Control+b');
    await expect(page.locator('.resize-handle.vertical')).toHaveCount(0);
    await expect(page.locator('.search-panel')).toHaveCount(1);
    await focusEditor(page);
    await page.keyboard.type('gg0');

    await pressLeader(page, 'Space', 's', 'w');

    await expect(page.locator('.resize-handle.vertical')).toBeVisible();
    await expect(page.locator('.search-panel')).toBeVisible();
    await expect(page.locator('.search-input')).toBeFocused();
    await expect(page.locator('.search-input')).toHaveValue('needle');
    await expect(page.locator('.search-match-row')).toHaveCount(4);
  });

  test('Space s h clears Vim search highlights while n and N still navigate', async ({ page }) => {
    await openApp(page, {
      vim: true,
      files: {
        '/tmp/leader-clear.ts': 'alpha needle one\nbeta needle two\ngamma needle three\n',
      },
    });
    await openFileViaShortcut(page, '/tmp/leader-clear.ts');
    await focusEditor(page);
    await page.keyboard.press('0');

    await page.keyboard.type('/needle');
    await page.keyboard.press('Enter');
    await expect(page.locator('.status-bar')).toContainText('Ln 1');
    await expect(page.locator('.cm-searchMatch').first()).toBeVisible();

    await pressLeader(page, 'Space', 's', 'h');

    await expect(page.locator('.cm-searchMatch')).toHaveCount(0);
    // Clearing the paint must not clear the search query or n/N navigation.
    await page.keyboard.press('n');
    await expect(page.locator('.status-bar')).toContainText('Ln 2');
    await expect(page.locator('.cm-searchMatch').first()).toBeVisible();

    await page.keyboard.press('N');
    await expect(page.locator('.status-bar')).toContainText('Ln 1');
  });

  test('Space u w toggles word wrap and persists the preference', async ({ page }) => {
    await openApp(page, {
      vim: true,
      files: { '/tmp/leader-wrap.ts': 'const wrap = 1;\n' },
    });
    await openFileViaShortcut(page, '/tmp/leader-wrap.ts');
    await focusEditor(page);
    await expect(page.locator('.status-bar')).toContainText('Wrap: On');

    await pressLeader(page, 'Space', 'u', 'w');
    await expect(page.locator('.status-bar')).toContainText('Wrap: Off');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('crumb.wordWrap'))).toBe('false');

    await pressLeader(page, 'Space', 'u', 'w');
    await expect(page.locator('.status-bar')).toContainText('Wrap: On');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('crumb.wordWrap'))).toBe('true');
  });

  test('Space u n toggles persisted line numbers', async ({ page }) => {
    await openApp(page, {
      vim: true,
      files: { '/tmp/leader-numbers.ts': 'const numbers = 1;\n' },
    });
    await openFileViaShortcut(page, '/tmp/leader-numbers.ts');
    await focusEditor(page);
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(1);

    await pressLeader(page, 'Space', 'u', 'n');
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('crumb.lineNumbers'))).toBe('false');

    // The preference survives a reload, not just the current editor instance.
    await page.reload();
    await newFile(page);
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('crumb.lineNumbers'))).toBe('false');
  });
});
