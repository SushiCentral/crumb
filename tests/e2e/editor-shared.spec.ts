import { expect, test, type Locator, type Page } from '@playwright/test';

// Real Editor panes mounted through React. These tests target resources that
// are shared by split panes: Vim mappings, document-owned marks, and teardown.
const FIXTURE = '/tests/e2e/editor-shared-fixture.html';

interface PaneState {
  paneId: string;
  tabId: string | null;
  doc: string;
  tabs: Record<string, string>;
  panes: Array<{ id: string; tabId: string }>;
  openTabIds: string[];
  activePaneId: string | null;
  cursor: { line: number; column: number; selected: number };
  enabled: boolean;
  mode: string;
  undoDepth: number;
}

async function openWorkspace(
  page: Page,
  options: { mode?: 'split' | 'shared' | 'single'; a?: string; b?: string; vim?: boolean; map?: string; strict?: boolean } = {},
): Promise<void> {
  const params = new URLSearchParams();
  params.set('mode', options.mode ?? 'split');
  if (options.a !== undefined) params.set('a', options.a);
  if (options.b !== undefined) params.set('b', options.b);
  if (options.vim) params.set('vim', '1');
  if (options.map) params.set('map', options.map);
  if (options.strict) params.set('strict', '1');
  await page.goto(`${FIXTURE}?${params.toString()}`);
  await expect(page.getByTestId('pane-A').locator('.cm-content')).toBeVisible();
}

function pane(page: Page, id: string): Locator {
  return page.getByTestId(`pane-${id}`);
}

async function state(page: Page, paneId: string): Promise<PaneState> {
  return page.evaluate(id => (window as unknown as Record<string, any>).__crumbEditor.getState(id), paneId);
}

async function expectState(page: Page, paneId: string, expected: Partial<PaneState>): Promise<void> {
  await expect.poll(async () => state(page, paneId)).toMatchObject(expected);
}

async function expectCursor(page: Page, paneId: string, column: number): Promise<void> {
  await expect.poll(async () => (await state(page, paneId)).cursor).toMatchObject({ line: 1, column });
}

async function focusPane(page: Page, paneId: string): Promise<void> {
  await page.evaluate(id => (window as unknown as Record<string, any>).__crumbEditor.focus(id), paneId);
  await expect(pane(page, paneId).locator('.cm-content')).toBeFocused();
}

async function setVimEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(value => (window as unknown as Record<string, any>).__crumbEditor.setVimEnabled(value), enabled);
}

async function switchPaneTab(page: Page, paneId: string, tabId: string): Promise<void> {
  await page.evaluate(([id, tab]) => (window as unknown as Record<string, any>).__crumbEditor.switchPaneTab(id, tab), [paneId, tabId]);
}

async function unmountPane(page: Page, paneId: string): Promise<void> {
  await page.evaluate(id => (window as unknown as Record<string, any>).__crumbEditor.unmountPane(id), paneId);
  await expect(pane(page, paneId)).toHaveCount(0);
}

async function setWorkspace(
  page: Page,
  tabs: Array<{ id: string; content: string }>,
  panes: Array<{ id: string; tabId: string }>,
): Promise<void> {
  await page.evaluate(([nextTabs, nextPanes]) => {
    (window as unknown as Record<string, any>).__crumbEditor.setWorkspace(nextTabs, nextPanes);
  }, [tabs, panes]);
}

test('a configured mapping survives unmounting a sibling Editor pane', async ({ page }) => {
  await openWorkspace(page, { mode: 'split', a: '', b: '', vim: true, map: 'jj' });

  // jj is an Insert-mode mapping to Escape, so MAPPED behavior is observable
  // without relying on a particular Normal-mode default.
  await focusPane(page, 'A');
  await page.keyboard.type('ijj');
  await expectState(page, 'A', { mode: 'normal', doc: '' });

  await unmountPane(page, 'B');
  await focusPane(page, 'A');
  await page.keyboard.type('ijj');
  await expectState(page, 'A', { mode: 'normal', doc: '' });

  // The surviving pane still owns the mapping; if a second removal had
  // uninstalled it, jj would have been inserted and the mode stayed Insert.
  await expect(pane(page, 'A').locator('.cm-content')).toHaveText('');
});

