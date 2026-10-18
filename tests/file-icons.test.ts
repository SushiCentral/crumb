import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileTreeIcon } from '../src/lib/file-icons.ts';

test('recognizes project filenames before generic extensions', () => {
  assert.equal(fileTreeIcon('package.json', false), 'nodejs');
  assert.equal(fileTreeIcon('Cargo.toml', false), 'rust');
  assert.equal(fileTreeIcon('tauri.conf.json', false), 'tauri');
  assert.equal(fileTreeIcon('.gitignore', false), 'git');
});

test('recognizes file types case-insensitively and falls back for unknown files', () => {
  assert.equal(fileTreeIcon('Editor.tsx', false), 'react_ts');
  assert.equal(fileTreeIcon('main.rs', false), 'rust');
  assert.equal(fileTreeIcon('README.MD', false), 'markdown');
  assert.equal(fileTreeIcon('unknown.xyz', false), 'document');
});

test('folders have semantic icons and an expanded variant', () => {
  assert.equal(fileTreeIcon('src', true), 'folder-src');
  assert.equal(fileTreeIcon('src', true, true), 'folder-src-open');
  assert.equal(fileTreeIcon('random', true), 'folder');
  assert.equal(fileTreeIcon('random', true, true), 'folder-open');
});

test('all representative icon mappings resolve to bundled SVGs', () => {
  for (const name of ['src', 'tests', 'test', 'assets', 'public', '.github', 'node_modules', 'target', 'dist', 'build', 'components', 'scripts', 'docs', 'random', 'App.tsx', 'App.jsx', 'Cargo.toml', 'tauri.conf.json', 'package.json', '.gitignore', 'README.md', 'main.ts', 'a.js', 'a.css', 'a.html', 'a.json', 'a.yaml', 'a.sh', 'a.png', 'a.svg', 'a.py', 'LICENSE', 'a.xyz']) {
    for (const directory of [false, true]) for (const expanded of [false, true]) {
      const icon = fileTreeIcon(name, directory, expanded);
      assert.ok(existsSync(new URL(`../public/file-icons/${icon}.svg`, import.meta.url)), icon);
    }
  }
});
