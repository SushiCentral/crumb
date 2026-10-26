import { expect, test, type Locator, type Page } from '@playwright/test';

async function openEditor(page: Page, doc = ''): Promise<Locator> {
  await page.goto(`/tests/e2e/vim-fixture.html?doc=${encodeURIComponent(doc)}`);
  const editor = page.getByTestId('code-editor');
  await editor.click();
  await expect(editor.locator('.cm-content')).toBeVisible();
  return editor;
}

async function expectDocument(editor: Locator, expected: string): Promise<void> {
  await expect(editor.locator('.cm-content')).toHaveText(expected);
}

async function moveToStart(page: Page): Promise<void> {
  await page.keyboard.type('gg');
}

async function cursorOffset(editor: Locator): Promise<number> {
  return editor.locator('.cm-content').evaluate((content) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return -1;

    const range = selection.getRangeAt(0);
    const beforeCursor = document.createRange();
    beforeCursor.selectNodeContents(content);
    beforeCursor.setEnd(range.startContainer, range.startOffset);
    return beforeCursor.toString().length;
  });
}

test('insert mode edits the real CodeMirror document', async ({ page }) => {
  const editor = await openEditor(page);

  await page.keyboard.type('iabc');
  await page.keyboard.press('Escape');

  await expectDocument(editor, 'abc');
});

// Expected documents and cursor positions match `nvim --clean` defaults.
test('3dw deletes three words', async ({ page }) => {
  const editor = await openEditor(page, 'one two three four five');
  await moveToStart(page);

  await page.keyboard.type('3dw');

  await expectDocument(editor, 'four five');
});

test('ciw changes the inner word', async ({ page }) => {
  const editor = await openEditor(page, 'alpha beta gamma');
  await moveToStart(page);

  await page.keyboard.type('wciwreplaced');
  await page.keyboard.press('Escape');

  await expectDocument(editor, 'alpha replaced gamma');
});

test('vaw selects a word and delete removes it', async ({ page }) => {
  const editor = await openEditor(page, 'alpha beta gamma');
  await moveToStart(page);

  await page.keyboard.type('wvawd');

  await expectDocument(editor, 'alpha gamma');
});

test('named register keeps its text after the unnamed register changes', async ({ page }) => {
  const editor = await openEditor(page, 'alpha beta gamma');
  await moveToStart(page);

  await page.keyboard.type('"ayw');
  await page.keyboard.type('wyw');
  await page.keyboard.type('w"aP');

  await expectDocument(editor, 'alpha beta alpha gamma');
});

test('dot repeats the last change', async ({ page }) => {
  const editor = await openEditor(page, 'one two three four');
  await moveToStart(page);

  await page.keyboard.type('dw');
  await page.keyboard.type('.');

  await expectDocument(editor, 'three four');
});

test('/word search finds matches and n/N traverse them', async ({ page }) => {
  const editor = await openEditor(page, 'alpha beta gamma beta delta');
  await moveToStart(page);

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expect.poll(() => cursorOffset(editor)).toBe(6);

  await page.keyboard.press('n');
  await expect.poll(() => cursorOffset(editor)).toBe(17);

  await page.keyboard.press('N');
  await expect.poll(() => cursorOffset(editor)).toBe(6);

  await expectDocument(editor, 'alpha beta gamma beta delta');
});
