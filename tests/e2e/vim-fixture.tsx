import { basicSetup, EditorView } from 'codemirror';
import { createVimExtension } from '../../src/lib/vim/extension.ts';

const doc = new URLSearchParams(window.location.search).get('doc') ?? '';
const container = document.createElement('div');
container.dataset.testid = 'code-editor';
document.getElementById('root')?.append(container);

const vim = createVimExtension();

new EditorView({
  doc,
  extensions: [vim.extension, basicSetup],
  parent: container,
});
