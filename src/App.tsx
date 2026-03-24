import { useState, useEffect } from "react";
import Editor from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import "./App.css";

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle on Cmd+J or Ctrl+J
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsPanelOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <Editor />
      </div>
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