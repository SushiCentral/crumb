import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const pythonFixture = readFileSync(
  new URL('../fixtures/vim-flash-python.py', import.meta.url),
  'utf8',
);
const flashTrace = JSON.parse(readFileSync(
  new URL('../fixtures/vim-flash-traces.json', import.meta.url),
  'utf8',
)) as {
  fixture: { viewport: { endLine: number } };
  anchors: { importTime: { offset: number }; runtime: { offset: number } };
  traces: Record<string, {
    matchCount: number;
    targetOffset: number;
    targetLabel: string;
    expectedAnchorLabels: { importTime: string | null; runtime: string | null };
  }>;
};

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

interface FixtureMetrics {
  visibleRanges: Array<{ from: number; to: number }>;
  scrollLeft: number;
  scrollTop: number;
  scroller: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  layer: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
  gutter: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
}

interface RenderedLabel {
  label: string;
  offset: number;
  current: boolean;
  rect: { left: number; top: number; right: number; bottom: number };
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return page.evaluate(() => {
    const fixtureWindow = window as unknown as {
      __vimFixture: { getState: () => FixtureState };
    };
    return fixtureWindow.__vimFixture.getState();
  });
}

async function fixtureMetrics(page: Page): Promise<FixtureMetrics> {
  return page.evaluate(() => {
    const fixtureWindow = window as unknown as {
      __vimFixture: { getMetrics: () => FixtureMetrics };
    };
    return fixtureWindow.__vimFixture.getMetrics();
  });
}

async function renderedLabels(page: Page): Promise<RenderedLabel[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.crumb-jump-label')]
    .filter(element => getComputedStyle(element).display !== 'none')
    .map(element => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.textContent ?? '',
        offset: Number(element.dataset.offset),
        current: element.classList.contains('is-current'),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      };
    }));
}

function labelAtOffset(page: Page, offset: number): Locator {
  return page.locator(`.crumb-jump-label[data-offset="${offset}"]`);
}

async function pressLabelAtOffset(page: Page, offset: number): Promise<void> {
  const label = await labelAtOffset(page, offset).getAttribute('data-label');
  if (!label) throw new Error(`No label at offset ${offset}`);
  await page.keyboard.press(label);
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
  await expect.poll(async () => (await fixtureState(page)).cursor).toBe(0);
  return editor;
}

async function startFlash(page: Page, query: string): Promise<void> {
  await page.keyboard.type(`s${query}`, { delay: 15 });
}

test('live labels and highlights appear without Enter and no editor chip is mounted', async ({ page }) => {
  const editor = await openEditor(page, 'alpha beta alpha gamma alpha');

  await startFlash(page, 'alpha');

  await expect(page.locator('.crumb-jump-prompt')).toHaveCount(0);
  await expect(page.locator('.cm-editor.cm-flash-active')).toHaveCount(1);
  await expect(page.locator('.crumb-flash-label-layer')).toHaveCount(1);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(3);
  await expect(page.locator('.crumb-jump-live')).toContainText('3 matches');
  await expect(page.locator('.crumb-jump-match')).toHaveCount(3);
  await expect(page.locator('.crumb-jump-current')).toHaveCount(1);
  await expect(page.locator('.crumb-flash-dim')).not.toHaveCount(0);
  await expect(editor.locator('.cm-content')).toBeFocused();

  const active = await fixtureState(page);
  expect(active.flash).toEqual({ query: 'alpha', matchCount: 3 });

  const labels = await renderedLabels(page);
  expect(new Set(labels.map(label => label.label)).size).toBe(3);
  expect(labels.find(label => label.offset === 11)?.current).toBe(true);
  await expect(page.locator('.crumb-jump-label.is-current')).toHaveAttribute('data-offset', '11');

  const metrics = await fixtureMetrics(page);
  for (const label of labels) {
    expect(label.rect.top).toBeGreaterThanOrEqual(metrics.scroller.top - 1);
    expect(label.rect.bottom).toBeLessThanOrEqual(metrics.scroller.bottom + 1);
    expect(label.rect.left).toBeGreaterThanOrEqual(metrics.scroller.left - 1);
    expect(label.rect.right).toBeLessThanOrEqual(metrics.scroller.right + 1);
  }

  await pressLabelAtOffset(page, 11);

  const state = await fixtureState(page);
  expect(state.mode).toBe('normal');
  expect(state.cursor).toBe(11);
  expect(state.ranges).toEqual([{ anchor: 11, head: 11 }]);
  expect(state.flash).toBeNull();
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);
  await expect(page.locator('.cm-editor.cm-flash-active')).toHaveCount(0);
});

