import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import Editor from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import FileExplorer from "./components/FileExplorer";
import "./App.css";

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
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
      // Toggle on Cmd+J or Ctrl+J
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsPanelOpen(prev => !prev);
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
        {/* Sidebar */}
        <div style={{ width: "250px", minWidth: "250px", borderRight: "1px solid #333", backgroundColor: "#1e1e1e", overflow: "hidden" }}>
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
