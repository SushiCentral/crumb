import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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

const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/>
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
  shell?: string;
}

interface TerminalGroup {
  id: string;
  terminals: TerminalInstance[];
  activeTerminalId: string;
}

export default function BottomPanel({ onClose }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<'terminal' | 'output' | 'problems'>('terminal');
  
  // Terminal Multiplexing State - Initialized lazily to avoid Date clock drifts in strict mode
  const [groups, setGroups] = useState<TerminalGroup[]>(() => {
    const termId = `term-${Date.now()}`;
    return [{ id: `group-${Date.now()}`, terminals: [{ id: termId }], activeTerminalId: termId }];
  });
  const [activeGroupId, setActiveGroupId] = useState<string>(groups[0].id);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const [availableShells, setAvailableShells] = useState<string[]>([]);
  const [isShellDropdownOpen, setIsShellDropdownOpen] = useState(false);

  useEffect(() => {
    invoke<string[]>('get_available_shells').then(setAvailableShells).catch(console.error);
  }, []);

  const handleNewTerminal = (shell?: string) => {
    const newTermId = `term-${Date.now()}`;
    const newGroupId = `group-${Date.now()}`;
    setGroups(prev => [...prev, {
      id: newGroupId,
      terminals: [{ id: newTermId, shell }],
      activeTerminalId: newTermId
    }]);
    setActiveGroupId(newGroupId);
  };

  const handleSplitTerminal = (shell?: string) => {
    const newTermId = `term-${Date.now()}`;
    setGroups(prev => prev.map(g => {
      if (g.id === activeGroupId) {
        return {
          ...g,
          terminals: [...g.terminals, { id: newTermId, shell }],
          activeTerminalId: newTermId
        };
      }
      return g;
    }));
  };

  const handleKillTerminal = () => {
    const groupIndex = groups.findIndex(g => g.id === activeGroupId);
    if (groupIndex === -1) return;
    const group = groups[groupIndex];
    const targetTermId = group.activeTerminalId;
    
    // Clean up title memory
    setTitles(prev => {
      const nextTitles = { ...prev };
      delete nextTitles[targetTermId];
      return nextTitles;
    });

    let nextGroups = [...groups];
    let nextActiveGroupId = activeGroupId;

    const targetIdx = group.terminals.findIndex(t => t.id === targetTermId);
    const nextTerms = group.terminals.filter(t => t.id !== targetTermId);

    if (nextTerms.length === 0) {
      // Entire group killed
      nextGroups.splice(groupIndex, 1);
      if (nextGroups.length === 0) {
        const fallbackTermId = `term-${Date.now()}`;
        const fallbackGroupId = `group-${Date.now()}`;
        nextGroups = [{ id: fallbackGroupId, terminals: [{ id: fallbackTermId }], activeTerminalId: fallbackTermId }];
        nextActiveGroupId = fallbackGroupId;
        if (onClose) onClose(); // Gracefully collapse UI since everything died
      } else {
        nextActiveGroupId = nextGroups[Math.max(0, groupIndex - 1)].id;
      }
    } else {
      // Switch active terminal within surviving group horizontally seamlessly
      const nextActiveIdx = Math.min(targetIdx, nextTerms.length - 1);
      nextGroups[groupIndex] = {
        ...group,
        terminals: nextTerms,
        activeTerminalId: nextTerms[nextActiveIdx].id
      };
    }

    setGroups(nextGroups);
    setActiveGroupId(nextActiveGroupId);
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
            <div className="split-action-btn">
              <button className="icon-btn" title="New Terminal" onClick={() => handleNewTerminal()}>
                <PlusIcon />
              </button>
              <button 
                className="icon-btn" 
                title="Select Default Profile"
                style={{ paddingLeft: '2px', paddingRight: '4px' }}
                onClick={() => setIsShellDropdownOpen(!isShellDropdownOpen)}
              >
                <ChevronDownIcon />
              </button>

              {isShellDropdownOpen && (
                <div className="shell-dropdown-menu">
                  <div className="shell-dropdown-header">Select Profile</div>
                  {availableShells.map(sh => {
                    const name = sh.split('/').pop();
                    return (
                      <div key={sh} className="shell-dropdown-item" onClick={() => {
                        handleNewTerminal(sh);
                        setIsShellDropdownOpen(false);
                      }}>
                        <div style={{ width: '16px', height: '16px', marginRight: '8px', opacity: 0.8 }}><TerminalIcon /></div>
                        {name}
                        <span className="shell-dropdown-path">{sh}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button className="icon-btn" title="Split Terminal" onClick={() => handleSplitTerminal()}>
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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', position: 'relative', minWidth: 0 }}>
            {groups.map(group => (
              <div 
                key={group.id} 
                style={{ 
                  display: activeGroupId === group.id ? 'flex' : 'none', 
                  flex: 1, 
                  flexDirection: 'row', 
                  width: '100%', 
                  height: '100%',
                  minWidth: 0
                }}
              >
                {group.terminals.map((term, index) => (
                  <div
                    key={term.id}
                    style={{
                      flex: 1,
                      borderRight: index < group.terminals.length - 1 ? '1px solid #333' : 'none',
                      position: 'relative',
                      minWidth: 0
                    }}
                  >
                    <Terminal
                      id={term.id}
                      shell={term.shell}
                      isActive={activeGroupId === group.id && group.activeTerminalId === term.id}
                      onClick={() => {
                        setActiveGroupId(group.id);
                        setGroups(prev => prev.map(g => g.id === group.id ? { ...g, activeTerminalId: term.id } : g));
                      }}
                      onTitleChange={(title) => setTitles(prev => ({...prev, [term.id]: title}))}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Sidebar Terminal Menu */}
          {groups.length > 0 && (
            <div className="terminal-sidebar">
              {groups.flatMap((group) => {
                if (group.terminals.length === 1) {
                  const term = group.terminals[0];
                  const isTermActive = activeGroupId === group.id;
                  const defaultLabel = term.shell ? term.shell.split('/').pop() : 'zsh';
                  return (
                    <div 
                      key={term.id}
                      className={`sidebar-item ${isTermActive ? 'active' : ''}`}
                      onClick={() => setActiveGroupId(group.id)}
                    >
                      <div className="sidebar-item-icon">
                        <TerminalIcon />
                      </div>
                      <span className="sidebar-item-text">{titles[term.id] || defaultLabel}</span>
                    </div>
                  );
                } else {
                  return group.terminals.map((term, index) => {
                    const isTermActive = activeGroupId === group.id && group.activeTerminalId === term.id;
                    const isFirst = index === 0;
                    const isLast = index === group.terminals.length - 1;
                    const elbow = isFirst ? '┌' : (isLast ? '└' : '├');
                    const defaultLabel = term.shell ? term.shell.split('/').pop() : 'zsh';

                    return (
                      <div 
                        key={term.id}
                        className={`sidebar-item split-item ${isTermActive ? 'active' : ''}`}
                        onClick={() => {
                          setActiveGroupId(group.id);
                          setGroups(prev => prev.map(g => g.id === group.id ? { ...g, activeTerminalId: term.id } : g));
                        }}
                      >
                        <span className="tree-elbow">{elbow}</span>
                        <div className="sidebar-item-icon">
                          <TerminalIcon />
                        </div>
                        <span className="sidebar-item-text">{titles[term.id] || defaultLabel}</span>
                      </div>
                    );
                  });
                }
              })}
            </div>
          )}
        </div>
        
        {activeTab === 'output' && <OutputPanel />}
        {activeTab === 'problems' && <ProblemsPanel />}
      </div>
    </div>
  );
}
