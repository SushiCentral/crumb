import type { VimConfig, VimMapping, VimMappingMode } from './config.ts';

export interface VimMappingEngine {
  map(lhs: string, rhs: string, context: string): void;
  unmap(lhs: string, context: string): unknown;
}

export interface VimMappingInstaller {
  installMappings(): void;
  removeMappings(): void;
}

const MODE_CONTEXT: Record<VimMappingMode, string> = {
  normal: 'normal',
  insert: 'insert',
  visual: 'visual',
  operator: 'operatorPending',
};

interface InstalledMapping {
  lhs: string;
  rhs: string;
  context: string;
  refs: number;
}

// Vim mappings live in the engine's global keymap, not in a view. Keep
// reference counts so two extensions configuring the same mapping do not
// install duplicate entries or remove each other's mapping.
const installedMappings = new Map<string, InstalledMapping>();

function mappingKey(mapping: VimMapping, mode: VimMappingMode): string {
  return `${MODE_CONTEXT[mode]}\u0000${mapping.lhs}`;
}

/**
 * Build the idempotent, ref-counted mapping installer for one extension
 * instance. The engine is injected so this remains unit-testable without
 * creating an EditorView or importing the Vim adapter directly.
 */
export function createMappingInstaller(config: VimConfig, engine: VimMappingEngine): VimMappingInstaller {
  const localMappings = new Set<string>();

  function installMappings(): void {
    // Validate the whole request before mutating the engine so a conflict
    // cannot leave half of a configuration installed.
    const pending = new Map<string, { mapping: VimMapping; context: string }>();

    for (const mapping of config.mappings) {
      for (const mode of mapping.modes) {
        const key = mappingKey(mapping, mode);
        if (localMappings.has(key)) continue;

        const context = MODE_CONTEXT[mode];
        const existing = installedMappings.get(key);
        if (existing && existing.rhs !== mapping.rhs) {
          throw new Error(
            `Vim mapping conflict for "${mapping.lhs}" in ${context}: ` +
            `already "${existing.rhs}", refused "${mapping.rhs}"`,
          );
        }

        const planned = pending.get(key);
        if (planned) {
          if (planned.mapping.rhs !== mapping.rhs) {
            throw new Error(
              `Vim mapping conflict for "${mapping.lhs}" in ${context}: ` +
              `"${planned.mapping.rhs}" and "${mapping.rhs}" in one config`,
            );
          }
          continue;
        }
        pending.set(key, { mapping, context });
      }
    }

    for (const [key, { mapping, context }] of pending) {
      const existing = installedMappings.get(key);
      if (existing) {
        existing.refs += 1;
      } else {
        engine.map(mapping.lhs, mapping.rhs, context);
        installedMappings.set(key, { lhs: mapping.lhs, rhs: mapping.rhs, context, refs: 1 });
      }
      localMappings.add(key);
    }
  }

  function removeMappings(): void {
    for (const key of localMappings) {
      const installed = installedMappings.get(key);
      if (!installed) continue;
      installed.refs -= 1;
      if (installed.refs <= 0) {
        installedMappings.delete(key);
        engine.unmap(installed.lhs, installed.context);
      }
    }
    localMappings.clear();
  }

  return { installMappings, removeMappings };
}
