import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import Editor, { type EditorHandle } from '../../src/components/Editor.tsx';
import type { CursorInfo } from '../../src/lib/editor-extensions.ts';
import { defaultEditorPreferences, type EditorPreferences } from '../../src/lib/preferences.ts';
import { getTheme } from '../../src/lib/themes.ts';
import { createVimExtension } from '../../src/lib/vim/extension.ts';
import { createVimSession } from '../../src/lib/vim/session.ts';
import { defaultVimConfig, type VimConfig } from '../../src/lib/vim/config.ts';

interface FixtureTab {
  id: string;
  content: string;
}

interface FixturePane {
  id: string;
  tabId: string;
}

interface FixtureSnapshot {
  tabs: FixtureTab[];
  panes: FixturePane[];
  activePaneId: string | null;
  preferences: EditorPreferences;
  cursors: Record<string, CursorInfo>;
}

const params = new URLSearchParams(window.location.search);
const vimProbe = createVimExtension();
const initialVimConfig: VimConfig = params.get('map') === 'jj'
  ? { mappings: [{ lhs: 'jj', rhs: '<Esc>', modes: ['insert'] }] }
  : defaultVimConfig;

const workspaceMode = params.get('mode') ?? 'split';
const firstContent = params.get('a') ?? '';
const secondContent = params.get('b') ?? '';

const initialTabs: FixtureTab[] = workspaceMode === 'split'
  ? [{ id: 'A', content: firstContent }, { id: 'B', content: secondContent }]
  : [{ id: 'S', content: firstContent }, { id: 'T', content: secondContent }];

const initialPanes: FixturePane[] = workspaceMode === 'shared'
  ? [{ id: 'A', tabId: 'S' }, { id: 'B', tabId: 'S' }]
  : workspaceMode === 'single'
    ? [{ id: 'A', tabId: 'S' }]
    : [{ id: 'A', tabId: 'A' }, { id: 'B', tabId: 'B' }];

function Harness() {
  const [tabs, setTabs] = useState<FixtureTab[]>(initialTabs);
  const [panes, setPanes] = useState<FixturePane[]>(initialPanes);
  const [activePaneId, setActivePaneId] = useState<string | null>(initialPanes[0]?.id ?? null);
  const [cursors, setCursors] = useState<Record<string, CursorInfo>>({});
  const [preferences, setPreferences] = useState<EditorPreferences>({
    ...defaultEditorPreferences,
    vimModeEnabled: params.get('vim') === '1',
  });
  const [vimSession] = useState(() => createVimSession());

  const paneRefs = useRef(new Map<string, EditorHandle>());
  const snapshotRef = useRef<FixtureSnapshot>({ tabs, panes, activePaneId, preferences, cursors });
  snapshotRef.current = { tabs, panes, activePaneId, preferences, cursors };

  const theme = getTheme('crumb');

  const handleChange = useCallback((tabId: string, value: string) => {
    setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, content: value } : tab));
  }, []);

  useEffect(() => {
    vimSession.reconcileDocuments(tabs.map(tab => tab.id));
  }, [vimSession, tabs]);

  useEffect(() => {
    vimSession.requestOwner(activePaneId);
  }, [vimSession, activePaneId]);

  useEffect(() => {
    if (activePaneId && panes.some(pane => pane.id === activePaneId)) return;
    if (panes.length > 0) setActivePaneId(panes[0].id);
    else if (activePaneId !== null) setActivePaneId(null);
  }, [activePaneId, panes]);

  useEffect(() => {
    const viewFor = (paneId: string) => {
      const dom = document.querySelector<HTMLElement>(`[data-testid="pane-${paneId}"] .cm-editor`);
      return dom ? EditorView.findFromDOM(dom) : null;
    };

    (window as unknown as Record<string, unknown>).__crumbEditor = {
      getState: (paneId: string) => {
        const current = snapshotRef.current;
        const pane = current.panes.find(item => item.id === paneId);
        const tab = current.tabs.find(item => item.id === pane?.tabId);
        const view = viewFor(paneId);
        return {
          paneId,
          tabId: pane?.tabId ?? null,
          doc: tab?.content ?? '',
          tabs: Object.fromEntries(current.tabs.map(item => [item.id, item.content])),
          panes: current.panes.map(item => ({ id: item.id, tabId: item.tabId })),
          openTabIds: current.tabs.map(item => item.id),
          activePaneId: current.activePaneId,
          cursor: current.cursors[paneId] ?? { line: 1, column: 1, selected: 0 },
          enabled: current.preferences.vimModeEnabled,
          mode: view ? vimProbe.getState(view).mode : 'missing',
          undoDepth: view ? undoDepth(view.state) : -1,
        };
      },
      focus: (paneId: string) => {
        setActivePaneId(paneId);
        paneRefs.current.get(paneId)?.focus();
      },
      setVimEnabled: (enabled: boolean) => {
        setPreferences(current => ({ ...current, vimModeEnabled: enabled }));
      },
      switchPaneTab: (paneId: string, tabId: string) => {
        setPanes(current => current.map(pane => pane.id === paneId ? { ...pane, tabId } : pane));
      },
      unmountPane: (paneId: string) => {
        setPanes(current => current.filter(pane => pane.id !== paneId));
        setActivePaneId(current => current === paneId ? null : current);
      },
      setWorkspace: (nextTabs: FixtureTab[], nextPanes: FixturePane[]) => {
        setTabs(nextTabs);
        setPanes(nextPanes);
        setActivePaneId(current => nextPanes.some(pane => pane.id === current)
          ? current
          : nextPanes[0]?.id ?? null);
      },
    };
  }, []);

  return <div className="workspace">
    {panes.map(pane => {
      const tab = tabs.find(item => item.id === pane.tabId);
      if (!tab) return null;
      return <div key={pane.id} data-testid={`pane-${pane.id}`}>
        <Editor
          ref={handle => {
            if (handle) paneRefs.current.set(pane.id, handle);
            else paneRefs.current.delete(pane.id);
          }}
          paneId={pane.id}
          vimSession={vimSession}
          tabId={tab.id}
          path={null}
          openTabIds={tabs.map(item => item.id)}
          doc={tab.content}
          theme={theme}
          fontSize={14}
          fontFamily={theme.codeFont}
          wordWrap={false}
          preferences={preferences}
          vimConfig={initialVimConfig}
          onCursorChange={cursor => {
            setCursors(current => ({ ...current, [pane.id]: cursor }));
          }}
          onChange={value => handleChange(pane.tabId, value)}
          onFocus={() => setActivePaneId(pane.id)}
        />
      </div>;
    })}
  </div>;
}

const root = createRoot(document.getElementById('root')!);
root.render(params.get('strict') === '1'
  ? <StrictMode><Harness /></StrictMode>
  : <Harness />);
