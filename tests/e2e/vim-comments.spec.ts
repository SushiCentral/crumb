import { expect, test, type Locator, type Page } from '@playwright/test';

// The component fixture mounts the real `Editor` with `path={null}`, which
// selects the untitled JavaScript buffer (`javascript()` in Editor.tsx). That
// gives the Vim `gc` operator real `commentTokens` language data to use.
const COMPONENT_FIXTURE = '/tests/e2e/editor-component-fixture.html';
// The minimal Vim fixture deliberately has no language extension, so it is the
// only existing fixture that can express "no comment tokens" without changing
// production code or another agent's fixture.
const VIM_FIXTURE = '/tests/e2e/vim-fixture.html';

const ORIGINAL = 'const alpha = 1;\nconst beta = 2;\nconst gamma = 3;';
const FIRST_LINE_COMMENTED = '// const alpha = 1;\nconst beta = 2;\nconst gamma = 3;';
const FIRST_TWO_LINES_COMMENTED = '// const alpha = 1;\n// const beta = 2;\nconst gamma = 3;';

interface FixtureState {
  enabled: boolean;
  doc: string;
  mode: string;
  cursor: { line: number; column: number; selected: number };
  undoDepth: number;
}

interface VimFixtureState {
  doc: string;
  mode: string;
  cursor: number;
  ranges: Array<{ anchor: number; head: number }>;
  undoDepth: number;
}

