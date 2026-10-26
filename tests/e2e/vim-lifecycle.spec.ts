import { expect, test, type Page } from '@playwright/test';

// Real EditorView proof for the isolated Vim module. This spec was first run
// against the stock engine with no lifecycle layer; those failures motivated
// the module boundary exercised here.
const FIXTURE = '/tests/e2e/vim-lifecycle-fixture.html';

const FROZEN_CLOCK = new Date('2035-01-01T00:00:00.000Z');

interface HarnessState {
  active: string;
  enabled: boolean;
  doc: string;
  cursor: number;
  mode: string;
  pending: string;
}

async function openLifecycle(
  page: Page,
  a: string,
  b: string,
  options: { map?: string; rhs?: string } = {},
): Promise<void> {
  const params = new URLSearchParams({ a, b });
  if (options.map) {
    params.set('map', options.map);
    params.set('rhs', options.rhs ?? '');
  }
  await page.goto(`${FIXTURE}?${params.toString()}`);
  const editor = page.getByTestId('code-editor');
  await editor.click();
  await expect(editor.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => (window as unknown as Record<string, any>).__crumbVim.setCursor(0));
}

async function state(page: Page): Promise<HarnessState> {
  return page.evaluate(() => (window as unknown as Record<string, any>).__crumbVim.current());
}

async function switchTo(page: Page, id: string): Promise<void> {
  await page.evaluate(target => (window as unknown as Record<string, any>).__crumbVim.switchTo(target), id);
}

async function setCursor(page: Page, offset: number): Promise<void> {
  await page.evaluate(target => (window as unknown as Record<string, any>).__crumbVim.setCursor(target), offset);
}

async function setVimEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(target => (window as unknown as Record<string, any>).__crumbVim.setVimEnabled(target), enabled);
}

async function expectCursor(page: Page, offset: number): Promise<void> {
  await expect.poll(async () => (await state(page)).cursor).toBe(offset);
}

async function blurPrompt(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(120);
}

async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.clock.pauseAt(FROZEN_CLOCK);
  const frozenAt = await page.evaluate(() => Date.now());
  await page.waitForTimeout(5);
  expect(await page.evaluate(() => Date.now())).toBe(frozenAt);
}

async function blurPromptWithClock(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.clock.runFor(1);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))).toBe(true);
}

test('dot repeats the last change after A -> B -> A', async ({ page }) => {
  await openLifecycle(page, 'one two three four', 'bravo charlie');

  await page.keyboard.type('dw');
  expect((await state(page)).doc).toBe('two three four');

  await switchTo(page, 'B');
  await switchTo(page, 'A');
  await page.keyboard.type('.');

  expect((await state(page)).doc).toBe('three four');
});

test('dot repeats the latest session-wide change after another tab edits', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'one two');

  await page.keyboard.type('dw');
  expect((await state(page)).doc).toBe('beta gamma');

  await switchTo(page, 'B');
  await page.keyboard.type('x');
  expect((await state(page)).doc).toBe('ne two');

  await switchTo(page, 'A');
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('eta gamma');
});

test('dot repeats an edit made in another tab without returning first', async ({ page }) => {
  await openLifecycle(page, 'alpha beta', 'one two');

  await page.keyboard.type('dw');
  expect((await state(page)).doc).toBe('beta');

  await switchTo(page, 'B');
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('two');
});

test('dot repeats the global insert payload of a change across tabs', async ({ page }) => {
  await openLifecycle(page, 'alpha beta', 'one two');

  await page.keyboard.type('cwX');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('X beta');

  await switchTo(page, 'B');
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('X two');
});

test('dot repeats a pure insert payload across tabs', async ({ page }) => {
  await openLifecycle(page, 'alpha', 'one two');

  await page.keyboard.type('iXY');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('XYalpha');

  await switchTo(page, 'B');
  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('XYone two');
});

test('named registers are global across a view switch', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'zzz');

  await page.keyboard.type('"ayw');
  await switchTo(page, 'B');
  await page.keyboard.type('"aP');

  expect((await state(page)).doc).toBe('alpha zzz');
});

