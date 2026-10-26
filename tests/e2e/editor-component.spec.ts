import { expect, test, type Locator, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';

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
  if (vim) await page.keyboard.type('gg0');
  else await page.keyboard.press('Control+Home');
}

interface DecodedImage {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

// Playwright has no pixel API, so decode its PNG screenshot directly. The
// renderer emits 8-bit RGB/RGBA, which keeps the unfiltering below small.
function decodePng(buffer: Buffer): DecodedImage {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const kind = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format (depth ${bitDepth}, color ${colorType})`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (kind === 'IDAT') {
      parts.push(data);
    } else if (kind === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const data = Buffer.alloc(stride * height);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[source];
    source += 1;
    const target = row * stride;
    const previous = target - stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[source + column];
      const left = column >= channels ? data[target + column - channels] : 0;
      const up = row > 0 ? data[previous + column] : 0;
      const upLeft = row > 0 && column >= channels ? data[previous + column - channels] : 0;
      let predictor = 0;
      if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        predictor = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
      data[target + column] = (value + predictor) & 0xff;
    }
    source += stride;
  }
  return { width, height, channels, data };
}

function pixelAt(image: DecodedImage, x: number, y: number): number[] {
  const index = (y * image.width + x) * image.channels;
  return Array.from(image.data.subarray(index, index + 3));
}

function rgbFromHex(value: string): number[] {
  const hex = value.replace(/^#/, '');
  const expanded = hex.length === 3 ? Array.from(hex, digit => digit + digit).join('') : hex;
  return [0, 2, 4].map(index => Number.parseInt(expanded.slice(index, index + 2), 16));
}

function expectColorClose(actual: number[], expected: number[]): void {
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(2);
  }
}

test('Vim is off by default and ordinary typing is unchanged', async ({ page }) => {
  const editor = await openEditor(page, { a: '' });

  await expectState(page, { enabled: false, mode: 'inactive' });
  await page.keyboard.type('iabc');

  await expect(editor.locator('.cm-content')).toHaveText('iabc');
  await expectState(page, { doc: 'iabc', mode: 'inactive' });
});

test('characterwise Visual mode shows the exact selected characters, including the cursor cell', async ({ page }) => {
  const editor = await openEditor(page, { a: 'alpha beta\nsecond line', vim: true });
  const cmEditor = editor.locator('.cm-editor');
  const selectionColor = 'rgb(54, 88, 120)';
  const accentColor = 'rgb(89, 185, 209)';
  const foregroundColor = 'rgb(229, 231, 235)';

  await cmEditor.evaluate((element, colors) => {
    element.style.setProperty('--selection', colors.selection);
    element.style.setProperty('--accent', colors.accent);
    element.style.setProperty('--text', colors.foreground);
  }, { selection: selectionColor, accent: accentColor, foreground: foregroundColor });

  await page.keyboard.press('v');
  await expect(cmEditor).toHaveClass(/vim-visual-mode/);

  const cursor = cmEditor.locator('.cm-fat-cursor');
  await expect(cursor).toBeVisible();
  const initialCursorBox = await cursor.boundingBox();
  expect(initialCursorBox).not.toBeNull();
  const initialCursorStyle = await cursor.evaluate(element => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color, boxShadow: style.boxShadow };
  });
  expect(initialCursorStyle.backgroundColor).toBe(selectionColor);
  expect(initialCursorStyle.color).toBe(foregroundColor);
  expect(initialCursorStyle.boxShadow).toContain('rgb(89, 185, 209)');

  // `v` must select exactly the character under the cursor, not a collapsed
  // range. Verify the rendered CodeMirror selection, not a synthetic text Range.
  expect((await state(page)).cursor.selected).toBe(1);
  const initialSelection = cmEditor.locator('.cm-selectionBackground');
  await expect(initialSelection).toHaveCount(1);
  const initialSelectionBox = await initialSelection.boundingBox();
  expect(initialSelectionBox).not.toBeNull();
  expect(Math.abs(initialCursorBox!.x - initialSelectionBox!.x)).toBeLessThan(2);
  expect(initialCursorBox!.width).toBeCloseTo(initialSelectionBox!.width, 0);
  expect(initialSelectionBox!.width).toBeLessThan(100);

  await page.keyboard.press('l');
  await expect.poll(async () => (await state(page)).cursor.selected).toBe(2);

  const expandedSelection = cmEditor.locator('.cm-selectionBackground');
  await expect(expandedSelection).toHaveCount(1);
  const expandedBox = await expandedSelection.boundingBox();
  expect(expandedBox).not.toBeNull();
  expect(expandedBox!.width).toBeCloseTo(initialSelectionBox!.width * 2, 0);
  expect(expandedBox!.height).toBeCloseTo(initialSelectionBox!.height, 0);
  expect(expandedBox!.width).toBeLessThan(100);

  const movedCursorBox = await cursor.boundingBox();
  expect(movedCursorBox).not.toBeNull();
  expect(movedCursorBox!.x).toBeCloseTo(initialSelectionBox!.x + initialSelectionBox!.width, 0);
  expect(movedCursorBox!.width).toBeCloseTo(initialSelectionBox!.width, 0);
  expect(await cursor.evaluate(element => getComputedStyle(element).color)).toBe(foregroundColor);
  expect(await cursor.evaluate(element => getComputedStyle(element).boxShadow)).toContain('rgb(89, 185, 209)');
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

  await page.keyboard.type('gg0');
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

  await page.keyboard.type('gg0');
  await page.keyboard.type('iZ');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.cm-content')).toHaveText('Zone two');

  await switchTab(page, 'A');
  await expectState(page, { activeTabId: 'A', mode: 'normal', doc: 'alpha beta' });
  await page.keyboard.type('gg0');
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
  await page.keyboard.type('gg0');
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

test('selected text paints above the active-line background while the rest of the line stays highlighted', async ({ page }) => {
  const editor = await openEditor(page, { a: '                    \nsecond line' });

  // Select ten spaces in the middle of the active line. Spaces avoid glyph
  // pixels at the sampled points.
  await page.keyboard.press('Control+Home');
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight');
  for (let index = 0; index < 10; index += 1) await page.keyboard.press('Shift+ArrowRight');
  await expectState(page, { cursor: { line: 1, column: 16, selected: 10 } });

  const selection = editor.locator('.cm-selectionBackground');
  await expect(selection).toHaveCount(1);
  const box = await selection.boundingBox();
  expect(box).not.toBeNull();

  // Read the fixture's production theme variables rather than synthetic colors.
  const colors = await editor.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      selection: style.getPropertyValue('--selection').trim(),
      activeLine: style.getPropertyValue('--active-line').trim(),
    };
  });
  const selectionColor = rgbFromHex(colors.selection);
  const activeLineColor = rgbFromHex(colors.activeLine);
  expect(selectionColor).not.toEqual(activeLineColor);

  const screenshot = decodePng(await page.screenshot());
  const middleY = Math.round(box!.y + box!.height / 2);
  const selectedPixel = pixelAt(screenshot, Math.round(box!.x + box!.width / 2), middleY);
  const activeLinePixel = pixelAt(screenshot, Math.round(box!.x - 8), middleY);

  expectColorClose(selectedPixel, selectionColor);
  expectColorClose(activeLinePixel, activeLineColor);
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
