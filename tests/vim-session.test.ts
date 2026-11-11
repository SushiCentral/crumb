import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  createVimSession,
  type VimSessionAdapter,
  type VimSessionBinding,
} from '../src/lib/vim/session.ts';
import type {
  VimJumpBridgeHandlers,
  VimMarkPosition,
  VimRepeatSnapshot,
} from '../src/lib/vim/lifecycle.ts';

interface FakeMark {
  name: string;
  line: number;
  ch: number;
}

interface FakeRestore {
  repeat: string | undefined;
  marks: FakeMark[];
}

interface FakeState {
  doc: Text;
  state: EditorState;
  marks: FakeMark[];
  repeat: string | undefined;
  restores: FakeRestore[];
  focuses: number;
  cursorRestores: Array<{ line: number; ch: number }>;
  events: string[];
  jumps: VimJumpBridgeHandlers | undefined;
  normalizeCursor: { line: number; ch: number } | null;
  normalizeHook: (() => void) | undefined;
  normalizations: number;
  semanticCursor: { line: number; ch: number } | null;
}

function createFakeAdapter() {
  const states = new WeakMap<object, FakeState>();

  const adapter: VimSessionAdapter = {
    capture(view: EditorView) {
      const fake = states.get(view as object);
      if (!fake) return null;
      const marks = fake.marks.map(mark => ({ ...mark }));
      // Engine capture moves live markers into the snapshot.
      fake.marks = [];
      return {
        document: fake.doc,
        repeat: { tag: fake.repeat } as unknown as VimRepeatSnapshot,
        marks: marks as VimMarkPosition[],
      };
    },
    restore(
      view: EditorView,
      repeat: VimRepeatSnapshot,
      marks: { readonly doc: Text; readonly marks: readonly VimMarkPosition[] } | undefined,
    ) {
      const fake = states.get(view as object);
      if (!fake) return 'unavailable';
      fake.repeat = (repeat as unknown as { tag?: string } | undefined)?.tag;
      fake.marks = marks ? marks.marks.map(mark => ({ ...mark })) : [];
      fake.restores.push({ repeat: fake.repeat, marks: fake.marks.map(mark => ({ ...mark })) });
      if (marks && !marks.doc.eq(fake.doc)) {
        fake.marks = [];
        return 'stale';
      }
      return 'applied';
    },
    hasAdapter(view: EditorView) {
      return states.has(view as object);
    },
    registerJumps(view: EditorView, handlers: VimJumpBridgeHandlers) {
      const fake = states.get(view as object);
      if (!fake) return () => {};
      fake.jumps = handlers;
      return () => {
        if (fake.jumps === handlers) fake.jumps = undefined;
      };
    },
    restoreCursor(view: EditorView, position: { line: number; ch: number }) {
      const fake = states.get(view as object);
      if (!fake) return false;
      fake.cursorRestores.push({ line: position.line, ch: position.ch });
      fake.events.push('restore');
      const target = fake.state.doc.line(Math.min(position.line + 1, fake.state.doc.lines));
      fake.state = fake.state.update({
        selection: { anchor: target.from + Math.min(position.ch, target.length) },
      }).state;
      fake.doc = fake.state.doc;
      return true;
    },
    normalizeBeforeCapture(view: EditorView) {
      const fake = states.get(view as object);
      if (!fake) return;
      fake.normalizations += 1;
      fake.normalizeHook?.();
      if (!fake.normalizeCursor) return;
      const target = fake.state.doc.line(Math.min(fake.normalizeCursor.line + 1, fake.state.doc.lines));
      fake.state = fake.state.update({
        selection: { anchor: target.from + Math.min(fake.normalizeCursor.ch, target.length) },
      }).state;
      fake.doc = fake.state.doc;
    },
    semanticCursor(view: EditorView) {
      const fake = states.get(view as object);
      if (!fake?.semanticCursor) return null;
      return { ...fake.semanticCursor };
    },
  };

  return {
    adapter,
    createView(text: string) {
      const state = EditorState.create({ doc: text });
      const view = {
        get state() { return states.get(view as object)?.state ?? state; },
        hasFocus: false,
        dom: { contains: () => false },
        focus: () => {
          const fake = states.get(view as object);
          if (fake) {
            fake.focuses += 1;
            fake.events.push('focus');
            (view as unknown as { hasFocus: boolean }).hasFocus = true;
          }
        },
        dispatch: (spec: { selection?: { anchor: number }; scrollIntoView?: boolean }) => {
          const fake = states.get(view as object);
          assert.ok(fake);
          fake.state = fake.state.update({
            selection: spec.selection,
            scrollIntoView: spec.scrollIntoView,
          }).state;
        },
      } as unknown as EditorView;
      states.set(view as object, {
        doc: state.doc,
        state,
        marks: [],
        repeat: undefined,
        restores: [],
        focuses: 0,
        cursorRestores: [],
        events: [],
        jumps: undefined,
        normalizeCursor: null,
        normalizeHook: undefined,
        normalizations: 0,
        semanticCursor: null,
      });
      return view;
    },
    setDocument(view: EditorView, text: string, line = 0, ch = 0) {
      const fake = states.get(view as object);
      assert.ok(fake);
      const state = EditorState.create({ doc: text });
      const target = state.doc.line(Math.min(line + 1, state.doc.lines));
      fake.state = state.update({
        selection: { anchor: target.from + Math.min(ch, target.length) },
      }).state;
      fake.doc = fake.state.doc;
    },
    setCursor(view: EditorView, line: number, ch = 0) {
      const fake = states.get(view as object);
      assert.ok(fake);
      const target = fake.state.doc.line(Math.min(line + 1, fake.state.doc.lines));
      fake.state = fake.state.update({
        selection: { anchor: target.from + Math.min(ch, target.length) },
      }).state;
      fake.doc = fake.state.doc;
    },
    cursor(view: EditorView) {
      const fake = states.get(view as object);
      assert.ok(fake);
      const head = fake.state.selection.main.head;
      const line = fake.state.doc.lineAt(head);
      return { line: line.number - 1, ch: head - line.from };
    },
    jumpHandlers(view: EditorView) {
      return states.get(view as object)?.jumps;
    },
    jumpAdd(view: EditorView, from: { line: number; ch: number }, to: { line: number; ch: number }) {
      const fake = states.get(view as object);
      assert.ok(fake?.jumps);
      fake.jumps.add({} as never, from, to);
    },
    jumpMove(view: EditorView, offset: number) {
      const fake = states.get(view as object);
      assert.ok(fake?.jumps);
      fake.jumps.move({} as never, offset);
    },
    jumpFind(view: EditorView, offset: number) {
      const fake = states.get(view as object);
      assert.ok(fake?.jumps);
      return fake.jumps.find({} as never, offset);
    },
    jumpCorrect(view: EditorView, line: number, ch: number) {
      const fake = states.get(view as object);
      assert.ok(fake?.jumps);
      fake.jumps.correct({} as never, { line, ch });
    },
    setRepeat(view: EditorView, tag: string | undefined) {
      const fake = states.get(view as object);
      assert.ok(fake);
      fake.repeat = tag;
    },
    setMark(view: EditorView, mark: FakeMark) {
      const fake = states.get(view as object);
      assert.ok(fake);
      fake.marks = [{ ...mark }];
    },
    marks(view: EditorView) {
      return states.get(view as object)?.marks ?? [];
    },
    restores(view: EditorView) {
      return states.get(view as object)?.restores ?? [];
    },
    focuses(view: EditorView) {
      return states.get(view as object)?.focuses ?? 0;
    },
    cursorRestores(view: EditorView) {
      return states.get(view as object)?.cursorRestores ?? [];
    },
    events(view: EditorView) {
      return states.get(view as object)?.events ?? [];
    },
    normalizations(view: EditorView) {
      return states.get(view as object)?.normalizations ?? 0;
    },
    setNormalizeCursor(view: EditorView, line: number, ch = 0) {
      const fake = states.get(view as object);
      assert.ok(fake);
      fake.normalizeCursor = { line, ch };
    },
    setNormalizeHook(view: EditorView, hook: (() => void) | undefined) {
      const fake = states.get(view as object);
      assert.ok(fake);
      fake.normalizeHook = hook;
    },
    setSemanticCursor(view: EditorView, line: number, ch = 0) {
      const fake = states.get(view as object);
      assert.ok(fake);
      fake.semanticCursor = { line, ch };
    },
  };
}

