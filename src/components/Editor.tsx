import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { createSyntaxHighlighting } from '../lib/highlight';
import { languageForPath } from '../lib/languages';
import type { Theme } from '../lib/themes';

interface EditorProps {
  tabId: string;
  path: string | null;
  openTabIds: string[];
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
const languageCompartment = new Compartment();
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

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ tabId, path, openTabIds, doc, theme, fontSize, onChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const statesRef = useRef(new Map<string, EditorState>());
  const activeTabRef = useRef(tabId);
  const onChangeRef = useRef(onChange);

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const createState = (content: string, currentTheme: Theme, currentFontSize: number) => EditorState.create({
    doc: content,
    extensions: [
      syntaxCompartment.of(Prec.highest(createSyntaxHighlighting(currentTheme))),
      basicSetup,
      languageCompartment.of([]),
      appearanceCompartment.of(editorAppearance(currentTheme, currentFontSize)),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        statesRef.current.set(activeTabRef.current, update.state);
        const external = update.transactions.some(transaction => transaction.annotation(externalDocUpdate));
        if (!external) onChangeRef.current?.(update.state.doc.toString());
      }),
    ],
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const state = createState(doc, theme, fontSize);
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    statesRef.current.set(tabId, state);
    return () => { viewRef.current = null; view.destroy(); };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (activeTabRef.current !== tabId) {
      statesRef.current.set(activeTabRef.current, view.state);
      activeTabRef.current = tabId;
      view.setState(statesRef.current.get(tabId) ?? createState(doc, theme, fontSize));
    }
    view.dispatch({
      effects: [
        syntaxCompartment.reconfigure(Prec.highest(createSyntaxHighlighting(theme))),
        appearanceCompartment.reconfigure(editorAppearance(theme, fontSize)),
      ],
    });
  }, [tabId, theme, fontSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    const description = languageForPath(path);
    if (!path) {
      view.dispatch({ effects: languageCompartment.reconfigure(javascript()) });
    } else if (!description) {
      view.dispatch({ effects: languageCompartment.reconfigure([]) });
    } else {
      void description.load().then(support => {
        if (!cancelled && activeTabRef.current === tabId) {
          view.dispatch({ effects: languageCompartment.reconfigure(support) });
        }
      }).catch(error => console.error(`Could not load ${description.name} highlighting:`, error));
    }
    return () => { cancelled = true; };
  }, [tabId, path]);

  useEffect(() => {
    const open = new Set(openTabIds);
    for (const id of statesRef.current.keys()) if (!open.has(id)) statesRef.current.delete(id);
  }, [openTabIds]);

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
