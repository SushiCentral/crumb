import { useState, useEffect, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import Editor, { type EditorHandle } from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import FileExplorer from "./components/FileExplorer";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette";
import { getTheme, themes, themeVariables } from "./lib/themes";
import { FolderIcon } from "./components/Icons";
import "./App.css";

const initialDoc = `// Welcome to Crumb\n\nfunction hello() {\n  console.log("Hello, world!");\n}\n`;
interface EditorTab {
  id: string;
  path: string | null;
  content: string;
  savedContent: string | null;
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
  const [fontSize, setFontSize] = useState(() => {
    const value = Number(readPreference('crumb.fontSize', '13'));
    return Number.isFinite(value) ? Math.min(24, Math.max(10, value)) : 13;
  });
  const [tabs, setTabs] = useState<EditorTab[]>(() => [newUntitledTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [terminalFolderRequest, setTerminalFolderRequest] = useState<{ path: string; sequence: number } | null>(null);
  const [terminalFolderError, setTerminalFolderError] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const editorRef = useRef<EditorHandle>(null);
  const sidebarDraggingRef = useRef(false);
  const panelDraggingRef = useRef(false);

  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
  const updateTabs = (update: (current: EditorTab[]) => EditorTab[]) => {
    const next = update(tabsRef.current);
    tabsRef.current = next;
    setTabs(next);
  };
  const activateTab = (id: string) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  };
  const theme = getTheme(themeId);

  useEffect(() => {
    try { localStorage.setItem('crumb.theme', themeId); } catch { /* Storage may be unavailable. */ }
  }, [themeId]);
  useEffect(() => {
    try { localStorage.setItem('crumb.fontSize', String(fontSize)); } catch { /* Storage may be unavailable. */ }
  }, [fontSize]);

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

  const handleOpenFile = async (path?: string) => {
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
        activateTab(existing.id);
        return;
      }
      const content = await readTextFile(selectedPath);
      const openedWhileReading = tabsRef.current.find(tab => tab.path === selectedPath);
      if (openedWhileReading) { activateTab(openedWhileReading.id); return; }
      const newTab: EditorTab = { id: crypto.randomUUID(), path: selectedPath, content, savedContent: content };
      updateTabs(current => [...current, newTab]);
      activateTab(newTab.id);
      setFileError(null);
    } catch (error) {
      console.error("Failed to open file:", error);
      setFileError(`Could not open file: ${String(error)}`);
    }
  };

  const handleEditorChange = (nextValue: string) => {
    const id = activeTabIdRef.current;
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

  const closeTab = (id: string) => {
    const current = tabsRef.current;
    const index = current.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const next = current.filter(tab => tab.id !== id);
    if (next.length === 0) next.push(newUntitledTab());
    updateTabs(() => next);
    if (activeTabIdRef.current === id) activateTab(next[Math.min(index, next.length - 1)].id);
    setPendingCloseId(null);
  };

  const addUntitledTab = () => {
    const tab = newUntitledTab();
    updateTabs(current => [...current, tab]);
    activateTab(tab.id);
    editorRef.current?.focus();
  };

  const requestCloseTab = (id: string) => {
    const tab = tabsRef.current.find(item => item.id === id);
    if (!tab) return;
    if (tab.content !== tab.savedContent) setPendingCloseId(id);
    else closeTab(id);
  };

  const handleExplorerRename = (oldPath: string, newPath: string, isDirectory: boolean) => {
    const matches = (path: string | null) => path === oldPath || (isDirectory && path != null && (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)));
    updateTabs(current => current.map(tab => matches(tab.path) ? { ...tab, path: `${newPath}${tab.path!.slice(oldPath.length)}` } : tab));
  };

  const handleExplorerDelete = (path: string, isDirectory: boolean) => {
    const matches = (filePath: string | null) => filePath === path || (isDirectory && filePath != null && (filePath.startsWith(`${path}/`) || filePath.startsWith(`${path}\\`)));
    // Keep changed documents as unsaved tabs so deleting a file cannot erase edits.
    updateTabs(current => current.map(tab => matches(tab.path) ? { ...tab, path: null, savedContent: tab.content === tab.savedContent ? tab.content : null } : tab));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setIsPaletteOpen(open => !open);
        return;
      }
      if (isPaletteOpen || pendingCloseId) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        e.stopPropagation();
        requestCloseTab(activeTabIdRef.current);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const current = tabsRef.current;
        const index = current.findIndex(tab => tab.id === activeTabIdRef.current);
        activateTab(current[(index + (e.shiftKey ? current.length - 1 : 1)) % current.length].id);
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
        if (isPanelOpen) editorRef.current?.focus();
        setIsPanelOpen((prev) => !prev);
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement?.closest(".xterm")) {
          editorRef.current?.focus();
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
  }, [isPaletteOpen, isPanelOpen, pendingCloseId]);

  const commands: PaletteCommand[] = [
    { id: 'theme', label: 'Preferences: Color Theme', detail: `Current: ${theme.name}`, run: () => {} },
    { id: 'terminal', label: isPanelOpen ? 'View: Hide Terminal' : 'View: Show Terminal', shortcut: 'Ctrl/Cmd J', run: () => setIsPanelOpen(value => !value) },
    { id: 'explorer', label: isSidebarOpen ? 'View: Hide File Tree' : 'View: Show File Tree', shortcut: 'Ctrl/Cmd B', run: () => setIsSidebarOpen(value => !value) },
    { id: 'font-up', label: 'Appearance: Increase Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.min(24, value + 1)) },
    { id: 'font-down', label: 'Appearance: Decrease Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.max(10, value - 1)) },
    { id: 'font-reset', label: 'Appearance: Reset Font Size', detail: '13px', run: () => setFontSize(13) },
    { id: 'open', label: 'File: Open File', shortcut: 'Ctrl/Cmd O', run: () => void handleOpenFile() },
    { id: 'new', label: 'File: New File', shortcut: 'Ctrl/Cmd N', run: addUntitledTab },
    { id: 'save', label: 'File: Save File', shortcut: 'Ctrl/Cmd S', run: () => void handleSaveFile() },
    { id: 'terminal-folder', label: 'File: Open Current Terminal Folder', run: () => void handleOpenTerminalFolder() },
  ];

  return (
    <div style={{ ...themeVariables(theme), colorScheme: theme.dark ? 'dark' : 'light', height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden", backgroundColor: "var(--editor)", color: "var(--text)" }}>
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
            activeFilePath={activeTab.path}
            onRename={handleExplorerRename}
            onDelete={handleExplorerDelete}
            onRootPathChange={setExplorerRootPath}
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
          <div className="editor-tabs" role="tablist" aria-label="Open files">
            {tabs.map(tab => (
              <div key={tab.id} className={`editor-tab ${tab.id === activeTabId ? 'active' : ''}`} role="tab" aria-selected={tab.id === activeTabId} title={tab.path ?? 'Untitled'}>
                <button className="editor-tab-label" onClick={() => activateTab(tab.id)}>{getFileNameFromPath(tab.path)}{tab.content !== tab.savedContent && <span className="editor-tab-dirty" title="Unsaved changes">●</span>}</button>
                <button className="editor-tab-close" aria-label={`Close ${getFileNameFromPath(tab.path)}`} onClick={() => requestCloseTab(tab.id)}>×</button>
              </div>
            ))}
          </div>
          {fileError && <div className="file-error" role="alert">{fileError}<button onClick={() => setFileError(null)} aria-label="Dismiss error">×</button></div>}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Editor ref={editorRef} tabId={activeTab.id} openTabIds={tabs.map(tab => tab.id)} doc={activeTab.content} theme={theme} fontSize={fontSize} onChange={handleEditorChange} />
          </div>
        </div>
      </div>

      {isPanelOpen && <div className="resize-handle horizontal" role="separator" aria-label="Resize bottom panel" aria-orientation="horizontal" aria-valuemin={120} aria-valuemax={Math.max(120, window.innerHeight - 160)} aria-valuenow={panelHeight} tabIndex={0}
        onPointerDown={event => { event.preventDefault(); panelDraggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => {
          if (!panelDraggingRef.current) return;
          const bottom = event.currentTarget.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
          const available = event.currentTarget.parentElement?.clientHeight ?? window.innerHeight;
          setPanelHeight(Math.max(120, Math.min(available - 160, bottom - event.clientY)));
        }}
        onPointerUp={event => { panelDraggingRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { panelDraggingRef.current = false; }}
        onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setPanelHeight(height => Math.max(120, Math.min(window.innerHeight - 160, height + (event.key === 'ArrowUp' ? 10 : -10)))); } }}
      />}
      {/* Bottom Panel */}
      <div
        style={{
          height: isPanelOpen ? `${panelHeight}px` : "0",
          maxHeight: 'calc(100vh - 160px)',
          backgroundColor: "var(--panel)",
          display: isPanelOpen ? "block" : "none"
        }}
      >
        <BottomPanel onClose={() => setIsPanelOpen(false)} onActiveSessionChange={setActiveTerminalSessionId} theme={theme} fontSize={fontSize} focusRequest={terminalFocusRequest} workingDirectory={explorerRootPath} />
      </div>
      {isPaletteOpen && (
        <CommandPalette
          commands={commands}
          themes={themes}
          currentThemeId={themeId}
          onThemeChange={setThemeId}
          onClose={() => setIsPaletteOpen(false)}
        />
      )}
      {pendingCloseId && (
        <div className="file-dialog-backdrop" role="presentation">
          <div className="file-dialog" role="dialog" aria-modal="true" aria-label="Unsaved changes">
            <strong>Save changes?</strong>
            <p>{getFileNameFromPath(tabs.find(tab => tab.id === pendingCloseId)?.path ?? null)} has unsaved changes.</p>
            {fileError && <p role="alert" style={{ color: 'var(--warning)' }}>{fileError}</p>}
            <div className="file-dialog-actions">
              <button onClick={() => setPendingCloseId(null)}>Cancel</button>
              <button onClick={() => closeTab(pendingCloseId)}>Don't Save</button>
              <button className="primary" onClick={async () => { if (await handleSaveFile(pendingCloseId)) closeTab(pendingCloseId); }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