function attach(session: ReturnType<typeof createVimSession>, paneId: string, view: EditorView): VimSessionBinding {
  return session.attachPane(paneId, view, 'S', true);
}

test('only the active owner publishes repeat and inactive panes cannot overwrite it', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const viewA = fake.createView('alpha beta');
  const viewB = fake.createView('bravo charlie');
  const a = attach(session, 'A', viewA);
  const b = attach(session, 'B', viewB);
  session.requestOwner('A');

  fake.setRepeat(viewA, 'A-latest');
  fake.setRepeat(viewB, 'B-stale');

  // Simulate global disable. Only the owner may publish its adapter state.
  a.beforeTransition();
  b.beforeTransition();
  a.setEnabled(false);
  b.setEnabled(false);

  a.setEnabled(true);
  a.afterTransition('S');
  b.setEnabled(true);
  b.afterTransition('S');

  const restoresA = fake.restores(viewA);
  assert.equal(restoresA.at(-1)?.repeat, 'A-latest');
  assert.equal(fake.restores(viewB).length, 0, 'inactive pane must not receive ownership or publish state');
});

test('marks converge on ownership transfer, including the latest update to the same mark', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const viewA = fake.createView('alpha beta gamma');
  const viewB = fake.createView('alpha beta gamma');
  const a = attach(session, 'A', viewA);
  attach(session, 'B', viewB);
  session.requestOwner('A');

  fake.setMark(viewA, { name: 'a', line: 0, ch: 6 });
  session.requestOwner('B');
  assert.deepEqual(fake.marks(viewB), [{ name: 'a', line: 0, ch: 6 }]);

  // A writes the same mark again later; ownership transfer must see the update.
  session.requestOwner('A');
  fake.setMark(viewA, { name: 'a', line: 0, ch: 11 });
  session.requestOwner('B');
  assert.deepEqual(fake.marks(viewB), [{ name: 'a', line: 0, ch: 11 }]);

  // An inactive capture cannot overwrite the newer snapshot.
  a.beforeTransition();
  a.afterTransition('S');
  session.requestOwner('A');
  assert.deepEqual(fake.marks(viewA), [{ name: 'a', line: 0, ch: 11 }]);
});

