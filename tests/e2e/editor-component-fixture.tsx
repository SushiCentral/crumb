import '../../src/index.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import Editor from '../../src/components/Editor.tsx';
import type { CursorInfo } from '../../src/lib/editor-extensions.ts';
import { defaultEditorPreferences, type EditorPreferences } from '../../src/lib/preferences.ts';
import { getTheme, themeVariables } from '../../src/lib/themes.ts';
import { createVimExtension, type VimPublicState } from '../../src/lib/vim/extension.ts';
import { createVimSession } from '../../src/lib/vim/session.ts';

interface FixtureTab {
  id: string;
  content: string;
}

interface FixtureState {
  activeTabId: string;
  tabs: FixtureTab[];
  cursor: CursorInfo;
  preferences: EditorPreferences;
  themeId: string;
  vimState: VimPublicState | null;
}

const params = new URLSearchParams(window.location.search);
const vimProbe = createVimExtension();

const initialTabs: FixtureTab[] = [
  { id: 'A', content: params.get('a') ?? '' },
  { id: 'B', content: params.get('b') ?? '' },
];

function Harness() {
  const [tabs, setTabs] = useState<FixtureTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState('A');
  const [themeId, setThemeId] = useState(params.get('theme') ?? 'crumb');
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, column: 1, selected: 0 });
  const [vimState, setVimState] = useState<VimPublicState | null>(null);
  const [preferences, setPreferences] = useState<EditorPreferences>({
    ...defaultEditorPreferences,
    vimModeEnabled: params.get('vim') === '1',
  });
  const [vimSession] = useState(() => createVimSession());

  const stateRef = useRef<FixtureState>({ activeTabId, tabs, cursor, preferences, themeId, vimState });
  stateRef.current = { activeTabId, tabs, cursor, preferences, themeId, vimState };

  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
  const theme = getTheme(themeId);

  const handleChange = useCallback((value: string) => {
    setTabs(current => current.map(tab => tab.id === activeTabId ? { ...tab, content: value } : tab));
  }, [activeTabId]);

  const handleVimStateChange = useCallback((_paneId: string, next: VimPublicState) => {
    setVimState(next);
  }, []);

  useEffect(() => {
    vimSession.reconcileDocuments(tabs.map(tab => tab.id));
  }, [vimSession, tabs]);

  useEffect(() => {
    const view = () => {
      const dom = document.querySelector<HTMLElement>('[data-testid="code-editor"] .cm-editor');
      return dom ? EditorView.findFromDOM(dom) : null;
    };

    (window as unknown as Record<string, unknown>).__crumbEditor = {
      getState: () => {
        const current = stateRef.current;
        return {
          activeTabId: current.activeTabId,
          enabled: current.preferences.vimModeEnabled,
          doc: current.tabs.find(tab => tab.id === current.activeTabId)?.content ?? '',
          tabs: Object.fromEntries(current.tabs.map(tab => [tab.id, tab.content])),
          cursor: current.cursor,
          themeId: current.themeId,
          vimState: current.vimState,
          undoDepth: (() => {
            const currentView = view();
            return currentView ? undoDepth(currentView.state) : -1;
          })(),
          mode: (() => {
            const currentView = view();
            return currentView ? vimProbe.getState(currentView).mode : 'missing';
          })(),
        };
      },
      setVimEnabled: (enabled: boolean) => {
        setPreferences(current => ({ ...current, vimModeEnabled: enabled }));
      },
      setPreference: (key: keyof EditorPreferences, value: EditorPreferences[keyof EditorPreferences]) => {
        setPreferences(current => ({ ...current, [key]: value }));
      },
      setTheme: (id: string) => setThemeId(id),
      switchTab: (id: string) => setActiveTabId(id),
    };
  }, []);

  return <>
    <input
      data-testid="external-input"
      aria-label="External input"
      placeholder="external control"
      style={{ position: 'absolute', top: 0, right: 0, zIndex: 2 }}
    />
    <div data-testid="code-editor" style={themeVariables(theme, theme.codeFont)}>
      <Editor
        paneId="A"
        vimSession={vimSession}
        tabId={active.id}
        path={null}
        openTabIds={tabs.map(tab => tab.id)}
        doc={active.content}
        theme={theme}
        fontSize={14}
        fontFamily={theme.codeFont}
        wordWrap={false}
        preferences={preferences}
        onCursorChange={setCursor}
        onVimStateChange={handleVimStateChange}
        onChange={handleChange}
      />
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
