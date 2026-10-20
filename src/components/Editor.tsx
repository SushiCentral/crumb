import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { Annotation, Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { createSyntaxHighlighting } from '../lib/highlight';
import { languageForPath } from '../lib/languages';
import type { Theme } from '../lib/themes';
import type { EditorPreferences } from '../lib/preferences';
import { editorCoreExtensions, editorPreferenceExtensions, cursorInfo, type CursorInfo } from '../lib/editor-extensions';
import { attachScrollSync } from '../lib/scroll-sync';

interface EditorProps {
  tabId: string;
  path: string | null;
  openTabIds: string[];
  doc: string;
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  wordWrap: boolean;
  preferences: EditorPreferences;
  onCursorChange?: (cursor: CursorInfo) => void;
  onChange?: (value: string) => void;
  onFocus?: () => void;
}

export interface EditorHandle {
  focus: () => void;
  jumpToLine: (line: number) => void;
}

const externalDocUpdate = Annotation.define<boolean>();
const syntaxCompartment = new Compartment();
const languageCompartment = new Compartment();
const appearanceCompartment = new Compartment();
const preferencesCompartment = new Compartment();

function editorAppearance(theme: Theme, fontSize: number, fontFamily: string) {
  return EditorView.theme({
    '&': {
      backgroundColor: 'var(--editor)',
      color: 'var(--text)',
      fontFamily: `'${fontFamily}', monospace`,
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
    '.cm-matchingBracket': { backgroundColor: 'var(--selection)', outline: 'none' },
    '.cm-scroller::-webkit-scrollbar': { width: '7px', height: '7px' },
    '.cm-scroller::-webkit-scrollbar-thumb': { background: 'var(--surface)', borderRadius: '4px' },
  }, { dark: theme.dark });
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ tabId, path, openTabIds, doc, theme, fontSize, fontFamily, wordWrap, preferences, onChange, onCursorChange, onFocus }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const statesRef = useRef(new Map<string, EditorState>());
  const activeTabRef = useRef(tabId);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    jumpToLine: (line: number) => {
      const view = viewRef.current;
      if (!view) return;
      const totalLines = view.state.doc.lines;
      const target = Math.min(Math.max(1, line), totalLines);
      const lineObj = view.state.doc.line(target);
      view.dispatch({
        selection: { anchor: lineObj.from },
        scrollIntoView: true,
      });
      view.focus();
    },
  }), []);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const createState = (content: string, currentTheme: Theme, currentFontSize: number) => EditorState.create({
    doc: content,
    extensions: [
      syntaxCompartment.of(Prec.highest(createSyntaxHighlighting(currentTheme))),
      editorCoreExtensions,
      preferencesCompartment.of([editorPreferenceExtensions(preferences), wordWrap ? EditorView.lineWrapping : []]),
      languageCompartment.of([]),
      appearanceCompartment.of(editorAppearance(currentTheme, currentFontSize, fontFamily)),
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet) onCursorChangeRef.current?.(cursorInfo(update.state));
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
    onCursorChangeRef.current?.(cursorInfo(state));

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  // Peer panes exchange ratios through the scroll-sync bus. Declared after the
  // mount effect so viewRef is populated; re-attaches when the tab changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    return attachScrollSync(view.scrollDOM, tabId);
  }, [tabId]);

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
        appearanceCompartment.reconfigure(editorAppearance(theme, fontSize, fontFamily)),
        preferencesCompartment.reconfigure([editorPreferenceExtensions(preferences), wordWrap ? EditorView.lineWrapping : []]),
      ],
    });
    onCursorChangeRef.current?.(cursorInfo(view.state));
  }, [tabId, theme, fontSize, fontFamily, wordWrap, preferences]);

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
      annotations: [externalDocUpdate.of(true), Transaction.addToHistory.of(false)],
      changes: { from: 0, to: view.state.doc.length, insert: doc },
    });
  }, [doc]);

  return <div ref={containerRef} onFocusCapture={onFocus} style={{ height: '100%', width: '100%' }} />;
});

export default Editor;
