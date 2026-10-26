import { expect, test, type Locator, type Page } from '@playwright/test';

// These tests mount the real `Editor` component in React with its normal
// preference props. The fixture does not use Tauri APIs.
const FIXTURE = '/tests/e2e/editor-component-fixture.html';

interface FixtureState {
  activeTabId: string;
  enabled: boolean;
  doc: string;
  tabs: Record<string, string>;
  cursor: { line: number; column: number; selected: number };
  themeId: string;
  undoDepth: number;
  mode: string;
  vimState: { mode: string; pending: string } | null;
}

async function openEditor(page: Page, options: { a?: string; b?: string; vim?: boolean } = {}): Promise<Locator> {
  const params = new URLSearchParams();
  if (options.a !== undefined) params.set('a', options.a);
  if (options.b !== undefined) params.set('b', options.b);
  if (options.vim) params.set('vim', '1');
  await page.goto(`${FIXTURE}?${params.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.locator('.cm-content').click({ position: { x: 8, y: 8 } });
  await expect(editor.locator('.cm-content')).toBeVisible();
  return editor;
}

async function state(page: Page): Promise<FixtureState> {
  return page.evaluate(() => (window as unknown as Record<string, any>).__crumbEditor.getState());
}

async function expectState(page: Page, expected: Partial<FixtureState>): Promise<void> {
  await expect.poll(async () => state(page)).toMatchObject(expected);
}

async function setVimEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(value => (window as unknown as Record<string, any>).__crumbEditor.setVimEnabled(value), enabled);
}

async function setPreference(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(([name, next]) => (window as unknown as Record<string, any>).__crumbEditor.setPreference(name, next), [key, value]);
}

async function setTheme(page: Page, id: string): Promise<void> {
  await page.evaluate(themeId => (window as unknown as Record<string, any>).__crumbEditor.setTheme(themeId), id);
}

async function switchTab(page: Page, id: string): Promise<void> {
  await page.evaluate(tabId => (window as unknown as Record<string, any>).__crumbEditor.switchTab(tabId), id);
}

async function moveToStart(page: Page, vim: boolean): Promise<void> {
  if (vim) await page.keyboard.type('gg');
  else await page.keyboard.press('Control+Home');
}

test('Vim is off by default and ordinary typing is unchanged', async ({ page }) => {
  const editor = await openEditor(page, { a: '' });

  await expectState(page, { enabled: false, mode: 'inactive' });
  await page.keyboard.type('iabc');

  await expect(editor.locator('.cm-content')).toHaveText('iabc');
  await expectState(page, { doc: 'iabc', mode: 'inactive' });
});

test('enabling Vim preserves the document, cursor, and CodeMirror history', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha', vim: false });

  await page.keyboard.press('Control+End');
  await page.keyboard.type('X');
  const beforeToggle = await state(page);
  expect(beforeToggle.doc).toBe('alphaX');
  expect(beforeToggle.undoDepth).toBeGreaterThan(0);

  await setVimEnabled(page, true);
  await expectState(page, {
    enabled: true,
    mode: 'normal',
    doc: 'alphaX',
    cursor: beforeToggle.cursor,
    undoDepth: beforeToggle.undoDepth,
  });

  await page.keyboard.type('gg');
  await page.keyboard.type('iZ');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.cm-content')).toHaveText('ZalphaX');

  await page.keyboard.press('u');
  await expectState(page, { doc: 'alphaX' });
  await page.keyboard.press('u');
  await expectState(page, { doc: 'alpha' });
});

test('disabling Vim preserves editing state and restores ordinary typing', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha', vim: true });

  await page.keyboard.type('gg');
  await page.keyboard.type('iX');
  await page.keyboard.press('Escape');
  await expectState(page, { doc: 'Xalpha', mode: 'normal' });
  const beforeToggle = await state(page);

  await setVimEnabled(page, false);
  await expectState(page, {
    enabled: false,
    mode: 'inactive',
    doc: 'Xalpha',
    cursor: beforeToggle.cursor,
    undoDepth: beforeToggle.undoDepth,
  });

  await page.keyboard.press('End');
  await page.keyboard.type('Z');
  await expect(editor.locator('.cm-content')).toHaveText('XalphaZ');

  await page.keyboard.press('Control+z');
  await expectState(page, { doc: 'Xalpha' });
  await page.keyboard.press('Control+z');
  await expectState(page, { doc: 'alpha' });
});

test('switching tabs cancels transient input, starts in Normal, and isolates state', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha beta', b: 'one two', vim: true });

  await page.keyboard.type('gg');
  await page.keyboard.type('d');
  await expectState(page, { doc: 'alpha beta', mode: 'normal' });

  await switchTab(page, 'B');
  await expectState(page, { activeTabId: 'B', mode: 'normal', doc: 'one two' });

  await page.keyboard.type('w');
  await expectState(page, { doc: 'one two' });

  await page.keyboard.type('gg');
  await page.keyboard.type('iZ');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.cm-content')).toHaveText('Zone two');

  await switchTab(page, 'A');
  await expectState(page, { activeTabId: 'A', mode: 'normal', doc: 'alpha beta' });
  await page.keyboard.type('gg');
  await page.keyboard.type('x');
  await expect(editor.locator('.cm-content')).toHaveText('lpha beta');
  await expectState(page, { tabs: { A: 'lpha beta', B: 'Zone two' } });
});

test('cached tabs reflect a Vim enable made while another tab was active', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha', b: 'beta', vim: false });

  await switchTab(page, 'B');
  await setVimEnabled(page, true);
  await switchTab(page, 'A');

  await expectState(page, { activeTabId: 'A', enabled: true, mode: 'normal' });
  await page.keyboard.type('gg');
  await page.keyboard.type('iZ');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.cm-content')).toHaveText('Zalpha');
});

test('cached tabs reflect a Vim disable made while another tab was active', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha', b: 'beta', vim: true });

  await switchTab(page, 'B');
  await setVimEnabled(page, false);
  await switchTab(page, 'A');

  await expectState(page, { activeTabId: 'A', enabled: false, mode: 'inactive', doc: 'alpha' });
  await page.keyboard.type('iZ');
  await expect(editor.locator('.cm-content')).toHaveText('iZalpha');
});

test('focus repair from a disabled editor does not steal focus when Vim is enabled', async ({ page }) => {
  await openEditor(page, { a: 'alpha', vim: false });
  const external = page.getByTestId('external-input');

  await external.focus();
  await expect(external).toBeFocused();

  await setVimEnabled(page, true);
  await expectState(page, { enabled: true, mode: 'normal' });
  await expect(external).toBeFocused();
});

test('ordinary edits while Vim is disabled invalidate stale mark positions', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha beta gamma', vim: true });

  await page.keyboard.type('gg');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await expectState(page, { cursor: { line: 1, column: 7, selected: 0 } });

  await setVimEnabled(page, false);
  await expectState(page, { mode: 'inactive' });
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('ZZ ');
  await expect(editor.locator('.cm-content')).toHaveText('ZZ alpha beta gamma');

  await setVimEnabled(page, true);
  await expectState(page, { mode: 'normal' });
  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectState(page, { cursor: { line: 1, column: 1, selected: 0 } });
});

test('theme and ordinary preference changes do not reset pending Vim input', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha beta gamma', vim: true });

  await page.keyboard.type('gg');
  await page.keyboard.type('d');
  await expectState(page, { doc: 'alpha beta gamma', mode: 'normal' });

  await setTheme(page, 'one-dark');
  await setPreference(page, 'lineNumbers', false);
  await setPreference(page, 'highlightActiveLine', false);
  await expectState(page, { themeId: 'one-dark', doc: 'alpha beta gamma', enabled: true });

  await page.keyboard.type('w');
  await expect(editor.locator('.cm-content')).toHaveText('beta gamma');
});

test('Tab does not run indentWithTab in Normal or Visual mode', async ({ page }) => {
  await openEditor(page, { a: 'alpha\nbeta', vim: true });

  await page.keyboard.type('gg');
  await page.keyboard.press('Tab');
  await expectState(page, { doc: 'alpha\nbeta', mode: 'normal' });

  await page.keyboard.type('V');
  await expectState(page, { mode: 'visual-line' });
  await page.keyboard.press('Tab');
  await expectState(page, { doc: 'alpha\nbeta', mode: 'visual-line' });
});

test('Tab retains Insert-mode indentation', async ({ page }) => {
  await openEditor(page, { a: 'alpha', vim: true });

  await page.keyboard.type('gg');
  await page.keyboard.type('i');
  await expectState(page, { mode: 'insert' });

  await page.keyboard.press('Tab');
  await expectState(page, { doc: '  alpha', mode: 'insert' });

  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  await expectState(page, { doc: '  Xalpha', mode: 'normal' });
});

test('Editor forwards typed Vim mode and pending state updates', async ({ page }) => {
  await openEditor(page, { a: 'alpha beta', vim: true });
  await expectState(page, { vimState: { mode: 'normal', pending: '' } });

  await page.keyboard.type('d');
  await expectState(page, { vimState: { mode: 'normal', pending: 'd' } });

  await page.keyboard.press('Escape');
  await expectState(page, { vimState: { mode: 'normal', pending: '' } });

  await page.keyboard.type('i');
  await expectState(page, { vimState: { mode: 'insert', pending: '' } });

  await page.keyboard.press('Escape');
  await expectState(page, { vimState: { mode: 'normal', pending: '' } });

  await setVimEnabled(page, false);
  await expectState(page, { vimState: { mode: 'inactive', pending: '' } });
});

test('repeated Vim toggles do not duplicate the extension or lose history', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha', vim: true });

  await page.keyboard.type('gg');
  await page.keyboard.type('iX');
  await page.keyboard.press('Escape');
  const beforeToggles = await state(page);
  expect(beforeToggles.doc).toBe('Xalpha');
  expect(beforeToggles.undoDepth).toBeGreaterThan(0);

  for (let i = 0; i < 3; i += 1) {
    await setVimEnabled(page, false);
    await setVimEnabled(page, true);
  }

  await expectState(page, {
    enabled: true,
    mode: 'normal',
    doc: 'Xalpha',
    undoDepth: beforeToggles.undoDepth,
  });
  expect(await page.locator('.cm-editor').count()).toBe(1);
  expect(await page.locator('.cm-content').count()).toBe(1);
  expect(await page.locator('.cm-vim-panel').count()).toBe(0);

  await page.keyboard.press('u');
  await expectState(page, { doc: 'alpha' });
  await page.keyboard.type('gg');
  await page.keyboard.type('iY');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.cm-content')).toHaveText('Yalpha');
});