test('owner detach finalizes before destruction so a surviving pane can restore repeat and marks', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const viewA = fake.createView('alpha beta gamma');
  const viewB = fake.createView('alpha beta gamma');
  const a = attach(session, 'A', viewA);
  attach(session, 'B', viewB);
  session.requestOwner('A');

  fake.setRepeat(viewA, 'A-edit');
  fake.setMark(viewA, { name: 'a', line: 0, ch: 6 });
  a.detach();

  session.requestOwner('B');
  assert.deepEqual(fake.marks(viewB), [{ name: 'a', line: 0, ch: 6 }]);
  assert.equal(fake.restores(viewB).at(-1)?.repeat, 'A-edit');
});

test('document closure removes marks but not repeat, and late capture cannot resurrect marks', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const viewA = fake.createView('alpha beta gamma');
  const viewB = fake.createView('alpha beta gamma');
  const a = attach(session, 'A', viewA);
  attach(session, 'B', viewB);
  session.requestOwner('A');

  fake.setRepeat(viewA, 'A-edit');
  fake.setMark(viewA, { name: 'a', line: 0, ch: 6 });
  session.reconcileDocuments([]);

  // Late owner teardown after closure must not write marks back into the store.
  a.detach();
  session.reconcileDocuments(['S']);
  session.requestOwner('B');

  assert.deepEqual(fake.marks(viewB), []);
  assert.equal(fake.restores(viewB).at(-1)?.repeat, 'A-edit');
});

