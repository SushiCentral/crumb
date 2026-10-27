import { type VimConfig, type VimMapping, type VimMappingMode } from '../src/lib/vim/config.ts';

const normalMapping: VimMapping = { lhs: 'Y', rhs: 'y$', modes: ['normal'] };
const insertMapping: VimMapping = { lhs: 'jj', rhs: '<Esc>', modes: ['insert'] };
const supportedModes: readonly VimMappingMode[] = ['normal', 'insert', 'visual', 'operator'];
const config: VimConfig = { mappings: [normalMapping, insertMapping] };

// @ts-expect-error 'command' is not a supported Vim mapping mode.
const unsupportedMode: VimMappingMode = 'command';

// @ts-expect-error mappings are readonly and cannot be replaced.
config.mappings = [];

// @ts-expect-error mapping arrays are readonly and cannot be mutated.
config.mappings.push(insertMapping);

// @ts-expect-error mapping modes are readonly and cannot be mutated.
normalMapping.modes.push('visual');

export const vimConfigTypeFixture = { config, supportedModes, unsupportedMode };
