import { basicSetup, EditorView } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { createVimExtension } from '../../src/lib/vim/extension.ts';
import type { VimConfig } from '../../src/lib/vim/config.ts';

const params = new URLSearchParams(window.location.search);
const initialA = params.get('a') ?? '';
const initialB = params.get('b') ?? '';
const mapLhs = params.get('map');
const mapRhs = params.get('rhs');

const mappingConfig: VimConfig = mapLhs
  ? { mappings: [{ lhs: mapLhs, rhs: mapRhs ?? '', modes: ['normal'] }] }
  : { mappings: [] };

const vim = createVimExtension(mappingConfig);
vim.installMappings();

const vimCompartment = new Compartment();
let vimEnabled = true;
let active = 'A';
const states = new Map<string, EditorState>();
const container = document.createElement('div');
container.dataset.testid = 'code-editor';
document.getElementById('root')?.append(container);

const updateListener = EditorView.updateListener.of(update => {
  if (update.docChanged) states.set(active, update.state);
});

function createState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [basicSetup, vimCompartment.of(vim.extension), updateListener],
  });
}

states.set('A', createState(initialA));
states.set('B', createState(initialB));

const view = new EditorView({ state: states.get('A'), parent: container });

function switchTo(id: string): void {
  if (id === active) return;
  const previous = active;
  vim.beforeActivation(view, previous);
  states.set(previous, view.state);
  const target = states.get(id);
  if (!target) return;
  active = id;
  view.setState(target);
  vim.afterActivation(view, id);
  view.focus();
}

function setVimEnabled(enabled: boolean): void {
  if (enabled === vimEnabled) return;
  if (!enabled) vim.beforeActivation(view, active);
  vimEnabled = enabled;

  const extension = enabled ? vim.extension : [];
  view.dispatch({ effects: vimCompartment.reconfigure(extension) });

  // EditorState.set states for inactive tabs must carry the same compartment
  // value. Otherwise switching tabs silently re-enables Vim on a tab that was
  // cached before the toggle.
  for (const [id, state] of Array.from(states)) {
    if (id === active) {
      states.set(id, view.state);
    } else {
      states.set(id, state.update({ effects: vimCompartment.reconfigure(extension) }).state);
    }
  }

  if (enabled) vim.afterActivation(view, active);
  view.focus();
}

function setCursor(offset: number): void {
  view.dispatch({ selection: { anchor: offset } });
  view.focus();
}

function current() {
  const { mode, pending } = vim.getState(view);
  return {
    active,
    enabled: vimEnabled,
    doc: view.state.doc.toString(),
    cursor: view.state.selection.main.head,
    mode,
    pending,
  };
}

(window as unknown as Record<string, unknown>).__crumbVim = {
  switchTo,
  setVimEnabled,
  setCursor,
  current,
  docOf: (id: string) => states.get(id)?.doc.toString() ?? null,
  releaseDocument: (id: string) => {
    vim.releaseDocument(id);
  },
  insertWhileDisabled: (text: string) => {
    view.dispatch({ changes: { from: 0, insert: text } });
    states.set(active, view.state);
  },
};
