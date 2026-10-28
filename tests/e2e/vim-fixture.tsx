import { basicSetup, EditorView } from 'codemirror';
import { undoDepth } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { createVimExtension } from '../../src/lib/vim/extension.ts';

const params = new URLSearchParams(window.location.search);
const doc = params.get('doc') ?? '';
const container = document.createElement('div');
container.dataset.testid = 'code-editor';
const width = params.get('width');
if (width) container.style.width = `${width}px`;
document.getElementById('root')?.append(container);

const writes: string[] = [];
const hostCalls: string[] = [];
const leaderActions: string[] = [];
let flashState: { query: string; matchCount: number } | null = null;
let cachedState: EditorState | null = null;
let view: EditorView;
const vim = createVimExtension(undefined, {
  onWrite: () => {
    writes.push(view.state.doc.toString());
  },
  onQuit: force => {
    hostCalls.push(force ? 'q!' : 'q');
  },
  onWriteQuit: () => {
    hostCalls.push('wq');
  },
  onFlashStateChange: state => {
    flashState = state;
  },
  ...(params.get('leader') === '1'
    ? {
        leader: {
          dispatch: action => {
            leaderActions.push(action);
          },
        },
      }
    : {}),
});
vim.installMappings();

view = new EditorView({
  doc,
  extensions: [
    vim.extension,
    basicSetup,
    ...(params.get('wrap') === '1' ? [EditorView.lineWrapping] : []),
  ],
  parent: container,
});

const visibleLines = Number(params.get('lines'));
if (Number.isFinite(visibleLines) && visibleLines > 0) {
  const sample = container.querySelector<HTMLElement>('.cm-line');
  const lineHeight = sample?.getBoundingClientRect().height || view.defaultLineHeight;
  container.style.height = `${lineHeight * visibleLines + 4}px`;
}

interface FixtureSnapshot {
  doc: string;
  cursor: number;
  anchor: number;
  ranges: Array<{ anchor: number; head: number }>;
  mode: string;
  pending: string;
  writes: string[];
  hostCalls: string[];
  leaderActions: string[];
  flash: { query: string; matchCount: number } | null;
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
    hostCalls: [...hostCalls],
    leaderActions: [...leaderActions],
    flash: flashState ? { ...flashState } : null,
    undoDepth: undoDepth(view.state),
  }),
  getRegister: (name: string) => vim.getRegister(view, name),
  getCoordsAt: (offset: number) => {
    const coords = view.coordsAtPos(offset);
    return coords ? { x: coords.left, y: coords.top, height: coords.bottom - coords.top } : null;
  },
  getCharRect: (offset: number) => {
    const coords = view.coordsForChar?.(offset) ?? view.coordsAtPos(offset);
    return coords
      ? {
          left: coords.left,
          right: coords.right,
          top: coords.top,
          bottom: coords.bottom,
          width: coords.right - coords.left,
          height: coords.bottom - coords.top,
        }
      : null;
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
  clearHostCalls: () => {
    hostCalls.length = 0;
  },
  getMetrics: () => {
    const scroller = view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const layer = document.querySelector<HTMLElement>('.crumb-flash-label-layer');
    const gutter = view.dom.querySelector<HTMLElement>('.cm-gutters');
    const gutterRect = gutter?.getBoundingClientRect() ?? null;
    return {
      visibleRanges: view.visibleRanges.map(range => ({ from: range.from, to: range.to })),
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      scroller: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      gutter: gutterRect
        ? {
            left: gutterRect.left,
            top: gutterRect.top,
            right: gutterRect.right,
            bottom: gutterRect.bottom,
            width: gutterRect.width,
            height: gutterRect.height,
          }
        : null,
      layer: layer
        ? (() => {
            const layerRect = layer.getBoundingClientRect();
            return {
              left: layerRect.left,
              top: layerRect.top,
              right: layerRect.right,
              bottom: layerRect.bottom,
              width: layerRect.width,
              height: layerRect.height,
            };
          })()
        : null,
    };
  },
  setScroll: (left: number, top = 0) => {
    view.scrollDOM.scrollLeft = left;
    view.scrollDOM.scrollTop = top;
  },
  replaceDoc: (text: string) => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
  },
  switchWithVimCapture: () => {
    vim.beforeActivation(view, 'A');
    cachedState = view.state;
    view.setState(EditorState.create({ doc: 'switched' }));
  },
  cacheStateAndSwitch: () => {
    cachedState = view.state;
    view.setState(EditorState.create({ doc: 'switched' }));
  },
  restoreCachedState: () => {
    if (!cachedState) throw new Error('No cached state');
    view.setState(cachedState);
    cachedState = null;
  },
};
