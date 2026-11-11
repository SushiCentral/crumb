export type VimMappingMode = 'normal' | 'insert' | 'visual' | 'operator';

export interface VimMapping {
  readonly lhs: string;
  readonly rhs: string;
  readonly modes: readonly VimMappingMode[];
}

export interface VimConfig {
  readonly mappings: readonly VimMapping[];
}

export const defaultVimConfig: VimConfig = Object.freeze({
  mappings: Object.freeze([]),
});
