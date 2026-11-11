import { expect, test, type Page } from '@playwright/test';
import {
  focusEditor,
  openApp,
  openFileViaShortcut,
} from './app-vim-helpers';

/**
 * Keyboard model for the Search in Files sidebar and the Ctrl+Shift+E/F and
 * Ctrl+B family.
 *
 * TDD contract (RED against the current implementation):
 * - Escape in the query input restores the active editor without closing Search.
 * - ArrowDown from the query enters the first match; Up/Down move between
 *   matches; Enter opens the focused match at its line and focuses the editor;
 *   Escape from the match list returns to the editor.
 * - Ctrl+Shift+E opens the Explorer, selects it instead when Search is active,
 *   and closes it when Explorer is already the active tab. It works from a
 *   focused Vim Normal or Insert editor, the Search query input, and a closed
 *   sidebar.
 * - Ctrl+Shift+F opens Search and focuses its query; when Search is already the
 *   active tab it closes the sidebar and restores editor focus.
 * - Plain Ctrl+E no longer toggles either sidebar. Meta/Super+E variants do not
 *   toggle either.
 * - Ctrl+B toggles sidebar visibility without changing the active tab. It works
 *   from the Search query and a focused Vim editor, where it supersedes Vim's
 *   Ctrl-B page-back. Ctrl+Shift+B must not toggle; Cmd+B keeps working.
 *
 * All flows run with Vim enabled so shortcut routing and focus restoration are
 * exercised in the same editor context users invoke them from.
 */

const WORKSPACE = '/workspace';
const EDITOR_FILE = `${WORKSPACE}/scratch-editor.ts`;
const SEARCH_FILE = `${WORKSPACE}/keyboard-search.ts`;
const EDITOR_CONTENT = 'const scratch = 0;\n';
// Three deterministic matches on lines 3, 4, and 5.
const SEARCH_CONTENT = [
  'const alpha = 0;',
  '// search fixture',
  'const needleOne = 1;',
  'const needleTwo = 2;',
  'const needleThree = 3;',
  'const omega = 4;',
].join('\n');

const SEARCH_MATCHES = 3;
const LONG_DOC_LINES = 160;
const LONG_DOC = Array.from({ length: LONG_DOC_LINES }, (_, index) => `line ${index + 1}`).join('\n');

function activeEditorContent(page: Page) {
  return page.locator('.editor-pane.active .cm-content');
}

function sidebarResizeHandle(page: Page) {
  return page.locator('.resize-handle.vertical');
}

function explorerButton(page: Page) {
  return page.getByRole('button', { name: 'Toggle file explorer' });
}

function searchButton(page: Page) {
  return page.getByRole('button', { name: 'Toggle search in files' });
}

async function openWorkspaceAndEditor(page: Page): Promise<void> {
  await openApp(page, {
    vim: true,
    openQueue: [WORKSPACE],
    files: {
      [EDITOR_FILE]: EDITOR_CONTENT,
      [SEARCH_FILE]: SEARCH_CONTENT,
    },
  });
  await page.getByRole('button', { name: 'Open Folder…' }).first().click();
  await expect(page.locator('.tree-entry').filter({ hasText: 'scratch-editor.ts' })).toBeVisible();
  await openFileViaShortcut(page, EDITOR_FILE);
  await focusEditor(page);
}

async function searchForNeedle(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+f');
  const input = page.locator('.search-input');
  await expect(input).toBeFocused();
  await input.fill('needle');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search-match-row')).toHaveCount(SEARCH_MATCHES);
  await expect(input).toBeFocused();
}

async function closeExplorerWithActivityButton(page: Page): Promise<void> {
  if (await page.locator('.file-explorer').isVisible()) {
    // Keep setup independent of the Ctrl+B contract under test.
    await explorerButton(page).click();
  }
  await expect(sidebarResizeHandle(page)).toHaveCount(0);
}

