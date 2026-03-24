import Editor from "./components/Editor";
import BottomPanel from "./components/BottomPanel";
import "./App.css";

export default function App() {
  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <Editor />
      </div>
      <div style={{ height: "40%", borderTop: "1px solid #333", backgroundColor: "#1e1e1e" }}>
        <BottomPanel />
      </div>
    </div>
  );
}