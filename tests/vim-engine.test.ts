import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EditorView } from '@codemirror/view';
import { createVimExtension } from '../src/lib/vim/extension.ts';
import { createMappingInstaller } from '../src/lib/vim/mappings.ts';
import type { VimConfig } from '../src/lib/vim/config.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const vimModuleDir = join(projectRoot, 'src', 'lib', 'vim');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('the Vim package and private adapter state stay inside src/lib/vim', () => {
  const roots = [join(projectRoot, 'src'), join(projectRoot, 'tests')];
  for (const root of roots) {
    for (const file of filesUnder(root)) {
      const source = readFileSync(file, 'utf8');
      const display = relative(projectRoot, file);
      const allowed = file.startsWith(`${vimModuleDir}/`) || file.startsWith(`${vimModuleDir}\\`);
      // The guard itself necessarily contains the forbidden patterns.
      if (allowed || display === 'tests/vim-engine.test.ts') continue;

      assert.doesNotMatch(source, /@replit\/codemirror-vim/, `${display} imports the Vim package directly`);
      assert.doesNotMatch(source, /\.state\.vim\b/, `${display} reads cm.state.vim directly`);
      assert.doesNotMatch(source, /getVimGlobalState_/, `${display} reads Vim global state directly`);
      assert.doesNotMatch(source, /\bgetCM\s*\(/, `${display} reads the CM5 adapter directly`);
    }
  }
});

test('the factory exposes only the small typed lifecycle API', () => {
  const extension = createVimExtension();
  assert.ok(Array.isArray(extension.extension));
  for (const method of ['installMappings', 'removeMappings', 'getState', 'cancelInput', 'beforeActivation', 'afterActivation', 'releaseDocument']) {
    assert.equal(typeof (extension as unknown as Record<string, unknown>)[method], 'function');
  }

  const view = { cm: null } as unknown as EditorView;
  assert.deepEqual(extension.getState(view), { mode: 'inactive', pending: '' });
  assert.doesNotThrow(() => extension.beforeActivation(view, 'doc-a'));
  assert.doesNotThrow(() => extension.afterActivation(view, 'doc-a'));
  assert.doesNotThrow(() => extension.cancelInput(view));
  assert.doesNotThrow(() => extension.releaseDocument('doc-a'));
});

test('mode/pending state is derived without exposing engine internals', () => {
  const extension = createVimExtension();
  const makeView = (vim: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    cm: { state: { vim, ...extra } },
  }) as unknown as EditorView;

  assert.deepEqual(
    extension.getState(makeView({ insertMode: false, visualMode: false, status: 'd' })),
    { mode: 'normal', pending: 'd' },
  );
  assert.deepEqual(
    extension.getState(makeView({ insertMode: true, visualMode: false, status: '' }, { overwrite: false })),
    { mode: 'insert', pending: '' },
  );
  assert.deepEqual(
    extension.getState(makeView({ insertMode: true, visualMode: false, status: '' }, { overwrite: true })),
    { mode: 'replace', pending: '' },
  );
  assert.deepEqual(
    extension.getState(makeView({ insertMode: false, visualMode: true, visualLine: true, status: '' })),
    { mode: 'visual-line', pending: '' },
  );
  assert.deepEqual(
    extension.getState(makeView({ insertMode: false, visualMode: true, visualBlock: true, status: '' })),
    { mode: 'visual-block', pending: '' },
  );
  assert.deepEqual(
    extension.getState(makeView({ insertMode: false, visualMode: true, status: '' })),
    { mode: 'visual', pending: '' },
  );

  const prompt = { querySelector: () => ({}), textContent: '?beta' };
  assert.deepEqual(
    extension.getState(makeView({ insertMode: false, visualMode: false, status: '' }, { dialog: prompt })),
    { mode: 'search', pending: '' },
  );
  const command = { querySelector: () => ({}), textContent: ':set nu' };
  assert.deepEqual(
    extension.getState(makeView({ insertMode: false, visualMode: false, status: '' }, { dialog: command })),
    { mode: 'command', pending: '' },
  );
  const notification = { querySelector: () => null, textContent: '1 lines yanked' };
  assert.deepEqual(
    extension.getState(makeView({ insertMode: false, visualMode: false, status: '' }, { dialog: notification })),
    { mode: 'normal', pending: '' },
  );
});

