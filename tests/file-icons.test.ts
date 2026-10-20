import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileTreeIcon } from '../src/lib/file-icons.ts';

test('all representative icon mappings resolve to bundled SVGs', () => {
  for (const name of ['src', 'tests', 'test', 'assets', 'public', '.github', 'node_modules', 'target', 'dist', 'build', 'components', 'scripts', 'docs', 'random', 'App.tsx', 'App.jsx', 'Cargo.toml', 'tauri.conf.json', 'package.json', '.gitignore', 'README.md', 'main.ts', 'a.js', 'a.css', 'a.html', 'a.json', 'a.yaml', 'a.sh', 'a.png', 'a.svg', 'a.py', 'LICENSE', 'a.xyz']) {
    for (const directory of [false, true]) for (const expanded of [false, true]) {
      const icon = fileTreeIcon(name, directory, expanded);
      assert.ok(existsSync(new URL(`../public/file-icons/${icon}.svg`, import.meta.url)), icon);
    }
  }
});
