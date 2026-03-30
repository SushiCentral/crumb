import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import Editor from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import FileExplorer from "./components/FileExplorer";
import documentIcon from "./assets/document.svg";
import "./App.css";

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editorContent, setEditorContent] = useState(
    `// Welcome to Horizon\n\nfunction hello() {\n  console.log("Hello, world!");\n}\n`
  );

  const handleOpenFile = async (path?: string | any) => {
    try {
      let selectedPath = typeof path === 'string' ? path : null;
      if (!selectedPath) {
        const selected = await open({
          multiple: false,
          directory: false,
        });

        if (!selected || Array.isArray(selected)) {
          return;
        }
        selectedPath = selected;
      }

      const content = await readTextFile(selectedPath);
      setEditorContent(content);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle bottom panel on Cmd+J or Ctrl+J
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsPanelOpen(prev => !prev);
        return;
      }

      // Toggle sidebar on Cmd+B or Ctrl+B
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarOpen(prev => !prev);
        return;
      }

      // Open file on Cmd+O or Ctrl+O
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleOpenFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.opacity = isSidebarOpen ? '1' : '0.5';
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
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Editor doc={editorContent} />
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