test('committed search survives a view switch and keeps n/N working', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other');

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await switchTo(page, 'B');
  await switchTo(page, 'A');

  await page.keyboard.press('n');
  await expectCursor(page, 17);
  await page.keyboard.press('N');
  await expectCursor(page, 6);
  expect((await state(page)).doc).toBe('alpha beta gamma beta delta');
});

test('cancelling /partial and ?partial restores committed query and direction', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other');

  await page.keyboard.type('?beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 17);

  await page.keyboard.type('/partial');
  await page.keyboard.press('Escape');
  await setCursor(page, 0);
  await page.keyboard.press('n');
  await expectCursor(page, 17);

  await setCursor(page, 0);
  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await page.keyboard.type('?partial');
  await page.keyboard.press('Escape');
  await setCursor(page, 0);
  await page.keyboard.press('n');
  await expectCursor(page, 6);
});

test('blurring an incremental search restores the committed query and direction', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other');

  await page.keyboard.type('?beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 17);

  await page.keyboard.type('/partial');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(100);

  await setCursor(page, 0);
  await page.keyboard.press('n');
  await expectCursor(page, 17);
});

test('blurring a search prompt opened after an operator clears the pending operator', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other');

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await setCursor(page, 0);
  await page.keyboard.type('d/alpha');
  await blurPrompt(page);

  expect((await state(page)).pending).toBe('');
  await setCursor(page, 0);
  await page.keyboard.type('w');
  expect((await state(page)).doc).toBe('alpha beta gamma');
});

test('cancelled incremental search overlay does not repaint after the engine deadline', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other');

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await page.keyboard.type('/alpha');
  await blurPrompt(page);
  await page.waitForTimeout(150);
  expect(await page.locator('.cm-searchMatch').count()).toBe(0);
});

test('n after cancelling a query-less incremental search does not leave a delayed overlay', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other');
  await freezeClock(page);

  await page.keyboard.type('/alpha');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.clock.runFor(200);

  expect(await page.locator('.cm-searchMatch').count()).toBe(0);
});

test('gn after cancelling a query-less incremental search does not leave a delayed overlay', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other');
  await freezeClock(page);

  await page.keyboard.type('/alpha');
  await page.keyboard.press('Escape');
  await page.keyboard.type('gn');
  await page.clock.runFor(200);

  expect(await page.locator('.cm-searchMatch').count()).toBe(0);
});

for (const action of ['fn', 'mn', 'rn']) {
  test(`literal ${action} after cancelling a search keeps the delayed overlay cancelled`, async ({ page }) => {
    await openLifecycle(page, 'alpha beta gamma beta delta', 'other');
    await freezeClock(page);

    await page.keyboard.type('/beta');
    await page.keyboard.press('Enter');
    await expectCursor(page, 6);

    await page.keyboard.type('/alpha');
    await blurPromptWithClock(page);
    await page.keyboard.type(action);
    await page.clock.runFor(200);

    expect(await page.locator('.cm-searchMatch').count()).toBe(0);
  });
}

test('a mapping from n to a motion keeps the delayed overlay cancelled', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other', { map: 'n', rhs: 'h' });
  await freezeClock(page);

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await page.keyboard.type('/alpha');
  await blurPromptWithClock(page);
  await page.keyboard.type('n');
  await page.clock.runFor(200);

  expect(await page.locator('.cm-searchMatch').count()).toBe(0);
});

test('a newer n navigation supersedes a cancelled search overlay sweep', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other');
  await freezeClock(page);

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await page.keyboard.type('/beta');
  await blurPromptWithClock(page);

  await page.keyboard.press('n');
  await page.clock.runFor(200);
  await expectCursor(page, 17);
  expect(await page.locator('.cm-searchMatch').count()).toBeGreaterThan(0);
});