async function openEditor(page: Page, doc: string): Promise<Locator> {
  const params = new URLSearchParams({ a: doc, vim: '1' });
  await page.goto(`${COMPONENT_FIXTURE}?${params.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.locator('.cm-content').click({ position: { x: 8, y: 8 } });
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expectState(page, { enabled: true, mode: 'normal', doc });
  await expectJavaScriptReady(editor);
  return editor;
}

async function state(page: Page): Promise<FixtureState> {
  return page.evaluate(() => {
    const fixture = (window as unknown as {
      __crumbEditor: { getState: () => FixtureState };
    }).__crumbEditor;
    return fixture.getState();
  });
}

async function expectState(page: Page, expected: Partial<FixtureState>): Promise<void> {
  await expect.poll(async () => state(page)).toMatchObject(expected);
}

async function expectDoc(page: Page, expected: string): Promise<void> {
  await expect.poll(async () => (await state(page)).doc).toBe(expected);
}

// `path: null` dispatches javascript() from a mount effect rather than through
// an async LanguageDescription load, but the language facet and its first
// parse still land after the initial render. Wait for real JavaScript token
// spans (the `const` keywords) instead of sleeping: running `gc` before the
// language data exists would make CodeMirror's toggleLineComment return false
// and turn these into false negatives.
async function expectJavaScriptReady(editor: Locator): Promise<void> {
  const keywordSpans = editor.locator('.cm-line span').filter({ hasText: 'const' });
  await expect.poll(async () => keywordSpans.count()).toBeGreaterThan(0);
}

async function openVimFixture(page: Page, doc: string): Promise<Locator> {
  const params = new URLSearchParams({ doc });
  await page.goto(`${VIM_FIXTURE}?${params.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.locator('.cm-content').click();
  await expect(editor.locator('.cm-content')).toBeVisible();
  await page.keyboard.type('gg');
  return editor;
}

async function vimFixtureState(page: Page): Promise<VimFixtureState> {
  return page.evaluate(() => {
    const fixture = (window as unknown as {
      __vimFixture: { getState: () => VimFixtureState };
    }).__vimFixture;
    return fixture.getState();
  });
}

test('gcc comments and uncomments the current line', async ({ page }) => {
  await openEditor(page, ORIGINAL);
  await page.keyboard.type('gg');

  await page.keyboard.type('gcc');
  await expectDoc(page, FIRST_LINE_COMMENTED);
  await expectState(page, { mode: 'normal' });

  await page.keyboard.type('gcc');
  await expectDoc(page, ORIGINAL);
  await expectState(page, { mode: 'normal' });
});

test('gcj comments the current and next line', async ({ page }) => {
  await openEditor(page, ORIGINAL);
  await page.keyboard.type('gg');

  await page.keyboard.type('gcj');
  await expectDoc(page, FIRST_TWO_LINES_COMMENTED);
  await expectState(page, { mode: 'normal' });
});

test('Visual-line gc comments every selected line', async ({ page }) => {
  await openEditor(page, ORIGINAL);
  await page.keyboard.type('gg');

  await page.keyboard.type('Vj');
  await expectState(page, { mode: 'visual-line' });

  await page.keyboard.type('gc');
  await expectDoc(page, FIRST_TWO_LINES_COMMENTED);
  await expectState(page, {
    mode: 'normal',
    // The operator returns the top selected line's first non-blank, so the
    // engine collapses the Visual range and does not re-enter Visual.
    cursor: { line: 1, column: 1, selected: 0 },
  });
});

test('Visual-line gc handles an upward selection', async ({ page }) => {
  await openEditor(page, ORIGINAL);
  await page.keyboard.type('ggj');
  await expectState(page, { cursor: { line: 2, column: 1, selected: 0 } });

  await page.keyboard.type('Vk');
  await expectState(page, { mode: 'visual-line' });

  await page.keyboard.type('gc');
  await expectDoc(page, FIRST_TWO_LINES_COMMENTED);
  await expectState(page, {
    mode: 'normal',
    cursor: { line: 1, column: 1, selected: 0 },
  });
});

test('2gcc comments the counted line range', async ({ page }) => {
  await openEditor(page, ORIGINAL);
  await page.keyboard.type('gg');

  // Pinned engine: `gc` is an operator, and a repeated operator key expands
  // linewise with the pending operator count. `2gcc` therefore selects two
  // lines before CodeMirror toggles their line comments.
  await page.keyboard.type('2gcc');
  await expectDoc(page, FIRST_TWO_LINES_COMMENTED);
  await expectState(page, { mode: 'normal' });
});

test('u undoes a multi-line gc as one operation', async ({ page }) => {
  await openEditor(page, ORIGINAL);
  await page.keyboard.type('gg');
  const before = await state(page);

  await page.keyboard.type('gcj');
  await expectDoc(page, FIRST_TWO_LINES_COMMENTED);
  await expect.poll(async () => (await state(page)).undoDepth).toBe(before.undoDepth + 1);

  await page.keyboard.press('u');
  await expectDoc(page, ORIGINAL);
  await expect.poll(async () => (await state(page)).undoDepth).toBe(before.undoDepth);
});

test('gcc is a no-op when the document has no comment tokens', async ({ page }) => {
  const doc = 'alpha beta\nsecond line';
  await openVimFixture(page, doc);
  const before = await vimFixtureState(page);

  await page.keyboard.type('gcc');
  await expect.poll(async () => (await vimFixtureState(page)).doc).toBe(doc);
  const after = await vimFixtureState(page);
  expect(after.undoDepth).toBe(before.undoDepth);
  expect(after.mode).toBe('normal');
});

test('Visual gc exits even when the document has no comment tokens', async ({ page }) => {
  const doc = 'alpha beta\nsecond line';
  await openVimFixture(page, doc);
  const before = await vimFixtureState(page);

  await page.keyboard.type('Vjgc');
  await expect.poll(async () => (await vimFixtureState(page)).doc).toBe(doc);
  const after = await vimFixtureState(page);
  expect(after.undoDepth).toBe(before.undoDepth);
  expect(after.mode).toBe('normal');
  // The cursor-return fallback must collapse the Visual range even though the
  // comment command itself made no edit.
  expect(after.cursor).toBe(0);
  expect(after.ranges.every(range => range.anchor === range.head)).toBe(true);
});