test('Space remains literal query text while the leader is enabled', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha beta', { leader: '1' });

  await startFlash(page, 'alpha beta');

  expect((await fixtureState(page)).flash).toEqual({ query: 'alpha beta', matchCount: 2 });
  await expect(page.locator('.crumb-jump-label')).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test('label-shaped continuation characters skip collision and extend the live query', async ({ page }) => {
  await openEditor(page, 'aa aa aa');

  await startFlash(page, 'a');
  await expect(page.locator('.crumb-jump-label')).toHaveCount(6);
  const labels = await page.locator('.crumb-jump-label').allTextContents();
  expect(labels).not.toContain('a');

  const first = await fixtureState(page);
  expect(first.flash).toEqual({ query: 'a', matchCount: 6 });

  // `a` follows every `a` match in the document, so it is not a label and
  // extends the query instead of jumping.
  await page.keyboard.type('a');

  const extended = await fixtureState(page);
  expect(extended.flash).toEqual({ query: 'aa', matchCount: 3 });
  await expect(page.locator('.crumb-jump-label')).toHaveCount(3);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(3);

  await page.keyboard.press('Escape');
  expect((await fixtureState(page)).flash).toBeNull();
});

test('Enter commits the next forward target from the activation cursor', async ({ page }) => {
  const editor = await openEditor(page, 'foo bar foo baz foo');
  await page.keyboard.type('4l');
  expect((await fixtureState(page)).cursor).toBe(4);

  await startFlash(page, 'foo');
  expect((await fixtureState(page)).flash).toEqual({ query: 'foo', matchCount: 3 });
  await expect(editor.locator('.cm-content')).toBeFocused();

  await page.keyboard.press('Enter');

  const state = await fixtureState(page);
  expect(state.cursor).toBe(8);
  expect(state.flash).toBeNull();
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
});

test('Backspace recomputes matches and the next Enter target', async ({ page }) => {
  await openEditor(page, 'abc ab');

  await startFlash(page, 'abc');
  expect((await fixtureState(page)).flash).toEqual({ query: 'abc', matchCount: 1 });

  await page.keyboard.press('Backspace');
  expect((await fixtureState(page)).flash).toEqual({ query: 'ab', matchCount: 2 });
  await expect(page.locator('.crumb-jump-match')).toHaveCount(2);

  await page.keyboard.press('Enter');
  expect((await fixtureState(page)).cursor).toBe(4);
});

test('a nonempty query with no matches exits Flash without leaking the typing key', async ({ page }) => {
  const editor = await openEditor(page, 'needle here');

  await startFlash(page, 'z');

  const state = await fixtureState(page);
  expect(state.mode).toBe('normal');
  expect(state.cursor).toBe(0);
  expect(state.ranges).toEqual([{ anchor: 0, head: 0 }]);
  expect(state.flash).toBeNull();
  await expect(editor.locator('.cm-content')).toHaveText('needle here');
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);

  await page.keyboard.type('iZ');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.cm-content')).toHaveText('Zneedle here');
});

test('a zero-result query in Visual restores the activation selection and exits Flash', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await page.keyboard.type('vl');

  await startFlash(page, 'z');

  const state = await fixtureState(page);
  expect(state.mode).toBe('visual');
  expect(state.ranges).toEqual([{ anchor: 0, head: 2 }]);
  expect(state.flash).toBeNull();
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);
});

test('Backspace to an empty query keeps Flash active without highlights', async ({ page }) => {
  await openEditor(page, 'needle here');

  await page.keyboard.type('s');
  expect((await fixtureState(page)).flash).toEqual({ query: '', matchCount: 0 });

  await page.keyboard.press('Backspace');
  expect((await fixtureState(page)).flash).toEqual({ query: '', matchCount: 0 });
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(1);

  await page.keyboard.type('n');
  expect((await fixtureState(page)).flash).toEqual({ query: 'n', matchCount: 1 });
  await page.keyboard.press('Escape');
});

