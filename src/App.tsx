import { useState, useEffect, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import Editor, { type EditorHandle } from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import FileExplorer from "./components/FileExplorer";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette";
import { getTheme, themes, themeVariables } from "./lib/themes";
import documentIcon from "./assets/document.svg";
import "./App.css";

const initialDoc = `// Welcome to Crumb\n\nfunction hello() {\n  console.log("Hello, world!");\n}\n`;
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
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [themeId, setThemeId] = useState(() => getTheme(readPreference('crumb.theme', 'crumb')).id);
  const [fontSize, setFontSize] = useState(() => {
    const value = Number(readPreference('crumb.fontSize', '13'));
    return Number.isFinite(value) ? Math.min(24, Math.max(10, value)) : 13;
  });
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState(initialDoc);
  const [lastSavedContent, setLastSavedContent] = useState(initialDoc);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [terminalFolderRequest, setTerminalFolderRequest] = useState<{ path: string; sequence: number } | null>(null);
  const [terminalFolderError, setTerminalFolderError] = useState<string | null>(null);
  const openFilePathRef = useRef<string | null>(null);
  const editorContentRef = useRef(initialDoc);
  const editorRef = useRef<EditorHandle>(null);

  const hasUnsavedChanges = editorContent !== lastSavedContent;
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

      const content = await readTextFile(selectedPath);
      openFilePathRef.current = selectedPath;
      editorContentRef.current = content;
      setOpenFilePath(selectedPath);
      setEditorContent(content);
      setLastSavedContent(content);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  const handleEditorChange = (nextValue: string) => {
    editorContentRef.current = nextValue;
    setEditorContent(nextValue);
  };

  const handleSaveFile = async () => {
    try {
      let targetPath = openFilePathRef.current;

      if (!targetPath) {
        const selected = await save({
          title: "Save File",
        });

        if (typeof selected !== "string") {
          return;
        }

        targetPath = selected;
      }

      const contentToSave = editorContentRef.current;
      await writeTextFile(targetPath, contentToSave);
      openFilePathRef.current = targetPath;
      setOpenFilePath(targetPath);
      setLastSavedContent(contentToSave);
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setIsPaletteOpen(open => !open);
        return;
      }
      if (isPaletteOpen) return;
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
  }, [isPaletteOpen, isPanelOpen]);

  const activeFileName = getFileNameFromPath(openFilePath);
  const commands: PaletteCommand[] = [
    { id: 'theme', label: 'Preferences: Color Theme', detail: `Current: ${theme.name}`, run: () => {} },
    { id: 'terminal', label: isPanelOpen ? 'View: Hide Terminal' : 'View: Show Terminal', shortcut: 'Ctrl/Cmd J', run: () => setIsPanelOpen(value => !value) },
    { id: 'explorer', label: isSidebarOpen ? 'View: Hide File Tree' : 'View: Show File Tree', shortcut: 'Ctrl/Cmd B', run: () => setIsSidebarOpen(value => !value) },
    { id: 'font-up', label: 'Appearance: Increase Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.min(24, value + 1)) },
    { id: 'font-down', label: 'Appearance: Decrease Font Size', detail: `Currently ${fontSize}px`, run: () => setFontSize(value => Math.max(10, value - 1)) },
    { id: 'font-reset', label: 'Appearance: Reset Font Size', detail: '13px', run: () => setFontSize(13) },
    { id: 'open', label: 'File: Open File', shortcut: 'Ctrl/Cmd O', run: () => void handleOpenFile() },
    { id: 'save', label: 'File: Save File', shortcut: 'Ctrl/Cmd S', run: () => void handleSaveFile() },
    { id: 'terminal-folder', label: 'File: Open Current Terminal Folder', run: () => void handleOpenTerminalFolder() },
  ];

  return (
    <div style={{ ...themeVariables(theme), colorScheme: theme.dark ? 'dark' : 'light', height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden", backgroundColor: "var(--editor)", color: "var(--text)" }}>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
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
            <span className="themed-icon" aria-hidden="true" style={{ width: '20px', height: '20px', maskImage: `url(${documentIcon})`, WebkitMaskImage: `url(${documentIcon})` }} />
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
          width: isSidebarOpen ? "250px" : "0px",
          minWidth: isSidebarOpen ? "250px" : "0px",
          borderRight: isSidebarOpen ? "1px solid var(--border)" : "none",
          backgroundColor: "var(--sidebar)",
          overflow: "hidden",
          transition: "width 0.15s ease, min-width 0.15s ease",
        }}>
          <FileExplorer
            onFileSelect={handleOpenFile}
            terminalFolderRequest={terminalFolderRequest}
            onOpenTerminalFolder={handleOpenTerminalFolder}
            terminalFolderError={terminalFolderError}
          />
        </div>

        {/* Main Editor */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div
            style={{
              height: "34px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 12px",
              borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--panel-header)",
              color: "var(--muted)",
              fontSize: "12px",
              fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeFileName}
            </span>
            {hasUnsavedChanges && <span style={{ color: "var(--warning)" }}>Unsaved</span>}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Editor ref={editorRef} doc={editorContent} theme={theme} fontSize={fontSize} onChange={handleEditorChange} />
          </div>
        </div>
      </div>

      {/* Bottom Panel */}
      <div
        style={{
          height: isPanelOpen ? "40%" : "0",
          borderTop: isPanelOpen ? "1px solid var(--border)" : "none",
          backgroundColor: "var(--panel)",
          transition: "height 0.2s ease",
          display: isPanelOpen ? "block" : "none"
        }}
      >
        <BottomPanel onClose={() => setIsPanelOpen(false)} onActiveSessionChange={setActiveTerminalSessionId} theme={theme} fontSize={fontSize} focusRequest={terminalFocusRequest} />
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
    </div>
  );
}