test('a newer mapped search supersedes a cancelled search overlay sweep', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other', { map: 'z', rhs: '?beta<CR>' });
  await freezeClock(page);

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await page.keyboard.type('/beta');
  await blurPromptWithClock(page);

  await page.keyboard.type('z');
  await page.clock.runFor(200);
  await expectCursor(page, 17);
  expect(await page.locator('.cm-searchMatch').count()).toBeGreaterThan(0);
});

test('mapped backward search commits update the cached direction for later cancellation', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma beta delta', 'other', { map: 'z', rhs: '?beta<CR>' });

  await page.keyboard.type('/beta');
  await page.keyboard.press('Enter');
  await expectCursor(page, 6);

  await setCursor(page, 0);
  await page.keyboard.type('z');
  await expectCursor(page, 17);

  await page.keyboard.type('/partial');
  await page.keyboard.press('Escape');
  await setCursor(page, 0);
  await page.keyboard.press('n');
  await expectCursor(page, 17);
});

test('cancelling a Visual-mode search with Escape leaves Visual active', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other');

  await page.keyboard.type('v');
  expect((await state(page)).mode).toBe('visual');

  await page.keyboard.type('/beta');
  expect((await state(page)).mode).toBe('search');
  await page.keyboard.press('Escape');

  expect((await state(page)).mode).toBe('visual');
  expect((await state(page)).doc).toBe('alpha beta gamma');
});

test('blurring a Visual-mode search leaves Visual active', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other');

  await page.keyboard.type('v');
  expect((await state(page)).mode).toBe('visual');

  await page.keyboard.type('/beta');
  expect((await state(page)).mode).toBe('search');
  await blurPrompt(page);

  expect((await state(page)).mode).toBe('visual');
  expect((await state(page)).doc).toBe('alpha beta gamma');
});

test('local marks survive A -> B -> A using fresh adapter-bound markers', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other doc');

  await page.keyboard.type('wma');
  await switchTo(page, 'B');
  await switchTo(page, 'A');

  await page.keyboard.type('gg0');
  await page.keyboard.type('iXX');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('XXalpha beta gamma');

  await page.keyboard.type('gg0');
  await page.keyboard.type('`a');
  await expectCursor(page, 8);
});

test('marks are invalidated rather than transplanted after edits while Vim is disabled', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other doc');

  await setCursor(page, 6);
  await page.keyboard.type('ma');

  await setVimEnabled(page, false);
  await page.evaluate(() => (window as unknown as Record<string, any>).__crumbVim.insertWhileDisabled('ZZ '));
  await setVimEnabled(page, true);

  await setCursor(page, 0);
  await page.keyboard.type('`a');

  expect((await state(page)).doc).toBe('ZZ alpha beta gamma');
  await expectCursor(page, 0);
});

test('releasing a closed document drops its cached marks', async ({ page }) => {
  await openLifecycle(page, 'alpha beta gamma', 'other doc');

  await setCursor(page, 6);
  await page.keyboard.type('ma');
  await switchTo(page, 'B');

  await page.evaluate(() => (window as unknown as Record<string, any>).__crumbVim.releaseDocument('A'));
  await switchTo(page, 'A');

  await setCursor(page, 0);
  await page.keyboard.type('`a');
  await expectCursor(page, 0);
});