test.describe('Search in Files keyboard focus', () => {
  test('Escape in the query returns focus to the active Vim editor without closing Search', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);

    await page.keyboard.press('Escape');

    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');

    // Search stays available: same query, same results, sidebar still open.
    await expect(page.locator('.search-input')).toBeVisible();
    await expect(page.locator('.search-input')).toHaveValue('needle');
    await expect(page.locator('.search-match-row')).toHaveCount(SEARCH_MATCHES);
    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(searchButton(page)).toHaveClass(/active/);
  });

  test('ArrowDown enters matches and Up/Down move the active descendant', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);

    const input = page.locator('.search-input');
    const rows = page.locator('.search-match-row');
    const expectActiveMatch = async (index: number) => {
      await expect(input).toBeFocused();
      const activeId = await input.getAttribute('aria-activedescendant');
      expect(activeId).toBeTruthy();
      await expect(rows.nth(index)).toHaveAttribute('id', activeId!);
      await expect(rows.nth(index)).toHaveAttribute('aria-selected', 'true');
    };

    await page.keyboard.press('ArrowDown');
    await expectActiveMatch(0);

    await page.keyboard.press('ArrowDown');
    await expectActiveMatch(1);

    await page.keyboard.press('ArrowDown');
    await expectActiveMatch(2);

    await page.keyboard.press('ArrowUp');
    await expectActiveMatch(1);

    await page.keyboard.press('ArrowUp');
    await expectActiveMatch(0);
  });

  test('Enter opens the focused match at its line and focuses the Vim editor', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);

    // Second match: "const needleTwo = 2;" on line 4.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const input = page.locator('.search-input');
    await expect(input).toBeFocused();
    const activeId = await input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    await expect(page.locator('.search-match-row').nth(1)).toHaveAttribute('id', activeId!);

    await page.keyboard.press('Enter');

    await expect(page.locator('.editor-tab')).toHaveCount(2);
    await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText(/keyboard-search\.ts/);
    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.status-bar')).toContainText('Ln 4, Col 1');
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
  });

  test('Escape from a focused match returns focus to the active Vim editor', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.search-input')).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
    // Exiting the match list must not tear down Search.
    await expect(page.locator('.search-input')).toBeVisible();
    await expect(page.locator('.search-match-row')).toHaveCount(SEARCH_MATCHES);
  });
});

test.describe('Ctrl+Shift+E Explorer toggle', () => {
  test('Ctrl+Shift+E opens Explorer from a closed sidebar and closes it on the next press', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await closeExplorerWithActivityButton(page);
    await focusEditor(page);
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');

    await page.keyboard.press('Control+Shift+E');

    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(page.locator('.file-explorer')).toBeVisible();
    await expect(explorerButton(page)).toHaveClass(/active/);

    await page.keyboard.press('Control+Shift+E');

    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(explorerButton(page)).not.toHaveClass(/active/);
  });

  test('Ctrl+Shift+E opens Explorer from a focused Vim Insert editor', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await closeExplorerWithActivityButton(page);
    await focusEditor(page);
    await page.keyboard.press('i');
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: insert');

    await page.keyboard.press('Control+Shift+E');

    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(page.locator('.file-explorer')).toBeVisible();
    await expect(explorerButton(page)).toHaveClass(/active/);
    // The shortcut must not leave an "e" in the document.
    await expect(page.locator('.cm-content')).toHaveText('const scratch = 0;');
  });

  test('Ctrl+Shift+E selects Explorer instead of closing the sidebar while Search is active', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);
    await expect(searchButton(page)).toHaveClass(/active/);
    await expect(page.locator('.search-input')).toBeFocused();

    await page.keyboard.press('Control+Shift+E');

    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(page.locator('.file-explorer')).toBeVisible();
    await expect(page.locator('.search-panel')).toHaveCount(0);
    await expect(explorerButton(page)).toHaveClass(/active/);
    await expect(searchButton(page)).not.toHaveClass(/active/);
  });

  test('plain Ctrl+E and Meta+Shift+E no longer toggle the Explorer', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await closeExplorerWithActivityButton(page);
    await focusEditor(page);

    await page.keyboard.press('Control+e');
    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(explorerButton(page)).not.toHaveClass(/active/);

    await page.keyboard.press('Meta+Shift+e');
    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(explorerButton(page)).not.toHaveClass(/active/);
  });
});

