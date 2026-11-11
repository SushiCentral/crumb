import { expect, test } from '@playwright/test';
import { focusEditor, openApp, openFileViaShortcut } from './app-vim-helpers';

const content = [
  'const firstNeedle = "needle at the top";',
  'const secondNeedle = "needle in the middle";',
  'const thirdNeedle = "needle at the bottom";',
].join('\n');

type RGB = [number, number, number];

function luminance(color: RGB): number {
  const [red, green, blue] = color.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: RGB, background: RGB): number {
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

async function startFlash(page: Parameters<typeof openApp>[0], theme: string): Promise<void> {
  await page.addInitScript(value => {
    localStorage.setItem('crumb.theme', value);
    localStorage.setItem('crumb.fontSize', '13');
  }, theme);
  await openApp(page, { vim: true, files: { '/tmp/flash-visual.ts': content } });
  await openFileViaShortcut(page, '/tmp/flash-visual.ts');
  await focusEditor(page);
  await page.keyboard.type('sneedle');
  await expect(page.locator('.status-bar')).toContainText('Flash:');
}

for (const theme of ['crumb', 'dracula', 'catppuccin-latte']) {
  test(`Flash hierarchy is legible in ${theme}`, async ({ page }) => {
    await startFlash(page, theme);

    const view = page.locator('.cm-editor');
    await expect(view).toHaveClass(/cm-flash-active/);
    await expect(view.locator('.crumb-flash-dim').first()).toBeVisible();
    await expect(view.locator('.crumb-jump-match').first()).toBeVisible();
    await expect(view.locator('.crumb-jump-current').first()).toBeVisible();
    await expect(view.locator('.crumb-flash-label-layer')).toHaveCount(1);
    await expect(view.locator('.crumb-jump-label').first()).toBeVisible();

    const styles = await view.evaluate(editor => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const channels = (value: string): [number, number, number] => {
        if (!context) throw new Error('Canvas is required for color contrast checks');
        context.fillStyle = value;
        context.clearRect(0, 0, 1, 1);
        context.fillRect(0, 0, 1, 1);
        const pixel = context.getImageData(0, 0, 1, 1).data;
        return [pixel[0], pixel[1], pixel[2]];
      };
      const dim = editor.querySelector<HTMLElement>('.crumb-flash-dim');
      const match = editor.querySelector<HTMLElement>('.crumb-jump-match:not(.crumb-jump-current)');
      const current = editor.querySelector<HTMLElement>('.crumb-jump-current');
      const label = editor.querySelector<HTMLElement>('.crumb-jump-label:not(.is-current)');
      const currentLabel = editor.querySelector<HTMLElement>('.crumb-jump-label.is-current');
      const content = editor.querySelector<HTMLElement>('.cm-content');
      return {
        background: channels(getComputedStyle(editor).backgroundColor),
        baseBackground: channels(getComputedStyle(editor).getPropertyValue('--editor').trim()),
        editorOpacity: Number.parseFloat(getComputedStyle(editor).opacity),
        contentOpacity: content ? Number.parseFloat(getComputedStyle(content).opacity) : 0,
        dimOpacity: dim ? Number.parseFloat(getComputedStyle(dim).opacity) : 1,
        matchOpacity: match ? Number.parseFloat(getComputedStyle(match).opacity) : 0,
        matchBackground: match ? channels(getComputedStyle(match).backgroundColor) : [0, 0, 0] as [number, number, number],
        matchBackgroundImage: match ? getComputedStyle(match).backgroundImage : 'none',
        targetBackground: current ? channels(getComputedStyle(current).backgroundColor) : [0, 0, 0] as [number, number, number],
        targetForeground: current ? channels(getComputedStyle(current).color) : [0, 0, 0] as [number, number, number],
        targetBackgroundImage: current ? getComputedStyle(current).backgroundImage : 'none',
        labelFontSize: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
        labelWidth: label ? Number.parseFloat(getComputedStyle(label).width) : 0,
        labelHeight: label ? Number.parseFloat(getComputedStyle(label).height) : 0,
        lineHeight: Number.parseFloat(getComputedStyle(editor).lineHeight),
        labelPadding: label ? getComputedStyle(label).padding : '1px',
        labelBorderWidth: label ? getComputedStyle(label).borderWidth : '1px',
        labelRadius: label ? getComputedStyle(label).borderRadius : '1px',
        labelShadow: label ? getComputedStyle(label).boxShadow : 'shadow',
        editorFontSize: content ? Number.parseFloat(getComputedStyle(content).fontSize) : 0,
        labelBackground: label ? channels(getComputedStyle(label).backgroundColor) : [0, 0, 0] as [number, number, number],
        labelForeground: label ? channels(getComputedStyle(label).color) : [0, 0, 0] as [number, number, number],
        labelBackgroundImage: label ? getComputedStyle(label).backgroundImage : 'none',
        labelGradientStart: channels(getComputedStyle(editor).getPropertyValue('--crumb-flash-label-gradient-start').trim()),
        labelGradientEnd: channels(getComputedStyle(editor).getPropertyValue('--crumb-flash-label-gradient-end').trim()),
        currentLabelBackground: currentLabel ? channels(getComputedStyle(currentLabel).backgroundColor) : [0, 0, 0] as [number, number, number],
        currentLabelForeground: currentLabel ? channels(getComputedStyle(currentLabel).color) : [0, 0, 0] as [number, number, number],
        currentLabelBackgroundImage: currentLabel ? getComputedStyle(currentLabel).backgroundImage : 'none',
        currentLabelGradientStart: channels(getComputedStyle(editor).getPropertyValue('--crumb-flash-label-current-gradient-start').trim()),
        currentLabelGradientEnd: channels(getComputedStyle(editor).getPropertyValue('--crumb-flash-label-current-gradient-end').trim()),
        currentLabelDx: current && currentLabel
          ? currentLabel.getBoundingClientRect().left - current.getBoundingClientRect().right
          : Number.POSITIVE_INFINITY,
        currentLabelDy: current && currentLabel
          ? currentLabel.getBoundingClientRect().top - current.getBoundingClientRect().top
          : Number.POSITIVE_INFINITY,
      };
    });

    expect(luminance(styles.background)).toBeLessThan(luminance(styles.baseBackground));
    expect(styles.editorOpacity).toBe(1);
    expect(styles.contentOpacity).toBe(1);
    expect(styles.dimOpacity).toBeLessThan(1);
    expect(styles.matchOpacity).toBe(1);
    expect(styles.matchBackground).not.toEqual([0, 0, 0]);
    expect(styles.targetBackground).not.toEqual(styles.matchBackground);
    expect(contrast(styles.targetForeground, styles.targetBackground)).toBeGreaterThanOrEqual(4.5);
    expect(styles.labelFontSize).toBe(styles.editorFontSize);
    expect(styles.labelWidth).toBeGreaterThan(styles.editorFontSize * 0.5);
    expect(styles.labelWidth).toBeLessThanOrEqual(styles.editorFontSize);
    expect(Math.abs(styles.labelHeight - styles.lineHeight)).toBeLessThanOrEqual(1);
    expect(styles.labelPadding).toBe('0px');
    expect(styles.labelBorderWidth).toBe('0px');
    expect(styles.labelRadius).toBe('0px');
    expect(styles.labelShadow).toBe('none');
    expect(contrast(styles.labelForeground, styles.labelBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(styles.currentLabelForeground, styles.currentLabelBackground)).toBeGreaterThanOrEqual(4.5);
    expect(styles.labelBackgroundImage).toContain('linear-gradient');
    expect(styles.currentLabelBackgroundImage).toContain('linear-gradient');
    expect(styles.targetBackgroundImage).toBe('none');
    expect(contrast(styles.labelForeground, styles.labelGradientStart)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(styles.labelForeground, styles.labelGradientEnd)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(styles.currentLabelForeground, styles.currentLabelGradientStart)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(styles.currentLabelForeground, styles.currentLabelGradientEnd)).toBeGreaterThanOrEqual(4.5);
    expect(styles.matchBackgroundImage).toBe('none');
    expect(Math.abs(styles.currentLabelDx)).toBeLessThanOrEqual(2);
    expect(Math.abs(styles.currentLabelDy)).toBeLessThanOrEqual(1);
    await expect(page.locator('.cm-content')).toBeFocused();
    await expect(page.locator('.crumb-jump-prompt')).toHaveCount(0);
  });
}

test('Visual Flash keeps a visible native selection while previewing', async ({ page }) => {
  await startFlash(page, 'crumb');
  await page.keyboard.press('Escape');
  await focusEditor(page);
  await page.keyboard.press('G');
  await page.keyboard.press('V');
  await page.keyboard.type('sneedle');

  const view = page.locator('.cm-editor');
  await expect(view).toHaveClass(/cm-flash-active/);
  const selectionMarks = view.locator('.cm-selectionBackground');
  await expect.poll(() => selectionMarks.count()).toBeGreaterThan(1);
  for (const mark of await selectionMarks.all()) await expect(mark).toBeVisible();
  await expect(view.locator('.crumb-jump-current')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeFocused();
});
