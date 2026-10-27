import { expect, test, type Page } from '@playwright/test';

// Authored integration coverage for the surround commands. This spec is not
// executed by the surround implementation task; the parent owns the final
// browser suite run.

interface FixtureState {
  doc: string;
  cursor: number;
  mode: string;
  pending: string;
  undoDepth: number;
}

async function state(page: Page): Promise<FixtureState> {
  return page.evaluate(() => {
    const fixtureWindow = window as unknown as {
      __vimFixture: { getState: () => FixtureState };
    };
    return fixtureWindow.__vimFixture.getState();
  });
}

async function openEditor(page: Page, doc: string): Promise<void> {
  const query = new URLSearchParams({ doc });
  await page.goto(`/tests/e2e/vim-fixture.html?${query.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.click();
  await expect(editor.locator('.cm-content')).toBeVisible();
  await page.keyboard.type('gg0');
  await expect.poll(async () => (await state(page)).cursor).toBe(0);
}

async function expectDoc(page: Page, doc: string): Promise<void> {
  await expect.poll(async () => (await state(page)).doc).toBe(doc);
}

async function openLifecycle(
  page: Page,
  params: Record<string, string> = {},
): Promise<void> {
  const query = new URLSearchParams({ a: '(alpha)', b: 'bravo', ...params });
  await page.goto(`/tests/e2e/vim-lifecycle-fixture.html?${query.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.click();
  await expect(editor.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __crumbVim: { setCursor: (offset: number) => void } })
      .__crumbVim.setCursor(1);
  });
}

async function lifecycleDoc(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fixture = window as unknown as { __crumbVim: { current: () => { doc: string } } };
    return fixture.__crumbVim.current().doc;
  });
}

async function lifecycleCursor(page: Page): Promise<number> {
  return page.evaluate(() => {
    const fixture = window as unknown as { __crumbVim: { current: () => { cursor: number } } };
    return fixture.__crumbVim.current().cursor;
  });
}

test('ysiw surrounds the inner word and leaves the cursor inside', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type('ysiw"');

  await expectDoc(page, '"alpha" beta');
  const snapshot = await state(page);
  expect(snapshot.cursor).toBe(1);
  expect(snapshot.mode).toBe('normal');
});

test('a standalone Shift keydown before the quote delimiter is ignored', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type('ysiw');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Quote');
  await page.keyboard.up('Shift');

  await expectDoc(page, '"alpha" beta');
});

test('an unshifted apostrophe remains a valid delimiter', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type("ysiw'");

  await expectDoc(page, "'alpha' beta");
});

test('standalone Control/Alt/Meta keydowns do not cancel pending surround', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type('ysiw');
  for (const key of ['Control', 'Alt', 'Meta']) {
    await page.keyboard.down(key);
    await page.keyboard.up(key);
  }
  await page.keyboard.down('Shift');
  await page.keyboard.press('Quote');
  await page.keyboard.up('Shift');

  await expectDoc(page, '"alpha" beta');
});

test('a standalone Shift between ys and a shifted W motion is ignored', async ({ page }) => {
  await openEditor(page, 'one two');

  await page.keyboard.type('ys');
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyW');
  await page.keyboard.up('Shift');
  // The W motion range is "one " (up to the next WORD), so the space stays
  // inside the delimiters.
  await page.keyboard.down('Shift');
  await page.keyboard.press('Quote');
  await page.keyboard.up('Shift');

  await expectDoc(page, '"one "two');
});

test('ys supports a counted motion', async ({ page }) => {
  await openEditor(page, 'one two');

  await page.keyboard.type('ys3l)');

  await expectDoc(page, '(one) two');
  expect((await state(page)).cursor).toBe(1);
});

test('yss surrounds the current line', async ({ page }) => {
  await openEditor(page, 'one\ntwo');

  await page.keyboard.type('yss"');
  await expectDoc(page, '"one"\ntwo');

  await page.keyboard.type('j.');
  await expectDoc(page, '"one"\n"two"');
});

test('ds removes the closest enclosing bracket pair', async ({ page }) => {
  await openEditor(page, '((alpha))');
  await page.keyboard.type('ll');

  await page.keyboard.type('ds(');

  await expectDoc(page, '(alpha)');
  expect((await state(page)).cursor).toBe(1);
});

test('ds removes escaped-aware quote pairs', async ({ page }) => {
  await openEditor(page, 'say "hello" now');
  await page.keyboard.type('f"l');

  await page.keyboard.type('ds"');

  await expectDoc(page, 'say hello now');
});

test('cs changes the closest pair using delimiter aliases', async ({ page }) => {
  await openEditor(page, '(alpha)');
  await page.keyboard.type('l');

  await page.keyboard.type('cs([');

  await expectDoc(page, '[alpha]');

  await page.keyboard.type('u');
  await expectDoc(page, '(alpha)');

  await page.keyboard.type('cs(B');
  await expectDoc(page, '{alpha}');
});

