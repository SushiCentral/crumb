import { useState, useRef } from 'react';
import Terminal from './Terminal';
import OutputPanel from './OutputPanel';
import ProblemsPanel from './ProblemsPanel';

// --- SVG Icons for Terminal Actions (VS Code Codicons) ---
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
  </svg>
);

const SplitIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M2.5 3A1.5 1.5 0 0 0 1 4.5v7A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13.5 3h-11zM2 4.5C2 4.22 2.22 4 2.5 4h4.5v8H2.5A.5.5 0 0 1 2 11.5v-7zm6 7.5V4h5.5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H8z"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M11 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1zM6 2v1h4V2H6zm5 2H5v9h6V4z"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M6 6h1v5H6zM9 6h1v5H9z"/>
  </svg>
);

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8.7 8l3.65-3.65-.7-.7L8 7.3 4.35 3.65l-.7.7L7.3 8l-3.65 3.65.7.7L8 8.7l3.65 3.65.7-.7L8.7 8z"/>
  </svg>
);

const TerminalIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M14 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm0 1v8H2V4h12z"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M3.707 5.707L1.414 8l2.293 2.293.707-.707L2.828 8l1.586-1.586-.707-.707zM7 10h4v1H7v-1z"/>
  </svg>
);

interface BottomPanelProps {
  onClose?: () => void;
}

interface TerminalInstance {
  id: string;
}

export default function BottomPanel({ onClose }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<'terminal' | 'output' | 'problems'>('terminal');
  
  // Terminal Multiplexing State - Initialized lazily to avoid Date clock drifts in strict mode
  const [terminals, setTerminals] = useState<TerminalInstance[]>(() => [{ id: `term-${Date.now()}` }]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>(terminals[0].id);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const handleNewTerminal = () => {
    const newId = `term-${Date.now()}`;
    setTerminals(prev => [...prev, { id: newId }]);
    setActiveTerminalId(newId);
  };

  const handleSplitTerminal = () => {
    // For now, mapping a split acts as a new terminal in the sidebar group.
    handleNewTerminal();
  };

  const handleKillTerminal = () => {
    // Note: the backend Rust kill_pty is robustly handled by Terminal.tsx's unmount cleanup hook.
    const nextList = terminals.filter(t => t.id !== activeTerminalId);
    
    // Clean up title memory
    setTitles(prev => {
      const nextTitles = { ...prev };
      delete nextTitles[activeTerminalId];
      return nextTitles;
    });

    if (nextList.length > 0) {
      setTerminals(nextList);
      setActiveTerminalId(nextList[nextList.length - 1].id);
    } else {
      // Gracefully close the entire bottom panel if the final terminal is killed
      if (onClose) onClose();
      
      // Auto-restart a fresh standby shell while hidden, ensuring the toggle shortcut has a terminal ready
      const newId = `term-${Date.now()}`;
      setTerminals([{ id: newId }]);
      setActiveTerminalId(newId);
    }
  };

  return (
    <div className="bottom-panel-container">
      <div className="tab-bar">
        <button 
          className={`tab-btn ${activeTab === 'problems' ? 'active' : ''}`}
          onClick={() => setActiveTab('problems')}
        >
          Problems
        </button>
        <button 
          className={`tab-btn ${activeTab === 'output' ? 'active' : ''}`}
          onClick={() => setActiveTab('output')}
        >
          Output
        </button>
        <button 
          className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
          onClick={() => setActiveTab('terminal')}
        >
          Terminal
        </button>

        <div style={{ flex: 1 }} />
        
        {/* Terminal Actions (Only visible when Terminal is active) */}
        {activeTab === 'terminal' && (
          <div className="actions-group">
            <button className="icon-btn" title="New Terminal" onClick={handleNewTerminal}>
              <PlusIcon />
            </button>
            <button className="icon-btn" title="Split Terminal" onClick={handleSplitTerminal}>
              <SplitIcon />
            </button>
            <button className="icon-btn" title="Kill Terminal" onClick={handleKillTerminal}>
              <TrashIcon />
            </button>
            <button className="icon-btn" title="More Actions...">
              <MoreIcon />
            </button>
            <div className="divider" />
          </div>
        )}

        {/* Global Close Button UI */}
        <button 
          className="icon-btn" 
          onClick={onClose}
          title="Close Panel (⌘J / Ctrl+J)"
          style={{ marginLeft: activeTab === 'terminal' ? '0' : '8px' }}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="tab-content">
        {/* Responsive Terminal Layout matching VS Code Tabs Map */}
        <div style={{ display: activeTab === 'terminal' ? 'flex' : 'none', height: '100%', width: '100%' }}>
          
          {/* Main Terminal View Container */}
          <div style={{ flex: 1, position: 'relative' }}>
            {terminals.map((term) => (
              <div 
                key={term.id} 
                style={{ 
                  display: activeTerminalId === term.id ? 'block' : 'none',
                  width: '100%',
                  height: '100%'
                }}
              >
                <Terminal 
                  id={term.id} 
                  isActive={activeTerminalId === term.id}
                  onClick={() => setActiveTerminalId(term.id)}
                  onTitleChange={(title) => setTitles(prev => ({...prev, [term.id]: title}))}
                />
              </div>
            ))}
          </div>

          {/* Sidebar Terminal Menu */}
          {terminals.length > 0 && (
            <div className="terminal-sidebar">
              {terminals.map((term) => (
                <div 
                  key={term.id}
                  className={`sidebar-item ${activeTerminalId === term.id ? 'active' : ''}`}
                  onClick={() => setActiveTerminalId(term.id)}
                >
                  <div className="sidebar-item-icon">
                    <TerminalIcon />
                  </div>
                  <span>{titles[term.id] || 'zsh'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {activeTab === 'output' && <OutputPanel />}
        {activeTab === 'problems' && <ProblemsPanel />}
      </div>
    </div>
  );
}
