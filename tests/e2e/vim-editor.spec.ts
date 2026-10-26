import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

interface SemanticFixtureCase {
  id: string;
  doc: string;
  keys: string;
  expected: {
    doc: string;
    cursor: number;
    mode: string;
    pending: string;
    selection: { anchor: number; head: number };
    register: { text: string; type: string };
    undoSteps: number;
  };
}

const semanticFixture = JSON.parse(
  readFileSync(new URL('../fixtures/vim-semantics.json', import.meta.url), 'utf8'),
) as { oracle: string; cases: SemanticFixtureCase[] };

interface FixtureState {
  doc: string;
  cursor: number;
  anchor: number;
  ranges: Array<{ anchor: number; head: number }>;
  mode: string;
  pending: string;
  writes: string[];
  undoDepth: number;
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return page.evaluate(() => {
    const fixtureWindow = window as unknown as {
      __vimFixture: { getState: () => FixtureState };
    };
    return fixtureWindow.__vimFixture.getState();
  });
}

async function fixtureCoords(page: Page, offset: number): Promise<{ x: number; y: number; height: number }> {
  return page.evaluate(position => {
    const fixtureWindow = window as unknown as {
      __vimFixture: {
        getCoordsAt: (offset: number) => { x: number; y: number; height: number } | null;
      };
    };
    const coords = fixtureWindow.__vimFixture.getCoordsAt(position);
    if (!coords) throw new Error(`No coordinates for offset ${position}`);
    return coords;
  }, offset);
}

async function fixtureNativeDisplayMove(
  page: Page,
  offset: number,
  forward: boolean,
  repeat = 1,
): Promise<number> {
  return page.evaluate(
    ([position, direction, count]) => {
      const fixtureWindow = window as unknown as {
        __vimFixture: {
          nativeDisplayMove: (offset: number, forward: boolean, repeat: number) => number;
        };
      };
      return fixtureWindow.__vimFixture.nativeDisplayMove(
        position as number,
        direction as boolean,
        count as number,
      );
    },
    [offset, forward, repeat] as const,
  );
}

async function fixtureScrollRepeat(page: Page): Promise<number> {
  return page.evaluate(() => {
    const fixtureWindow = window as unknown as {
      __vimFixture: { nativeScrollRepeat: () => number };
    };
    return fixtureWindow.__vimFixture.nativeScrollRepeat();
  });
}

async function fixtureRegister(page: Page, name = '"'): Promise<{ text: string; linewise: boolean; blockwise: boolean }> {
  return page.evaluate(registerName => {
    const fixtureWindow = window as unknown as {
      __vimFixture: {
        getRegister: (name: string) => { text: string; linewise: boolean; blockwise: boolean };
      };
    };
    return fixtureWindow.__vimFixture.getRegister(registerName);
  }, name);
}

