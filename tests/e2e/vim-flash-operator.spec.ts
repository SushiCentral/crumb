import { expect, test, type Locator, type Page } from '@playwright/test';
import { focusEditor, openApp, openFileViaShortcut, tabLabel } from './app-vim-helpers';

interface FixtureState {
  doc: string;
  cursor: number;
  anchor: number;
  ranges: Array<{ anchor: number; head: number }>;
  mode: string;
  pending: string;
  flash: { query: string; matchCount: number } | null;
  undoDepth: number;
}

interface RegisterSnapshot {
  text: string;
  linewise: boolean;
  blockwise: boolean;
}

async function state(page: Page): Promise<FixtureState> {
  return page.evaluate(() => {
    const fixture = window as unknown as { __vimFixture: { getState: () => FixtureState } };
    return fixture.__vimFixture.getState();
  });
}

async function register(page: Page, name = '"'): Promise<RegisterSnapshot> {
  return page.evaluate(registerName => {
    const fixture = window as unknown as {
      __vimFixture: { getRegister: (value: string) => RegisterSnapshot };
    };
    return fixture.__vimFixture.getRegister(registerName);
  }, name);
}

async function openEditor(
  page: Page,
  doc: string,
  params: Record<string, string> = {},
): Promise<Locator> {
  const query = new URLSearchParams({ doc, ...params });
  await page.goto(`/tests/e2e/vim-flash-fixture.html?${query.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.click();
  await expect(editor.locator('.cm-content')).toBeVisible();
  await page.keyboard.type('gg0', { delay: 15 });
  await expect.poll(async () => (await state(page)).cursor).toBe(0);
  return editor;
}

async function pressLabelAt(page: Page, offset: number): Promise<void> {
  const label = await page.locator(`.crumb-jump-label[data-offset="${offset}"]`).getAttribute('data-label');
  if (!label) throw new Error(`No visible label at offset ${offset}`);
  await page.keyboard.press(label);
}

test('dgs uses one native inclusive motion to the match start', async ({ page }) => {
  const editor = await openEditor(page, 'alpha beta gamma delta');
  const beforeRegister = await register(page);

  await page.keyboard.type('dgsbeta', { delay: 20 });

  const preview = await state(page);
  expect(preview.doc).toBe('alpha beta gamma delta');
  expect(preview.cursor).toBe(0);
  expect(preview.undoDepth).toBe(0);
  expect(preview.flash).toEqual({ query: 'beta', matchCount: 1 });
  expect(await register(page)).toEqual(beforeRegister);
  await expect(page.locator('.crumb-jump-label[data-offset="6"]')).toBeVisible();

  await page.keyboard.press('Enter');

  expect((await state(page)).doc).toBe('eta gamma delta');
  expect((await state(page)).flash).toBeNull();
  expect((await state(page)).undoDepth).toBe(1);
  expect((await state(page)).mode).toBe('normal');
  expect((await state(page)).pending).toBe('');
  await expect(editor.locator('.cm-content')).toHaveText('eta gamma delta');

  await page.keyboard.press('u');
  expect((await state(page)).doc).toBe('alpha beta gamma delta');
});

test('cgs enters Insert only after confirming the target', async ({ page }) => {
  await openEditor(page, 'alpha beta gamma');

  await page.keyboard.type('cgsbeta', { delay: 20 });
  expect((await state(page)).doc).toBe('alpha beta gamma');
  expect((await state(page)).mode).toBe('normal');
  expect((await state(page)).flash).toEqual({ query: 'beta', matchCount: 1 });

  await page.keyboard.press('Enter');
  expect((await state(page)).mode).toBe('insert');
  expect((await state(page)).doc).toBe('eta gamma');

  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('Xeta gamma');
});

test('ygs preserves charwise and named register behavior', async ({ page }) => {
  await openEditor(page, 'alpha beta gamma');

  await page.keyboard.type('"aygsbeta', { delay: 20 });
  await page.keyboard.press('Enter');

  const named = await register(page, 'a');
  expect(named).toEqual({ text: 'alpha b', linewise: false, blockwise: false });
  expect((await state(page)).doc).toBe('alpha beta gamma');
  expect((await state(page)).undoDepth).toBe(0);
  expect((await register(page)).text).toBe('alpha b');
});

test('operator Flash handles multiline and backward inclusive targets', async ({ page }) => {
  await openEditor(page, 'alpha\nbeta gamma\ndelta');

  await page.keyboard.type('dgsgamma', { delay: 20 });
  await page.keyboard.press('Enter');
  expect((await state(page)).doc).toBe('amma\ndelta');

  await openEditor(page, 'alpha beta gamma');
  await page.keyboard.type('$');
  await page.keyboard.type('ygsalpha', { delay: 20 });
  await pressLabelAt(page, 0);
  expect((await register(page)).text).toBe('alpha beta gamma');
  expect((await state(page)).doc).toBe('alpha beta gamma');
});

test('case and indent operators reuse the native inclusive Flash motion', async ({ page }) => {
  await openEditor(page, 'alpha beta gamma');
  await page.keyboard.type('gUgsbeta', { delay: 20 });
  await page.keyboard.press('Enter');
  expect((await state(page)).doc).toBe('ALPHA Beta gamma');
  expect((await state(page)).undoDepth).toBe(1);

  await openEditor(page, 'alpha beta gamma');
  await page.keyboard.type('g~gsbeta', { delay: 20 });
  await page.keyboard.press('Enter');
  expect((await state(page)).doc).toBe('ALPHA Beta gamma');

  await openEditor(page, 'alpha beta gamma');
  await page.keyboard.type('>gsbeta', { delay: 20 });
  await page.keyboard.press('Enter');
  expect((await state(page)).doc).toBe('  alpha beta gamma');
});

test('operator counts select Enter targets while labels ignore the count', async ({ page }) => {
  const doc = 'alpha beta alpha beta alpha';
  await openEditor(page, doc);

  await page.keyboard.type('d2gsalpha', { delay: 20 });
  await expect(page.locator('.crumb-jump-label.is-current')).toHaveAttribute('data-offset', '22');
  await expect(page.locator('.crumb-jump-current')).toHaveAttribute('data-flash-offset', '22');
  await page.keyboard.press('Enter');
  expect((await state(page)).doc).toBe('lpha');

  await openEditor(page, doc);
  await page.keyboard.type('d2gsalpha', { delay: 20 });
  await pressLabelAt(page, 11);
  expect((await state(page)).doc).toBe('lpha beta alpha');
});

test('Escape, blur, mouse, and external edits cancel the pending operator', async ({ page }) => {
  const doc = 'alpha beta alpha';

  await openEditor(page, doc);
  const beforeRegister = await register(page);
  await page.keyboard.type('dgsalpha', { delay: 20 });
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe(doc);
  expect((await state(page)).undoDepth).toBe(0);
  expect((await state(page)).flash).toBeNull();
  expect((await state(page)).pending).toBe('');
  expect((await state(page)).mode).toBe('normal');
  expect(await register(page)).toEqual(beforeRegister);

  await openEditor(page, doc);
  await page.keyboard.type('dgsalpha', { delay: 20 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => (await state(page)).flash).toBeNull();
  expect((await state(page)).doc).toBe(doc);
  expect((await state(page)).pending).toBe('');

  await openEditor(page, doc);
  await page.keyboard.type('dgsalpha', { delay: 20 });
  const coords = await page.evaluate(() => {
    const fixture = window as unknown as {
      __vimFixture: { getCoordsAt: (offset: number) => { x: number; y: number; height: number } | null };
    };
    return fixture.__vimFixture.getCoordsAt(4);
  });
  if (!coords) throw new Error('No coordinates');
  await page.mouse.click(coords.x + 1, coords.y + coords.height / 2);
  await expect.poll(async () => (await state(page)).flash).toBeNull();
  expect((await state(page)).doc).toBe(doc);
  expect((await state(page)).pending).toBe('');
  expect((await state(page)).cursor).toBe(4);

  await openEditor(page, doc);
  await page.keyboard.type('dgsalpha', { delay: 20 });
  await page.evaluate(() => {
    const fixture = window as unknown as { __vimFixture: { replaceDoc: (text: string) => void } };
    fixture.__vimFixture.replaceDoc('replacement');
  });
  await expect.poll(async () => (await state(page)).flash).toBeNull();
  expect((await state(page)).doc).toBe('replacement');
  expect((await state(page)).pending).toBe('');
});

test('active operator Flash owns literal s and assigned s labels before surround', async ({ page }) => {
  await openEditor(page, '"s" tail');
  await page.keyboard.type('dgs', { delay: 20 });
  await page.keyboard.type('s"', { delay: 20 });
  const active = await state(page);
  expect(active.doc).toBe('"s" tail');
  expect(active.undoDepth).toBe(0);
  expect(active.flash).toEqual({ query: 's"', matchCount: 1 });
  await page.keyboard.press('Escape');
  expect((await state(page)).pending).toBe('');
  expect((await state(page)).doc).toBe('"s" tail');

  const doc = 'alpha beta alpha beta alpha';
  await openEditor(page, doc);
  await page.keyboard.type('dgsalpha', { delay: 20 });
  const label = page.locator('.crumb-jump-label[data-label="s"]');
  await expect(label).toHaveCount(1);
  const offset = Number(await label.getAttribute('data-offset'));
  await page.keyboard.press('s');
  expect((await state(page)).doc).toBe(doc.slice(offset + 1));
  expect((await state(page)).undoDepth).toBe(1);
});

test('modified chords cancel the pending operator before reaching Vim', async ({ page }) => {
  const doc = Array.from({ length: 40 }, (_, index) => `alpha line ${index}`).join('\n');

  for (const chord of ['Control+d', 'Control+f', 'Control+ArrowRight']) {
    await openEditor(page, doc);
    const beforeRegister = await register(page);
    await page.keyboard.type('dgsalpha', { delay: 20 });
    const beforeDoc = (await state(page)).doc;
    await page.keyboard.press(chord);

    await expect.poll(async () => (await state(page)).flash).toBeNull();
    expect((await state(page)).doc).toBe(beforeDoc);
    expect((await state(page)).undoDepth).toBe(0);
    expect((await state(page)).pending).toBe('');
    expect(await register(page)).toEqual(beforeRegister);
  }
});

test('real-App Ctrl+Tab cancels operator Flash before switching tabs', async ({ page }) => {
  await openApp(page, {
    vim: true,
    files: {
      '/tmp/flash-op-a.ts': 'alpha beta gamma',
      '/tmp/flash-op-b.ts': 'other buffer',
    },
  });
  await openFileViaShortcut(page, '/tmp/flash-op-a.ts');
  await openFileViaShortcut(page, '/tmp/flash-op-b.ts');
  await tabLabel(page, 'flash-op-a.ts').click();
  await focusEditor(page);

  await page.keyboard.type('dgsalpha', { delay: 20 });
  await expect(page.locator('.status-bar')).toContainText('Flash:');

  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-op-b.ts');
  await expect(page.locator('.status-bar')).not.toContainText('Flash:');

  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.editor-tab.active .editor-tab-label')).toHaveText('flash-op-a.ts');
  await focusEditor(page);
  await expect(page.locator('.cm-content')).toContainText('alpha beta gamma');
  await expect(page.locator('.status-bar')).not.toContainText('Flash:');
});

test('session capture and no-results cancel a pending operator without edits', async ({ page }) => {
  const doc = 'alpha beta alpha';

  await openEditor(page, doc);
  await page.keyboard.type('dgsalpha', { delay: 20 });
  await page.evaluate(() => {
    const fixture = window as unknown as { __vimFixture: { switchWithVimCapture: () => void } };
    fixture.__vimFixture.switchWithVimCapture();
  });
  await page.evaluate(() => {
    const fixture = window as unknown as { __vimFixture: { restoreCachedState: () => void } };
    fixture.__vimFixture.restoreCachedState();
  });
  expect((await state(page)).doc).toBe(doc);
  expect((await state(page)).undoDepth).toBe(0);
  expect((await state(page)).pending).toBe('');
  expect((await state(page)).flash).toBeNull();

  await openEditor(page, doc);
  await page.keyboard.type('dgsz', { delay: 20 });
  expect((await state(page)).flash).toBeNull();
  expect((await state(page)).doc).toBe(doc);
  expect((await state(page)).pending).toBe('');
  expect((await state(page)).mode).toBe('normal');
});

test('operator Flash disables repeat of the whole edit including insert payload', async ({ page }) => {
  await openEditor(page, 'alpha beta gamma delta');
  await page.keyboard.type('dgsbeta', { delay: 20 });
  await page.keyboard.press('Enter');
  expect((await state(page)).doc).toBe('eta gamma delta');
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('eta gamma delta');
  expect((await state(page)).undoDepth).toBe(1);

  await openEditor(page, 'alpha beta gamma delta');
  await page.keyboard.type('cgsbeta', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('Xeta gamma delta');
  const changeDepth = (await state(page)).undoDepth;
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('Xeta gamma delta');
  expect((await state(page)).undoDepth).toBe(changeDepth);

  await openEditor(page, 'alpha beta gamma');
  await page.keyboard.type('gUgsbeta', { delay: 20 });
  await page.keyboard.press('Enter');
  const cased = (await state(page)).doc;
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe(cased);

  await openEditor(page, 'alpha beta gamma');
  await page.keyboard.type('>gsbeta', { delay: 20 });
  await page.keyboard.press('Enter');
  const indented = (await state(page)).doc;
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe(indented);
});

test('canceling Flash preserves the previous ordinary dot repeat', async ({ page }) => {
  await openEditor(page, 'abcdef alpha');
  await page.keyboard.type('x');
  expect((await state(page)).doc).toBe('bcdef alpha');
  await page.keyboard.type('dgsz', { delay: 20 });
  expect((await state(page)).flash).toBeNull();
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('cdef alpha');
});

test('count before the operator also selects the Nth target', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha beta alpha');
  await page.keyboard.type('2dgsalpha', { delay: 20 });
  await expect(page.locator('.crumb-jump-label.is-current')).toHaveAttribute('data-offset', '22');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('alpha beta alpha beta alpha');
  expect((await state(page)).pending).toBe('');
});

test('an explicit operator gs mapping wins over Flash', async ({ page }) => {
  await openEditor(page, 'alpha', { operatorGs: '1' });

  await page.keyboard.type('dgs', { delay: 20 });

  expect((await state(page)).flash).toBeNull();
  expect((await state(page)).doc).toBe('lpha');
  expect((await state(page)).mode).toBe('normal');
});