test('Visual S surrounds a charwise selection', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type('viwS"');

  await expectDoc(page, '"alpha" beta');
  expect((await state(page)).mode).toBe('normal');
});

test('Visual Shift+S then Shift-held quote survives modifier keydowns', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type('viw');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Shift');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Quote');
  await page.keyboard.up('Shift');

  await expectDoc(page, '"alpha" beta');
  expect((await state(page)).mode).toBe('normal');
});

test('Visual S includes the last selected character', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  // CodeMirror's charwise Visual range is inclusive of the last character.
  await page.keyboard.type('viwS]');

  await expectDoc(page, '[alpha] beta');
});

test('Visual S surrounds a linewise selection', async ({ page }) => {
  await openEditor(page, 'one\ntwo\nthree');

  await page.keyboard.type('VjS"');

  await expectDoc(page, '"one\ntwo"\nthree');
});

test('Escape cancels a charwise Visual S prompt without an edit', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type('viwS');
  await page.keyboard.press('Escape');

  await expectDoc(page, 'alpha beta');
  expect((await state(page)).mode).toBe('normal');
});

test('an invalid delimiter cancels a linewise Visual S prompt without an edit', async ({ page }) => {
  await openEditor(page, 'one\ntwo');

  await page.keyboard.type('VjS#');

  await expectDoc(page, 'one\ntwo');
  expect((await state(page)).mode).toBe('normal');
});

test('Visual block S cancels without any partial edit', async ({ page }) => {
  await openEditor(page, 'one\ntwo');

  await page.keyboard.press('Control+v');
  await page.keyboard.type('jS"');

  await expectDoc(page, 'one\ntwo');
  expect((await state(page)).mode).toBe('normal');
});

test('Escape cancels a pending delimiter without changing the document', async ({ page }) => {
  await openEditor(page, '(alpha)');
  await page.keyboard.type('l');

  await page.keyboard.type('ds');
  await page.keyboard.press('Escape');

  await expectDoc(page, '(alpha)');
  // A following normal command proves the engine is not stuck in a prefix.
  await page.keyboard.type('x');
  await expectDoc(page, '(lpha)');
});

test('an invalid delimiter cancels without changes', async ({ page }) => {
  await openEditor(page, '(alpha)');
  await page.keyboard.type('l');

  await page.keyboard.type('ds#');

  await expectDoc(page, '(alpha)');
  await page.keyboard.type('x');
  await expectDoc(page, '(lpha)');
});

test('one surround is one undo step', async ({ page }) => {
  await openEditor(page, 'alpha beta');

  await page.keyboard.type('ysiw"');
  await expectDoc(page, '"alpha" beta');
  expect((await state(page)).undoDepth).toBe(1);

  await page.keyboard.type('u');
  await expectDoc(page, 'alpha beta');
});

test('dot repeats a completed ys operation', async ({ page }) => {
  await openEditor(page, 'alpha beta gamma');

  await page.keyboard.type('ysiw"');
  // Vim's `w` treats the closing quote as a punctuation word, so two motions
  // are needed to reach `beta`. Assert that before repeating.
  await page.keyboard.type('ww');
  expect((await state(page)).cursor).toBe(8);
  await page.keyboard.type('.');

  await expectDoc(page, '"alpha" "beta" gamma');
});

test('a tab switch clears pending surround input', async ({ page }) => {
  await openLifecycle(page);

  await page.keyboard.type('ds');
  await page.evaluate(() => {
    (window as unknown as { __crumbVim: { switchTo: (id: string) => void } })
      .__crumbVim.switchTo('B');
  });
  await page.evaluate(() => {
    (window as unknown as { __crumbVim: { switchTo: (id: string) => void } })
      .__crumbVim.switchTo('A');
  });

  // The fixture restores the saved cursor at offset 1. If pending survived, x
  // would be consumed as an invalid delimiter and the document would stay
  // "(alpha)". x executing proves cancellation; it deletes "a".
  expect(await lifecycleCursor(page)).toBe(1);
  await page.keyboard.type('x');
  await expect.poll(async () => lifecycleDoc(page)).toBe('(lpha)');
});

test('a configured ds mapping suppresses the surround prefix', async ({ page }) => {
  await openLifecycle(page, { map: 'ds', rhs: 'dd' });

  await page.keyboard.type('ds(');

  // If Crumb intercepted `s`, `(` would delete the enclosing pair. With the
  // user mapping configured, the prefix is left to the engine and no edit
  // happens.
  await expect.poll(async () => lifecycleDoc(page)).toBe('(alpha)');
});

test('a configured y remap takes precedence over surround interception', async ({ page }) => {
  await openLifecycle(page, { map: 'y', rhs: 'dd' });

  await page.keyboard.type('y');
  await page.keyboard.press('Escape');

  // The user's `y -> dd` mapping deletes the line instead of leaving a yank
  // operator pending for surround to retarget.
  await expect.poll(async () => lifecycleDoc(page)).toBe('');
});