test('reconciling unchanged document ids does not release marks', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const viewA = fake.createView('alpha');
  const viewB = fake.createView('alpha');
  attach(session, 'A', viewA);
  attach(session, 'B', viewB);
  session.requestOwner('A');
  fake.setMark(viewA, { name: 'a', line: 0, ch: 2 });

  session.reconcileDocuments(['S', 'T']);
  session.requestOwner('B');
  assert.deepEqual(fake.marks(viewB), [{ name: 'a', line: 0, ch: 2 }]);
});

test('owner requests queue until the target binding is attached and ready', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  session.requestOwner('B');
  const viewB = fake.createView('alpha');
  attach(session, 'B', viewB);
  assert.equal(fake.restores(viewB).length, 1);
});

test('focus intent from a Vim-disabled binding does not fire when it is enabled later', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const view = fake.createView('alpha');
  const binding = session.attachPane('A', view, 'S', false);
  session.requestOwner('A', { focus: true });
  assert.equal(fake.focuses(view), 0);

  binding.setEnabled(true);
  binding.afterTransition('S');

  assert.equal(fake.focuses(view), 0, 'disabled-mode focus intent must not survive until enable');
});

test('synchronous focus reentry during finalization cannot reclaim ownership', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const viewA = fake.createView('alpha');
  const viewB = fake.createView('bravo');
  attach(session, 'A', viewA);
  attach(session, 'B', viewB);
  session.requestOwner('A');
  fake.setRepeat(viewA, 'A-latest');
  const restoresBefore = fake.restores(viewA).length;

  let reentered = false;
  const capture = fake.adapter.capture;
  fake.adapter.capture = view => {
    if (view === viewA && !reentered) {
      reentered = true;
      // Simulate CodeMirror prompt cleanup synchronously focusing the outgoing
      // pane while the owner is being captured.
      session.requestOwner('A', { focus: true });
    }
    return capture(view);
  };

  session.requestOwner('B', { focus: true });

  assert.equal(reentered, true);
  assert.equal(fake.restores(viewA).length, restoresBefore, 'outgoing pane must not be restored mid-finalization');
  assert.equal(fake.restores(viewB).at(-1)?.repeat, 'A-latest');
  assert.equal(fake.focuses(viewA), 0);
  assert.equal(fake.focuses(viewB), 1, 'incoming pane receives focus after the transfer');
});

test('normalizes a transient preview before sampling the departure for jump history', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const viewA = fake.createView(textA);
  const viewB = fake.createView(textB);
  const binding = session.attachPane('P', viewA, 'A', true);
  session.attachPane('Q', viewB, 'B', true);
  session.requestOwner('P');

  // Visual Flash activation is line 0; its preview moved the real head to
  // line 12. Ownership transfer must normalize back to activation before the
  // departure is sampled, or Ctrl-o asks the source document for line 12.
  fake.setCursor(viewA, 0, 0);
  fake.setNormalizeCursor(viewA, 0, 0);
  fake.setCursor(viewA, 12, 4);
  assert.deepEqual(fake.cursor(viewA), { line: 12, ch: 4 });

  let reentered = false;
  fake.setNormalizeHook(viewA, () => {
    if (reentered) return;
    reentered = true;
    // Normalization dispatches through the engine; focus cleanup may
    // synchronously ask for the outgoing pane while it is finalizing.
    session.requestOwner('P', { focus: true });
  });

  binding.beforeTransition();
  fake.setDocument(viewB, textB, 0);
  binding.afterTransition('B');

  assert.equal(fake.normalizations(viewA), 1);
  assert.equal(reentered, true);
  assert.equal(fake.focuses(viewA), 0, 'normalization reentry must stay behind the finalization guard');

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}:${target.ch}`);
    if (target.documentId === 'A') {
      binding.beforeTransition();
      fake.setDocument(viewA, textA, target.line, target.ch);
      binding.afterTransition('A');
    }
    return { paneId: 'P' };
  });

  fake.jumpMove(viewA, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['A:0:0'], 'the recorded departure is the activation cursor, not the preview');
});

test('records the inclusive Vim Visual head, not CodeMirror\'s exclusive head, as the departure column', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = 'alpha beta alpha';
  const textB = makeText('B');
  const viewA = fake.createView(textA);
  const viewB = fake.createView(textB);
  const binding = session.attachPane('P', viewA, 'A', true);
  session.attachPane('Q', viewB, 'B', true);
  session.requestOwner('P');

  // `vl` leaves the semantic Vim head on ch1 while charwise Visual's
  // CodeMirror head is the exclusive ch2. Flash previews the next match, then
  // normalization restores the same activation selection before sampling.
  fake.setNormalizeCursor(viewA, 0, 2);
  fake.setSemanticCursor(viewA, 0, 1);
  fake.setCursor(viewA, 0, 12);
  assert.deepEqual(fake.cursor(viewA), { line: 0, ch: 12 });

  binding.beforeTransition();
  fake.setDocument(viewB, textB, 0);
  binding.afterTransition('B');

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}:${target.ch}`);
    if (target.documentId === 'A') {
      binding.beforeTransition();
      fake.setDocument(viewA, textA, target.line, target.ch);
      binding.afterTransition('A');
    }
    return { paneId: 'P' };
  });

  fake.jumpMove(viewA, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['A:0:1'], 'the exclusive CodeMirror head must not shift the departure by one');
});

