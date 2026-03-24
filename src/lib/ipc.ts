import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type TerminalId = string;

export const readFile = (path: string): Promise<string> =>
  invoke<string>('read_file', { path });

export const writeFile = (path: string, content: string): Promise<void> =>
  invoke<void>('write_file', { path, content });

export const listDir = (path: string): Promise<DirEntry[]> =>
  invoke<DirEntry[]>('list_dir', { path });

export const spawnTerminal = (cwd: string): Promise<TerminalId> =>
  invoke<TerminalId>('spawn_terminal', { cwd });

export const writeTerminal = (id: TerminalId, data: string): Promise<void> =>
  invoke<void>('write_terminal', { id, data });

export const resizeTerminal = (
  id: TerminalId,
  cols: number,
  rows: number
): Promise<void> => invoke<void>('resize_terminal', { id, cols, rows });

export const killTerminal = (id: TerminalId): Promise<void> =>
  invoke<void>('kill_terminal', { id });

export const onTerminalOutput = (
  id: TerminalId,
  handler: (data: string) => void
) => listen<string>(`terminal-output-${id}`, (e) => handler(e.payload));
