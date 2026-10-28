import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { Annotation, Compartment, EditorState, Prec, Transaction, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { createSyntaxHighlighting } from '../lib/highlight';
import { languageForPath } from '../lib/languages';
import type { Theme } from '../lib/themes';
import type { EditorPreferences } from '../lib/preferences';
import {
  editorCoreExtensions,
  editorPreferenceExtensions,
  cursorInfo,
  cursorScrollMarginForFontSize,
  EDITOR_LINE_HEIGHT,
  type CursorInfo,
} from '../lib/editor-extensions';
import { createCursorReporter, type CursorReporter } from '../lib/cursor-report';
import { attachScrollSync } from '../lib/scroll-sync';
import { createVimExtension, type VimExtension, type VimPublicState } from '../lib/vim/extension';
import { defaultVimConfig, type VimConfig } from '../lib/vim/config';
import { isVimLeaderMode, type VimLeaderAction } from '../lib/vim/leader';
import { shouldVimOwnTab } from '../lib/vim/shortcuts';
import type { VimSession, VimSessionBinding } from '../lib/vim/session';
import VimLeaderGuide from './VimLeaderGuide';

export interface VimEditorTarget {
  readonly paneId: string;
  readonly tabId: string;
}

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
  /** Route Space leader sequences into Crumb's existing application actions. */
  onVimLeaderAction?: (action: VimLeaderAction, target: VimEditorTarget) => void;
  /** Route Vim `:q`/`:q!` for the pane and tab that invoked it. */
  onExQuitRequest?: (target: VimEditorTarget, force: boolean) => void;
  /** Route Vim `:wq` for the pane and tab that invoked it. */
  onExWriteQuitRequest?: (target: VimEditorTarget) => void;
  onFocus?: () => void;
  /** Typed Vim mode/pending snapshot for the active application status bar. */
  onVimStateChange?: (paneId: string, state: VimPublicState) => void;
}

export interface EditorHandle {
  focus: () => void;
  jumpToLine: (line: number) => void;
  /** Current mode snapshot used by App's capture-phase shortcut policy. */
  getVimState: () => VimPublicState | null;
  /** Word at the primary cursor head, or null when the cursor is not on one. */
  getCursorWord: () => string | null;
  /** Clear the engine's committed search overlay without discarding the pattern. */
  clearSearchHighlight: () => void;
}

const externalDocUpdate = Annotation.define<boolean>();
const syntaxCompartment = new Compartment();
const languageCompartment = new Compartment();
const appearanceCompartment = new Compartment();
const preferencesCompartment = new Compartment();