function makeText(prefix: string, lines = 100): string {
  return Array.from({ length: lines }, (_, index) => `${prefix}${index + 1} ....................`).join('\n');
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('records native and cross-file jumps in one chronology and replays without recording', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.setCursor(view, 1);
  fake.jumpAdd(view, { line: 1, ch: 0 }, { line: 39, ch: 0 });
  fake.setCursor(view, 39);

  // A real document transition is the cross-file jump; both ids are open.
  binding.beforeTransition();
  fake.setDocument(view, textB, 6);
  binding.afterTransition('B');
  fake.jumpAdd(view, { line: 6, ch: 0 }, { line: 89, ch: 0 });
  fake.setCursor(view, 89);

  let currentDocument = 'B';
  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}:${target.ch}`);
    if (target.documentId !== currentDocument) {
      binding.beforeTransition();
      fake.setDocument(view, target.documentId === 'A' ? textA : textB, target.line, target.ch);
      currentDocument = target.documentId;
      binding.afterTransition(target.documentId);
    }
    return { paneId: 'P' };
  });

  fake.jumpMove(view, -1);
  await flushMicrotasks();
  assert.deepEqual(fake.cursor(view), { line: 6, ch: 0 });

  fake.jumpMove(view, -1);
  await flushMicrotasks();
  assert.equal(currentDocument, 'A');
  assert.deepEqual(fake.cursor(view), { line: 39, ch: 0 });

  fake.jumpMove(view, -1);
  await flushMicrotasks();
  assert.deepEqual(fake.cursor(view), { line: 1, ch: 0 });

  fake.jumpMove(view, 1);
  await flushMicrotasks();
  fake.jumpMove(view, 1);
  await flushMicrotasks();
  fake.jumpMove(view, 1);
  await flushMicrotasks();

  assert.deepEqual(targets, [
    'B:6:0',
    'A:39:0',
    'A:1:0',
    'A:39:0',
    'B:6:0',
    'B:89:0',
  ]);
  assert.equal(currentDocument, 'B');
  assert.deepEqual(fake.cursor(view), { line: 89, ch: 0 });
});

test('counts and rapid traversal chain from the reserved target with latest request winning', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 1, ch: 0 }, { line: 39, ch: 0 });
  fake.setCursor(view, 39);
  binding.beforeTransition();
  fake.setDocument(view, textB, 6);
  binding.afterTransition('B');
  fake.jumpAdd(view, { line: 6, ch: 0 }, { line: 89, ch: 0 });
  // Reset the source position to the newest entry (the fake adapter does not
  // move the cursor for an add).
  fake.setCursor(view, 89);

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    if (target.documentId === 'A') {
      binding.beforeTransition();
      fake.setDocument(view, textA, target.line, target.ch);
      binding.afterTransition('A');
    }
    return { paneId: 'P' };
  });

  // First request reserves B7; the second Ctrl-o must continue from that
  // reservation (A40) rather than from B90 again.
  fake.jumpMove(view, -1);
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['A:39']);
  assert.deepEqual(fake.cursor(view), { line: 39, ch: 0 }, 'the latest target wins');
});

test('a rejected navigation restores the pointer and the next request retries the same target', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 1, ch: 0 }, { line: 39, ch: 0 });
  binding.beforeTransition();
  fake.setDocument(view, textB, 89);
  binding.afterTransition('B');
  fake.jumpAdd(view, { line: 6, ch: 0 }, { line: 89, ch: 0 });
  fake.setCursor(view, 89);

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    return null;
  });
  fake.jumpMove(view, -1);
  await flushMicrotasks();
  assert.deepEqual(targets, ['B:6']);
  assert.deepEqual(fake.cursor(view), { line: 89, ch: 0 }, 'rejection must not move the source');

  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    return { paneId: 'P' };
  });
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['B:6', 'B:6'], 'the pointer was rolled back, not advanced');
  assert.deepEqual(fake.cursor(view), { line: 6, ch: 0 });
});

test('an unrelated transition cancels a waiting cross-file navigation and rolls history back', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 1, ch: 0 }, { line: 39, ch: 0 });
  fake.setCursor(view, 39);
  binding.beforeTransition();
  fake.setDocument(view, textB, 6);
  binding.afterTransition('B');
  fake.jumpAdd(view, { line: 6, ch: 0 }, { line: 89, ch: 0 });
  fake.setCursor(view, 89);

  const targets: string[] = [];
  let activateHost = false;
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    return { paneId: 'P' };
  });

  fake.jumpMove(view, -2);
  await flushMicrotasks();
  assert.deepEqual(targets, ['A:39']);
  assert.deepEqual(fake.cursor(view), { line: 89, ch: 0 }, 'navigation waits for the host transition');

  // An unrelated transition on the same pane (wrong target document) cancels.
  binding.beforeTransition();
  binding.afterTransition('B');
  await flushMicrotasks();

  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    activateHost = true;
    return { paneId: 'P' };
  });
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.equal(activateHost, true);
  assert.deepEqual(targets, ['A:39', 'B:6'], 'history pointer rolled back before the retry');
});

test('find only resolves same-document history and correction updates the forward destination', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 1, ch: 0 }, { line: 39, ch: 0 });
  fake.jumpCorrect(view, 39, 12);
  fake.setCursor(view, 39, 12);
  binding.beforeTransition();
  fake.setDocument(view, textB, 6);
  binding.afterTransition('B');
  fake.jumpAdd(view, { line: 6, ch: 0 }, { line: 89, ch: 0 });
  fake.setCursor(view, 89);

  assert.deepEqual(fake.jumpFind(view, -1), { line: 6, ch: 0 });
  assert.equal(fake.jumpFind(view, -5), null, 'foreign positions are never returned');

  session.setJumpNavigator(target => {
    if (target.documentId === 'A') {
      binding.beforeTransition();
      fake.setDocument(view, textA, target.line, target.ch);
      binding.afterTransition('A');
    }
    return { paneId: 'P' };
  });

  fake.jumpMove(view, -1);
  await flushMicrotasks();
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.deepEqual(fake.cursor(view), { line: 39, ch: 12 }, 'correction replaced the native landing column');
});

test('reconcile cancels a closed pending target before pruning so rollback cannot resurrect it', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 0, ch: 0 }, { line: 39, ch: 0 });
  fake.setCursor(view, 39);
  binding.beforeTransition();
  fake.setDocument(view, textB, 89);
  binding.afterTransition('B');
  fake.setCursor(view, 89);

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    // Resolve the pane but deliberately leave the document transition pending.
    return { paneId: 'P' };
  });

  fake.jumpMove(view, -1);
  await flushMicrotasks();
  assert.deepEqual(targets, ['A:39']);

  // A closes while the pending target is still A. Cancellation must restore the
  // pre-reservation snapshot BEFORE prune removes A from the live list.
  session.reconcileDocuments(['B']);
  await flushMicrotasks();
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['A:39'], 'repeated Back must not request the closed document');
});

test('reconcile prunes a still-pending rollback snapshot for other closed documents', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['X', 'A', 'B']);

  const textX = makeText('X');
  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textX);
  const binding = session.attachPane('P', view, 'X', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 0, ch: 0 }, { line: 5, ch: 0 });
  fake.setCursor(view, 5);
  binding.beforeTransition();
  fake.setDocument(view, textA, 39);
  binding.afterTransition('A');
  fake.jumpAdd(view, { line: 39, ch: 0 }, { line: 89, ch: 0 });
  fake.setCursor(view, 89);
  binding.beforeTransition();
  fake.setDocument(view, textB, 89);
  binding.afterTransition('B');
  fake.setCursor(view, 89);

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    return { paneId: 'P' };
  });

  // Pending Back to A, while X is still part of the pre-reservation snapshot.
  fake.jumpMove(view, -2);
  await flushMicrotasks();
  assert.deepEqual(targets, ['A:39']);

  // X closes but the pending target A remains. The rollback snapshot must lose
  // X, otherwise a later cancel restores it and the traversal can reach X.
  session.reconcileDocuments(['A', 'B']);
  binding.beforeTransition();
  binding.afterTransition('B');
  await flushMicrotasks();

  fake.jumpMove(view, -1);
  await flushMicrotasks();
  fake.jumpMove(view, -1);
  await flushMicrotasks();
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['A:39', 'A:89', 'A:39']);
  assert.ok(!targets.some(target => target.startsWith('X:')), 'closed X must not be resurrected');
});

test('a clamped replay landing updates the selected entry so Forward still works', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A', 90);
  const shortA = makeText('A', 10);
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 0, ch: 0 }, { line: 89, ch: 0 });
  fake.setCursor(view, 89);
  binding.beforeTransition();
  fake.setDocument(view, textB, 0);
  binding.afterTransition('B');

  let currentDocument = 'B';
  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    if (target.documentId !== currentDocument) {
      binding.beforeTransition();
      fake.setDocument(
        view,
        target.documentId === 'A' ? shortA : textB,
        target.line,
        target.ch,
      );
      currentDocument = target.documentId;
      binding.afterTransition(target.documentId);
    }
    return { paneId: 'P' };
  });

  // A had 90 lines when the jump was recorded but only 10 when replayed.
  fake.jumpMove(view, -1);
  await flushMicrotasks();
  assert.equal(currentDocument, 'A');
  assert.deepEqual(fake.cursor(view), { line: 9, ch: 0 });
  assert.deepEqual(fake.cursorRestores(view).at(-1), { line: 9, ch: 0 });

  // The clamped landing is now the selected entry, so Forward is not mistaken
  // for an unrecorded departure and the B branch survives.
  fake.jumpMove(view, 1);
  await flushMicrotasks();
  assert.deepEqual(targets, ['A:89', 'B:0']);
  assert.equal(currentDocument, 'B');
  assert.deepEqual(fake.cursor(view), { line: 0, ch: 0 });
});

test('a genuine native jump during replay cancels pending and records the new jump', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const textB = makeText('B');
  const view = fake.createView(textA);
  const binding = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');

  fake.jumpAdd(view, { line: 0, ch: 0 }, { line: 39, ch: 0 });
  fake.setCursor(view, 39);
  binding.beforeTransition();
  fake.setDocument(view, textB, 89);
  binding.afterTransition('B');
  fake.setCursor(view, 89);

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    return { paneId: 'P' };
  });

  fake.jumpMove(view, -1);
  await flushMicrotasks();
  assert.deepEqual(targets, ['A:39']);

  // The owner performs a real within-file jump while the old Back waits for A.
  fake.jumpAdd(view, { line: 19, ch: 0 }, { line: 69, ch: 0 });
  fake.setCursor(view, 69);
  await flushMicrotasks();

  assert.deepEqual(fake.cursorRestores(view), [], 'the old pending A navigation must not apply');
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['A:39', 'B:19'], 'the newer genuine jump owns the history');
  assert.deepEqual(fake.cursor(view), { line: 19, ch: 0 });
});

test('native adds from an inactive owner are ignored', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A', 'B']);

  const textA = makeText('A');
  const viewA = fake.createView(textA);
  const viewB = fake.createView(makeText('B'));
  session.attachPane('P', viewA, 'A', true);
  session.attachPane('Q', viewB, 'B', true);
  session.requestOwner('P');

  // Q is an enabled, ready binding but not the owner; its native add must not
  // publish into the session history.
  fake.jumpAdd(viewB, { line: 0, ch: 0 }, { line: 5, ch: 0 });
  fake.jumpAdd(viewA, { line: 0, ch: 0 }, { line: 1, ch: 0 });
  fake.setCursor(viewA, 1);

  const targets: string[] = [];
  session.setJumpNavigator(target => {
    targets.push(`${target.documentId}:${target.line}`);
    return { paneId: 'P' };
  });

  fake.jumpMove(viewA, -1);
  await flushMicrotasks();
  fake.jumpMove(viewA, -1);
  await flushMicrotasks();

  assert.deepEqual(targets, ['A:0'], 'the inactive B jump never entered the history');
});

test('a replay restores through the adapter cursor helper before focusing', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A']);

  const view = fake.createView(makeText('A'));
  session.attachPane('P', view, 'A', true);
  session.requestOwner('P');
  fake.jumpAdd(view, { line: 0, ch: 0 }, { line: 39, ch: 0 });
  fake.setCursor(view, 39);

  session.setJumpNavigator(() => ({ paneId: 'P' }));
  fake.jumpMove(view, -1);
  await flushMicrotasks();

  assert.deepEqual(fake.cursorRestores(view), [{ line: 0, ch: 0 }]);
  assert.deepEqual(fake.events(view).slice(-2), ['restore', 'focus']);
});

test('a stale binding cannot unregister the replacement jump handler', async () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['A']);

  const view = fake.createView(makeText('A'));
  const stale = session.attachPane('P', view, 'A', true);
  session.requestOwner('P');
  stale.detach();

  const replacementView = fake.createView(makeText('A'));
  session.attachPane('P', replacementView, 'A', true);
  session.requestOwner('P');

  // StrictMode-style replay of the removed binding must not remove the new
  // view's registered jump handler.
  stale.detach();
  stale.beforeTransition();
  stale.afterTransition('A');
  assert.ok(fake.jumpHandlers(replacementView));

  fake.jumpAdd(replacementView, { line: 0, ch: 0 }, { line: 39, ch: 0 });
  fake.setCursor(replacementView, 39);
  session.setJumpNavigator(() => ({ paneId: 'P' }));

  fake.jumpMove(replacementView, -1);
  await flushMicrotasks();
  assert.equal(fake.cursor(replacementView).line, 0);
});

test('detached and replays bindings cannot perform stale lifecycle operations', () => {
  const fake = createFakeAdapter();
  const session = createVimSession(fake.adapter);
  session.reconcileDocuments(['S']);

  const firstView = fake.createView('alpha');
  const first = session.attachPane('A', firstView, 'S', true);
  session.requestOwner('A');
  first.detach();

  const secondView = fake.createView('alpha');
  const second = attach(session, 'A', secondView);
  session.requestOwner('A');

  // StrictMode-style replay of the removed binding must not capture, restore,
  // or detach the replacement binding.
  first.beforeTransition();
  first.afterTransition('S');
  first.detach();

  fake.setMark(secondView, { name: 'a', line: 0, ch: 3 });
  second.beforeTransition();
  second.afterTransition('S');
  assert.deepEqual(fake.marks(secondView), [{ name: 'a', line: 0, ch: 3 }]);
});
