import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldVimOwnShortcut,
  shouldVimOwnTab,
  type VimShortcutInput,
} from '../src/lib/vim/shortcuts.ts';

const baseInput: VimShortcutInput = {
  enabled: true,
  focusedSurface: 'editor',
  mode: 'normal',
  key: 'w',
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  mappingOwnsKey: false,
  isMac: false,
};

function shortcut(overrides: Partial<VimShortcutInput> = {}): boolean {
  return shouldVimOwnShortcut({ ...baseInput, ...overrides });
}

test('Vim owns conflicting Ctrl bindings only while enabled in a focused editor', () => {
  for (const key of ['w', 'o', 'i']) {
    assert.equal(shortcut({ key }), true, `Ctrl-${key} should belong to Vim`);
  }

  // Crumb reserves Ctrl-B for the sidebar toggle so it must never reach Vim's
  // page-back command, even in a focused Normal-mode editor.
  assert.equal(shortcut({ key: 'b' }), false, 'Ctrl-B belongs to the Crumb sidebar toggle');

  assert.equal(shortcut({ enabled: false }), false);
  assert.equal(shortcut({ enabled: true, focusedSurface: 'editor' }), true);

  for (const focusedSurface of ['dialog', 'palette', 'terminal', 'input', 'other'] as const) {
    assert.equal(
      shortcut({ focusedSurface }),
      false,
      `${focusedSurface} focus must retain its own shortcut handling`,
    );
  }
});

test('Vim owns the Ctrl conflicts in Normal, Insert, Replace, and Visual modes', () => {
  for (const mode of ['normal', 'insert', 'replace', 'visual', 'visual-line', 'visual-block'] as const) {
    assert.equal(shortcut({ mode }), true, `${mode} mode should keep focused Vim Ctrl ownership`);
  }

  for (const mode of ['inactive', 'search', 'command'] as const) {
    assert.equal(shortcut({ mode }), false, `${mode} must not take application shortcuts`);
  }
});

test('unsupported or modified Ctrl combinations remain application shortcuts', () => {
  for (const key of ['s', 'f', 'c', 'x', 'b', 'n', 'p', 'h', 'j', 'k', 'l', 'Tab', ',', '`']) {
    assert.equal(shortcut({ key }), false, `Ctrl-${key} is not a supported Vim conflict`);
  }

  assert.equal(shortcut({ key: 'w', shiftKey: true }), false);
  assert.equal(shortcut({ key: 'w', altKey: true }), false);
  assert.equal(shortcut({ key: 'w', metaKey: true }), false);
  assert.equal(shortcut({ key: 'w', ctrlKey: false }), false);
  assert.equal(shortcut({ key: 'W' }), true, 'key matching is case-insensitive');
});

test('macOS Command shortcuts stay application-owned unless an explicit Vim mapping owns the key', () => {
  assert.equal(shortcut({ isMac: true, ctrlKey: false, metaKey: true, key: 's' }), false);
  assert.equal(shortcut({ isMac: true, ctrlKey: false, metaKey: true, key: 'w' }), false);
  assert.equal(shortcut({ isMac: true, ctrlKey: false, metaKey: true, key: 's', mappingOwnsKey: true }), true);
});

test('configured Vim mappings are given ownership before application shortcuts', () => {
  assert.equal(shortcut({ key: 's', mappingOwnsKey: true }), true);
  assert.equal(shortcut({ key: 'Tab', mappingOwnsKey: true }), true);
  assert.equal(shortcut({ key: 'x', ctrlKey: false, altKey: true, mappingOwnsKey: true }), true);
  assert.equal(shortcut({ key: 'x', ctrlKey: false, mappingOwnsKey: true, focusedSurface: 'input' }), false);
});

test('Ctrl-W is Vim-owned in editor focus so it cannot reach Crumb tab closing', () => {
  assert.equal(shortcut({ key: 'w' }), true);
  assert.equal(shortcut({ key: 'w', mode: 'insert' }), true);
  assert.equal(shortcut({ key: 'w', focusedSurface: 'editor' }), true);
  assert.equal(shortcut({ key: 'w', enabled: false }), false);
});

test('Tab ownership follows Vim mode without stealing Insert indentation', () => {
  for (const mode of ['normal', 'visual', 'visual-line', 'visual-block'] as const) {
    assert.equal(shouldVimOwnTab(mode), true, `${mode} Tab must not run indentWithTab`);
  }

  for (const mode of ['insert', 'replace'] as const) {
    assert.equal(shouldVimOwnTab(mode), false, `${mode} Tab must retain indentation`);
  }

  for (const mode of ['inactive', 'search', 'command'] as const) {
    assert.equal(shouldVimOwnTab(mode), false, `${mode} must not consume Tab`);
  }
});