test('Crumb mappings install and remove idempotently', () => {  const calls: string[] = [];
  const engine = {
    map: (lhs: string, rhs: string, context: string) => {
      calls.push(`map ${context} ${lhs} ${rhs}`);
    },
    unmap: (lhs: string, context: string) => {
      calls.push(`unmap ${context} ${lhs}`);
      return true;
    },
  };

  const config: VimConfig = {
    mappings: [
      { lhs: 'Y', rhs: 'y$', modes: ['normal', 'visual', 'operator'] },
      { lhs: 'jk', rhs: '<Esc>', modes: ['insert'] },
    ],
  };
  const first = createMappingInstaller(config, engine);
  const second = createMappingInstaller(config, engine);

  first.installMappings();
  first.installMappings();
  assert.deepEqual(calls, [
    'map normal Y y$',
    'map visual Y y$',
    'map operatorPending Y y$',
    'map insert jk <Esc>',
  ]);

  second.installMappings();
  assert.deepEqual(calls, [
    'map normal Y y$',
    'map visual Y y$',
    'map operatorPending Y y$',
    'map insert jk <Esc>',
  ], 'a second extension must not stack duplicate engine mappings');

  first.removeMappings();
  first.removeMappings();
  assert.deepEqual(calls, [
    'map normal Y y$',
    'map visual Y y$',
    'map operatorPending Y y$',
    'map insert jk <Esc>',
  ], 'removing one shared reference must keep the mapping installed');

  second.removeMappings();
  assert.deepEqual(calls, [
    'map normal Y y$',
    'map visual Y y$',
    'map operatorPending Y y$',
    'map insert jk <Esc>',
    'unmap normal Y',
    'unmap visual Y',
    'unmap operatorPending Y',
    'unmap insert jk',
  ]);

  first.installMappings();
  assert.deepEqual(calls.slice(-4), [
    'map normal Y y$',
    'map visual Y y$',
    'map operatorPending Y y$',
    'map insert jk <Esc>',
  ], 'mappings can be installed again after removal');
  first.removeMappings();
});

test('conflicting mappings for the same lhs/context are rejected explicitly', () => {
  const calls: string[] = [];
  const engine = {
    map: (lhs: string, rhs: string, context: string) => {
      calls.push(`map ${context} ${lhs} ${rhs}`);
    },
    unmap: (lhs: string, context: string) => {
      calls.push(`unmap ${context} ${lhs}`);
      return true;
    },
  };

  const first = createMappingInstaller({ mappings: [{ lhs: 'Y', rhs: 'y$', modes: ['normal'] }] }, engine);
  const conflicting = createMappingInstaller({ mappings: [{ lhs: 'Y', rhs: 'yy', modes: ['normal'] }] }, engine);

  first.installMappings();
  assert.throws(() => conflicting.installMappings(), /conflict/i);
  assert.deepEqual(calls, ['map normal Y y$']);

  first.removeMappings();
  assert.deepEqual(calls, ['map normal Y y$', 'unmap normal Y']);

  const intraCalls: string[] = [];
  const intraEngine = {
    map: (lhs: string, rhs: string, context: string) => {
      intraCalls.push(`map ${context} ${lhs} ${rhs}`);
    },
    unmap: (lhs: string, context: string) => {
      intraCalls.push(`unmap ${context} ${lhs}`);
      return true;
    },
  };
  assert.throws(
    () => createMappingInstaller({
      mappings: [
        { lhs: 'Q', rhs: 'q', modes: ['normal'] },
        { lhs: 'Q', rhs: 'qq', modes: ['normal'] },
      ],
    }, intraEngine).installMappings(),
    /conflict/i,
  );
  assert.deepEqual(intraCalls, []);
});