test('Flash-local ignorecase and smartcase match the oracle policy', async ({ page }) => {
  await openEditor(page, 'Time time TIME');

  await startFlash(page, 'time');
  expect((await fixtureState(page)).flash).toEqual({ query: 'time', matchCount: 3 });
  await expect(page.locator('.crumb-jump-label')).toHaveCount(3);

  await page.keyboard.press('Escape');
  await startFlash(page, 'Time');
  expect((await fixtureState(page)).flash).toEqual({ query: 'Time', matchCount: 1 });
  await expect(page.locator('.crumb-jump-label')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('the checked-in Python oracle trace drives labels, targets, and uppercase overflow', async ({ page }) => {
  await openEditor(page, pythonFixture, {
    lines: String(flashTrace.fixture.viewport.endLine),
  });

  const queries = Object.keys(flashTrace.traces);
  const importAnchor = flashTrace.anchors.importTime.offset;
  const runtimeAnchor = flashTrace.anchors.runtime.offset;

  await page.keyboard.type('s');
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    const previous = index === 0 ? '' : queries[index - 1];
    await page.keyboard.type(query.slice(previous.length), { delay: 40 });
    const step = flashTrace.traces[query];
    expect((await fixtureState(page)).flash).toEqual({
      query,
      matchCount: step.matchCount,
    });

    if (step.expectedAnchorLabels.importTime === null) {
      await expect(labelAtOffset(page, importAnchor)).toHaveCount(0);
    } else {
      await expect(labelAtOffset(page, importAnchor)).toHaveText(
        step.expectedAnchorLabels.importTime,
      );
    }
    if (step.expectedAnchorLabels.runtime === null) {
      await expect(labelAtOffset(page, runtimeAnchor)).toHaveCount(0);
    } else {
      await expect(labelAtOffset(page, runtimeAnchor)).toHaveText(
        step.expectedAnchorLabels.runtime,
      );
    }
    await expect(labelAtOffset(page, step.targetOffset)).toHaveClass(/is-current/);
    await expect(labelAtOffset(page, step.targetOffset)).toHaveText(step.targetLabel);
    await expect(page.locator('.crumb-jump-label.is-current')).toHaveAttribute(
      'data-offset',
      String(step.targetOffset),
    );
  }

  await page.keyboard.press('Escape');
});

test('badges stay inside the true viewport and follow horizontal scroll', async ({ page }) => {
  await openEditor(page, 'x'.repeat(400), { width: '180' });
  await startFlash(page, 'x');

  const assertInsideScroller = async () => {
    const metrics = await fixtureMetrics(page);
    const labels = await renderedLabels(page);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.rect.top).toBeGreaterThanOrEqual(metrics.scroller.top - 1);
      expect(label.rect.bottom).toBeLessThanOrEqual(metrics.scroller.bottom + 1);
      expect(label.rect.left).toBeGreaterThanOrEqual(metrics.scroller.left - 1);
      expect(label.rect.right).toBeLessThanOrEqual(metrics.scroller.right + 1);
    }
  };

  await assertInsideScroller();
  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { setScroll: (left: number, top?: number) => void } })
      .__vimFixture.setScroll(120, 0);
  });
  await expect.poll(async () => (await renderedLabels(page)).some(label => label.offset === 0)).toBe(false);
  await expect.poll(async () => (await renderedLabels(page)).length).toBeGreaterThan(0);
  await assertInsideScroller();
});

test('preview motions do not change registers or the undo state', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  const before = await page.evaluate(() => {
    const fixture = (window as unknown as {
      __vimFixture: { getRegister: (name: string) => unknown; getState: () => { undoDepth: number } };
    }).__vimFixture;
    return { register: fixture.getRegister('"'), undoDepth: fixture.getState().undoDepth };
  });

  await page.keyboard.type('vl');
  await startFlash(page, 'alpha');

  const after = await page.evaluate(() => {
    const fixture = (window as unknown as {
      __vimFixture: { getRegister: (name: string) => unknown; getState: () => { undoDepth: number } };
    }).__vimFixture;
    return { register: fixture.getRegister('"'), undoDepth: fixture.getState().undoDepth };
  });
  expect(after).toEqual(before);
  await page.keyboard.press('Escape');
});

