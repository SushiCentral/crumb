import { expect, test, type Locator, type Page } from '@playwright/test';

// The component fixture mounts the real Editor with the normal preference
// compartment. This spec checks the shared DOM hooks only; guide pixels are
// owned by the editor theme.
const FIXTURE = '/tests/e2e/editor-component-fixture.html';

async function openEditor(page: Page, doc: string): Promise<Locator> {
  await page.goto(`${FIXTURE}?a=${encodeURIComponent(doc)}`);
  const editor = page.getByTestId('code-editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  return editor;
}

async function setIndentGuides(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(value => {
    (window as unknown as Record<string, { setPreference: (key: string, next: boolean) => void }>)
      .__crumbEditor.setPreference('indentGuides', value);
  }, enabled);
}

function cssNumber(line: Locator, property: string): Promise<string> {
  return line.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name).trim(), property);
}

test('guide hooks follow indentation and infer blank lines between blocks', async ({ page }) => {
  const editor = await openEditor(page, 'function f() {\n  if (x) {\n\n    y;\n  }\n}');
  const lines = editor.locator('.cm-line');

  await expect(lines.nth(0)).not.toHaveClass(/cm-indent-guide-line/);
  await expect(lines.nth(1)).toHaveClass(/cm-indent-guide-line/);
  await expect.poll(() => cssNumber(lines.nth(1), '--cm-indent-count')).toBe('1');
  await expect.poll(() => cssNumber(lines.nth(1), '--cm-indent-step')).toBe('2ch');

  // The blank line sits between an indent-2 line and an indent-4 line.
  await expect(lines.nth(2)).toHaveClass(/cm-indent-guide-line/);
  await expect.poll(() => cssNumber(lines.nth(2), '--cm-indent-count')).toBe('2');

  await expect.poll(() => cssNumber(lines.nth(3), '--cm-indent-count')).toBe('2');
  await expect.poll(() => cssNumber(lines.nth(4), '--cm-indent-count')).toBe('1');
  await expect(lines.nth(5)).not.toHaveClass(/cm-indent-guide-line/);
});

test('the indentGuides preference removes and restores guides in place', async ({ page }) => {
  const editor = await openEditor(page, '  a\n  b');
  const guides = editor.locator('.cm-line.cm-indent-guide-line');
  const content = editor.locator('.cm-content');
  const before = await content.innerText();

  await expect(guides).toHaveCount(2);
  await setIndentGuides(page, false);
  await expect(guides).toHaveCount(0);

  await setIndentGuides(page, true);
  await expect(guides).toHaveCount(2);
  expect(await content.innerText()).toBe(before);
});