function editorAppearance(theme: Theme, fontSize: number, fontFamily: string) {
  const themeExtension = EditorView.theme({
    '&': {
      backgroundColor: 'var(--editor)',
      color: 'var(--text)',
      fontFamily: `'${fontFamily}', monospace`,
      fontSize: `${fontSize}px`,
      lineHeight: String(EDITOR_LINE_HEIGHT),
    },
    '.cm-content': { padding: '10px 0' },
    '.cm-line': { padding: '0 16px' },
    '.cm-line.cm-indent-guide-line': {
      '--cm-indent-guide-color': 'color-mix(in srgb, var(--text) 18%, var(--editor))',
      backgroundImage: 'repeating-linear-gradient(to right, var(--cm-indent-guide-color) 0 1px, transparent 1px var(--cm-indent-step))',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'calc(var(--cm-indent-count) * var(--cm-indent-step)) 100%',
      backgroundOrigin: 'content-box',
    },
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
  // The scroll margin is static, so it is reconfigured with the appearance
  // whenever the font size changes.
  return [themeExtension, cursorScrollMarginForFontSize(fontSize)];
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ paneId, vimSession, tabId, path, openTabIds, doc, theme, fontSize, fontFamily, wordWrap, preferences, vimConfig = defaultVimConfig, onChange, onCursorChange, onSaveRequest, onVimLeaderAction, onExQuitRequest, onExWriteQuitRequest, onFocus, onVimStateChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const statesRef = useRef(new Map<string, EditorState>());
  const activeTabRef = useRef(tabId);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onVimStateChangeRef = useRef(onVimStateChange);
  const onSaveRequestRef = useRef(onSaveRequest);
  const onVimLeaderActionRef = useRef(onVimLeaderAction);
  const onExQuitRequestRef = useRef(onExQuitRequest);
  const onExWriteQuitRequestRef = useRef(onExWriteQuitRequest);
  onCursorChangeRef.current = onCursorChange;
  onVimStateChangeRef.current = onVimStateChange;
  onSaveRequestRef.current = onSaveRequest;
  onVimLeaderActionRef.current = onVimLeaderAction;
  onExQuitRequestRef.current = onExQuitRequest;
  onExWriteQuitRequestRef.current = onExWriteQuitRequest;

  // The guide is pane-local React state. The Vim extension only forwards the
  // visible prefix through this ref, so the overlay is a sibling of the
  // CodeMirror mount element instead of a child that CodeMirror could replace.
  const [leaderGuidePrefix, setLeaderGuidePrefix] = useState<readonly string[] | null>(null);
  const leaderGuideChangeRef = useRef<(prefix: readonly string[] | null) => void>(setLeaderGuidePrefix);

  // Selection-only cursor reporting waits until movement stops (see
  // `cursor-report.ts`). Publishing once per animation frame re-rendered the
  // whole App during a held navigation key, which starved the input queue and
  // kept the cursor moving after release. Doc edits, mounts and tab switches
  // report synchronously so consumers never read a cursor from before a change.
  const reporterRef = useRef<CursorReporter | null>(null);
  if (reporterRef.current === null) {
    reporterRef.current = createCursorReporter(cursor => onCursorChangeRef.current?.(cursor));
  }
  const reporter = reporterRef.current;
  const reportCursorNow = (state: EditorState) => reporter.reportNow(cursorInfo(state));

  // One extension instance per Editor. Engine mappings and registers remain
  // global; the mapping installer is reference-counted across distinct
  // instances, which is what makes split panes safe. `:w` captures the
  // originating tab synchronously; App resolves and reports any later async
  // save/untitled/error transition against that same tab ID.
  const vimRef = useRef<VimExtension | null>(null);
  if (vimRef.current === null) {
    vimRef.current = createVimExtension(vimConfig, {
      onWrite: () => onSaveRequestRef.current?.(activeTabRef.current),
      // The host callbacks capture the originating pane and tab synchronously;
      // App must never resolve a later close against the then-active tab.
      onQuit: force => onExQuitRequestRef.current?.(
        { paneId, tabId: activeTabRef.current },
        force,
      ),
      onWriteQuit: () => onExWriteQuitRequestRef.current?.({
        paneId,
        tabId: activeTabRef.current,
      }),
      // Editor fixtures that do not wire application actions keep Space as
      // the engine's normal right-motion.
      leader: onVimLeaderActionRef.current
        ? {
          dispatch: action => onVimLeaderActionRef.current?.(
            action,
            { paneId, tabId: activeTabRef.current },
          ),
          onGuideChange: prefix => leaderGuideChangeRef.current(prefix),
        }
        : undefined,
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

  // The engine signals on every keypress and command completion. Only forward
  // snapshots that actually changed, so plain navigation never schedules React
  // work (the status bar would otherwise re-render the App per key).
  const lastVimStateRef = useRef<VimPublicState | null>(null);
  const publishVimState = (state: VimPublicState) => {
    const previous = lastVimStateRef.current;
    if (previous?.mode === state.mode && previous?.pending === state.pending) return;
    lastVimStateRef.current = state;
    onVimStateChangeRef.current?.(paneId, state);
  };

  const reportVimState = () => {
    const view = viewRef.current;
    if (view) publishVimState(vim.getState(view));
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
      // A mode that cannot own the leader must not leave a stale overlay.
      if (!isVimLeaderMode(state.mode)) setLeaderGuidePrefix(null);
      publishVimState(state);
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
    getCursorWord: () => {
      const view = viewRef.current;
      if (!view) return null;
      const word = view.state.wordAt(view.state.selection.main.head);
      if (!word) return null;
      const text = view.state.sliceDoc(word.from, word.to);
      return text.length > 0 ? text : null;
    },
    clearSearchHighlight: () => {
      const view = viewRef.current;
      if (view) vim.clearSearchHighlight(view);
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
        else if (update.selectionSet) reporter.reportLater(cursorInfo(update.state));
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
      reporter.cancel();
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
    style={{ position: 'relative', height: '100%', width: '100%' }}
  >
    <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    <VimLeaderGuide prefix={leaderGuidePrefix} />
  </div>;
});

export default Editor;
