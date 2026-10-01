import { Fragment, lazy, Suspense, useState, useEffect, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import Editor, { type EditorHandle } from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import FileExplorer from "./components/FileExplorer";
import SearchPanel from "./components/SearchPanel";
import SettingsModal from "./components/SettingsModal";
import WelcomeScreen from "./components/WelcomeScreen";
import ToastContainer, { type ToastMessage } from "./components/Toast";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette";
import QuickOpen, { type QuickOpenHandle } from "./components/QuickOpen";
import { codeFonts, getTheme, themes, themeVariables } from "./lib/themes";
import { languageName } from "./lib/languages";
import { FolderIcon, SearchIcon, SettingsIcon, SplitPreviewIcon } from "./components/Icons";
import "./App.css";

const initialDoc = `// Welcome to Crumb\n\nfunction hello() {\n  console.log("Hello, world!");\n}\n`;
const MarkdownPreview = lazy(() => import('./components/MarkdownPreview'));
const isMarkdownPath = (path: string | null) => path != null && /\.(md|markdown)$/i.test(path);

interface EditorTab {
  id: string;
  path: string | null;
  content: string;
  savedContent: string | null;
}

interface EditorPane {
  id: string;
  tabId: string;
  tabIds: string[];
  kind: 'editor' | 'preview';
}

interface RecentItem {
  path: string;
  name: string;
  lastOpened: number;
}

interface PendingCloseItem {
  tabId: string;
  paneId: string;
}

interface PendingCloseOperation {
  targets: PendingCloseItem[];
  dirtyTabIds: string[];
  index: number;
}

const newUntitledTab = (): EditorTab => ({
  id: crypto.randomUUID(), path: null, content: initialDoc, savedContent: initialDoc,
});

const readPreference = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};

