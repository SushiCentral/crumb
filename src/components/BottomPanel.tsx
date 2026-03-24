import { useState } from 'react';
import Terminal from './Terminal';
import OutputPanel from './OutputPanel';
import ProblemsPanel from './ProblemsPanel';

export default function BottomPanel() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'output' | 'problems'>('terminal');

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
      </div>
      <div className="tab-content">
        {/* We keep Terminal always mounted so it doesn't lose the PTY connection when switching tabs */}
        <div style={{ display: activeTab === 'terminal' ? 'block' : 'none', height: '100%', width: '100%' }}>
          <Terminal />
        </div>
        
        {activeTab === 'output' && <OutputPanel />}
        {activeTab === 'problems' && <ProblemsPanel />}
      </div>
    </div>
  );
}
