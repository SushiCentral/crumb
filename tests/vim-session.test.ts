import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  createVimSession,
  type VimSessionAdapter,
  type VimSessionBinding,
} from '../src/lib/vim/session.ts';
import type { VimMarkPosition, VimRepeatSnapshot } from '../src/lib/vim/lifecycle.ts';

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
  marks: FakeMark[];
  repeat: string | undefined;
  restores: FakeRestore[];
  focuses: number;
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
  };

  return {
    adapter,
    createView(text: string) {
      const view = {
        focus: () => {
          const fake = states.get(view as object);
          if (fake) fake.focuses += 1;
        },
      } as unknown as EditorView;
      states.set(view as object, {
        doc: EditorState.create({ doc: text }).doc,
        marks: [],
        repeat: undefined,
        restores: [],
        focuses: 0,
      });
      return view;
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
