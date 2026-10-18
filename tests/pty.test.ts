import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPtySession } from '../src/lib/pty.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness() {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const outputs: string[] = [];
  const errors: string[] = [];
  const registration = deferred<() => void>();
  const spawn = deferred<void>();
  let listener: ((event: { payload: { id: string; data: string } }) => void) | undefined;
  let unlistens = 0;
  const transport = {
    listen: async (_name: string, callback: typeof listener) => {
      listener = callback;
      return registration.promise;
    },
    invoke: async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === 'spawn_pty') await spawn.promise;
      return undefined;
    },
  };
  const start = (clearPromptOnStart = false) => startPtySession(transport, { rows: 24, cols: 80, clearPromptOnStart, onOutput: data => outputs.push(data), onError: error => errors.push(error) });
  return { start, transport, calls, outputs, errors, registration, spawn,
    emit: (id: string, data: string) => listener?.({ payload: { id, data } }),
    unlisten: () => { unlistens++; },
    unlistens: () => unlistens };
}

test('registers output listener before spawning, and routes only this session', async () => {
  const h = harness();
  const session = h.start();
  await tick();
  assert.equal(h.calls.length, 0);
  h.registration.resolve(h.unlisten);
  await tick();
  assert.equal(h.calls[0].command, 'spawn_pty');
  h.emit('different-session', 'wrong');
  h.emit(session.id, 'prompt');
  assert.deepEqual(h.outputs, ['prompt']);
  h.spawn.resolve();
  await tick();
  session.dispose();
  await tick();
});

test('buffers early writes in order and latest resize until spawn succeeds', async () => {
  const h = harness();
  const session = h.start();
  session.write('a');
  session.write('b');
  session.resize(20, 40);
  session.resize(30, 60);
  h.registration.resolve(h.unlisten);
  await tick();
  assert.deepEqual(h.calls.map(call => call.command), ['spawn_pty']);
  h.spawn.resolve();
  await tick();
  await tick();
  assert.deepEqual(h.calls.slice(1).map(call => [call.command, call.args?.data ?? call.args?.rows]), [
    ['resize_pty', 30], ['write_pty', 'a'], ['write_pty', 'b'],
  ]);
  session.dispose();
  await tick();
});

test('listener failure prevents spawn and discards buffered input', async () => {
  const h = harness();
  const session = h.start();
  session.write('not sent');
  h.registration.reject(new Error('listen failed'));
  await tick();
  assert.deepEqual(h.calls, []);
  assert.match(h.errors.join(' '), /listen failed/);
  session.dispose();
});

test('spawn failure unregisters listener and discards buffered input', async () => {
  const h = harness();
  const session = h.start();
  session.write('not sent');
  h.registration.resolve(h.unlisten);
  await tick();
  h.spawn.reject(new Error('spawn failed'));
  await tick();
  assert.deepEqual(h.calls.map(call => call.command), ['spawn_pty']);
  assert.equal(h.unlistens(), 1);
  assert.match(h.errors.join(' '), /spawn failed/);
  session.dispose();
});

test('dispose during spawn stops output and kills once after spawn resolves', async () => {
  const h = harness();
  const session = h.start();
  h.registration.resolve(h.unlisten);
  await tick();
  session.write('discard');
  session.dispose();
  session.dispose();
  h.emit(session.id, 'late');
  assert.deepEqual(h.outputs, []);
  h.spawn.resolve();
  await tick();
  assert.deepEqual(h.calls.map(call => call.command), ['spawn_pty', 'kill_pty']);
  assert.equal(h.unlistens(), 1);
});

test('dispose during listener registration never spawns and unregisters after resolution', async () => {
  const h = harness();
  const session = h.start();
  session.dispose();
  h.registration.resolve(h.unlisten);
  await tick();
  assert.deepEqual(h.calls, []);
  assert.equal(h.unlistens(), 1);
});

test('rejected write, resize, and cleanup calls report errors without unhandled rejections', async () => {
  const h = harness();
  h.transport.invoke = async (command, args) => {
    h.calls.push({ command, args });
    if (command !== 'spawn_pty') throw new Error(`${command} rejected`);
  };
  const session = h.start();
  h.registration.resolve(() => { throw new Error('unlisten rejected'); });
  await tick();
  session.write('input');
  session.resize(24, 80);
  session.dispose();
  await tick();
  assert.match(h.errors.join(' '), /write_pty rejected/);
  assert.match(h.errors.join(' '), /resize_pty rejected/);
  assert.match(h.errors.join(' '), /unlisten rejected/);
  assert.match(h.errors.join(' '), /kill_pty rejected/);
});

test('async unlisten rejection is reported without an unhandled rejection', async () => {
  const h = harness();
  const session = h.start();
  h.registration.resolve(async () => { throw new Error('async unlisten rejected'); });
  await tick();
  h.spawn.resolve();
  await tick();
  session.dispose();
  await tick();
  assert.match(h.errors.join(' '), /async unlisten rejected/);
});

test('prompt clearing is opt-in and only happens after successful startup', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const session = h.start(true);
  h.registration.resolve(h.unlisten);
  await tick();
  context.mock.timers.tick(500);
  await tick();
  assert.equal(h.calls.filter(call => call.command === 'write_pty').length, 0);
  h.spawn.resolve();
  await tick();
  context.mock.timers.tick(250);
  await tick();
  assert.deepEqual(h.calls.filter(call => call.command === 'write_pty').map(call => call.args?.data), ['\x0c']);
  session.dispose();
  await tick();
});

test('disposing a terminal cancels its pending prompt clear', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const session = h.start(true);
  h.registration.resolve(h.unlisten);
  h.spawn.resolve();
  await tick();
  session.dispose();
  context.mock.timers.tick(500);
  await tick();
  assert.equal(h.calls.filter(call => call.command === 'write_pty').length, 0);
});

test('default startup never sends Ctrl-L', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const session = h.start();
  h.registration.resolve(h.unlisten);
  h.spawn.resolve();
  await tick();
  context.mock.timers.tick(1000);
  await tick();
  assert.equal(h.calls.filter(call => call.command === 'write_pty').length, 0);
  session.dispose();
  await tick();
});