test('a committed Flash jump records one navigable departure for Ctrl-o', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await startFlash(page, 'alpha');
  await pressLabelAtOffset(page, 11);
  expect((await fixtureState(page)).cursor).toBe(11);

  await page.keyboard.press('Control+o');

  expect((await fixtureState(page)).cursor).toBe(0);
  expect((await fixtureState(page)).mode).toBe('normal');
});

test('mouse selection cancels Flash and preserves the user selection', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await startFlash(page, 'alpha');
  const coords = await page.evaluate(() => {
    const fixture = (window as unknown as {
      __vimFixture: { getCoordsAt: (offset: number) => { x: number; y: number; height: number } | null };
    }).__vimFixture;
    return fixture.getCoordsAt(4);
  });
  if (!coords) throw new Error('No coordinates');

  await page.mouse.click(coords.x + 1, coords.y + coords.height / 2);

  await expect.poll(async () => (await fixtureState(page)).flash).toBeNull();
  expect((await fixtureState(page)).cursor).toBe(4);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.cm-editor.cm-flash-active')).toHaveCount(0);
});

test('external document edits cancel without restoring stale preview offsets', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await page.keyboard.type('vl');
  await startFlash(page, 'alpha');
  expect((await fixtureState(page)).ranges).toEqual([{ anchor: 0, head: 12 }]);

  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { replaceDoc: (text: string) => void } })
      .__vimFixture.replaceDoc('replacement text');
  });

  await expect.poll(async () => (await fixtureState(page)).flash).toBeNull();
  expect((await fixtureState(page)).doc).toBe('replacement text');
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.cm-editor.cm-flash-active')).toHaveCount(0);
});

test('blur restores the transient Visual preview and keeps the Visual type', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await page.keyboard.type('vl');
  await startFlash(page, 'alpha');
  expect((await fixtureState(page)).ranges).toEqual([{ anchor: 0, head: 12 }]);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await expect.poll(async () => (await fixtureState(page)).flash).toBeNull();
  const restored = await fixtureState(page);
  expect(restored.mode).toBe('visual');
  expect(restored.ranges).toEqual([{ anchor: 0, head: 2 }]);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
});

test('session capture restores a transient Visual preview before saving state', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await page.keyboard.type('vl');
  await startFlash(page, 'alpha');
  expect((await fixtureState(page)).ranges).toEqual([{ anchor: 0, head: 12 }]);

  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { switchWithVimCapture: () => void } })
      .__vimFixture.switchWithVimCapture();
  });
  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { restoreCachedState: () => void } })
      .__vimFixture.restoreCachedState();
  });

  const restored = await fixtureState(page);
  expect(restored.mode).toBe('normal');
  expect(restored.ranges).toEqual([{ anchor: 1, head: 1 }]);
  expect(restored.flash).toBeNull();
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
});

test('Visual line and block Escape restore their activation selections', async ({ page }) => {
  await openEditor(page, 'alpha beta\nsecond alpha\nalpha third');
  await page.keyboard.type('V');
  await startFlash(page, 'alpha');
  expect((await fixtureState(page)).ranges).toEqual([{ anchor: 0, head: 23 }]);
  await page.keyboard.press('Escape');
  let state = await fixtureState(page);
  expect(state.mode).toBe('normal');
  expect(state.ranges).toEqual([{ anchor: 0, head: 0 }]);

  await openEditor(page, 'xax\nbbb\nxcx');
  await page.keyboard.press('Control+v');
  await page.keyboard.type('j');
  await startFlash(page, 'c');
  expect((await fixtureState(page)).mode).toBe('visual-block');
  await page.keyboard.press('Escape');
  state = await fixtureState(page);
  expect(state.mode).toBe('normal');
  expect(state.ranges).toEqual([{ anchor: 4, head: 4 }]);
});

