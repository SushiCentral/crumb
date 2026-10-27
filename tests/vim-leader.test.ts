import assert from 'node:assert/strict';
import test from 'node:test';
import type { VimMapping } from '../src/lib/vim/config.ts';
import {
  VIM_LEADER_GUIDE_DELAY_MS,
  VIM_LEADER_TIMEOUT_MS,
  createVimLeaderController,
  isVimLeaderMode,
  isVimLeaderStartAllowed,
  matchVimLeaderKey,
  vimLeaderKeyFromEvent,
  vimLeaderSuppressedByMappings,
} from '../src/lib/vim/leader.ts';

function event(overrides: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>> = {}) {
  return {
    key: ' ',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

interface FakeTimers {
  readonly setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  advance(delay: number): void;
  readonly pendingCount: number;
}

function fakeTimers(): FakeTimers {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  return {
    setTimeout: (callback, delay) => {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: id => {
      timers.delete(id as unknown as number);
    },
    advance: delay => {
      now += delay;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    get pendingCount() {
      return timers.size;
    },
  };
}

test('leader starts only on Space and matches the approved app actions', () => {
  assert.deepEqual(matchVimLeaderKey([], 'Space'), { kind: 'pending', keys: ['Space'] });
  assert.deepEqual(matchVimLeaderKey([], 'x'), { kind: 'ignored' });

  assert.deepEqual(matchVimLeaderKey(['Space'], 'Space'), {
    kind: 'action', action: 'command-palette', keys: ['Space', 'Space'],
  });
  assert.deepEqual(matchVimLeaderKey(['Space'], 'E'), {
    kind: 'action', action: 'toggle-file-tree', keys: ['Space', 'E'],
  });
  assert.deepEqual(matchVimLeaderKey(['Space'], 'e'), {
    kind: 'action', action: 'toggle-file-tree', keys: ['Space', 'e'],
  });
  assert.deepEqual(matchVimLeaderKey(['Space'], '/'), {
    kind: 'action', action: 'search', keys: ['Space', '/'],
  });
  assert.deepEqual(matchVimLeaderKey(['Space'], 'f'), {
    kind: 'pending', keys: ['Space', 'f'],
  });
  assert.deepEqual(matchVimLeaderKey(['Space', 'f'], 'f'), {
    kind: 'action', action: 'quick-open', keys: ['Space', 'f', 'f'],
  });
});

test('non-matching leader keys cancel instead of falling through to Vim', () => {
  // Space currently moves right; the leader owns the remainder of an
  // incomplete sequence so `Space x` cannot become a motion plus an edit.
  assert.deepEqual(matchVimLeaderKey(['Space'], 'x'), { kind: 'cancelled', keys: [] });
  assert.deepEqual(matchVimLeaderKey(['Space'], 'F'), { kind: 'cancelled', keys: [] });
  assert.deepEqual(matchVimLeaderKey(['Space', 'f'], 'x'), { kind: 'cancelled', keys: [] });
  assert.deepEqual(matchVimLeaderKey(['Space', 'f'], 'Escape'), { kind: 'cancelled', keys: [] });
  assert.deepEqual(matchVimLeaderKey(['Space'], 'Escape'), { kind: 'cancelled', keys: [] });
});

test('leader key normalization preserves case and ignores modified or named keys', () => {
  assert.equal(vimLeaderKeyFromEvent(event()), 'Space');
  assert.equal(vimLeaderKeyFromEvent(event({ key: 'E' })), 'E');
  assert.equal(vimLeaderKeyFromEvent(event({ key: '/' })), '/');
  assert.equal(vimLeaderKeyFromEvent(event({ key: 'f' })), 'f');
  assert.equal(vimLeaderKeyFromEvent(event({ key: 'Escape' })), 'Escape');
  assert.equal(vimLeaderKeyFromEvent(event({ key: 'E', ctrlKey: true })), null);
  assert.equal(vimLeaderKeyFromEvent(event({ key: ' ', metaKey: true })), null);
  assert.equal(vimLeaderKeyFromEvent(event({ key: '/', altKey: true })), null);
  assert.equal(vimLeaderKeyFromEvent(event({ key: 'ArrowRight' })), null);
});

test('leader is active in Vim non-insert modes and stays out of prompts/insert', () => {
  for (const mode of ['normal', 'visual', 'visual-line', 'visual-block'] as const) {
    assert.equal(isVimLeaderMode(mode), true, `${mode} should accept the leader`);
  }
  for (const mode of ['insert', 'replace', 'search', 'command', 'inactive'] as const) {
    assert.equal(isVimLeaderMode(mode), false, `${mode} must keep its current key behavior`);
  }
});

test('the leader cannot start on top of an engine-pending prefix', () => {
  assert.equal(isVimLeaderStartAllowed('normal', ''), true);
  assert.equal(isVimLeaderStartAllowed('visual', ''), true);
  // `d<Space>` and `2<Space>` must stay with the engine's own Space motion.
  assert.equal(isVimLeaderStartAllowed('normal', 'd'), false);
  assert.equal(isVimLeaderStartAllowed('normal', '2'), false);
  assert.equal(isVimLeaderStartAllowed('visual', '"a'), false);
  assert.equal(isVimLeaderStartAllowed('insert', ''), false);
});

test('a complete sequence dispatches exactly one existing App action', () => {
  const actions: string[] = [];
  const controller = createVimLeaderController({
    dispatch: action => actions.push(action),
  });

  assert.equal(controller.handleKey('Space'), true);
  assert.deepEqual(controller.pending, ['Space']);
  assert.equal(controller.handleKey('Space'), true);
  assert.deepEqual(controller.pending, []);
  assert.deepEqual(actions, ['command-palette']);

  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('E'), true);
  assert.deepEqual(actions, ['command-palette', 'toggle-file-tree']);

  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('e'), true);
  assert.deepEqual(actions, ['command-palette', 'toggle-file-tree', 'toggle-file-tree']);

  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('/'), true);
  assert.deepEqual(actions, ['command-palette', 'toggle-file-tree', 'toggle-file-tree', 'search']);

  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('f'), true);
  assert.equal(controller.handleKey('f'), true);
  assert.deepEqual(actions, ['command-palette', 'toggle-file-tree', 'toggle-file-tree', 'search', 'quick-open']);
});

