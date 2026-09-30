import { Fragment, lazy, Suspense, useState, useEffect, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import Editor, { type EditorHandle } from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import FileExplorer from "./components/FileExplorer";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette";
import QuickOpen, { type QuickOpenHandle } from "./components/QuickOpen";
import { codeFonts, getTheme, themes, themeVariables } from "./lib/themes";
import { languageName } from "./lib/languages";
import { FolderIcon, SplitPreviewIcon } from "./components/Icons";
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

const newUntitledTab = (): EditorTab => ({
  id: crypto.randomUUID(), path: null, content: initialDoc, savedContent: initialDoc,
});
const readPreference = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};

const getFileNameFromPath = (path: string | null) => {
  if (!path) {
    return "Untitled";
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
};

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [panelHeight, setPanelHeight] = useState(() => Math.round(window.innerHeight * 0.4));
  const [explorerRootPath, setExplorerRootPath] = useState<string | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
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
  const [tabs, setTabs] = useState<EditorTab[]>(() => [newUntitledTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [panes, setPanes] = useState<EditorPane[]>(() => [{ id: crypto.randomUUID(), tabId: tabs[0].id, tabIds: [tabs[0].id], kind: 'editor' }]);
  const [activePaneId, setActivePaneId] = useState(() => panes[0].id);
  const [paneWidths, setPaneWidths] = useState<Record<string, number>>({});
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string; paneId: string } | null>(null);
  const [pendingClose, setPendingClose] = useState<{ tabId: string; paneId: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [terminalFolderRequest, setTerminalFolderRequest] = useState<{ path: string; sequence: number } | null>(null);
  const [openTerminalRequest, setOpenTerminalRequest] = useState<{ path: string; sequence: number } | null>(null);
  const [terminalFolderError, setTerminalFolderError] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const panesRef = useRef(panes);
  const activePaneIdRef = useRef(activePaneId);
  const editorRefs = useRef(new Map<string, EditorHandle>());
  const workspaceRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ leftId: string; rightId: string; startX: number; leftWidth: number; rightWidth: number } | null>(null);
  const quickOpenRef = useRef<QuickOpenHandle>(null);
  const sidebarDraggingRef = useRef(false);
  const panelDraggingRef = useRef(false);
  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
  const canPreviewMarkdown = isMarkdownPath(activeTab.path);
  const isPreviewOpen = canPreviewMarkdown && panes.some(pane => pane.kind === 'preview' && pane.tabId === activeTab.id);
  useEffect(() => {
    workspaceRef.current?.querySelector<HTMLElement>(`[data-pane-id="${activePaneId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePaneId, panes.length]);
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
    if (!pane || (pane.kind === 'editor' && current.filter(item => item.kind === 'editor').length === 1)) return;
    const next = current.filter(item => item.id !== paneId);
    updatePanes(() => next);
    editorRefs.current.delete(paneId);
    setPaneWidths({});
    if (activePaneIdRef.current === paneId) selectPane(next[Math.min(current.findIndex(item => item.id === paneId), next.length - 1)].id);
  };
  const toggleMarkdownPreview = () => {
    if (!canPreviewMarkdown) return;
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
      setTerminalFolderError("Start or select a terminal first.");
      return;
    }
    try {
      const path = await invoke<string>("get_pty_cwd", { id: activeTerminalSessionId });
      setTerminalFolderRequest(previous => ({ path, sequence: (previous?.sequence ?? 0) + 1 }));
      setIsSidebarOpen(true);
      setTerminalFolderError(null);
    } catch (error) {
      setTerminalFolderError(String(error));
    }
  };

  const handleFolderOpened = (path: string) => {
    setExplorerRootPath(path);
    setOpenTerminalRequest(previous => ({ path, sequence: (previous?.sequence ?? 0) + 1 }));
    setIsPanelOpen(true);
    setTerminalFocusRequest(value => value + 1);
  };

  const handleOpenFile = async (path?: string, split = false) => {
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
      if (existing) {
        if (split) openInSplit(existing.id);
        else activateTab(existing.id);
        return;
      }
      const content = await readTextFile(selectedPath);
      const openedWhileReading = tabsRef.current.find(tab => tab.path === selectedPath);
      if (openedWhileReading) {
        if (split) openInSplit(openedWhileReading.id);
        else activateTab(openedWhileReading.id);
        return;
      }
      const newTab: EditorTab = { id: crypto.randomUUID(), path: selectedPath, content, savedContent: content };
      updateTabs(current => [...current, newTab]);
      if (split) openInSplit(newTab.id);
      else activateTab(newTab.id);
      setFileError(null);
    } catch (error) {
      console.error("Failed to open file:", error);
      setFileError(`Could not open file: ${String(error)}`);
    }
  };

  const handleEditorChange = (id: string, nextValue: string) => {
    updateTabs(current => current.map(tab => tab.id === id ? { ...tab, content: nextValue } : tab));
  };

  const handleSaveFile = async (id = activeTabIdRef.current): Promise<boolean> => {
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
        setFileError('That file is already open in another tab.');
        return false;
      }
      const contentToSave = tab.content;
      await writeTextFile(targetPath, contentToSave);
      updateTabs(current => current.map(item => item.id === id ? { ...item, path: targetPath, savedContent: contentToSave } : item));
      setFileError(null);
      return true;
    } catch (error) {
      console.error("Failed to save file:", error);
      setFileError(`Could not save file: ${String(error)}`);
      return false;
    }
  };

  const closeTab = (id: string, paneId: string) => {
    const currentPanes = panesRef.current;
    const pane = currentPanes.find(item => item.id === paneId && item.kind === 'editor');
    if (!pane || !pane.tabIds.includes(id)) return;
    const remainingIds = pane.tabIds.filter(tabId => tabId !== id);
    let nextPanes: EditorPane[];
    if (remainingIds.length) {
      const nextId = pane.tabId === id ? remainingIds[Math.min(pane.tabIds.indexOf(id), remainingIds.length - 1)] : pane.tabId;
      nextPanes = currentPanes.map(item => item.id === paneId ? { ...item, tabIds: remainingIds, tabId: nextId } : item);
    } else if (currentPanes.some(item => item.kind === 'editor' && item.id !== paneId)) {
      nextPanes = currentPanes.filter(item => item.id !== paneId);
    } else {
      const replacement = newUntitledTab();
      updateTabs(current => [...current, replacement]);
      nextPanes = currentPanes.map(item => item.id === paneId ? { ...item, tabId: replacement.id, tabIds: [replacement.id] } : item);
    }
    const stillReferenced = nextPanes.some(item => item.kind === 'preview' ? item.tabId === id : item.tabIds.includes(id));
    if (!stillReferenced) updateTabs(current => current.filter(tab => tab.id !== id));
    updatePanes(() => nextPanes);
    setPaneWidths({});
    if (!nextPanes.some(item => item.id === activePaneIdRef.current)) {
      const replacementPane = nextPanes[Math.min(currentPanes.findIndex(item => item.id === paneId), nextPanes.length - 1)];
      if (replacementPane) selectPane(replacementPane.id);
    } else if (activePaneIdRef.current === paneId && activeTabIdRef.current === id) {
      const selected = nextPanes.find(item => item.id === paneId);
      if (selected) { activeTabIdRef.current = selected.tabId; setActiveTabId(selected.tabId); }
    }
    setPendingClose(null);
  };

  const addUntitledTab = () => {
    const tab = newUntitledTab();
    updateTabs(current => [...current, tab]);
    activateTab(tab.id);
    focusActiveEditor();
  };

  const requestCloseTab = (id: string, paneId: string) => {
    const tab = tabsRef.current.find(item => item.id === id);
    if (!tab) return;
    const editorReferences = panesRef.current.filter(item => item.kind === 'editor' && item.tabIds.includes(id));
    if (tab.content !== tab.savedContent && editorReferences.length <= 1) setPendingClose({ tabId: id, paneId });
    else closeTab(id, paneId);
  };

  const removeUnavailablePreviews = () => {
    const next = panesRef.current.filter(pane => pane.kind === 'editor' || isMarkdownPath(tabsRef.current.find(tab => tab.id === pane.tabId)?.path ?? null));
    if (next.length === panesRef.current.length) return;
    updatePanes(() => next);
    setPaneWidths({});
    if (!next.some(pane => pane.id === activePaneIdRef.current)) selectPane(next.find(pane => pane.kind === 'editor')!.id);
  };

  const handleExplorerRename = (oldPath: string, newPath: string, isDirectory: boolean) => {
    const matches = (path: string | null) => path === oldPath || (isDirectory && path != null && (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)));
    updateTabs(current => current.map(tab => matches(tab.path) ? { ...tab, path: `${newPath}${tab.path!.slice(oldPath.length)}` } : tab));
    removeUnavailablePreviews();
  };

  const handleExplorerDelete = (path: string, isDirectory: boolean) => {
    const matches = (filePath: string | null) => filePath === path || (isDirectory && filePath != null && (filePath.startsWith(`${path}/`) || filePath.startsWith(`${path}\\`)));
    // Keep changed documents as unsaved tabs so deleting a file cannot erase edits.
    updateTabs(current => current.map(tab => matches(tab.path) ? { ...tab, path: null, savedContent: tab.content === tab.savedContent ? tab.content : null } : tab));
    removeUnavailablePreviews();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setIsPaletteOpen(open => !open);
        return;
      }
      if (isPaletteOpen || pendingClose) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        quickOpenRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        e.stopPropagation();
        requestCloseTab(activeTabIdRef.current, activePaneIdRef.current);
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

      // Toggle sidebar on Cmd+B or Ctrl+B
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      // Open file on Cmd+O or Ctrl+O
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void handleOpenFile();
        return;
      }

      // Save file on Cmd+S or Ctrl+S
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveFile();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isPaletteOpen, isPanelOpen, pendingClose]);

  const commands: PaletteCommand[] = [
    { id: 'theme', label: 'Preferences: Color Theme', detail: `Current: ${theme.name}`, run: () => {} },
    { id: 'code-font', label: 'Preferences: Editor Font', detail: `Current: ${codeFont}`, run: () => {} },
    { id: 'terminal', label: isPanelOpen ? 'View: Hide Terminal' : 'View: Show Terminal', shortcut: 'Ctrl/Cmd J', run: () => setIsPanelOpen(value => !value) },
    { id: 'explorer', label: isSidebarOpen ? 'View: Hide File Tree' : 'View: Show File Tree', shortcut: 'Ctrl/Cmd B', run: () => setIsSidebarOpen(value => !value) },
    { id: 'word-wrap', label: wordWrap ? 'Editor: Disable Word Wrap' : 'Editor: Enable Word Wrap', detail: wordWrap ? 'Wrapping is on' : 'Wrapping is off', run: () => setWordWrap(value => !value) },
    { id: 'split-editor', label: 'Editor: Open Active File in Split View', run: () => openInSplit(activeTab.id) },
    ...(canPreviewMarkdown ? [{ id: 'markdown-preview', label: isPreviewOpen ? 'Markdown: Hide Preview' : 'Markdown: Open Preview to Side', run: toggleMarkdownPreview }] : []),
    { id: 'font-up', label: 'Appearance: Increase Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.min(24, value + 1)) },
    { id: 'font-down', label: 'Appearance: Decrease Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.max(10, value - 1)) },
    { id: 'font-reset', label: 'Appearance: Reset Font Size', detail: '13px', run: () => setFontSize(13) },
    { id: 'open', label: 'File: Open File', shortcut: 'Ctrl/Cmd O', run: () => void handleOpenFile() },
    { id: 'quick-open', label: 'File: Search Files', shortcut: 'Ctrl/Cmd P', run: () => quickOpenRef.current?.focus() },
    { id: 'new', label: 'File: New File', shortcut: 'Ctrl/Cmd N', run: addUntitledTab },
    { id: 'save', label: 'File: Save File', shortcut: 'Ctrl/Cmd S', run: () => void handleSaveFile() },
    { id: 'terminal-folder', label: 'File: Open Current Terminal Folder', run: () => void handleOpenTerminalFolder() },
  ];

  return (
    <div className="app-shell" style={{ ...themeVariables(theme, codeFont), colorScheme: theme.dark ? 'dark' : 'light', height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden", backgroundColor: "var(--editor)", color: "var(--text)" }}>
      <header className="top-bar">
        <div className="top-bar-brand"><FolderIcon width={17} height={17} /><strong>crumb</strong></div>
        <QuickOpen ref={quickOpenRef} rootPath={explorerRootPath} openPaths={tabs.flatMap(tab => tab.path ? [tab.path] : [])} onOpenFile={path => { void handleOpenFile(path); }} />
        <div className="top-bar-actions">
          <span className="top-bar-workspace" title={explorerRootPath ?? 'No folder open'}>{explorerRootPath ? getFileNameFromPath(explorerRootPath) : 'No folder'}</span>
          <span className="top-bar-language" title="Current file language">{languageName(activeTab.path)}</span>
          {canPreviewMarkdown && <button className={`markdown-preview-toggle ${isPreviewOpen ? 'active' : ''}`} aria-pressed={isPreviewOpen} title={isPreviewOpen ? 'Hide Markdown preview' : 'Open Markdown preview to the side'} onClick={toggleMarkdownPreview}><SplitPreviewIcon /><span>Preview</span></button>}
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
          gap: "4px"
        }}>
          <button
            onClick={() => setIsSidebarOpen(prev => !prev)}
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
              borderLeft: isSidebarOpen ? "2px solid var(--accent)" : "2px solid transparent",
              opacity: isSidebarOpen ? 1 : 0.5,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--hover)";
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.opacity = isSidebarOpen ? "1" : "0.5";
            }}
          >
            <FolderIcon width={20} height={20} />
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setIsPaletteOpen(true)}
            title="Commands and themes (Ctrl/Cmd+Shift+P)"
            aria-label="Open command palette"
            style={{ width: '36px', height: '36px', marginBottom: '10px', border: 'none', borderRadius: '6px', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: '19px' }}
          >
            ›
          </button>
        </div>

        {/* Sidebar / File Explorer */}
        <div style={{
          width: isSidebarOpen ? `${sidebarWidth}px` : "0px",
          minWidth: isSidebarOpen ? `${sidebarWidth}px` : "0px",
          maxWidth: 'calc(100vw - 280px)',
          backgroundColor: "var(--sidebar)",
          overflow: "hidden",
          transition: sidebarDraggingRef.current ? 'none' : 'width 0.15s ease, min-width 0.15s ease',
        }}>
          <FileExplorer
            onFileSelect={handleOpenFile}
            onFileOpenInSplit={path => { void handleOpenFile(path, true); }}
            activeFilePath={activeTab.path}
            onRename={handleExplorerRename}
            onDelete={handleExplorerDelete}
            onRootPathChange={setExplorerRootPath}
            onFolderOpened={handleFolderOpened}
            terminalFolderRequest={terminalFolderRequest}
            onOpenTerminalFolder={handleOpenTerminalFolder}
            terminalFolderError={terminalFolderError}
          />
        </div>

        {isSidebarOpen && <div className="resize-handle vertical" role="separator" aria-label="Resize file tree" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={Math.max(160, window.innerWidth - 268)} aria-valuenow={sidebarWidth} tabIndex={0}
          onPointerDown={event => { event.preventDefault(); sidebarDraggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => {
            if (!sidebarDraggingRef.current) return;
            const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
            const available = event.currentTarget.parentElement?.clientWidth ?? window.innerWidth;
            setSidebarWidth(Math.max(160, Math.min(available - 48 - 220, event.clientX - left - 48)));
          }}
          onPointerUp={event => { sidebarDraggingRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onLostPointerCapture={() => { sidebarDraggingRef.current = false; }}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth(width => Math.max(160, Math.min(window.innerWidth - 268, width + (event.key === 'ArrowRight' ? 10 : -10)))); } }}
        />}

        {/* Main Editor */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {fileError && <div className="file-error" role="alert">{fileError}<button onClick={() => setFileError(null)} aria-label="Dismiss error">×</button></div>}
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
                  onPointerUp={event => { splitDragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
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
                      <MarkdownPreview content={file.content} path={file.path} onOpenFile={path => { void handleOpenFile(path); }} onClose={() => closePane(pane.id)} onActivate={() => selectPane(pane.id)} />
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
                      <Editor ref={handle => { if (handle) editorRefs.current.set(pane.id, handle); else editorRefs.current.delete(pane.id); }} tabId={file.id} path={file.path} openTabIds={tabs.map(tab => tab.id)} doc={file.content} theme={theme} fontSize={fontSize} fontFamily={codeFont} wordWrap={wordWrap} onChange={value => handleEditorChange(file.id, value)} onFocus={() => selectPane(pane.id)} />
                    </div>
                  </>}
                </div>
              </Fragment>;
            })}
          </div>
        </div>
      </div>

      {isPanelOpen && <div className="resize-handle horizontal" role="separator" aria-label="Resize bottom panel" aria-orientation="horizontal" aria-valuemin={120} aria-valuemax={Math.max(120, window.innerHeight - 200)} aria-valuenow={panelHeight} tabIndex={0}
        onPointerDown={event => { event.preventDefault(); panelDraggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => {
          if (!panelDraggingRef.current) return;
          const bottom = event.currentTarget.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
          const available = event.currentTarget.parentElement?.clientHeight ?? window.innerHeight;
          setPanelHeight(Math.max(120, Math.min(available - 200, bottom - event.clientY)));
        }}
        onPointerUp={event => { panelDraggingRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { panelDraggingRef.current = false; }}
        onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setPanelHeight(height => Math.max(120, Math.min(window.innerHeight - 200, height + (event.key === 'ArrowUp' ? 10 : -10)))); } }}
      />}
      {/* Bottom Panel */}
      <div
        style={{
          height: isPanelOpen ? `${panelHeight}px` : "0",
          maxHeight: 'calc(100vh - 200px)',
          backgroundColor: "var(--panel)",
          display: isPanelOpen ? "block" : "none"
        }}
      >
        <BottomPanel onClose={() => setIsPanelOpen(false)} onActiveSessionChange={setActiveTerminalSessionId} theme={theme} fontSize={fontSize} fontFamily={codeFont} focusRequest={terminalFocusRequest} workingDirectory={explorerRootPath} openTerminalRequest={openTerminalRequest} />
      </div>
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
      {tabMenu && <div className="tab-menu-backdrop" onMouseDown={() => setTabMenu(null)} onContextMenu={event => { event.preventDefault(); setTabMenu(null); }}>
        <div className="tree-menu" style={{ left: tabMenu.x, top: tabMenu.y }} onMouseDown={event => event.stopPropagation()}>
          <button onClick={() => { selectPane(tabMenu.paneId); openInSplit(tabMenu.tabId); setTabMenu(null); }}>Open in Split View</button>
          <button onClick={() => { requestCloseTab(tabMenu.tabId, tabMenu.paneId); setTabMenu(null); }}>Close Tab</button>
        </div>
      </div>}
      {pendingClose && (
        <div className="file-dialog-backdrop" role="presentation">
          <div className="file-dialog" role="dialog" aria-modal="true" aria-label="Unsaved changes">
            <strong>Save changes?</strong>
            <p>{getFileNameFromPath(tabs.find(tab => tab.id === pendingClose.tabId)?.path ?? null)} has unsaved changes.</p>
            {fileError && <p role="alert" style={{ color: 'var(--warning)' }}>{fileError}</p>}
            <div className="file-dialog-actions">
              <button onClick={() => setPendingClose(null)}>Cancel</button>
              <button onClick={() => closeTab(pendingClose.tabId, pendingClose.paneId)}>Don't Save</button>
              <button className="primary" onClick={async () => { if (await handleSaveFile(pendingClose.tabId)) closeTab(pendingClose.tabId, pendingClose.paneId); }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
