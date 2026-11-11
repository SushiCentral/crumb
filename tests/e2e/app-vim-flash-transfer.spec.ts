import { expect, test, type Page } from '@playwright/test';
import {
  focusEditor,
  openApp,
  openFileViaShortcut,
  tabLabel,
} from './app-vim-helpers';

/**
 * Flash visual previews move the real Vim head. Ownership transfer must
 * normalize that transient preview back to its activation cursor before the
 * session samples the departure, otherwise Ctrl-o asks the source document for
 * the preview line instead of the line the user left from.
 *
 * These run against the real App, Vim engine, and VimSession: one transfer
 * through tab switching and one through an active split pane.
 */

function numbered(prefix: string, total = 100): string[] {
  return Array.from({ length: total }, (_, index) => (
    index === 11
      ? `${prefix} needle preview target ${index + 1}`
      : `${prefix}${String(index + 1).padStart(3, '0')} ....................`
  ));
}

async function startVisualFlashPreview(page: Page): Promise<void> {
  await page.keyboard.type('gg');
  await page.keyboard.press('0');
  await page.keyboard.press('V');
  await page.keyboard.type('sneedle');

  const status = page.locator('.status-bar');
  await expect(status).toContainText('Flash:');
  await expect(status).toContainText('needle');
  await expect(page.locator('.crumb-jump-match').first()).toBeVisible();
  await expect(page.locator('.cm-editor.cm-flash-active')).toHaveCount(1);
  // The preview moved the real Vim head away from the activation line.
  await expect(status).toContainText('Ln 12');
}

/** Read the document line and column that own the live DOM selection. */
async function selectedCursor(
  content: import('@playwright/test').Locator,
): Promise<{ lineText: string | null; ch: number | null }> {
  return content.evaluate(element => {
    const selection = window.getSelection();
    if (!selection || !selection.focusNode) return { lineText: null, ch: null };
    const node = selection.focusNode;
    const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
    const line = parent?.closest('.cm-line') ?? null;
    if (!line) return { lineText: null, ch: null };
    const prefix = document.createRange();
    prefix.selectNodeContents(line);
    try {
      prefix.setEnd(node, selection.focusOffset);
    } catch {
      return { lineText: line.textContent, ch: null };
    }
    return { lineText: line.textContent, ch: prefix.toString().length };
  });
}

test('tab ownership transfer preserves the inclusive charwise Visual column for Ctrl-o', async ({ page }) => {
  const b = numbered('B');
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/flash-transfer-b.ts': b.join('\n'),
      '/tmp/flash-transfer-a.ts': 'alpha beta alpha',
    },
  });
  await openFileViaShortcut(page, '/tmp/flash-transfer-b.ts');
  await openFileViaShortcut(page, '/tmp/flash-transfer-a.ts');
  await focusEditor(page);

  // `vl` leaves the semantic Vim head on ch1 while charwise Visual's
  // CodeMirror head is the exclusive ch2. Flash previews the next match.
  await page.keyboard.press('0');
  await page.keyboard.press('v');
  await page.keyboard.press('l');
  await page.keyboard.type('salpha');

  const status = page.locator('.status-bar');
  await expect(status).toContainText('Flash:');
  await expect(status).toContainText('alpha');
  await expect(page.locator('.crumb-jump-match')).toHaveCount(2);
  await expect.poll(() => selectedCursor(page.locator('.cm-content')))
    .toEqual({ lineText: 'alpha beta alpha', ch: 12 });

  // Activate the other tab without moving DOM focus. A pointer click would
  // blur the editor and let Flash's blur handler normalize the preview before
  // the ownership transition; the App tab activation path is what must be
  // covered here.
  await tabLabel(page, 'flash-transfer-b.ts').evaluate(element => {
    (element as HTMLElement).click();
  });
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-transfer-b.ts');
  await expect(page.locator('.status-bar')).not.toContainText('Flash:');
  await expect(page.locator('.cm-flash-active')).toHaveCount(0);

  await page.keyboard.press('Control+o');
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-transfer-a.ts');
  await expect.poll(() => selectedCursor(page.locator('.cm-content')))
    .toEqual({ lineText: 'alpha beta alpha', ch: 1 });
});

test('split ownership transfer records the Flash activation cursor for Ctrl-o', async ({ page }) => {
  const a = numbered('A');
  const b = numbered('B');
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/flash-split-b.ts': b.join('\n'),
      '/tmp/flash-split-a.ts': a.join('\n'),
    },
  });
  await openFileViaShortcut(page, '/tmp/flash-split-b.ts');
  await openFileViaShortcut(page, '/tmp/flash-split-a.ts');
  await focusEditor(page);

  await page.keyboard.press('Control+Shift+p');
  await page.locator('.palette-input').fill('open active file in split');
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor-pane')).toHaveCount(2);

  const leftPane = page.locator('.editor-pane').nth(0);
  const rightPane = page.locator('.editor-pane').nth(1);

  // Left keeps B, right keeps A; then start Flash in the right pane.
  await leftPane.locator('.editor-tab-label').filter({ hasText: 'flash-split-b.ts' }).click();
  await rightPane.locator('.cm-content').click();
  await expect(rightPane.locator('.cm-content')).toBeFocused();
  await startVisualFlashPreview(page);

  // Select the left pane without moving DOM focus. App transfers Vim ownership
  // to B while Flash is still previewing in A.
  await leftPane.locator('.editor-pane-tabs').evaluate(element => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await expect(leftPane).toHaveClass(/active/);
  await expect(page.locator('.status-bar')).not.toContainText('Flash:');

  // Focus only; a pointer click would move B's cursor and insert an unrelated
  // same-document departure into the traversal.
  await leftPane.locator('.cm-content').focus();
  await expect(leftPane.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('Control+o');

  await expect(leftPane).toHaveClass(/active/);
  await expect(leftPane.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-split-a.ts');
  await expect(leftPane.locator('.cm-content')).toBeFocused();
  await expect.poll(() => selectedCursor(leftPane.locator('.cm-content')))
    .toEqual({ lineText: 'A001 ....................', ch: 0 });
});

test('disabling Vim while Flash is live leaves no status, dim, labels, or previews', async ({ page }) => {
  const a = numbered('A');
  await openApp(page, {
    vim: true,
    files: { '/tmp/flash-disable.ts': a.join('\n') },
  });
  await openFileViaShortcut(page, '/tmp/flash-disable.ts');
  await focusEditor(page);

  await page.keyboard.type('sneedle');
  const status = page.locator('.status-bar');
  await expect(status).toContainText('Flash:');
  await expect(page.locator('.crumb-jump-match').first()).toBeVisible();
  await expect(page.locator('.crumb-flash-dim').first()).toBeVisible();

  await page.keyboard.press('Control+Shift+p');
  await page.locator('.palette-input').fill('disable vim mode');
  await page.keyboard.press('Enter');

  await expect(page.locator('.vim-status')).toHaveCount(0);
  await expect(status).not.toContainText('Flash:');
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);
  await expect(page.locator('.crumb-flash-dim')).toHaveCount(0);
  await expect(page.locator('.cm-flash-active')).toHaveCount(0);
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-disable.ts');
});
