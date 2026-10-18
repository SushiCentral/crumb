import { FileIcon, FolderIcon, KeyboardIcon, NewFileIcon, SearchIcon, SettingsIcon, TerminalIcon } from './Icons';
import type { RecentProject } from '../lib/recent-projects';

interface WelcomeScreenProps {
  onNewFile: () => void;
  onOpenFile: (path?: string) => void;
  onOpenFolder: () => void;
  onOpenSearch: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onToggleTerminal: () => void;
  recentProjects: RecentProject[];
  onOpenProject: (path: string) => void;
  onClearRecentProjects: () => void;
}

export default function WelcomeScreen({
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onOpenSearch,
  onOpenPalette,
  onOpenSettings,
  onToggleTerminal,
  recentProjects,
  onOpenProject,
  onClearRecentProjects,
}: WelcomeScreenProps) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl+';

  return (
    <div className="welcome-screen">
      <div className="welcome-container">
        <header className="welcome-header">
          <h1 className="welcome-title">Crumb</h1>
          <p className="welcome-subtitle">Pick up where you left off.</p>
        </header>

        <div className="welcome-grid">
          <section className="welcome-card welcome-projects" aria-label="Recent projects">
            <div className="welcome-card-header">
              <h2 className="welcome-card-title">Recent projects</h2>
              {recentProjects.length > 0 && <button className="welcome-clear-btn" onClick={onClearRecentProjects} title="Clear recent projects">Clear</button>}
            </div>
            {recentProjects.length === 0 ? (
              <div className="welcome-empty-recent">
                <FolderIcon width={28} height={28} />
                <p>No recent projects yet</p>
                <small>Open a folder to start a project. It will appear here next time.</small>
                <button className="welcome-open-project" onClick={onOpenFolder}>Open Folder…</button>
              </div>
            ) : (
              <div className="welcome-recent-list">
                {recentProjects.map(item => (
                  <button key={item.path} className="welcome-recent-item" onClick={() => onOpenProject(item.path)} title={item.path}>
                    <FolderIcon width={20} height={20} className="recent-icon" />
                    <span className="recent-project-details"><span className="recent-name">{item.name}</span><span className="recent-path">{item.path}</span></span>
                  </button>
                ))}
              </div>
            )}
          </section>
          {/* Start Actions */}
          <section className="welcome-card">
            <h2 className="welcome-card-title">Start</h2>
            <div className="welcome-action-list">
              <button className="welcome-action-btn primary-action" onClick={onOpenFolder}>
                <span className="welcome-btn-icon"><FolderIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Open Folder…</span>
              </button>
              <button className="welcome-action-btn" onClick={onNewFile}>
                <span className="welcome-btn-icon"><NewFileIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">New File</span>
                <kbd className="welcome-shortcut">{modKey}N</kbd>
              </button>

              <button className="welcome-action-btn" onClick={() => onOpenFile()}>
                <span className="welcome-btn-icon"><FileIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Open File…</span>
                <kbd className="welcome-shortcut">{modKey}O</kbd>
              </button>

              <button className="welcome-action-btn" onClick={onOpenSearch}>
                <span className="welcome-btn-icon"><SearchIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Find in Files</span>
                <kbd className="welcome-shortcut">{modKey}Shift+F</kbd>
              </button>

              <button className="welcome-action-btn" onClick={onToggleTerminal}>
                <span className="welcome-btn-icon"><TerminalIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Integrated Terminal</span>
                <kbd className="welcome-shortcut">Ctrl+`</kbd>
              </button>

              <button className="welcome-action-btn" onClick={onOpenPalette}>
                <span className="welcome-btn-icon"><KeyboardIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Command Palette</span>
                <kbd className="welcome-shortcut">{modKey}Shift+P</kbd>
              </button>

              <button className="welcome-action-btn" onClick={onOpenSettings}>
                <span className="welcome-btn-icon"><SettingsIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Editor Settings</span>
              </button>
            </div>
          </section>

        </div>

        {/* Shortcuts Footer */}
        <footer className="welcome-footer">
          <div className="welcome-shortcuts-bar">
            <div className="shortcut-pill">
              <span className="shortcut-key">{modKey}P</span>
              <span className="shortcut-desc">Quick Open</span>
            </div>
            <div className="shortcut-pill">
              <span className="shortcut-key">{modKey}B</span>
              <span className="shortcut-desc">Toggle Explorer</span>
            </div>
            <div className="shortcut-pill">
              <span className="shortcut-key">{modKey}J</span>
              <span className="shortcut-desc">Toggle Panel</span>
            </div>
            <div className="shortcut-pill">
              <span className="shortcut-key">Ctrl+`</span>
              <span className="shortcut-desc">Focus Terminal</span>
            </div>
            <div className="shortcut-pill">
              <span className="shortcut-key">{modKey}S</span>
              <span className="shortcut-desc">Save File</span>
            </div>
            <div className="shortcut-pill">
              <span className="shortcut-key">{modKey}W</span>
              <span className="shortcut-desc">Close Tab</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