async function runKeys(page: Page, keys: string): Promise<void> {
  // Only the recorded special keys are tokenized. Search fixtures contain
  // literal Vim regex ranges such as \<beta\>, so "<...>" is not a safe
  // generic delimiter.
  const special = /<(?:CR|Esc|C-v|BS|C-\[)>/g;
  let previous = 0;
  for (let match = special.exec(keys); match; match = special.exec(keys)) {
    for (const character of keys.slice(previous, match.index)) {
      await page.keyboard.type(character, { delay: 15 });
    }
    const name = match[0] === '<CR>'
      ? 'Enter'
      : match[0] === '<Esc>'
        ? 'Escape'
        : match[0].slice(1, -1).replace(/^C-/, 'Control+');
    await page.keyboard.press(name);
    previous = match.index + match[0].length;
  }
  for (const character of keys.slice(previous)) await page.keyboard.type(character, { delay: 15 });
}

async function openEditor(
  page: Page,
  doc = '',
  params: Record<string, string> = {},
): Promise<Locator> {
  const query = new URLSearchParams({ doc, ...params });
  await page.goto(`/tests/e2e/vim-fixture.html?${query.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.click();
  // Neovim's nostartofline keeps the clicked column for `gg`; start each
  // fixture from the oracle's first-line/first-column baseline.
  await page.keyboard.type('gg0', { delay: 15 });
  await expect.poll(async () => (await fixtureState(page)).cursor).toBe(0);
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

test('3f.;, follows Neovim character finding with a count', async ({ page }) => {
  const editor = await openEditor(page, 'a.b.c.d.e.f');
  await runKeys(page, 'gg3f.;,');

  const state = await fixtureState(page);
  expect(state.cursor).toBe(5);
  expect(state.mode).toBe('normal');
  await expectDocument(editor, 'a.b.c.d.e.f');
});

test('2F.; repeats a counted backward character search', async ({ page }) => {
  const editor = await openEditor(page, 'a.b.c.d.e.f');
  await runKeys(page, 'gg$2F.;');

  const state = await fixtureState(page);
  expect(state.cursor).toBe(5);
  expect(state.mode).toBe('normal');
  await expectDocument(editor, 'a.b.c.d.e.f');
});

test('2t.;;2T. follows Neovim till motion counts in both directions', async ({ page }) => {
  const editor = await openEditor(page, 'a.b.c.d.e.f');
  await runKeys(page, 'gg2t.;;2T.');

  const state = await fixtureState(page);
  expect(state.cursor).toBe(4);
  expect(state.mode).toBe('normal');
  await expectDocument(editor, 'a.b.c.d.e.f');
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

const BLOCKED_SEMANTIC_CASES = new Map([
  [
    'visual-multiline-charwise-repeat',
    'blocked: engine multiline charwise Visual repeat replay ignores the last-line character offset',
  ],
  [
    'startofline-visual-line',
    'blocked: linewise operator cursor placement is engine operator parity',
  ],
  [
    'visual-block-short-row-dollar',
    'blocked: documented engine difference for short-row Visual-block selection/register content',
  ],
]);

for (const fixtureCase of semanticFixture.cases) {
  const blockedReason = BLOCKED_SEMANTIC_CASES.get(fixtureCase.id);
  if (blockedReason) {
    test.fixme(
      `Neovim semantics: ${fixtureCase.id} (${blockedReason})`,
      async () => {},
    );
    continue;
  }

  test(`Neovim semantics: ${fixtureCase.id}`, async ({ page }) => {
    const editor = await openEditor(page, fixtureCase.doc);
    await runKeys(page, fixtureCase.keys);

    const state = await fixtureState(page);
    const expected = fixtureCase.expected;
    expect(state.doc).toBe(expected.doc);
    expect(state.mode).toBe(expected.mode);
    expect(state.pending).toBe(expected.pending);
    // CodeMirror groups one Vim change per undo step, matching the recorded
    // Neovim undo depth for these fixtures.
    expect(state.undoDepth).toBe(expected.undoSteps);
    expect(state.writes).toEqual([]);

    if (expected.mode === 'visual') {
      // The recorder captures the live directed Visual anchor/head. CodeMirror
      // stores an exclusive charwise head, so compare the selected text.
      const expectedFrom = Math.min(expected.selection.anchor, expected.selection.head);
      const expectedTo = Math.max(expected.selection.anchor, expected.selection.head) + 1;
      const range = state.ranges[0];
      expect(range).toBeDefined();
      const actualFrom = Math.min(range.anchor, range.head);
      const actualTo = Math.max(range.anchor, range.head);
      expect(state.doc.slice(actualFrom, actualTo)).toBe(expected.doc.slice(expectedFrom, expectedTo));
    } else {
      expect(state.cursor).toBe(expected.cursor);
      expect(state.anchor).toBe(expected.selection.anchor);
    }

    const register = await fixtureRegister(page);
    expect(register.text).toBe(expected.register.text);
    if (expected.register.type.startsWith('V')) {
      expect(register.linewise).toBe(true);
      expect(register.blockwise).toBe(false);
    } else if (expected.register.type.startsWith('v')) {
      expect(register.linewise).toBe(false);
      expect(register.blockwise).toBe(false);
    } else {
      expect(register.blockwise).toBe(true);
    }
    await expect(editor.locator('.cm-content')).toBeVisible();
  });
}

test('mouse selection refreshes the startofline goal column', async ({ page }) => {
  await openEditor(page, 'abcdefghijk\nx\nabcdefghijk');
  await page.keyboard.type('6l');
  await expect.poll(async () => (await fixtureState(page)).cursor).toBe(6);

  // A real Chromium mouse click sets the host cursor; a subsequent line jump
  // must use the clicked column rather than the stale Vim goal.
  const coords = await fixtureCoords(page, 4);
  await page.mouse.click(coords.x + 1, coords.y + coords.height / 2);
  await expect.poll(async () => (await fixtureState(page)).cursor).toBe(4);

  await page.keyboard.type('G');
  expect((await fixtureState(page)).cursor).toBe(18);
});

test('gj on a wrapped line follows native display-line movement', async ({ page }) => {
  const doc = 'abcdefghijklmnopqrstuvwxyz'.repeat(6);
  await openEditor(page, doc, { width: '180', wrap: '1' });
  await page.keyboard.type('50l');
  const start = (await fixtureState(page)).cursor;
  const expected = await fixtureNativeDisplayMove(page, start, true, 1);

  await page.keyboard.type('gj');
  expect((await fixtureState(page)).cursor).toBe(expected);
});

test('gj updates the logical goal used by a following G', async ({ page }) => {
  const doc = 'abcdefghijklmnopqrstuvwxyz'.repeat(6);
  await openEditor(page, doc, { width: '180', wrap: '1' });

  await runKeys(page, 'gg050lgjG');
  expect((await fixtureState(page)).cursor).toBe(68);
});

test('Ctrl-D on a wrapped line follows native scroll movement', async ({ page }) => {
  const doc = 'abcdefghijklmnopqrstuvwxyz'.repeat(6);
  await openEditor(page, doc, { width: '180', wrap: '1' });
  await page.keyboard.type('50l');
  const start = (await fixtureState(page)).cursor;
  const repeat = await fixtureScrollRepeat(page);
  const expected = await fixtureNativeDisplayMove(page, start, true, repeat);

  await page.keyboard.press('Control+d');
  expect((await fixtureState(page)).cursor).toBe(expected);
});

test('argumentless :w invokes the save hook and unsupported Ex writes do not', async ({ page }) => {
  await openEditor(page, 'alpha beta');
  await page.keyboard.type(':w');
  await page.keyboard.press('Enter');

  await expect.poll(async () => (await fixtureState(page)).writes).toEqual(['alpha beta']);

  await page.keyboard.type(':w other.txt');
  await page.keyboard.press('Enter');
  await page.keyboard.type(':w!');
  await page.keyboard.press('Enter');
  await page.keyboard.type(':wq');
  await page.keyboard.press('Enter');
  await page.keyboard.type(':q');
  await page.keyboard.press('Enter');

  expect((await fixtureState(page)).writes).toEqual(['alpha beta']);
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