test('repeat stays with the active editor through a global Vim toggle', async ({ page }) => {
  await openWorkspace(page, { mode: 'split', a: 'one two three four', b: 'bravo charlie', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('x');
  await expectState(page, 'A', { doc: 'ne two three four' });

  // B never edits. Under a single command owner it must not publish stale
  // repeat state when Vim is globally disabled and re-enabled.
  await setVimEnabled(page, false);
  await expectState(page, 'A', { mode: 'inactive' });
  await expectState(page, 'B', { mode: 'inactive' });
  await setVimEnabled(page, true);
  await expectState(page, 'A', { mode: 'normal' });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('.');
  await expectState(page, 'A', { doc: 'e two three four' });
  await expectState(page, 'B', { doc: 'bravo charlie' });
});

test('prompt cancellation cannot steal focus or ownership from the incoming pane', async ({ page }) => {
  await openWorkspace(page, { mode: 'split', a: 'alpha beta gamma', b: 'one two three', vim: true });

  await focusPane(page, 'A');
  await expectState(page, 'A', { mode: 'normal' });
  await page.keyboard.type('gg');
  await page.keyboard.type('x');
  await expectState(page, 'A', { mode: 'normal', doc: 'lpha beta gamma' });

  await page.keyboard.press('/');
  await expectState(page, 'A', { mode: 'search' });
  await page.keyboard.type('beta');
  await expectState(page, 'A', { mode: 'search' });

  // Moving focus to B closes A's prompt. CodeMirror's dialog cleanup can try
  // to restore focus to A synchronously; that must not reverse the pending
  // ownership transfer.
  await focusPane(page, 'B');
  await expectState(page, 'B', { mode: 'normal' });

  await page.keyboard.type('.');
  await expectState(page, 'B', { doc: 'ne two three' });
  await expectState(page, 'A', { doc: 'lpha beta gamma' });

  // The captured repeat still belongs to the session after transferring back.
  await focusPane(page, 'A');
  await page.keyboard.type('.');
  await expectState(page, 'A', { doc: 'pha beta gamma' });
});

test('prompt cancellation preserves the global insert payload across focus transfer', async ({ page }) => {
  await openWorkspace(page, { mode: 'split', a: 'alpha beta gamma', b: 'one two three', vim: true });

  await focusPane(page, 'A');
  await expectState(page, 'A', { mode: 'normal' });
  await page.keyboard.type('gg');
  await page.keyboard.type('iXY');
  await page.keyboard.press('Escape');
  await expectState(page, 'A', { mode: 'normal', doc: 'XYalpha beta gamma' });

  await page.keyboard.press('/');
  await expectState(page, 'A', { mode: 'search' });
  await page.keyboard.type('beta');
  await expectState(page, 'A', { mode: 'search' });
  await focusPane(page, 'B');
  await expectState(page, 'B', { mode: 'normal' });

  await page.keyboard.type('.');
  await expectState(page, 'B', { doc: 'XYone two three' });
});

test('mark ownership converges on focus transfer and the latest writer wins', async ({ page }) => {
  await openWorkspace(page, { mode: 'shared', a: 'alpha beta gamma', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg0');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await expectCursor(page, 'A', 7);

  await focusPane(page, 'B');
  await page.keyboard.type('gg0');
  await page.keyboard.type('`a');
  await expectCursor(page, 'B', 7);

  await focusPane(page, 'A');
  await page.keyboard.type('gg0');
  await page.keyboard.type('w');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await focusPane(page, 'B');
  await page.keyboard.type('gg0');
  await page.keyboard.type('`a');
  await expectCursor(page, 'B', 12);
});

test('unmounting the owner captures repeat and marks for the surviving peer', async ({ page }) => {
  await openWorkspace(page, { mode: 'shared', a: 'one two three', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg0');
  await page.keyboard.type('x');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await expectState(page, 'A', { doc: 'ne two three' });
  await expectCursor(page, 'A', 4);

  await unmountPane(page, 'A');
  await focusPane(page, 'B');
  await expectState(page, 'B', { mode: 'normal', doc: 'ne two three' });

  await page.keyboard.type('gg0');
  await page.keyboard.type('`a');
  await expectCursor(page, 'B', 4);

  await page.keyboard.type('gg0');
  await page.keyboard.type('.');
  await expectState(page, 'B', { doc: 'e two three' });
});

test('target tab state is reconciled with current App content before marks restore', async ({ page }) => {
  await openWorkspace(page, { mode: 'shared', a: 'alpha beta gamma', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await expectCursor(page, 'A', 7);

  // B caches S, then moves to T and becomes the active owner there.
  await switchPaneTab(page, 'B', 'T');
  await focusPane(page, 'B');
  await expectState(page, 'B', { doc: 'other', mode: 'normal' });

  // A owns S again and changes its content while B's cached S state stays old.
  await focusPane(page, 'A');
  await page.keyboard.press('A');
  await page.keyboard.type(' tail');
  await page.keyboard.press('Escape');
  const currentDoc = 'alpha beta gamma tail';
  await expectState(page, 'A', { doc: currentDoc });

  // Give T the same prop string as S so a doc-only sync effect cannot notice
  // the tab change. B's cached S state is still the older content.
  await setWorkspace(
    page,
    [{ id: 'S', content: currentDoc }, { id: 'T', content: currentDoc }],
    [{ id: 'A', tabId: 'S' }, { id: 'B', tabId: 'T' }],
  );
  await expectState(page, 'B', { doc: currentDoc });

  await focusPane(page, 'B');
  await switchPaneTab(page, 'B', 'S');
  await expectState(page, 'B', { tabId: 'S', mode: 'normal' });
  await expect(pane(page, 'B').locator('.cm-content')).toHaveText(currentDoc);

  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectCursor(page, 'B', 7);
});

test('replacing panes with unchanged document ids preserves session state', async ({ page }) => {
  await openWorkspace(page, { mode: 'single', a: 'alpha beta gamma', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await expectCursor(page, 'A', 7);

  await setWorkspace(
    page,
    [{ id: 'S', content: 'alpha beta gamma' }, { id: 'T', content: 'other' }],
    [{ id: 'R', tabId: 'S' }],
  );
  await expect(pane(page, 'R').locator('.cm-content')).toBeVisible();
  await focusPane(page, 'R');
  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectCursor(page, 'R', 7);
});

test('StrictMode replay preserves mapping ownership and command-visible marks', async ({ page }) => {
  await openWorkspace(page, { mode: 'split', a: 'alpha beta gamma', b: 'bravo', vim: true, map: 'jj', strict: true });

  await focusPane(page, 'A');
  await page.keyboard.type('ijj');
  await expectState(page, 'A', { mode: 'normal', doc: 'alpha beta gamma' });
  await page.keyboard.type('gg');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');

  await unmountPane(page, 'B');
  await focusPane(page, 'A');
  await page.keyboard.type('ijj');
  await expectState(page, 'A', { mode: 'normal' });

  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectCursor(page, 'A', 7);
});

test('a mark captured by one same-document pane survives a disable/enable of all panes', async ({ page }) => {
  await openWorkspace(page, { mode: 'shared', a: 'alpha beta gamma', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await expectCursor(page, 'A', 7);

  // B shares the document but has no marks of its own.
  await focusPane(page, 'B');
  await setVimEnabled(page, false);
  await expectState(page, 'A', { mode: 'inactive' });
  await expectState(page, 'B', { mode: 'inactive' });
  await setVimEnabled(page, true);
  await expectState(page, 'A', { mode: 'normal' });
  await expectState(page, 'B', { mode: 'normal' });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectCursor(page, 'A', 7);

  // Same-tab splits share the document-owned mark set.
  await focusPane(page, 'B');
  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectCursor(page, 'B', 7);
});

test('same-document panes converge marks on transfer with deterministic latest-writer and repeat state', async ({ page }) => {
  await openWorkspace(page, { mode: 'shared', a: 'alpha beta gamma', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg0');
  await page.keyboard.type('rZ');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await page.keyboard.type('w');
  await page.keyboard.type('mb');
  await expectState(page, 'A', { doc: 'Zlpha beta gamma' });
  await expectCursor(page, 'A', 12);

  // The first ownership transfer restores both marks and repeat into B.
  await focusPane(page, 'B');
  await expectState(page, 'B', { doc: 'Zlpha beta gamma' });
  await page.keyboard.type('gg0');
  await page.keyboard.type('l');
  await page.keyboard.type('.');
  await expectState(page, 'B', { doc: 'ZZpha beta gamma' });

  // B now writes a conflicting a mark at the start.
  await page.keyboard.type('gg0');
  await page.keyboard.type('ma');
  await expectCursor(page, 'B', 1);

  await setVimEnabled(page, false);
  await expectState(page, 'A', { mode: 'inactive' });
  await expectState(page, 'B', { mode: 'inactive' });
  await setVimEnabled(page, true);
  await expectState(page, 'A', { mode: 'normal' });
  await expectState(page, 'B', { mode: 'normal' });

  // b exists only in pane A. The document-owned snapshot retains it while B's
  // later command owns the conflicting a position.
  await focusPane(page, 'A');
  await page.keyboard.type('gg0');
  await page.keyboard.type('`b');
  await expectCursor(page, 'A', 12);

  await page.keyboard.type('gg0');
  await page.keyboard.type('`a');
  await expectCursor(page, 'A', 1);

  await focusPane(page, 'B');
  await page.keyboard.type('gg0');
  await page.keyboard.type('`a');
  await expectCursor(page, 'B', 1);

  // Reverse writer order: A becomes the latest writer of a.
  await focusPane(page, 'A');
  await page.keyboard.type('gg0');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await focusPane(page, 'B');
  await page.keyboard.type('gg0');
  await page.keyboard.type('`a');
  await expectCursor(page, 'B', 7);
});

test('closing the last Editor releases marks so reopening the same document id is clean', async ({ page }) => {
  await openWorkspace(page, { mode: 'single', a: 'alpha beta', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');

  // Tab switch captures S's mark snapshot, then the whole workspace closes.
  await switchPaneTab(page, 'A', 'T');
  await expect(pane(page, 'A').locator('.cm-content')).toHaveText('other');
  await setWorkspace(page, [], []);
  await expect(pane(page, 'A')).toHaveCount(0);

  // Reopen with the same document id but start on the other tab, so switching
  // to S is the first lifecycle event on the new adapter.
  await setWorkspace(
    page,
    [{ id: 'T', content: 'other' }, { id: 'S', content: 'alpha beta' }],
    [{ id: 'A', tabId: 'T' }],
  );
  await expect(pane(page, 'A').locator('.cm-content')).toHaveText('other');
  await switchPaneTab(page, 'A', 'S');
  await expect(pane(page, 'A').locator('.cm-content')).toHaveText('alpha beta');

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectCursor(page, 'A', 1);
});

test('unmounting one pane does not release marks for a document still open elsewhere', async ({ page }) => {
  await openWorkspace(page, { mode: 'shared', a: 'alpha beta gamma', b: 'other', vim: true });

  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('w');
  await page.keyboard.type('ma');
  await expectCursor(page, 'A', 7);

  // Both panes visit S and then move to T. Switching A away captures S's
  // marks; B's cached S state is why unmount cleanup must not release blindly.
  await switchPaneTab(page, 'B', 'T');
  await switchPaneTab(page, 'A', 'T');
  await unmountPane(page, 'B');

  // S is still an open tab and A still has it cached.
  await expectState(page, 'A', { openTabIds: ['S', 'T'], tabId: 'T' });
  await switchPaneTab(page, 'A', 'S');
  await focusPane(page, 'A');
  await page.keyboard.type('gg');
  await page.keyboard.type('`a');
  await expectCursor(page, 'A', 7);
});