const readRecentFiles = (): RecentItem[] => {
  try {
    const raw = localStorage.getItem('crumb.recentFiles');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const getFileNameFromPath = (path: string | null) => {
  if (!path) return "Untitled";
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
};

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'search'>('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [panelHeight, setPanelHeight] = useState(() => Math.round(window.innerHeight * 0.4));
  const [explorerRootPath, setExplorerRootPath] = useState<string | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentItem[]>(readRecentFiles);

  // Tab-specific scroll synchronization (binds preview and editor showing the same tab)
  const [tabScrollRatios, setTabScrollRatios] = useState<Record<string, number>>({});

  const [themeId, setThemeId] = useState(() => getTheme(readPreference('crumb.theme', 'crumb')).id);
  const [codeFontOverride, setCodeFontOverride] = useState(() => {
    const saved = readPreference('crumb.codeFont', '');
    return codeFonts.find(font => font === saved) ?? null;
  });
  const [fontSize, setFontSize] = useState(() => {
    const value = Number(readPreference('crumb.fontSize', '13'));
    return Number.isFinite(value) ? Math.min(24, Math.max(10, value)) : 13;
  });
  const [wordWrap, setWordWrap] = useState(() => readPreference('crumb.wordWrap', 'true') !== 'false');

  // Empty workspace state: start with 0 tabs so Welcome Screen is displayed first
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [panes, setPanes] = useState<EditorPane[]>([]);
  const [activePaneId, setActivePaneId] = useState<string>('');
  const [paneWidths, setPaneWidths] = useState<Record<string, number>>({});

  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string; paneId: string } | null>(null);
  const [isCloseAllConfirmationOpen, setIsCloseAllConfirmationOpen] = useState(false);
  const [pendingCloseOperation, setPendingCloseOperation] = useState<PendingCloseOperation | null>(null);
  const currentPendingCloseId = pendingCloseOperation?.dirtyTabIds[pendingCloseOperation.index] ?? null;

  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [openTerminalRequest, setOpenTerminalRequest] = useState<{ path: string; sequence: number } | null>(null);
  const [terminalFolderError, setTerminalFolderError] = useState<string | null>(null);

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const panesRef = useRef(panes);
  const activePaneIdRef = useRef(activePaneId);
  const editorRefs = useRef(new Map<string, EditorHandle>());
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);

  const splitDragRef = useRef<{ leftId: string; rightId: string; startX: number; leftWidth: number; rightWidth: number } | null>(null);
  const quickOpenRef = useRef<QuickOpenHandle>(null);
  const sidebarDraggingRef = useRef(false);
  const panelDraggingRef = useRef(false);

  const currentDragWidthRef = useRef<number>(sidebarWidth);
  const currentDragHeightRef = useRef<number>(panelHeight);

  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  panesRef.current = panes;
  activePaneIdRef.current = activePaneId;

  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const canPreviewMarkdown = activeTab ? isMarkdownPath(activeTab.path) : false;
  const isPreviewOpen = canPreviewMarkdown && panes.some(pane => pane.kind === 'preview' && pane.tabId === activeTab?.id);

  useEffect(() => {
    if (activePaneId) {
      workspaceRef.current?.querySelector<HTMLElement>(`[data-pane-id="${activePaneId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activePaneId, panes.length]);

  const addToast = (message: string, type: ToastMessage['type'] = 'info') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
  };

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const addRecentFile = (filePath: string) => {
    const name = getFileNameFromPath(filePath);
    setRecentFiles(prev => {
      const updated = [{ path: filePath, name, lastOpened: Date.now() }, ...prev.filter(item => item.path !== filePath)].slice(0, 15);
      try { localStorage.setItem('crumb.recentFiles', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const clearRecentFiles = () => {
    setRecentFiles([]);
    try { localStorage.removeItem('crumb.recentFiles'); } catch {}
  };

  const updateTabScrollRatio = (tabId: string, ratio: number) => {
    setTabScrollRatios(prev => {
      if (Math.abs((prev[tabId] ?? -1) - ratio) < 0.005) return prev;
      return { ...prev, [tabId]: ratio };
    });
  };

  const updatePanes = (update: (current: EditorPane[]) => EditorPane[]) => {
    const next = update(panesRef.current);
    panesRef.current = next;
    setPanes(next);
  };

  const selectPane = (paneId: string) => {
    const pane = panesRef.current.find(item => item.id === paneId);
    if (!pane) return;
    if (activePaneIdRef.current === paneId && activeTabIdRef.current === pane.tabId) return;
    activePaneIdRef.current = paneId;
    setActivePaneId(paneId);
    activeTabIdRef.current = pane.tabId;
    setActiveTabId(pane.tabId);
  };

  const focusActiveEditor = () => {
    const active = panesRef.current.find(pane => pane.id === activePaneIdRef.current);
    const editor = active?.kind === 'editor' ? active : panesRef.current.find(pane => pane.kind === 'editor' && pane.tabId === active?.tabId) ?? panesRef.current.find(pane => pane.kind === 'editor');
    if (editor) editorRefs.current.get(editor.id)?.focus();
  };

  const openInSplit = (tabId: string, kind: EditorPane['kind'] = 'editor') => {
    if (tabsRef.current.length === 0) return;
    const pane: EditorPane = { id: crypto.randomUUID(), tabId, tabIds: kind === 'editor' ? [tabId] : [], kind };
    updatePanes(current => {
      const index = current.findIndex(item => item.id === activePaneIdRef.current);
      const next = [...current];
      next.splice(index < 0 ? current.length : index + 1, 0, pane);
      return next;
    });
    selectPane(pane.id);
  };

  const closePane = (paneId: string) => {
    const current = panesRef.current;
    const pane = current.find(item => item.id === paneId);
    if (!pane) return;
    if (pane.kind === 'editor') {
      requestCloseTabs(pane.tabIds, paneId);
      return;
    }
    const next = current.filter(item => item.id !== paneId);
    updatePanes(() => next);
    editorRefs.current.delete(paneId);
    setPaneWidths({});
    if (next.length > 0 && activePaneIdRef.current === paneId) {
      selectPane(next[Math.min(current.findIndex(item => item.id === paneId), next.length - 1)].id);
    }
  };

  const toggleMarkdownPreview = () => {
    if (!canPreviewMarkdown || !activeTab) return;
    const existing = panesRef.current.find(pane => pane.kind === 'preview' && pane.tabId === activeTab.id);
    if (existing) closePane(existing.id);
    else openInSplit(activeTab.id, 'preview');
  };

  const updateTabs = (update: (current: EditorTab[]) => EditorTab[]) => {
    const next = update(tabsRef.current);
    tabsRef.current = next;
    setTabs(next);
  };

  const activatePaneTab = (paneId: string, id: string) => {
    const pane = panesRef.current.find(item => item.id === paneId && item.kind === 'editor');
    if (!pane) return;
    updatePanes(current => current.map(item => item.id === paneId ? { ...item, tabId: id, tabIds: item.tabIds.includes(id) ? item.tabIds : [...item.tabIds, id] } : item));
    activePaneIdRef.current = paneId;
    setActivePaneId(paneId);
    activeTabIdRef.current = id;
    setActiveTabId(id);
  };

  const activateTab = (id: string) => {
    const activePane = panesRef.current.find(pane => pane.id === activePaneIdRef.current);
    const editorPane = activePane?.kind === 'editor' ? activePane : panesRef.current.find(pane => pane.kind === 'editor' && pane.tabId === activePane?.tabId) ?? panesRef.current.find(pane => pane.kind === 'editor');
    if (editorPane) activatePaneTab(editorPane.id, id);
  };

  const theme = getTheme(themeId);
  const codeFont = codeFontOverride ?? theme.codeFont;

  useEffect(() => {
    try { localStorage.setItem('crumb.theme', themeId); } catch { /* Storage may be unavailable. */ }
  }, [themeId]);
  useEffect(() => {
    try { localStorage.setItem('crumb.fontSize', String(fontSize)); } catch { /* Storage may be unavailable. */ }
  }, [fontSize]);
  useEffect(() => {
    try { localStorage.setItem('crumb.codeFont', codeFontOverride ?? ''); } catch { /* Storage may be unavailable. */ }
  }, [codeFontOverride]);
  useEffect(() => {
    try { localStorage.setItem('crumb.wordWrap', String(wordWrap)); } catch { /* Storage may be unavailable. */ }
  }, [wordWrap]);

  const handleOpenTerminalFolder = async () => {
    if (!activeTerminalSessionId) {
      addToast("Start or select a terminal first.", "warning");
      return;
    }
    try {
      const path = await invoke<string>("get_pty_cwd", { id: activeTerminalSessionId });
      setExplorerRootPath(path);
      setIsSidebarOpen(true);
      setSidebarTab('explorer');
      setTerminalFolderError(null);
    } catch (error) {
      addToast(String(error), "warning");
      setTerminalFolderError(String(error));
    }
  };

  const handleFolderOpened = (path: string) => {
    setExplorerRootPath(path);
    setOpenTerminalRequest(previous => ({ path, sequence: (previous?.sequence ?? 0) + 1 }));
    setIsPanelOpen(true);
    setTerminalFocusRequest(value => value + 1);
  };

  const handleChooseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string') {
        handleFolderOpened(selected);
        setIsSidebarOpen(true);
        setSidebarTab('explorer');
        addToast(`Opened workspace: ${getFileNameFromPath(selected)}`, 'info');
      }
    } catch (err) {
      addToast(`Could not open folder: ${String(err)}`, 'error');
    }
  };

  const handleOpenFile = async (path?: string, split = false, lineNumber?: number) => {
    try {
      let selectedPath = typeof path === "string" ? path : null;
      if (!selectedPath) {
        const selected = await open({
          multiple: false,
          directory: false,
        });

        if (typeof selected !== "string") {
          return;
        }
        selectedPath = selected;
      }

      const existing = tabsRef.current.find(tab => tab.path === selectedPath);
      let targetPaneId = activePaneIdRef.current;
      let targetTabId = '';

      if (existing) {
        targetTabId = existing.id;
        if (split) {
          openInSplit(existing.id);
        } else {
          activateTab(existing.id);
        }
      } else {
        const content = await readTextFile(selectedPath);
        const newTab: EditorTab = { id: crypto.randomUUID(), path: selectedPath, content, savedContent: content };
        targetTabId = newTab.id;

        if (tabsRef.current.length === 0 || panesRef.current.length === 0) {
          const newPane: EditorPane = { id: crypto.randomUUID(), tabId: newTab.id, tabIds: [newTab.id], kind: 'editor' };
          updateTabs(() => [newTab]);
          updatePanes(() => [newPane]);
          targetPaneId = newPane.id;
          activeTabIdRef.current = newTab.id;
          setActiveTabId(newTab.id);
          activePaneIdRef.current = newPane.id;
          setActivePaneId(newPane.id);
        } else {
          updateTabs(current => [...current, newTab]);
          if (split) {
            openInSplit(newTab.id);
          } else {
            activateTab(newTab.id);
          }
        }
      }

      addRecentFile(selectedPath);

      if (lineNumber != null) {
        setTimeout(() => {
          const pane = panesRef.current.find(p => p.id === targetPaneId && p.kind === 'editor') ?? panesRef.current.find(p => p.tabId === targetTabId && p.kind === 'editor');
          if (pane) {
            editorRefs.current.get(pane.id)?.jumpToLine(lineNumber);
          }
        }, 100);
      }
    } catch (error) {
      console.error("Failed to open file:", error);
      addToast(`Could not open file: ${String(error)}`, 'error');
    }
  };

  const handleEditorChange = (id: string, nextValue: string) => {
    updateTabs(current => current.map(tab => tab.id === id ? { ...tab, content: nextValue } : tab));
  };

  const handleSaveFile = async (id = activeTabIdRef.current): Promise<boolean> => {
    if (!id) return false;
    try {
      const tab = tabsRef.current.find(item => item.id === id);
      if (!tab) return false;
      let targetPath = tab.path;

      if (!targetPath) {
        const selected = await save({
          title: "Save File",
        });

        if (typeof selected !== "string") return false;
        targetPath = selected;
      }

      const alreadyOpen = tabsRef.current.find(item => item.id !== id && item.path === targetPath);
      if (alreadyOpen) {
        addToast('That file is already open in another tab.', 'warning');
        return false;
      }
      const contentToSave = tab.content;
      await writeTextFile(targetPath, contentToSave);
      updateTabs(current => current.map(item => item.id === id ? { ...item, path: targetPath, savedContent: contentToSave } : item));
      addRecentFile(targetPath);
      addToast(`Saved ${getFileNameFromPath(targetPath)}`, 'success');
      return true;
    } catch (error) {
      console.error("Failed to save file:", error);
      addToast(`Could not save file: ${String(error)}`, 'error');
      return false;
    }
  };

  const applyTabClosures = (targets: PendingCloseItem[]) => {
    const nextEditors = panesRef.current.map(pane => {
      if (pane.kind === 'preview') return pane;
      const tabIds = pane.tabIds.filter(tabId => !targets.some(target => target.paneId === pane.id && target.tabId === tabId));
      if (tabIds.length === 0) return null;
      const tabId = tabIds.includes(pane.tabId) ? pane.tabId : tabIds[Math.min(pane.tabIds.indexOf(pane.tabId), tabIds.length - 1)];
      return { ...pane, tabIds, tabId };
    }).filter((pane): pane is EditorPane => pane !== null);
    const visibleTabIds = new Set(nextEditors.filter(pane => pane.kind === 'editor').flatMap(pane => pane.tabIds));
    const nextPanes = nextEditors.filter(pane => pane.kind === 'editor' || visibleTabIds.has(pane.tabId));
    updateTabs(current => current.filter(tab => visibleTabIds.has(tab.id)));
    updatePanes(() => nextPanes);
    setPaneWidths({});
    for (const paneId of editorRefs.current.keys()) {
      if (!nextPanes.some(pane => pane.id === paneId)) editorRefs.current.delete(paneId);
    }
    const selected = nextPanes.find(pane => pane.id === activePaneIdRef.current)
      ?? nextPanes.find(pane => pane.kind === 'editor');
    activePaneIdRef.current = selected?.id ?? '';
    setActivePaneId(activePaneIdRef.current);
    activeTabIdRef.current = selected?.tabId ?? '';
    setActiveTabId(activeTabIdRef.current);
  };

  const addUntitledTab = () => {
    const tab = newUntitledTab();
    if (tabsRef.current.length === 0 || panesRef.current.length === 0) {
      const newPane: EditorPane = { id: crypto.randomUUID(), tabId: tab.id, tabIds: [tab.id], kind: 'editor' };
      updateTabs(() => [tab]);
      updatePanes(() => [newPane]);
      activeTabIdRef.current = tab.id;
      setActiveTabId(tab.id);
      activePaneIdRef.current = newPane.id;
      setActivePaneId(newPane.id);
    } else {
      updateTabs(current => [...current, tab]);
      activateTab(tab.id);
    }
    setTimeout(focusActiveEditor, 50);
  };

  const requestCloseTabs = (tabIdsToClose: string[], paneId: string) => {
    const targets = tabIdsToClose.map(tabId => ({ tabId, paneId }));
    requestCloseOperation(targets);
  };

  const requestCloseOperation = (targets: PendingCloseItem[]) => {
    if (targets.length === 0) return;
    const dirtyTabIds = [...new Set(targets.map(target => target.tabId))].filter(tabId => {
      const tab = tabsRef.current.find(item => item.id === tabId);
      if (!tab || tab.content === tab.savedContent) return false;
      return !panesRef.current.some(pane => pane.kind === 'editor' && pane.tabIds.includes(tabId)
        && !targets.some(target => target.paneId === pane.id && target.tabId === tabId));
    });
    if (dirtyTabIds.length === 0) applyTabClosures(targets);
    else setPendingCloseOperation({ targets, dirtyTabIds, index: 0 });
  };

  const requestCloseTab = (id: string, paneId: string) => {
    const pane = panesRef.current.find(item => item.id === paneId);
    if (pane?.kind === 'preview') { closePane(paneId); return; }
    requestCloseTabs([id], paneId);
  };

  const confirmPendingClose = async (saveChanges: boolean) => {
    const operation = pendingCloseOperation;
    if (!operation) return;
    const tabId = operation.dirtyTabIds[operation.index];
    if (saveChanges && !(await handleSaveFile(tabId))) return;
    if (operation.index + 1 < operation.dirtyTabIds.length) {
      setPendingCloseOperation({ ...operation, index: operation.index + 1 });
    } else {
      applyTabClosures(operation.targets);
      setPendingCloseOperation(null);
    }
  };

  const closeOtherTabs = (keepTabId: string, paneId: string) => {
    const pane = panesRef.current.find(item => item.id === paneId && item.kind === 'editor');
    if (!pane) return;
    const toClose = pane.tabIds.filter(id => id !== keepTabId);
    requestCloseTabs(toClose, paneId);
  };

  const closeTabsToTheRight = (targetTabId: string, paneId: string) => {
    const pane = panesRef.current.find(item => item.id === paneId && item.kind === 'editor');
    if (!pane) return;
    const index = pane.tabIds.indexOf(targetTabId);
    if (index >= 0) {
      const toClose = pane.tabIds.slice(index + 1);
      requestCloseTabs(toClose, paneId);
    }
  };

  const closeSavedTabs = (paneId: string) => {
    const pane = panesRef.current.find(item => item.id === paneId && item.kind === 'editor');
    if (!pane) return;
    const toClose = pane.tabIds.filter(id => {
      const tab = tabsRef.current.find(t => t.id === id);
      return tab && tab.content === tab.savedContent;
    });
    requestCloseTabs(toClose, paneId);
  };

  const closeAllTabsAndPanes = () => {
    setIsCloseAllConfirmationOpen(true);
  };

  const confirmCloseAllTabsAndPanes = () => {
    setIsCloseAllConfirmationOpen(false);
    const targets = panesRef.current.flatMap(pane => pane.kind === 'editor'
      ? pane.tabIds.map(tabId => ({ tabId, paneId: pane.id })) : []);
    if (targets.length === 0) applyTabClosures([]);
    else requestCloseOperation(targets);
  };

  const removeUnavailablePreviews = () => {
    const next = panesRef.current.filter(pane => pane.kind === 'editor' || isMarkdownPath(tabsRef.current.find(tab => tab.id === pane.tabId)?.path ?? null));
    if (next.length === panesRef.current.length) return;
    updatePanes(() => next);
    setPaneWidths({});
    if (next.length > 0 && !next.some(pane => pane.id === activePaneIdRef.current)) {
      const fallback = next.find(pane => pane.kind === 'editor');
      if (fallback) selectPane(fallback.id);
    }
  };

  const handleExplorerRename = (oldPath: string, newPath: string, isDirectory: boolean) => {
    const matches = (path: string | null) => path === oldPath || (isDirectory && path != null && (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)));
    updateTabs(current => current.map(tab => matches(tab.path) ? { ...tab, path: `${newPath}${tab.path!.slice(oldPath.length)}` } : tab));
    removeUnavailablePreviews();
  };

  const handleExplorerDelete = (path: string, isDirectory: boolean) => {
    const matches = (filePath: string | null) => filePath === path || (isDirectory && filePath != null && (filePath.startsWith(`${path}/`) || filePath.startsWith(`${path}\\`)));
    updateTabs(current => current.map(tab => matches(tab.path) ? { ...tab, path: null, savedContent: tab.content === tab.savedContent ? tab.content : null } : tab));
    removeUnavailablePreviews();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentPendingCloseId) return;
      if (isCloseAllConfirmationOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsCloseAllConfirmationOpen(false);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setIsPaletteOpen(open => !open);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarOpen(true);
        setSidebarTab('search');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        setIsSettingsOpen(open => !open);
        return;
      }
      if (isPaletteOpen || isSettingsOpen) return;

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        quickOpenRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        e.stopPropagation();
        if (activeTabIdRef.current && activePaneIdRef.current) {
          requestCloseTab(activeTabIdRef.current, activePaneIdRef.current);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const pane = panesRef.current.find(item => item.id === activePaneIdRef.current && item.kind === 'editor');
        const current = pane?.tabIds ?? [];
        if (current.length > 1) {
          const index = current.indexOf(activeTabIdRef.current);
          activatePaneTab(pane!.id, current[(index + (e.shiftKey ? current.length - 1 : 1)) % current.length]);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        e.stopPropagation();
        addUntitledTab();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        e.stopPropagation();
        if (isPanelOpen) focusActiveEditor();
        setIsPanelOpen((prev) => !prev);
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement?.closest(".xterm")) {
          focusActiveEditor();
        } else {
          setIsPanelOpen(true);
          setTerminalFocusRequest(value => value + 1);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void handleOpenFile();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveFile();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isPaletteOpen, isSettingsOpen, isPanelOpen, currentPendingCloseId, isCloseAllConfirmationOpen]);

  const commands: PaletteCommand[] = [
    { id: 'settings', label: 'Preferences: Open Settings', shortcut: 'Ctrl/Cmd ,', run: () => setIsSettingsOpen(true) },
    { id: 'theme', label: 'Preferences: Color Theme', detail: `Current: ${theme.name}`, run: () => {} },
    { id: 'code-font', label: 'Preferences: Editor Font', detail: `Current: ${codeFont}`, run: () => {} },
    { id: 'search-files', label: 'View: Find in Files (Search)', shortcut: 'Ctrl/Cmd Shift F', run: () => { setIsSidebarOpen(true); setSidebarTab('search'); } },
    { id: 'terminal', label: isPanelOpen ? 'View: Hide Terminal' : 'View: Show Terminal', shortcut: 'Ctrl/Cmd J', run: () => setIsPanelOpen(value => !value) },
    { id: 'explorer', label: isSidebarOpen ? 'View: Hide File Tree' : 'View: Show File Tree', shortcut: 'Ctrl/Cmd B', run: () => setIsSidebarOpen(value => !value) },
    { id: 'word-wrap', label: wordWrap ? 'Editor: Disable Word Wrap' : 'Editor: Enable Word Wrap', detail: wordWrap ? 'Wrapping is on' : 'Wrapping is off', run: () => setWordWrap(value => !value) },
    ...(activeTab ? [{ id: 'split-editor', label: 'Editor: Open Active File in Split View', run: () => openInSplit(activeTab.id) }] : []),
    ...(canPreviewMarkdown ? [{ id: 'markdown-preview', label: isPreviewOpen ? 'Markdown: Hide Preview' : 'Markdown: Open Preview to Side', run: toggleMarkdownPreview }] : []),
    { id: 'font-up', label: 'Appearance: Increase Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.min(24, value + 1)) },
    { id: 'font-down', label: 'Appearance: Decrease Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.max(10, value - 1)) },
    { id: 'font-reset', label: 'Appearance: Reset Font Size', detail: '13px', run: () => setFontSize(13) },
    { id: 'open', label: 'File: Open File', shortcut: 'Ctrl/Cmd O', run: () => void handleOpenFile() },
    { id: 'open-folder', label: 'File: Open Folder / Project', run: () => void handleChooseFolder() },
    { id: 'quick-open', label: 'File: Search Files', shortcut: 'Ctrl/Cmd P', run: () => quickOpenRef.current?.focus() },
    { id: 'new', label: 'File: New File', shortcut: 'Ctrl/Cmd N', run: addUntitledTab },
    ...(activeTab ? [{ id: 'save', label: 'File: Save File', shortcut: 'Ctrl/Cmd S', run: () => void handleSaveFile() }] : []),
    { id: 'terminal-folder', label: 'File: Open Current Terminal Folder', run: () => void handleOpenTerminalFolder() },
  ];

  return (
    <div className="app-shell" style={{ ...themeVariables(theme, codeFont), colorScheme: theme.dark ? 'dark' : 'light', height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden", backgroundColor: "var(--editor)", color: "var(--text)" }}>
      <header className="top-bar">
        <div className="top-bar-brand"><FolderIcon width={17} height={17} /><strong>crumb</strong></div>
        <QuickOpen ref={quickOpenRef} rootPath={explorerRootPath} openPaths={tabs.flatMap(tab => tab.path ? [tab.path] : [])} onOpenFile={path => { void handleOpenFile(path); }} />
        <div className="top-bar-actions">
          <span className="top-bar-workspace" title={explorerRootPath ?? 'No folder open'}>{explorerRootPath ? getFileNameFromPath(explorerRootPath) : 'No folder'}</span>
          <span className="top-bar-language" title="Current file language">{activeTab ? languageName(activeTab.path) : ''}</span>
          {canPreviewMarkdown && <button className={`markdown-preview-toggle ${isPreviewOpen ? 'active' : ''}`} aria-pressed={isPreviewOpen} title={isPreviewOpen ? 'Hide Markdown preview' : 'Open Markdown preview to the side'} onClick={toggleMarkdownPreview}><SplitPreviewIcon /><span>Preview</span></button>}
          {tabs.length > 0 && <button title="Close all editor tabs" onClick={closeAllTabsAndPanes}>Close All</button>}
          <button title="Commands and themes (Ctrl/Cmd+Shift+P)" onClick={() => setIsPaletteOpen(true)}>Commands</button>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {/* Activity Bar */}
        <div style={{
          width: "48px",
          minWidth: "48px",
          backgroundColor: "var(--activity)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "8px",
          gap: "6px"
        }}>
          {/* Explorer Button */}
          <button
            onClick={() => {
              if (!isSidebarOpen) {
                setIsSidebarOpen(true);
                setSidebarTab('explorer');
              } else if (sidebarTab === 'explorer') {
                setIsSidebarOpen(false);
              } else {
                setSidebarTab('explorer');
              }
            }}
            title="Explorer (⌘B)"
            aria-label="Toggle file explorer"
            style={{
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              borderLeft: isSidebarOpen && sidebarTab === 'explorer' ? "2px solid var(--accent)" : "2px solid transparent",
              opacity: isSidebarOpen && sidebarTab === 'explorer' ? 1 : 0.5,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--hover)"; e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.opacity = isSidebarOpen && sidebarTab === 'explorer' ? "1" : "0.5"; }}
          >
            <FolderIcon width={20} height={20} />
          </button>

          {/* Search Button */}
          <button
            onClick={() => {
              if (!isSidebarOpen) {
                setIsSidebarOpen(true);
                setSidebarTab('search');
              } else if (sidebarTab === 'search') {
                setIsSidebarOpen(false);
              } else {
                setSidebarTab('search');
              }
            }}
            title="Search in Files (⌘Shift+F)"
            aria-label="Toggle search in files"
            style={{
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              borderLeft: isSidebarOpen && sidebarTab === 'search' ? "2px solid var(--accent)" : "2px solid transparent",
              opacity: isSidebarOpen && sidebarTab === 'search' ? 1 : 0.5,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--hover)"; e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.opacity = isSidebarOpen && sidebarTab === 'search' ? "1" : "0.5"; }}
          >
            <SearchIcon width={19} height={19} />
          </button>

          <div style={{ flex: 1 }} />

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            title="Editor Settings (⌘,)"
            aria-label="Open settings"
            style={{
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              opacity: 0.6,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--hover)"; e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.opacity = "0.6"; }}
          >
            <SettingsIcon width={19} height={19} />
          </button>

          {/* Command Palette Trigger */}
          <button
            onClick={() => setIsPaletteOpen(true)}
            title="Commands and themes (Ctrl/Cmd+Shift+P)"
            aria-label="Open command palette"
            style={{ width: '36px', height: '36px', marginBottom: '8px', border: 'none', borderRadius: '6px', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: '19px' }}
          >
            ›
          </button>
        </div>

        {/* Sidebar Container */}
        <div
          ref={sidebarContainerRef}
          style={{
            width: isSidebarOpen ? `${sidebarWidth}px` : "0px",
            minWidth: isSidebarOpen ? `${sidebarWidth}px` : "0px",
            maxWidth: 'calc(100vw - 280px)',
            backgroundColor: "var(--sidebar)",
            overflow: "hidden",
            transition: sidebarDraggingRef.current ? 'none' : 'width 0.15s ease, min-width 0.15s ease',
          }}
        >
          {sidebarTab === 'explorer' ? (
            <FileExplorer
              rootPath={explorerRootPath}
              onFileSelect={handleOpenFile}
              onFileOpenInSplit={path => { void handleOpenFile(path, true); }}
              activeFilePath={activeTab?.path ?? null}
              onRename={handleExplorerRename}
              onDelete={handleExplorerDelete}
              onFolderOpened={handleFolderOpened}
              onOpenTerminalFolder={handleOpenTerminalFolder}
              terminalFolderError={terminalFolderError}
            />
          ) : (
            <SearchPanel
              rootPath={explorerRootPath}
              onOpenFile={(path, line) => { void handleOpenFile(path, false, line); }}
              onClose={() => setIsSidebarOpen(false)}
            />
          )}
        </div>

        {/* Vertical Resize Handle */}
        {isSidebarOpen && (
          <div
            className="resize-handle vertical"
            role="separator"
            aria-label="Resize file tree"
            aria-orientation="vertical"
            aria-valuemin={160}
            aria-valuemax={Math.max(160, window.innerWidth - 268)}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onPointerDown={event => {
              event.preventDefault();
              sidebarDraggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (!sidebarDraggingRef.current) return;
              const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
              const available = event.currentTarget.parentElement?.clientWidth ?? window.innerWidth;
              const newWidth = Math.max(160, Math.min(available - 48 - 220, event.clientX - left - 48));
              currentDragWidthRef.current = newWidth;
              if (sidebarContainerRef.current) {
                sidebarContainerRef.current.style.width = `${newWidth}px`;
                sidebarContainerRef.current.style.minWidth = `${newWidth}px`;
              }
            }}
            onPointerUp={event => {
              if (sidebarDraggingRef.current) {
                sidebarDraggingRef.current = false;
                setSidebarWidth(currentDragWidthRef.current);
                try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
              }
            }}
            onPointerCancel={event => {
              if (sidebarDraggingRef.current) {
                sidebarDraggingRef.current = false;
                setSidebarWidth(currentDragWidthRef.current);
                try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
              }
            }}
            onLostPointerCapture={() => {
              if (sidebarDraggingRef.current) {
                sidebarDraggingRef.current = false;
                setSidebarWidth(currentDragWidthRef.current);
              }
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setSidebarWidth(width => Math.max(160, Math.min(window.innerWidth - 268, width + (event.key === 'ArrowRight' ? 10 : -10))));
              }
            }}
          />
        )}

        {/* Main Editor Space (Welcome Screen or Editor Panes) */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tabs.length === 0 || panes.length === 0 ? (
            <WelcomeScreen
              onNewFile={addUntitledTab}
              onOpenFile={handleOpenFile}
              onOpenFolder={handleChooseFolder}
              onOpenSearch={() => { setIsSidebarOpen(true); setSidebarTab('search'); }}
              onOpenPalette={() => setIsPaletteOpen(true)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onToggleTerminal={() => setIsPanelOpen(v => !v)}
              recentFiles={recentFiles}
              onClearRecentFiles={clearRecentFiles}
            />
          ) : (
            <div ref={workspaceRef} className="editor-workspace" style={{ flex: 1 }}>
              {panes.map((pane, index) => {
                const file = tabs.find(tab => tab.id === pane.tabId) ?? tabs[0];
                const canClose = pane.kind === 'preview' || panes.some(item => item.kind === 'editor' && item.id !== pane.id);
                return <Fragment key={pane.id}>
                  {index > 0 && <div className="editor-pane-divider" role="separator" aria-label={`Resize split between ${getFileNameFromPath(tabs.find(tab => tab.id === panes[index - 1].tabId)?.path ?? null)} and ${getFileNameFromPath(file.path)}`} aria-orientation="vertical" tabIndex={0}
                    onPointerDown={event => {
                      event.preventDefault();
                      const leftWidth = event.currentTarget.previousElementSibling?.getBoundingClientRect().width;
                      const rightWidth = event.currentTarget.nextElementSibling?.getBoundingClientRect().width;
                      if (!leftWidth || !rightWidth) return;
                      splitDragRef.current = { leftId: panes[index - 1].id, rightId: pane.id, startX: event.clientX, leftWidth, rightWidth };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={event => {
                      const drag = splitDragRef.current;
                      if (!drag) return;
                      const total = drag.leftWidth + drag.rightWidth;
                      const leftWidth = Math.max(220, Math.min(total - 220, drag.leftWidth + event.clientX - drag.startX));
                      setPaneWidths(current => ({ ...current, [drag.leftId]: leftWidth, [drag.rightId]: total - leftWidth }));
                    }}
                    onPointerUp={event => {
                      splitDragRef.current = null;
                      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
                    }}
                    onPointerCancel={event => {
                      splitDragRef.current = null;
                      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
                    }}
                    onLostPointerCapture={() => { splitDragRef.current = null; }}
                    onKeyDown={event => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      const leftWidth = event.currentTarget.previousElementSibling?.getBoundingClientRect().width ?? 280;
                      const rightWidth = event.currentTarget.nextElementSibling?.getBoundingClientRect().width ?? 280;
                      const total = leftWidth + rightWidth;
                      const nextLeft = Math.max(220, Math.min(total - 220, leftWidth + (event.key === 'ArrowRight' ? 10 : -10)));
                      setPaneWidths(current => ({ ...current, [panes[index - 1].id]: nextLeft, [pane.id]: total - nextLeft }));
                    }}
                  />}
                  <div data-pane-id={pane.id} className={`editor-pane ${activePaneId === pane.id ? 'active' : ''}`} style={paneWidths[pane.id] ? { flex: `0 0 ${paneWidths[pane.id]}px` } : undefined}>
                    {pane.kind === 'preview' && file.path ? (
                      <Suspense fallback={<div className="markdown-preview-loading">Loading preview…</div>}>
                        <MarkdownPreview
                          content={file.content}
                          path={file.path}
                          onOpenFile={path => { void handleOpenFile(path); }}
                          onClose={() => closePane(pane.id)}
                          onActivate={() => selectPane(pane.id)}
                          syncScrollRatio={tabScrollRatios[file.id]}
                          onScrollRatio={ratio => updateTabScrollRatio(file.id, ratio)}
                        />
                      </Suspense>
                    ) : <>
                      <div className="editor-pane-tabs" onMouseDown={() => selectPane(pane.id)}>
                        <div className="editor-tabs pane-tab-list" role="tablist" aria-label={`Files in ${getFileNameFromPath(file.path)}`}>
                          {pane.tabIds.map(tabId => {
                            const tab = tabs.find(item => item.id === tabId);
                            if (!tab) return null;
                            return <div key={tab.id} className={`editor-tab ${tab.id === pane.tabId ? 'active' : ''}`} role="tab" aria-selected={tab.id === pane.tabId} title={tab.path ?? 'Untitled'} onContextMenu={event => { event.preventDefault(); setTabMenu({ x: event.clientX, y: event.clientY, tabId: tab.id, paneId: pane.id }); }}>
                              <button className="editor-tab-label" onClick={() => activatePaneTab(pane.id, tab.id)}>{getFileNameFromPath(tab.path)}{tab.content !== tab.savedContent && <span className="editor-tab-dirty" title="Unsaved changes">●</span>}</button>
                              <button className="editor-tab-close" aria-label={`Close ${getFileNameFromPath(tab.path)}`} onClick={() => requestCloseTab(tab.id, pane.id)}>×</button>
                            </div>;
                          })}
                        </div>
                        {panes.length > 1 && canClose && <button className="editor-pane-close" aria-label={`Close split for ${getFileNameFromPath(file.path)}`} title="Close split" onClick={() => closePane(pane.id)}>×</button>}
                      </div>
                      <div className="editor-pane-content">
                        <Editor
                          ref={handle => { if (handle) editorRefs.current.set(pane.id, handle); else editorRefs.current.delete(pane.id); }}
                          tabId={file.id}
                          path={file.path}
                          openTabIds={tabs.map(tab => tab.id)}
                          doc={file.content}
                          theme={theme}
                          fontSize={fontSize}
                          fontFamily={codeFont}
                          wordWrap={wordWrap}
                          onChange={value => handleEditorChange(file.id, value)}
                          onFocus={() => selectPane(pane.id)}
                          onScrollRatio={ratio => updateTabScrollRatio(file.id, ratio)}
                          syncScrollRatio={tabScrollRatios[file.id]}
                        />
                      </div>
                    </>}
                  </div>
                </Fragment>;
              })}
            </div>
          )}
        </div>
      </div>

      {/* Horizontal Bottom Panel Resize Handle */}
      {isPanelOpen && (
        <div
          className="resize-handle horizontal"
          role="separator"
          aria-label="Resize bottom panel"
          aria-orientation="horizontal"
          aria-valuemin={120}
          aria-valuemax={Math.max(120, window.innerHeight - 200)}
          aria-valuenow={panelHeight}
          tabIndex={0}
          onPointerDown={event => {
            event.preventDefault();
            panelDraggingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!panelDraggingRef.current) return;
            const bottom = event.currentTarget.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
            const available = event.currentTarget.parentElement?.clientHeight ?? window.innerHeight;
            const newHeight = Math.max(120, Math.min(available - 200, bottom - event.clientY));
            currentDragHeightRef.current = newHeight;
            if (panelContainerRef.current) {
              panelContainerRef.current.style.height = `${newHeight}px`;
            }
          }}
          onPointerUp={event => {
            if (panelDraggingRef.current) {
              panelDraggingRef.current = false;
              setPanelHeight(currentDragHeightRef.current);
              try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
            }
          }}
          onPointerCancel={event => {
            if (panelDraggingRef.current) {
              panelDraggingRef.current = false;
              setPanelHeight(currentDragHeightRef.current);
              try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
            }
          }}
          onLostPointerCapture={() => {
            if (panelDraggingRef.current) {
              panelDraggingRef.current = false;
              setPanelHeight(currentDragHeightRef.current);
            }
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              setPanelHeight(height => Math.max(120, Math.min(window.innerHeight - 200, height + (event.key === 'ArrowUp' ? 10 : -10))));
            }
          }}
        />
      )}

      {/* Bottom Panel */}
      <div
        ref={panelContainerRef}
        style={{
          height: isPanelOpen ? `${panelHeight}px` : "0",
          maxHeight: 'calc(100vh - 200px)',
          backgroundColor: "var(--panel)",
          display: isPanelOpen ? "block" : "none"
        }}
      >
        <BottomPanel onClose={() => setIsPanelOpen(false)} onActiveSessionChange={setActiveTerminalSessionId} theme={theme} fontSize={fontSize} fontFamily={codeFont} focusRequest={terminalFocusRequest} workingDirectory={explorerRootPath} openTerminalRequest={openTerminalRequest} />
      </div>

      {/* Command Palette */}
      {isPaletteOpen && (
        <CommandPalette
          commands={commands}
          themes={themes}
          currentThemeId={themeId}
          codeFontOverride={codeFontOverride}
          onCodeFontChange={setCodeFontOverride}
          onThemeChange={setThemeId}
          onClose={() => setIsPaletteOpen(false)}
        />
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal
          themes={themes}
          currentThemeId={themeId}
          onThemeChange={setThemeId}
          codeFontOverride={codeFontOverride}
          onCodeFontChange={setCodeFontOverride}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          wordWrap={wordWrap}
          onWordWrapChange={setWordWrap}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Tab Context Menu */}
      {tabMenu && <div className="tab-menu-backdrop" onMouseDown={() => setTabMenu(null)} onContextMenu={event => { event.preventDefault(); setTabMenu(null); }}>
        <div className="tree-menu" style={{ left: tabMenu.x, top: tabMenu.y }} onMouseDown={event => event.stopPropagation()}>
          <button onClick={() => { requestCloseTab(tabMenu.tabId, tabMenu.paneId); setTabMenu(null); }}>Close Tab</button>
          <button onClick={() => { closeOtherTabs(tabMenu.tabId, tabMenu.paneId); setTabMenu(null); }}>Close Others</button>
          <button onClick={() => { closeTabsToTheRight(tabMenu.tabId, tabMenu.paneId); setTabMenu(null); }}>Close to the Right</button>
          <button onClick={() => { closeSavedTabs(tabMenu.paneId); setTabMenu(null); }}>Close Saved</button>
          <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
          <button onClick={() => { selectPane(tabMenu.paneId); openInSplit(tabMenu.tabId); setTabMenu(null); }}>Open in Split View</button>
        </div>
      </div>}

      {isCloseAllConfirmationOpen && (
        <div className="file-dialog-backdrop" role="presentation">
          <div className="file-dialog" role="dialog" aria-modal="true" aria-label="Close all tabs">
            <strong>Close all tabs?</strong>
            <p>This will close every open editor tab and split. You will be asked to save any unsaved changes.</p>
            <div className="file-dialog-actions">
              <button onClick={() => setIsCloseAllConfirmationOpen(false)}>Cancel</button>
              <button className="primary" onClick={confirmCloseAllTabsAndPanes}>Close All</button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Changes Confirmation Queue */}
      {currentPendingCloseId && (
        <div className="file-dialog-backdrop" role="presentation">
          <div className="file-dialog" role="dialog" aria-modal="true" aria-label="Unsaved changes">
            <strong>Save changes?</strong>
            <p>{getFileNameFromPath(tabs.find(tab => tab.id === currentPendingCloseId)?.path ?? null)} has unsaved changes.</p>
            <div className="file-dialog-actions">
              <button onClick={() => setPendingCloseOperation(null)}>Cancel</button>
              <button onClick={() => { void confirmPendingClose(false); }}>Don't Save</button>
              <button className="primary" onClick={() => { void confirmPendingClose(true); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Centralized Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