test.describe('Ctrl+Shift+F Search toggle', () => {
  test('Ctrl+Shift+F opens Search and focuses the query from a Vim editor', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await closeExplorerWithActivityButton(page);
    await focusEditor(page);

    await page.keyboard.press('Control+Shift+F');

    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(page.locator('.search-panel')).toBeVisible();
    await expect(page.locator('.search-input')).toBeFocused();
    await expect(page.locator('.cm-content')).not.toBeFocused();
    await expect(searchButton(page)).toHaveClass(/active/);
    await expect(explorerButton(page)).not.toHaveClass(/active/);
    // The editor must not have received the shortcut as text.
    await expect(page.locator('.cm-content')).toHaveText('const scratch = 0;');
  });

  test('Ctrl+Shift+F closes Search and restores the active Vim editor when Search is active', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);
    await expect(page.locator('.search-input')).toBeFocused();

    await page.keyboard.press('Control+Shift+F');

    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(page.locator('.search-input')).toBeHidden();
    await expect(searchButton(page)).not.toHaveClass(/active/);
    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
  });

  test('Ctrl+Shift+F closes Search when focus already returned to the editor', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);

    // Escape/return-to-editor leaves Search as the active tab; the toggle must
    // key off the Search tab rather than current focus alone.
    await page.keyboard.press('Escape');
    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.search-input')).toBeVisible();

    await page.keyboard.press('Control+Shift+F');

    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(searchButton(page)).not.toHaveClass(/active/);
    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
  });

  test('Meta+Shift+F does not toggle Search', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await closeExplorerWithActivityButton(page);
    await focusEditor(page);

    await page.keyboard.press('Meta+Shift+f');

    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(page.locator('.search-panel')).toHaveCount(0);
    await expect(searchButton(page)).not.toHaveClass(/active/);
  });
});

test.describe('Ctrl+B sidebar visibility toggle', () => {
  test('Ctrl+B toggles Explorer and Search without changing the active tab', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await expect(explorerButton(page)).toHaveClass(/active/);

    await page.keyboard.press('Control+b');
    await expect(sidebarResizeHandle(page)).toHaveCount(0);

    await page.keyboard.press('Control+b');
    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(page.locator('.file-explorer')).toBeVisible();
    await expect(explorerButton(page)).toHaveClass(/active/);

    await page.keyboard.press('Control+Shift+F');
    await expect(searchButton(page)).toHaveClass(/active/);

    await page.keyboard.press('Control+b');
    await expect(sidebarResizeHandle(page)).toHaveCount(0);

    await page.keyboard.press('Control+b');
    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(page.locator('.search-panel')).toBeVisible();
    await expect(searchButton(page)).toHaveClass(/active/);
  });

  test('Ctrl+B works from the Search query and returns focus to the editor on close', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await searchForNeedle(page);
    await expect(page.locator('.search-input')).toBeFocused();

    await page.keyboard.press('Control+b');

    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(searchButton(page)).not.toHaveClass(/active/);
    await expect(activeEditorContent(page)).toBeFocused();
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');
  });

  test('Ctrl+B works from a focused Vim editor and does not become Ctrl-B page-back', async ({ page }) => {
    await openApp(page, {
      vim: true,
      openQueue: ['/tmp/long-pageback.ts'],
      files: { '/tmp/long-pageback.ts': LONG_DOC },
    });
    await openFileViaShortcut(page, '/tmp/long-pageback.ts');
    await focusEditor(page);

    await page.keyboard.type('G');
    await expect(page.locator('.status-bar')).toContainText(`Ln ${LONG_DOC_LINES}`);
    await expect(page.locator('.vim-status')).toHaveAttribute('aria-label', 'Vim mode: normal');

    await page.keyboard.press('Control+b');

    await expect(sidebarResizeHandle(page)).toHaveCount(0);
    await expect(page.locator('.status-bar')).toContainText(`Ln ${LONG_DOC_LINES}`);
    await expect(page.locator('.cm-line').last()).toHaveText(`line ${LONG_DOC_LINES}`);
  });

  test('Ctrl+Shift+B does not toggle the sidebar', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await expect(sidebarResizeHandle(page)).toBeVisible();

    await page.keyboard.press('Control+Shift+B');

    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(explorerButton(page)).toHaveClass(/active/);
  });

  test('Cmd+B keeps toggling the sidebar', async ({ page }) => {
    await openWorkspaceAndEditor(page);
    await closeExplorerWithActivityButton(page);
    await focusEditor(page);

    await page.keyboard.press('Meta+b');

    await expect(sidebarResizeHandle(page)).toBeVisible();
    await expect(explorerButton(page)).toHaveClass(/active/);
  });
});