test('incomplete leader sequences time out without dispatching and reset cleanly', () => {
  const timers = fakeTimers();
  const actions: string[] = [];
  const controller = createVimLeaderController({
    dispatch: action => actions.push(action),
    timeoutMs: 750,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  assert.equal(controller.handleKey('Space'), true);
  assert.deepEqual(controller.pending, ['Space']);
  // One inactivity timer plus the one-shot guide reveal timer.
  assert.equal(timers.pendingCount, 2);

  timers.advance(749);
  assert.deepEqual(controller.pending, ['Space']);
  assert.deepEqual(actions, []);

  timers.advance(1);
  assert.deepEqual(controller.pending, []);
  assert.deepEqual(actions, []);

  // The next Space starts a fresh sequence rather than replaying the timeout.
  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('f'), true);
  timers.advance(750);
  assert.deepEqual(controller.pending, []);
  assert.deepEqual(actions, []);

  // And a complete sequence still works after a timeout reset.
  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('/'), true);
  assert.deepEqual(actions, ['search']);
});

test('the leader timeout restarts for each accepted prefix key', () => {
  const timers = fakeTimers();
  const actions: string[] = [];
  const controller = createVimLeaderController({
    dispatch: action => actions.push(action),
    timeoutMs: 750,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  assert.equal(controller.handleKey('Space'), true);
  timers.advance(500);
  assert.equal(controller.handleKey('f'), true);
  timers.advance(500);
  assert.deepEqual(controller.pending, ['Space', 'f']);

  timers.advance(250);
  assert.deepEqual(controller.pending, []);

  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('f'), true);
  assert.equal(controller.handleKey('f'), true);
  assert.deepEqual(actions, ['quick-open']);
});

test('cancel and dispose clear pending input and timers', () => {
  const timers = fakeTimers();
  const actions: string[] = [];
  const controller = createVimLeaderController({
    dispatch: action => actions.push(action),
    timeoutMs: 750,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  assert.equal(controller.handleKey('Space'), true);
  controller.cancel();
  assert.deepEqual(controller.pending, []);
  assert.equal(timers.pendingCount, 0);
  timers.advance(1000);
  assert.deepEqual(actions, []);

  assert.equal(controller.handleKey('Space'), true);
  controller.dispose();
  assert.deepEqual(controller.pending, []);
  assert.equal(timers.pendingCount, 0);
  assert.equal(controller.handleKey('Space'), false);
  timers.advance(1000);
  assert.deepEqual(actions, []);
});

test('the default leader timeout is 10000ms', () => {
  assert.equal(VIM_LEADER_TIMEOUT_MS, 10000);
});

test('the default guide delay is 500ms', () => {
  assert.equal(VIM_LEADER_GUIDE_DELAY_MS, 500);
});

test('the guide reveals after exactly 500ms only while the initial prefix is still incomplete', () => {
  const timers = fakeTimers();
  const guides: Array<readonly string[] | null> = [];
  const controller = createVimLeaderController({
    dispatch: () => {},
    onGuideChange: prefix => guides.push(prefix),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  assert.equal(controller.handleKey('Space'), true);
  timers.advance(499);
  assert.deepEqual(guides, []);
  assert.equal(controller.guidePrefix, null);

  timers.advance(1);
  assert.deepEqual(guides, [['Space']]);
  assert.deepEqual(controller.guidePrefix, ['Space']);

  // A later accepted prefix key filters the visible guide immediately and
  // does not restart the one-shot reveal delay.
  assert.equal(controller.handleKey('f'), true);
  assert.deepEqual(guides, [['Space'], ['Space', 'f']]);
  assert.deepEqual(controller.guidePrefix, ['Space', 'f']);
  timers.advance(500);
  assert.deepEqual(guides, [['Space'], ['Space', 'f']]);
});

test('a complete sequence before the reveal delay never shows the guide', () => {
  const timers = fakeTimers();
  const guides: Array<readonly string[] | null> = [];
  const actions: string[] = [];
  const controller = createVimLeaderController({
    dispatch: action => actions.push(action),
    onGuideChange: prefix => guides.push(prefix),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  // Completing just before the 500ms boundary must still suppress the guide.
  assert.equal(controller.handleKey('Space'), true);
  timers.advance(499);
  assert.equal(controller.handleKey('Space'), true);
  assert.deepEqual(actions, ['command-palette']);
  assert.deepEqual(guides, []);

  assert.equal(controller.handleKey('Space'), true);
  assert.equal(controller.handleKey('f'), true);
  assert.equal(controller.handleKey('f'), true);
  assert.deepEqual(actions, ['command-palette', 'quick-open']);
  assert.deepEqual(guides, []);

  timers.advance(2000);
  assert.deepEqual(guides, []);
  assert.equal(controller.guidePrefix, null);
});

test('later prefix keys never restart the guide reveal delay', () => {
  const timers = fakeTimers();
  const guides: Array<readonly string[] | null> = [];
  const controller = createVimLeaderController({
    dispatch: () => {},
    onGuideChange: prefix => guides.push(prefix),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  assert.equal(controller.handleKey('Space'), true);
  timers.advance(400);
  assert.equal(controller.handleKey('f'), true);
  timers.advance(99);
  assert.deepEqual(guides, []);
  assert.equal(controller.guidePrefix, null);

  // 500ms after the initial Space, not after the later `f`.
  timers.advance(1);
  assert.deepEqual(guides, [['Space', 'f']]);
  assert.deepEqual(controller.guidePrefix, ['Space', 'f']);
});

test('the inactivity timeout restarts for each prefix and hides the guide at expiry', () => {
  const timers = fakeTimers();
  const guides: Array<readonly string[] | null> = [];
  const controller = createVimLeaderController({
    dispatch: () => {},
    onGuideChange: prefix => guides.push(prefix),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  assert.equal(controller.handleKey('Space'), true);
  timers.advance(9999);
  assert.deepEqual(controller.pending, ['Space']);
  assert.deepEqual(controller.guidePrefix, ['Space']);

  // The accepted prefix restarts the 10s inactivity window.
  assert.equal(controller.handleKey('f'), true);
  assert.deepEqual(controller.guidePrefix, ['Space', 'f']);
  timers.advance(9999);
  assert.deepEqual(controller.pending, ['Space', 'f']);
  assert.deepEqual(controller.guidePrefix, ['Space', 'f']);

  timers.advance(1);
  assert.deepEqual(controller.pending, []);
  assert.equal(controller.guidePrefix, null);
  assert.deepEqual(guides[guides.length - 1], null);
});

test('the guide hides on complete, invalid, Escape, cancel, and dispose', () => {
  const timers = fakeTimers();
  const guides: Array<readonly string[] | null> = [];
  const controller = createVimLeaderController({
    dispatch: () => {},
    onGuideChange: prefix => guides.push(prefix),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  const revealThen = (key: string) => {
    guides.length = 0;
    assert.equal(controller.handleKey('Space'), true);
    timers.advance(500);
    assert.deepEqual(controller.guidePrefix, ['Space']);
    if (key === 'cancel') controller.cancel();
    else if (key === 'dispose') controller.dispose();
    else assert.equal(controller.handleKey(key), true);
    assert.equal(controller.guidePrefix, null);
    assert.deepEqual(guides[guides.length - 1], null);
  };

  // complete
  revealThen('Space');
  // invalid
  revealThen('x');
  // Escape
  revealThen('Escape');
  // cancel
  revealThen('cancel');
  // dispose
  revealThen('dispose');
});

test('explicit non-insert Space mappings keep their configured behavior', () => {
  const mapping = (lhs: string, modes: VimMapping['modes']): VimMapping => ({ lhs, rhs: 'l', modes });

  assert.equal(vimLeaderSuppressedByMappings([]), false);
  assert.equal(vimLeaderSuppressedByMappings([{ lhs: 'Y', rhs: 'y$', modes: ['normal'] }]), false);
  assert.equal(vimLeaderSuppressedByMappings([mapping('<Space>', ['normal'])]), true);
  assert.equal(vimLeaderSuppressedByMappings([mapping(' ', ['visual'])]), true);
  assert.equal(vimLeaderSuppressedByMappings([mapping('<Space>f', ['visual'])]), true);
  // Insert-only mappings do not affect Normal/Visual leader ownership.
  assert.equal(vimLeaderSuppressedByMappings([mapping('<Space>', ['insert'])]), false);
});
