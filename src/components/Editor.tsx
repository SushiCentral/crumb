import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { Annotation, Compartment, EditorState, Prec, Transaction, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { createSyntaxHighlighting } from '../lib/highlight';
import { languageForPath } from '../lib/languages';
import type { Theme } from '../lib/themes';
import type { EditorPreferences } from '../lib/preferences';
import { editorCoreExtensions, editorPreferenceExtensions, cursorInfo, type CursorInfo } from '../lib/editor-extensions';
import { attachScrollSync } from '../lib/scroll-sync';
import { createVimExtension, type VimExtension, type VimPublicState } from '../lib/vim/extension';
import { defaultVimConfig, type VimConfig } from '../lib/vim/config';
import { shouldVimOwnTab } from '../lib/vim/shortcuts';
import type { VimSession, VimSessionBinding } from '../lib/vim/session';

interface EditorProps {
  paneId: string;
  vimSession: VimSession;
  tabId: string;
  path: string | null;
  openTabIds: string[];
  doc: string;
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  wordWrap: boolean;
  preferences: EditorPreferences;
  /** Optional source-level Vim configuration; defaults to the approved empty config. */
  vimConfig?: VimConfig;
  onCursorChange?: (cursor: CursorInfo) => void;
  onChange?: (value: string) => void;
  /** Route an argumentless Vim `:w` to Crumb's existing save flow. */
  onSaveRequest?: (tabId: string) => void;
  onFocus?: () => void;
  /** Typed Vim mode/pending snapshot for the active application status bar. */
  onVimStateChange?: (paneId: string, state: VimPublicState) => void;
}

export interface EditorHandle {
  focus: () => void;
  jumpToLine: (line: number) => void;
  /** Current mode snapshot used by App's capture-phase shortcut policy. */
  getVimState: () => VimPublicState | null;
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
      lineHeight: '1.5',
    },
    '.cm-content': { padding: '10px 0' },
    '.cm-line': { padding: '0 16px' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor)', borderRight: '1px solid var(--border)',
      color: 'var(--gutter)', paddingRight: '8px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text)' },
    // CodeMirror draws the selection in a negative-z layer below the text, so
    // a plain background on the active line would paint over it. Keep the line
    // itself transparent and put its highlight in a pseudo-element below the
    // selection layer (including its additional drop-cursor layer) but still
    // above the editor background. Text remains above both.
    '.cm-activeLine': { backgroundColor: 'transparent', position: 'relative' },
    '.cm-activeLine::before': {
      content: '""',
      position: 'absolute',
      inset: '0',
      zIndex: '-999',
      backgroundColor: 'var(--active-line)',
      pointerEvents: 'none',
    },
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

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ paneId, vimSession, tabId, path, openTabIds, doc, theme, fontSize, fontFamily, wordWrap, preferences, vimConfig = defaultVimConfig, onChange, onCursorChange, onSaveRequest, onFocus, onVimStateChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const statesRef = useRef(new Map<string, EditorState>());
  const activeTabRef = useRef(tabId);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onVimStateChangeRef = useRef(onVimStateChange);
  const onSaveRequestRef = useRef(onSaveRequest);
  onCursorChangeRef.current = onCursorChange;
  onVimStateChangeRef.current = onVimStateChange;
  onSaveRequestRef.current = onSaveRequest;

  // Selection-only cursor reporting is coalesced to at most one callback per
  // animation frame. Repeated keydown navigation would otherwise re-render App
  // for every intermediate cursor position. Only the latest cursor is retained;
  // the frame callback flushes it once the current navigation burst settles.
  // Doc edits and lifecycle reports stay synchronous so consumers never read a
  // cursor from before a committed change.
  const cursorFrameRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<CursorInfo | null>(null);

  const cancelCursorChange = () => {
    if (cursorFrameRef.current !== null) {
      cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null;
    }
    pendingCursorRef.current = null;
  };

  const reportCursorNow = (state: EditorState) => {
    // A synchronous report supersedes any deferred selection-only report, so a
    // later frame cannot overwrite it with a stale cursor.
    cancelCursorChange();
    onCursorChangeRef.current?.(cursorInfo(state));
  };

  const scheduleCursorChange = (state: EditorState) => {
    pendingCursorRef.current = cursorInfo(state);
    if (cursorFrameRef.current !== null) return;
    cursorFrameRef.current = requestAnimationFrame(() => {
      cursorFrameRef.current = null;
      const cursor = pendingCursorRef.current;
      pendingCursorRef.current = null;
      if (cursor) onCursorChangeRef.current?.(cursor);
    });
  };

  // One extension instance per Editor. Engine mappings and registers remain
  // global; the mapping installer is reference-counted across distinct
  // instances, which is what makes split panes safe. `:w` captures the
  // originating tab synchronously; App resolves and reports any later async
  // save/untitled/error transition against that same tab ID.
  const vimRef = useRef<VimExtension | null>(null);
  if (vimRef.current === null) {
    vimRef.current = createVimExtension(vimConfig, {
      onWrite: () => onSaveRequestRef.current?.(activeTabRef.current),
    });
  }
  const vim = vimRef.current;

  // Vim owns bare Tab in Normal/Visual modes; Insert/Replace must still reach
  // the ordinary indentWithTab binding. This runs before editorCoreExtensions,
  // so returning true consumes the key without dispatching a CodeMirror edit.
  const vimTabGuardRef = useRef<Extension | null>(null);
  if (vimTabGuardRef.current === null) {
    const consumeTab = (view: EditorView) => shouldVimOwnTab(vim.getState(view).mode);
    vimTabGuardRef.current = Prec.highest(keymap.of([
      { key: 'Tab', run: consumeTab },
      { key: 'Shift-Tab', run: consumeTab },
    ]));
  }
  const vimTabGuard = vimTabGuardRef.current;

  // A dedicated token per Editor instance. Cached tab states carry their own
  // compartment value, so toggling Vim never replaces an EditorState.
  const vimCompartmentRef = useRef<Compartment | null>(null);
  if (vimCompartmentRef.current === null) vimCompartmentRef.current = new Compartment();
  const vimCompartment = vimCompartmentRef.current;
  const vimEnabledRef = useRef(preferences.vimModeEnabled);
  const vimBindingRef = useRef<VimSessionBinding | null>(null);
  const vimStateSubscriptionRef = useRef<(() => void) | null>(null);

  const reportVimState = () => {
    const view = viewRef.current;
    if (view) onVimStateChangeRef.current?.(paneId, vim.getState(view));
  };

  const subscribeVimState = () => {
    vimStateSubscriptionRef.current?.();
    vimStateSubscriptionRef.current = null;
    const view = viewRef.current;
    if (!view) return;
    vimStateSubscriptionRef.current = vim.observeState(view, state => {
      // Mark characterwise Visual mode so its active fat-cursor cell can be
      // styled as part of the selected text, without affecting other modes.
      view.dom.classList.toggle('vim-visual-mode', state.mode === 'visual');
      onVimStateChangeRef.current?.(paneId, state);
    });
  };

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
    getVimState: () => {
      const view = viewRef.current;
      return view ? vim.getState(view) : null;
    },
  }), [vim]);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const createState = (content: string, currentTheme: Theme, currentFontSize: number) => EditorState.create({
    doc: content,
    extensions: [
      // The package requires Vim to precede other keymaps so its keydown
      // handler owns Escape before autocomplete/search keymaps see it.
      vimCompartment.of(preferences.vimModeEnabled ? vim.extension : []),
      vimTabGuard,
      syntaxCompartment.of(Prec.highest(createSyntaxHighlighting(currentTheme))),
      editorCoreExtensions,
      preferencesCompartment.of([editorPreferenceExtensions(preferences), wordWrap ? EditorView.lineWrapping : []]),
      languageCompartment.of([]),
      appearanceCompartment.of(editorAppearance(currentTheme, currentFontSize, fontFamily)),
      EditorView.updateListener.of(update => {
        if (update.docChanged) reportCursorNow(update.state);
        else if (update.selectionSet) scheduleCursorChange(update.state);
        if (!update.docChanged) return;
        statesRef.current.set(activeTabRef.current, update.state);
        const external = update.transactions.some(transaction => transaction.annotation(externalDocUpdate));
        if (!external) onChangeRef.current?.(update.state.doc.toString());
      }),
    ],
  });

  // Mappings are an engine-global resource, not view state. The installer is
  // reference-counted, so split panes and StrictMode double-mounts neither
  // duplicate nor prematurely remove them.
  useEffect(() => {
    vim.installMappings();
    return () => vim.removeMappings();
  }, [vim]);

  useEffect(() => {
    if (!containerRef.current) return;
    const state = createState(doc, theme, fontSize);
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    statesRef.current.set(tabId, state);
    vimBindingRef.current = vimSession.attachPane(paneId, view, tabId, preferences.vimModeEnabled);
    subscribeVimState();
    reportCursorNow(state);

    return () => {
      // Finalize/restore session state while the adapter is still alive; the
      // session, not an individual pane, decides when a document has closed.
      cancelCursorChange();
      vimStateSubscriptionRef.current?.();
      vimStateSubscriptionRef.current = null;
      vimBindingRef.current?.detach();
      vimBindingRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  // Vim enablement is its own lifecycle. Reconfiguring this compartment keeps
  // the EditorState, selection, and CodeMirror history intact. Cached tabs get
  // the same value so a later EditorView.setState() cannot revive stale Vim
  // ownership or accidentally keep it after the preference is turned off.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || vimEnabledRef.current === preferences.vimModeEnabled) return;

    const enabled = preferences.vimModeEnabled;
    const activeTab = activeTabRef.current;
    const binding = vimBindingRef.current;
    if (!enabled) binding?.beforeTransition();

    const extension = enabled ? vim.extension : [];
    view.dispatch({ effects: vimCompartment.reconfigure(extension) });
    for (const [id, state] of statesRef.current) {
      if (id === activeTab) {
        statesRef.current.set(id, view.state);
      } else {
        statesRef.current.set(id, state.update({
          effects: vimCompartment.reconfigure(extension),
        }).state);
      }
    }
    vimEnabledRef.current = enabled;

    binding?.setEnabled(enabled);
    if (enabled) binding?.afterTransition(activeTab);
    subscribeVimState();
    reportCursorNow(view.state);
  }, [preferences.vimModeEnabled, vimCompartment, vim]);

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
      const previousTabId = activeTabRef.current;
      // The outgoing adapter must capture repeat/marks and cancel pending input
      // while it still exists; setState() destroys every view plugin.
      const binding = vimBindingRef.current;
      binding?.beforeTransition();
      statesRef.current.set(previousTabId, view.state);

      let target = statesRef.current.get(tabId) ?? createState(doc, theme, fontSize);
      // A cached tab can be stale relative to App's current tab content. Apply
      // that content before installing the state so Vim restores marks against
      // the real document, and so a same-string prop on another tab cannot
      // leave stale content in the view.
      if (target.doc.toString() !== doc) {
        target = target.update({
          annotations: [externalDocUpdate.of(true), Transaction.addToHistory.of(false)],
          changes: { from: 0, to: target.doc.length, insert: doc },
        }).state;
      }
      // A state cached while Vim was in the other setting must match the
      // current preference before it is installed, not after the swap.
      target = target.update({
        effects: vimCompartment.reconfigure(preferences.vimModeEnabled ? vim.extension : []),
      }).state;

      activeTabRef.current = tabId;
      view.setState(target);
      statesRef.current.set(tabId, view.state);
      binding?.afterTransition(tabId);
      subscribeVimState();
    }
    view.dispatch({
      effects: [
        syntaxCompartment.reconfigure(Prec.highest(createSyntaxHighlighting(theme))),
        appearanceCompartment.reconfigure(editorAppearance(theme, fontSize, fontFamily)),
        preferencesCompartment.reconfigure([editorPreferenceExtensions(preferences), wordWrap ? EditorView.lineWrapping : []]),
      ],
    });
    reportCursorNow(view.state);
  }, [tabId, theme, fontSize, fontFamily, wordWrap, preferences, vimCompartment, vim]);

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
    for (const id of Array.from(statesRef.current.keys())) {
      if (open.has(id)) continue;
      statesRef.current.delete(id);
    }
  }, [openTabIds]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === doc) return;
    view.dispatch({
      annotations: [externalDocUpdate.of(true), Transaction.addToHistory.of(false)],
      changes: { from: 0, to: view.state.doc.length, insert: doc },
    });
  }, [doc, tabId]);

  return <div
    ref={containerRef}
    onFocusCapture={event => {
      // Moving focus between the editor, Vim prompt, and panels inside this
      // pane is not an ownership transfer. Requesting focus again here would
      // steal focus from an open Vim prompt.
      const internal = event.relatedTarget instanceof Node
        && containerRef.current?.contains(event.relatedTarget);
      if (!internal) {
        vimSession.requestOwner(paneId, { focus: true });
        reportVimState();
      }
      onFocus?.();
    }}
    onBlurCapture={event => {
      const internal = event.relatedTarget instanceof Node
        && containerRef.current?.contains(event.relatedTarget);
      if (!internal) {
        vimSession.cancelFocusIntent(event.relatedTarget instanceof Node ? event.relatedTarget : null);
      }
    }}
    style={{ height: '100%', width: '100%' }}
  />;
});

export default Editor;