test('pending input and mode state cannot leak into another tab', async ({ page }) => {
  await openLifecycle(page, 'alpha beta', 'one two', { map: 'gh', rhs: 'iMAPPED<Esc>' });

  await page.keyboard.type('d');
  expect((await state(page)).pending).toBe('d');

  await switchTo(page, 'B');
  expect((await state(page)).mode).toBe('normal');
  expect((await state(page)).pending).toBe('');
  await page.keyboard.type('w');
  expect((await state(page)).doc).toBe('one two');

  await switchTo(page, 'A');
  expect((await state(page)).doc).toBe('alpha beta');
  await page.keyboard.type('iabc');
  expect((await state(page)).mode).toBe('insert');

  await switchTo(page, 'B');
  expect((await state(page)).mode).toBe('normal');
  expect((await state(page)).doc).toBe('one two');
  await setCursor(page, 0);
  await page.keyboard.type('x');
  expect((await state(page)).doc).toBe('ne two');

  await switchTo(page, 'A');
  expect((await state(page)).doc).toBe('abcalpha beta');
  await page.keyboard.type('v');
  expect((await state(page)).mode).toBe('visual');
  await switchTo(page, 'B');
  expect((await state(page)).mode).toBe('normal');
  await setCursor(page, 0);
  await page.keyboard.type('x');
  expect((await state(page)).doc).toBe('e two');

  await switchTo(page, 'A');
  await page.keyboard.type('/abc');
  expect((await state(page)).mode).toBe('search');
  await switchTo(page, 'B');
  expect((await state(page)).mode).toBe('normal');
  expect((await state(page)).doc).toBe('e two');
  await setCursor(page, 0);
  await page.keyboard.type('iZ');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('Ze two');

  await switchTo(page, 'A');
  await page.keyboard.type('g');
  expect((await state(page)).pending).toBe('g');
  await switchTo(page, 'B');
  expect((await state(page)).mode).toBe('normal');
  await page.keyboard.type('h');
  expect((await state(page)).doc).toBe('Ze two');
  expect((await state(page)).mode).toBe('normal');
});

test('disabling Vim applies to every cached tab, not only the active one', async ({ page }) => {
  await openLifecycle(page, 'alpha', 'beta');

  await setVimEnabled(page, false);
  expect((await state(page)).mode).toBe('inactive');

  await switchTo(page, 'B');
  expect((await state(page)).enabled).toBe(false);
  expect((await state(page)).mode).toBe('inactive');

  await setVimEnabled(page, true);
  expect((await state(page)).mode).toBe('normal');

  await switchTo(page, 'A');
  expect((await state(page)).enabled).toBe(true);
  expect((await state(page)).mode).toBe('normal');
});

test('CodeMirror history survives tab switches and repeated Vim destroy/recreate', async ({ page }) => {
  await openLifecycle(page, 'alpha', 'beta');

  await page.keyboard.type('iXY');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('XYalpha');

  await switchTo(page, 'B');
  await switchTo(page, 'A');
  expect((await state(page)).doc).toBe('XYalpha');
  await page.keyboard.press('u');
  expect((await state(page)).doc).toBe('alpha');

  await setCursor(page, 0);
  await page.keyboard.type('iZZ');
  await page.keyboard.press('Escape');
  expect((await state(page)).doc).toBe('ZZalpha');

  for (let i = 0; i < 2; i += 1) {
    await setVimEnabled(page, false);
    await setVimEnabled(page, true);
  }
  expect((await state(page)).mode).toBe('normal');
  await page.keyboard.press('u');
  expect((await state(page)).doc).toBe('alpha');
});

test('registers, search, repeat and marks survive disable/re-enable while transient input does not', async ({ page }) => {
  await openLifecycle(page, 'one two three four', 'unused');

  await page.keyboard.type('"ayw');
  await page.keyboard.type('dw');
  expect((await state(page)).doc).toBe('two three four');

  await setCursor(page, 4);
  await page.keyboard.type('ma');

  await page.keyboard.type('/three');
  await page.keyboard.press('Enter');
  await expectCursor(page, 4);

  await page.keyboard.type('d');
  expect((await state(page)).pending).toBe('d');

  await setVimEnabled(page, false);
  expect((await state(page)).enabled).toBe(false);
  await setVimEnabled(page, true);

  expect((await state(page)).mode).toBe('normal');
  expect((await state(page)).pending).toBe('');

  await setCursor(page, 0);
  await page.keyboard.press('n');
  await expectCursor(page, 4);

  await setCursor(page, 10);
  await page.keyboard.type('`a');
  await expectCursor(page, 4);

  await page.keyboard.type('.');
  expect((await state(page)).doc).toBe('two four');

  await setCursor(page, 0);
  await page.keyboard.type('"aP');
  expect((await state(page)).doc).toBe('one two four');
});
