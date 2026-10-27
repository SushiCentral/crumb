import { expect, type Page } from '@playwright/test';

/**
 * Narrow real-App harness for Task 7.
 *
 * Only the Tauri IPC commands Crumb actually calls are stubbed. The application
 * code, CodeMirror, the Vim engine, xterm, and all React state are real. No
 * filesystem or shell is touched.
 */

export interface AppStubOptions {
  vim?: boolean;
  openQueue?: string[];
  files?: Record<string, string>;
  saveResult?: string | null;
  /** Emulate another platform before CodeMirror reads navigator.platform. */
  platform?: string;
}

export interface StubWrite {
  path: string;
  content: string;
  status: 'pending' | 'resolved' | 'rejected';
  error?: string;
}

export interface StubSnapshot {
  writeCalls: StubWrite[];
  pendingWrites: number;
  pendingSaveDialogs: number;
  pendingReads: number;
  openCalls: number;
  saveCalls: number;
  spawnCalls: number;
  ptyInput: string[];
}

export async function openApp(page: Page, options: AppStubOptions = {}): Promise<void> {
  await page.addInitScript((opts) => {
    if (opts.platform) {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: () => opts.platform! });
    }
    try {
      localStorage.setItem('crumb.vimModeEnabled', String(Boolean(opts.vim)));
    } catch {
      // localStorage is unavailable on the initial about:blank document.
    }

    const state = {
      openQueue: [...(opts.openQueue ?? [])],
      files: { ...(opts.files ?? {}) },
      saveResult: opts.saveResult ?? null,
      holdWrites: false,
      holdSaveDialog: false,
      holdReads: false,
      failNextWrite: null as string | null,
      writeCalls: [] as StubWrite[],
      pendingWrites: [] as Array<{
        call: StubWrite;
        resolve: () => void;
        reject: (reason: Error) => void;
      }>,
      pendingSaveDialogs: [] as Array<{
        resolve: (value: string | null) => void;
      }>,
      pendingReads: [] as Array<{
        path: string;
        resolve: () => void;
      }>,
      calls: [] as Array<{ command: string; args?: unknown; options?: unknown }>,
      ptyInput: [] as string[],
      callbackId: 0,
    };

    const snapshot = (): StubSnapshot => ({
      writeCalls: state.writeCalls.map(call => ({ ...call })),
      pendingWrites: state.pendingWrites.length,
      pendingSaveDialogs: state.pendingSaveDialogs.length,
      pendingReads: state.pendingReads.length,
      openCalls: state.calls.filter(call => call.command === 'plugin:dialog|open').length,
      saveCalls: state.calls.filter(call => call.command === 'plugin:dialog|save').length,
      spawnCalls: state.calls.filter(call => call.command === 'spawn_pty').length,
      ptyInput: [...state.ptyInput],
    });

    const directoryEntries = (directory: string) => {
      const prefix = directory.endsWith('/') || directory.endsWith('\\')
        ? directory
        : `${directory}/`;
      const directories = new Set<string>();
      const files: Array<{ name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }> = [];
      for (const filePath of Object.keys(state.files)) {
        if (!filePath.startsWith(prefix)) continue;
        const relative = filePath.slice(prefix.length);
        if (!relative) continue;
        const slash = relative.indexOf('/');
        if (slash < 0) files.push({ name: relative, isFile: true, isDirectory: false, isSymlink: false });
        else directories.add(relative.slice(0, slash));
      }
      return [
        ...Array.from(directories).map(name => ({ name, isFile: false, isDirectory: true, isSymlink: false })),
        ...files,
      ];
    };

    (window as unknown as Record<string, unknown>).__crumbTest = {
      snapshot,
      setSaveResult(value: string | null) {
        state.saveResult = value;
      },
      setOpenQueue(paths: string[]) {
        state.openQueue = [...paths];
      },
      setHoldWrites(value: boolean) {
        state.holdWrites = value;
      },
      setHoldSaveDialog(value: boolean) {
        state.holdSaveDialog = value;
      },
      setHoldReads(value: boolean) {
        state.holdReads = value;
      },
      releaseReads() {
        const pending = state.pendingReads.splice(0);
        for (const read of pending) read.resolve();
      },
      resolveSaveDialog(path: string | null, index = 0) {
        const pending = state.pendingSaveDialogs[index];
        if (!pending) throw new Error(`No pending save dialog at index ${index}`);
        state.pendingSaveDialogs.splice(index, 1);
        pending.resolve(path);
      },
      cancelSaveDialog(index = 0) {
        const pending = state.pendingSaveDialogs[index];
        if (!pending) throw new Error(`No pending save dialog at index ${index}`);
        state.pendingSaveDialogs.splice(index, 1);
        pending.resolve(null);
      },
      failNextWrite(message: string) {
        state.failNextWrite = message;
      },
      releaseWrite(index = 0) {
        const pending = state.pendingWrites[index];
        if (!pending) throw new Error(`No pending write at index ${index}`);
        pending.call.status = 'resolved';
        pending.resolve();
      },
      rejectWrite(message: string, index = 0) {
        const pending = state.pendingWrites[index];
        if (!pending) throw new Error(`No pending write at index ${index}`);
        pending.call.status = 'rejected';
        pending.call.error = message;
        pending.reject(new Error(message));
      },
    };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (command: string, args?: unknown, options?: unknown) => {
        state.calls.push({ command, args, options });

        if (command === 'plugin:dialog|open') {
          return Promise.resolve(state.openQueue.shift() ?? null);
        }
        if (command === 'plugin:dialog|save') {
          if (state.holdSaveDialog) {
            return new Promise<string | null>(resolve => {
              state.pendingSaveDialogs.push({ resolve });
            });
          }
          return Promise.resolve(state.saveResult);
        }
        if (command === 'plugin:fs|read_text_file') {
          const path = (args as { path?: string } | undefined)?.path ?? '';
          const content = state.files[path];
          if (content === undefined) return Promise.reject(new Error(`No fixture for ${path}`));
          const bytes = Array.from(new TextEncoder().encode(content));
          if (state.holdReads) {
            return new Promise<number[]>((resolve) => {
              state.pendingReads.push({ path, resolve: () => resolve(bytes) });
            });
          }
          return Promise.resolve(bytes);
        }
        if (command === 'plugin:fs|read_dir') {
          const path = (args as { path?: string } | undefined)?.path ?? '';
          return Promise.resolve(directoryEntries(path));
        }
        if (command === 'plugin:fs|stat') {
          const path = (args as { path?: string } | undefined)?.path ?? '';
          const content = state.files[path];
          return Promise.resolve({ isFile: true, isDirectory: false, isSymlink: false, size: content === undefined ? 0 : new TextEncoder().encode(content).length, mtime: null, atime: null, birthtime: null, readonly: false, fileAttributes: 0, dev: 0, ino: 0, mode: 0, nlink: 0, uid: 0, gid: 0, rdev: 0, blksize: 0, blocks: 0 });
        }
        if (command === 'plugin:fs|write_text_file') {
          const headers = (options as { headers?: { path?: string } } | undefined)?.headers;
          const path = decodeURIComponent(headers?.path ?? '');
          const content = new TextDecoder().decode(args as Uint8Array);
          const call: StubWrite = { path, content, status: 'pending' };
          state.writeCalls.push(call);

          if (state.failNextWrite !== null) {
            const message = state.failNextWrite;
            state.failNextWrite = null;
            call.status = 'rejected';
            call.error = message;
            return Promise.reject(new Error(message));
          }
          if (state.holdWrites) {
            return new Promise<void>((resolve, reject) => {
              state.pendingWrites.push({ call, resolve, reject });
            });
          }
          call.status = 'resolved';
          return Promise.resolve();
        }
        if (command === 'plugin:webview|set_webview_zoom') return Promise.resolve();
        if (command === 'get_available_shells') return Promise.resolve([]);
        if (command === 'plugin:event|listen') return Promise.resolve(1);
        if (command === 'plugin:event|unlisten') return Promise.resolve();
        if (command === 'spawn_pty' || command === 'resize_pty' || command === 'kill_pty') {
          return Promise.resolve();
        }
        if (command === 'write_pty') {
          const data = (args as { data?: string } | undefined)?.data;
          if (typeof data === 'string') state.ptyInput.push(data);
          return Promise.resolve();
        }
        if (command === 'get_pty_cwd') return Promise.resolve('/workspace');
        return Promise.resolve(null);
      },
      transformCallback: (callback: unknown) => {
        state.callbackId += 1;
        return state.callbackId;
      },
      unregisterCallback: () => {},
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main' },
      },
      plugins: { path: { sep: '/', delimiter: ':' } },
      convertFileSrc: (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`,
    };
  }, options);

  await page.goto('/');
}

export async function appStub(page: Page): Promise<StubSnapshot> {
  return page.evaluate(() => (window as unknown as Record<string, { snapshot: () => StubSnapshot }>).__crumbTest.snapshot());
}

export async function newFile(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New File' }).first().click();
  await expect(page.locator('.cm-editor')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toBeFocused();
}

export async function focusEditor(page: Page): Promise<void> {
  await page.locator('.cm-content').click();
  await expect(page.locator('.cm-content')).toBeFocused();
}

export async function openFileViaShortcut(page: Page, path: string): Promise<void> {
  await page.evaluate(next => {
    (window as unknown as Record<string, { setOpenQueue: (paths: string[]) => void }>).__crumbTest.setOpenQueue([next]);
  }, path);
  // Ctrl-O with a Vim-owned editor would be handled by Vim. Dialog opens are
  // deliberately initiated from a non-editor focus surface.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+o');
  const name = path.split('/').pop() ?? path;
  await expect(page.locator('.editor-tab-label').filter({ hasText: name })).toHaveCount(1);
}

export async function runEx(page: Page, command: string): Promise<void> {
  await focusEditor(page);
  await page.keyboard.type(`:${command}`);
  await page.keyboard.press('Enter');
}

export function tab(page: Page, name: string) {
  return page.locator('.editor-tab').filter({ hasText: name });
}

export function tabLabel(page: Page, name: string) {
  return page.locator('.editor-tab-label').filter({ hasText: name });
}