test('labels sit immediately after the match on the same text baseline without shifting layout', async ({ page }) => {
  const editor = await openEditor(page, 'import time\nconst value = 1');
  const lineBefore = await editor.locator('.cm-line').first().boundingBox();
  if (!lineBefore) throw new Error('No line bounds');

  await startFlash(page, 'import');
  await expect.poll(async () => (await renderedLabels(page)).length).toBe(1);

  const label = (await renderedLabels(page))[0];
  const matchEnd = await page.evaluate(() => {
    const fixture = (window as unknown as {
      __vimFixture: { getCharRect: (offset: number) => { left: number; right: number; top: number; bottom: number } | null };
    }).__vimFixture;
    return fixture.getCharRect(5);
  });
  if (!matchEnd) throw new Error('No match char bounds');

  expect(label.offset).toBe(0);
  expect(Math.abs(label.rect.left - matchEnd.right)).toBeLessThanOrEqual(2);
  expect(label.rect.top).toBeGreaterThanOrEqual(matchEnd.top - 1);
  expect(label.rect.top).toBeLessThan(matchEnd.bottom);
  expect(label.rect.bottom).toBeLessThanOrEqual(matchEnd.bottom + 1);

  const lineAfter = await editor.locator('.cm-line').first().boundingBox();
  expect(lineAfter).toEqual(lineBefore);
});

test('manual Visual scrolling settles without reapplying the native preview', async ({ page }) => {
  const doc = Array.from({ length: 120 }, (_, index) => `alpha row ${index}`).join('\n');
  await openEditor(page, doc, { lines: '8' });
  await page.keyboard.type('v');
  await startFlash(page, 'alpha');
  expect((await fixtureState(page)).mode).toBe('visual');

  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { setScroll: (left: number, top?: number) => void } })
      .__vimFixture.setScroll(0, 500);
  });
  await page.waitForTimeout(700);

  const metrics = await fixtureMetrics(page);
  expect(Math.abs(metrics.scrollTop - 500)).toBeLessThanOrEqual(2);
});

test('Escape from an offscreen activation keeps the activation scroll view', async ({ page }) => {
  const doc = Array.from({ length: 120 }, (_, index) => `alpha row ${index}`).join('\n');
  await openEditor(page, doc, { lines: '8' });

  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { setScroll: (left: number, top?: number) => void } })
      .__vimFixture.setScroll(0, 500);
  });
  await page.keyboard.type('s');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const metrics = await fixtureMetrics(page);
  expect(metrics.scrollTop).toBe(500);
  expect((await fixtureState(page)).flash).toBeNull();
});

test('Flash preview and escape preserve the nostartofline goal on short lines', async ({ page }) => {
  await openEditor(page, 'abcdefghij\nx\nabcdefghij');

  await page.keyboard.type('$jj');
  expect((await fixtureState(page)).cursor).toBe(22);
  await page.keyboard.type('gg0$j');
  expect((await fixtureState(page)).cursor).toBe(11);

  await page.keyboard.type('s');
  await page.keyboard.press('Escape');
  await page.keyboard.type('j');
  expect((await fixtureState(page)).cursor).toBe(22);

  await openEditor(page, 'abcdefghij\nx\nabcdefghij');
  await page.keyboard.type('10|j');
  expect((await fixtureState(page)).cursor).toBe(11);
  await page.keyboard.type('s');
  await page.keyboard.press('Escape');
  await page.keyboard.type('j');
  expect((await fixtureState(page)).cursor).toBe(22);
});

test('sticky gutter clips candidates and badges deterministically without overlap', async ({ page }) => {
  await openEditor(page, 'x'.repeat(400), { width: '180' });
  await startFlash(page, 'x');
  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { setScroll: (left: number, top?: number) => void } })
      .__vimFixture.setScroll(180, 0);
  });
  await expect.poll(async () => (await fixtureMetrics(page)).scrollLeft).toBe(180);
  await expect.poll(async () => (await renderedLabels(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(100);

  const metrics = await fixtureMetrics(page);
  const labels = await renderedLabels(page);
  const usableLeft = Math.max(metrics.scroller.left, metrics.gutter?.right ?? metrics.scroller.left);
  for (const label of labels) {
    expect(label.rect.left).toBeGreaterThanOrEqual(usableLeft - 1);
    expect(label.rect.right).toBeLessThanOrEqual(metrics.scroller.right + 1);
  }
  for (let a = 0; a < labels.length; a += 1) {
    for (let b = a + 1; b < labels.length; b += 1) {
      const left = labels[a];
      const right = labels[b];
      const overlaps = left.rect.left < right.rect.right
        && right.rect.left < left.rect.right
        && left.rect.top < right.rect.bottom
        && right.rect.top < left.rect.bottom;
      expect(overlaps).toBe(false);
    }
  }
});

test('wrapped and scaled Flash labels stay inside the usable text rectangle', async ({ page }) => {
  const doc = `${'x'.repeat(40)} ${'x'.repeat(40)} ${'x'.repeat(40)} ${'x'.repeat(40)}`;
  await openEditor(page, doc, { width: '180', wrap: '1' });
  await startFlash(page, 'x');
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('[data-testid="code-editor"]');
    if (editor) editor.style.zoom = '1.25';
  });
  await page.waitForTimeout(300);

  const metrics = await fixtureMetrics(page);
  const labels = await renderedLabels(page);
  expect(labels.length).toBeGreaterThan(0);
  const usableLeft = Math.max(metrics.scroller.left, metrics.gutter?.right ?? metrics.scroller.left);
  for (const label of labels) {
    expect(label.rect.left).toBeGreaterThanOrEqual(usableLeft - 1);
    expect(label.rect.right).toBeLessThanOrEqual(metrics.scroller.right + 1);
    expect(label.rect.top).toBeGreaterThanOrEqual(metrics.scroller.top - 1);
    expect(label.rect.bottom).toBeLessThanOrEqual(metrics.scroller.bottom + 1);
  }
});

