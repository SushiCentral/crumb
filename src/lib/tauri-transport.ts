import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PtyTransport } from './pty';

export const tauriPtyTransport: PtyTransport = { invoke, listen };
