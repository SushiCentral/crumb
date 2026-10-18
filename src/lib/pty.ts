export interface PtyPayload { id: string; data: string }

export interface PtyTransport {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: 'pty-output', handler: (event: { payload: PtyPayload }) => void): Promise<() => void | Promise<void>>;
}

export interface PtySessionOptions {
  rows: number;
  cols: number;
  shell?: string;
  cwd?: string | null;
  clearPromptOnStart?: boolean;
  onOutput(data: string): void;
  onError(message: string): void;
}

export interface PtySession {
  readonly id: string;
  write(data: string): void;
  resize(rows: number, cols: number): void;
  dispose(): void;
}

export function startPtySession(transport: PtyTransport, options: PtySessionOptions): PtySession {
  const id = crypto.randomUUID();
  let disposed = false;
  let failed = false;
  let ready = false;
  let unlisten: (() => void | Promise<void>) | undefined;
  let writes: string[] = [];
  let pendingSize: { rows: number; cols: number } | undefined;
  let commands = Promise.resolve();
  let clearPromptTimer: ReturnType<typeof setTimeout> | undefined;

  const report = (error: unknown) => options.onError(String(error));
  const call = (command: string, args: Record<string, unknown>) => {
    commands = commands.then(() => transport.invoke(command, args).then(() => undefined)).catch(report);
  };
  const stopListening = () => {
    const stop = unlisten;
    unlisten = undefined;
    if (stop) void Promise.resolve().then(stop).catch(report);
  };

  void (async () => {
    try {
      unlisten = await transport.listen('pty-output', event => {
        if (!disposed && !failed && event.payload.id === id) options.onOutput(event.payload.data);
      });
      if (disposed) { stopListening(); return; }
      await transport.invoke('spawn_pty', { id, rows: options.rows, cols: options.cols, shell: options.shell, cwd: options.cwd });
      if (disposed) { stopListening(); call('kill_pty', { id }); return; }
      ready = true;
      if (pendingSize) call('resize_pty', { id, ...pendingSize });
      pendingSize = undefined;
      for (const data of writes) call('write_pty', { id, data });
      writes = [];
      if (options.clearPromptOnStart) {
        clearPromptTimer = setTimeout(() => {
          if (!disposed && !failed) call('write_pty', { id, data: '\x0c' });
        }, 250);
      }
    } catch (error) {
      failed = true;
      writes = [];
      pendingSize = undefined;
      stopListening();
      if (!disposed) report(error);
    }
  })();

  return {
    id,
    write(data) {
      if (disposed || failed) return;
      if (ready) call('write_pty', { id, data });
      else writes.push(data);
    },
    resize(rows, cols) {
      if (disposed || failed || rows <= 0 || cols <= 0) return;
      if (ready) call('resize_pty', { id, rows, cols });
      else pendingSize = { rows, cols };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (clearPromptTimer !== undefined) clearTimeout(clearPromptTimer);
      writes = [];
      pendingSize = undefined;
      stopListening();
      if (ready) call('kill_pty', { id });
    },
  };
}