test('Visual character preview moves the native head live and Escape restores activation', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await page.keyboard.type('vl');
  const activation = await fixtureState(page);
  expect(activation.mode).toBe('visual');
  expect(activation.ranges).toEqual([{ anchor: 0, head: 2 }]);

  await startFlash(page, 'alpha');

  const preview = await fixtureState(page);
  expect(preview.mode).toBe('visual');
  expect(preview.ranges).toEqual([{ anchor: 0, head: 12 }]);
  expect(preview.flash).toEqual({ query: 'alpha', matchCount: 2 });

  await page.keyboard.press('Escape');

  const restored = await fixtureState(page);
  expect(restored.mode).toBe('normal');
  expect(restored.ranges).toEqual([{ anchor: 1, head: 1 }]);
  expect(restored.flash).toBeNull();
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
});

test('Visual line preview follows the live target and a label commits it', async ({ page }) => {
  await openEditor(page, 'alpha beta\nsecond alpha\nalpha third');
  await page.keyboard.type('V');

  await startFlash(page, 'alpha');

  const preview = await fixtureState(page);
  expect(preview.mode).toBe('visual-line');
  expect(preview.ranges).toEqual([{ anchor: 0, head: 23 }]);

  await pressLabelAtOffset(page, 24);

  const committed = await fixtureState(page);
  expect(committed.mode).toBe('visual-line');
  expect(committed.ranges).toEqual([{ anchor: 0, head: 35 }]);
  expect(committed.flash).toBeNull();
});

test('Visual block preview keeps native geometry and Enter commits the live target', async ({ page }) => {
  await openEditor(page, 'xax\nbbb\nxcx');
  await page.keyboard.press('Control+v');
  await page.keyboard.type('j');

  await startFlash(page, 'c');

  const preview = await fixtureState(page);
  expect(preview.mode).toBe('visual-block');
  expect(preview.ranges).toEqual([
    { anchor: 0, head: 2 },
    { anchor: 4, head: 6 },
    { anchor: 8, head: 10 },
  ]);

  await page.keyboard.press('Enter');

  const committed = await fixtureState(page);
  expect(committed.mode).toBe('visual-block');
  expect(committed.ranges).toEqual(preview.ranges);
  expect(committed.flash).toBeNull();
});

test('cached EditorState restoration does not resurrect transient decorations', async ({ page }) => {
  await openEditor(page, 'alpha beta alpha');
  await startFlash(page, 'alpha');
  await expect(page.locator('.crumb-jump-match')).toHaveCount(2);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(2);

  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { cacheStateAndSwitch: () => void } })
      .__vimFixture.cacheStateAndSwitch();
  });

  expect((await fixtureState(page)).flash).toBeNull();
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);

  await page.evaluate(() => {
    (window as unknown as { __vimFixture: { restoreCachedState: () => void } })
      .__vimFixture.restoreCachedState();
  });

  expect((await fixtureState(page)).flash).toBeNull();
  await expect(page.locator('.crumb-jump-match')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-label')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-live')).toHaveCount(0);
  await expect(page.locator('.crumb-jump-prompt')).toHaveCount(0);
});
