import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { createSyntaxHighlighting } from '../lib/highlight';
import type { Theme } from '../lib/themes';

interface EditorProps {
  doc: string;
  theme: Theme;
  fontSize: number;
  onChange?: (value: string) => void;
}

export interface EditorHandle {
  focus: () => void;
}

const externalDocUpdate = Annotation.define<boolean>();
const syntaxCompartment = new Compartment();
const appearanceCompartment = new Compartment();

function editorAppearance(theme: Theme, fontSize: number) {
  return EditorView.theme({
    '&': {
      backgroundColor: 'var(--editor)',
      color: 'var(--text)',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: `${fontSize}px`,
      lineHeight: '1.6',
    },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor)', borderRight: '1px solid var(--border)',
      color: 'var(--gutter)', paddingRight: '12px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text)' },
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--selection) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-matchingBracket': { backgroundColor: 'var(--surface)', outline: 'none' },
    '.cm-scroller::-webkit-scrollbar': { width: '7px', height: '7px' },
    '.cm-scroller::-webkit-scrollbar-thumb': { background: 'var(--surface)', borderRadius: '4px' },
  }, { dark: theme.dark });
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ doc, theme, fontSize, onChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc,
      extensions: [
        basicSetup,
        javascript(),
        syntaxCompartment.of(createSyntaxHighlighting(theme)),
        appearanceCompartment.of(editorAppearance(theme, fontSize)),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return;
          const external = update.transactions.some(transaction => transaction.annotation(externalDocUpdate));
          if (!external) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        syntaxCompartment.reconfigure(createSyntaxHighlighting(theme)),
        appearanceCompartment.reconfigure(editorAppearance(theme, fontSize)),
      ],
    });
  }, [theme, fontSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === doc) return;
    view.dispatch({
      annotations: externalDocUpdate.of(true),
      changes: { from: 0, to: view.state.doc.length, insert: doc },
    });
  }, [doc]);

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
});

export default Editor;
