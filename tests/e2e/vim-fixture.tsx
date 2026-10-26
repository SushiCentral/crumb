import { basicSetup, EditorView } from 'codemirror';
import { vim } from '@replit/codemirror-vim';

const doc = new URLSearchParams(window.location.search).get('doc') ?? '';
const container = document.createElement('div');
container.dataset.testid = 'code-editor';
document.getElementById('root')?.append(container);

new EditorView({
  doc,
  extensions: [vim({ status: false }), basicSetup],
  parent: container,
});
