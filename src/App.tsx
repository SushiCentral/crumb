import { useState, useEffect, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import Editor from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import FileExplorer from "./components/FileExplorer";
import documentIcon from "./assets/document.svg";
import "./App.css";

const initialDoc = `// Welcome to Crumb\n\nfunction hello() {\n  console.log("Hello, world!");\n}\n`;

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
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState(initialDoc);
  const [lastSavedContent, setLastSavedContent] = useState(initialDoc);
  const openFilePathRef = useRef<string | null>(null);
  const editorContentRef = useRef(initialDoc);

  const hasUnsavedChanges = editorContent !== lastSavedContent;

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
      // Toggle bottom panel on Cmd+J or Ctrl+J
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setIsPanelOpen((prev) => !prev);
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
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeFileName = getFileNameFromPath(openFilePath);

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Activity Bar */}
        <div style={{
          width: "48px",
          minWidth: "48px",
          backgroundColor: "#181818",
          borderRight: "1px solid #333",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "8px",
          gap: "4px"
        }}>
          <button
            onClick={() => setIsSidebarOpen(prev => !prev)}
            title="Explorer (⌘B)"
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
              borderLeft: isSidebarOpen ? "2px solid #e5e5e5" : "2px solid transparent",
              opacity: isSidebarOpen ? 1 : 0.5,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.opacity = isSidebarOpen ? "1" : "0.5";
            }}
          >
            <img src={documentIcon} alt="Explorer" style={{ width: "20px", height: "20px" }} />
          </button>
        </div>

        {/* Sidebar / File Explorer */}
        <div style={{
          width: isSidebarOpen ? "250px" : "0px",
          minWidth: isSidebarOpen ? "250px" : "0px",
          borderRight: isSidebarOpen ? "1px solid #333" : "none",
          backgroundColor: "#1e1e1e",
          overflow: "hidden",
          transition: "width 0.15s ease, min-width 0.15s ease",
        }}>
          <FileExplorer onFileSelect={handleOpenFile} />
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
              borderBottom: "1px solid #333",
              backgroundColor: "#1f1f1f",
              color: "#b3b3b3",
              fontSize: "12px",
              fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeFileName}
            </span>
            {hasUnsavedChanges && <span style={{ color: "#e8c547" }}>Unsaved</span>}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Editor doc={editorContent} onChange={handleEditorChange} />
          </div>
        </div>
      </div>
      
      {/* Bottom Panel */}
      <div 
        style={{ 
          height: isPanelOpen ? "40%" : "0", 
          borderTop: isPanelOpen ? "1px solid #333" : "none", 
          backgroundColor: "#1e1e1e",
          transition: "height 0.2s ease",
          display: isPanelOpen ? "block" : "none" 
        }}
      >
        <BottomPanel onClose={() => setIsPanelOpen(false)} />
      </div>
    </div>
  );
}
