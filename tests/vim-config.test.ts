import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultVimConfig, type VimConfig, type VimMapping, type VimMappingMode } from '../src/lib/vim/config.ts';

test('default Vim config exposes an empty mapping list that callers cannot mutate', () => {
  assert.deepEqual(defaultVimConfig.mappings, []);
  assert.equal(Object.isFrozen(defaultVimConfig), true);
  assert.equal(Object.isFrozen(defaultVimConfig.mappings), true);
  assert.throws(() => {
    (defaultVimConfig.mappings as unknown as VimMapping[]).push({ lhs: 'Y', rhs: 'y$', modes: ['normal'] });
  }, TypeError);
  assert.throws(() => {
    (defaultVimConfig as unknown as { mappings: readonly VimMapping[] }).mappings = [];
  }, TypeError);
});

test('typed Vim mappings support normal and insert modes without engine state', () => {
  const normal: VimMapping = { lhs: 'Y', rhs: 'y$', modes: ['normal'] };
  const insert: VimMapping = { lhs: 'jj', rhs: '<Esc>', modes: ['insert'] };
  const supportedModes: readonly VimMappingMode[] = ['normal', 'insert', 'visual', 'operator'];
  const config: VimConfig = { mappings: [normal, insert] };

  assert.deepEqual(config.mappings.map(mapping => [mapping.lhs, mapping.rhs, mapping.modes]), [
    ['Y', 'y$', ['normal']],
    ['jj', '<Esc>', ['insert']],
  ]);
  assert.deepEqual(supportedModes, ['normal', 'insert', 'visual', 'operator']);
});
