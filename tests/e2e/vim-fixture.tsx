import { basicSetup, EditorView } from 'codemirror';
import { undoDepth } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { createVimExtension } from '../../src/lib/vim/extension.ts';

const params = new URLSearchParams(window.location.search);
const doc = params.get('doc') ?? '';
const container = document.createElement('div');
container.dataset.testid = 'code-editor';
const width = params.get('width');
if (width) container.style.width = `${width}px`;
document.getElementById('root')?.append(container);

const writes: string[] = [];
const vim = createVimExtension(undefined, {
  onWrite: () => {
    writes.push(view.state.doc.toString());
  },
});
vim.installMappings();

const view = new EditorView({
  doc,
  extensions: [
    vim.extension,
    basicSetup,
    ...(params.get('wrap') === '1' ? [EditorView.lineWrapping] : []),
  ],
  parent: container,
});

interface FixtureSnapshot {
  doc: string;
  cursor: number;
  anchor: number;
  ranges: Array<{ anchor: number; head: number }>;
  mode: string;
  pending: string;
  writes: string[];
  undoDepth: number;
}

(window as unknown as Record<string, unknown>).__vimFixture = {
  getState: (): FixtureSnapshot => ({
    doc: view.state.doc.toString(),
    cursor: view.state.selection.main.head,
    anchor: view.state.selection.main.anchor,
    ranges: view.state.selection.ranges.map(range => ({ anchor: range.anchor, head: range.head })),
    mode: vim.getState(view).mode,
    pending: vim.getState(view).pending,
    writes: [...writes],
    undoDepth: undoDepth(view.state),
  }),
  getRegister: (name: string) => vim.getRegister(view, name),
  getCoordsAt: (offset: number) => {
    const coords = view.coordsAtPos(offset);
    return coords ? { x: coords.left, y: coords.top, height: coords.bottom - coords.top } : null;
  },
  nativeDisplayMove: (offset: number, forward: boolean, repeat = 1) => {
    let range = EditorSelection.cursor(offset);
    for (let index = 0; index < repeat; index += 1) {
      range = view.moveVertically(range, forward);
    }
    return range.head;
  },
  nativeScrollRepeat: () => Math.round(view.scrollDOM.clientHeight / (2 * view.defaultLineHeight)),
  clearWrites: () => {
    writes.length = 0;
  },
};
