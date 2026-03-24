import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Terminal from './Terminal';
import OutputPanel from './OutputPanel';
import ProblemsPanel from './ProblemsPanel';

// --- SVG Icons for Terminal Actions ---
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SplitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <path d="M8 3v10" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M5 5v5M8 5v5M11 5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M3 4h10M6 4V2.5C6 2.22 6.22 2 6.5 2h3c.28 0 .5.22 .5.5V4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    <path d="M4 4h8v8.5c0 .83-.67 1.5-1.5 1.5h-5A1.5 1.5 0 0 1 4 12.5V4z" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 4l3 3-3 3v1.5l4.5-4.5L4 2.5V4zm5 6h4v1.5H9V10z" />
    <path d="M1 1h14v14H1V1zm1 1v12h12V2H2z" />
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
    invoke('kill_pty', { id: activeTerminalId }).catch(console.error);
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
      // Auto-spawn a new terminal if all are killed
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
