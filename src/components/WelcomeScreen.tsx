import { FileIcon, FolderIcon, KeyboardIcon, NewFileIcon, SearchIcon, SettingsIcon, TerminalIcon } from './Icons';

interface RecentItem {
  path: string;
  name: string;
  lastOpened: number;
}

interface WelcomeScreenProps {
  onNewFile: () => void;
  onOpenFile: (path?: string) => void;
  onOpenFolder: () => void;
  onOpenSearch: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onToggleTerminal: () => void;
  recentFiles: RecentItem[];
  onClearRecentFiles: () => void;
}

export default function WelcomeScreen({
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onOpenSearch,
  onOpenPalette,
  onOpenSettings,
  onToggleTerminal,
  recentFiles,
  onClearRecentFiles,
}: WelcomeScreenProps) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl+';

  return (
    <div className="welcome-screen">
      <div className="welcome-container">
        <header className="welcome-header">
          <div className="welcome-badge">
            <FolderIcon width={28} height={28} />
          </div>
          <h1 className="welcome-title">Crumb</h1>
          <p className="welcome-subtitle">A fast, lightweight desktop code editor</p>
        </header>

        <div className="welcome-grid">
          {/* Start Actions */}
          <section className="welcome-card">
            <h2 className="welcome-card-title">Start</h2>
            <div className="welcome-action-list">
              <button className="welcome-action-btn primary-action" onClick={onNewFile}>
                <span className="welcome-btn-icon"><NewFileIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">New File</span>
                <kbd className="welcome-shortcut">{modKey}N</kbd>
              </button>

              <button className="welcome-action-btn" onClick={() => onOpenFile()}>
                <span className="welcome-btn-icon"><FileIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Open File…</span>
                <kbd className="welcome-shortcut">{modKey}O</kbd>
              </button>

              <button className="welcome-action-btn" onClick={onOpenFolder}>
                <span className="welcome-btn-icon"><FolderIcon width={18} height={18} /></span>
                <span className="welcome-btn-label">Open Folder / Project…</span>
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

          {/* Recent Files */}
          <section className="welcome-card">
            <div className="welcome-card-header">
              <h2 className="welcome-card-title">Recent Files</h2>
              {recentFiles.length > 0 && (
                <button className="welcome-clear-btn" onClick={onClearRecentFiles} title="Clear recent files">
                  Clear
                </button>
              )}
            </div>

            {recentFiles.length === 0 ? (
              <div className="welcome-empty-recent">
                <p>No recent files opened yet</p>
                <small>Opened files will appear here for fast access</small>
              </div>
            ) : (
              <div className="welcome-recent-list">
                {recentFiles.slice(0, 7).map((item) => (
                  <button
                    key={item.path}
                    className="welcome-recent-item"
                    onClick={() => onOpenFile(item.path)}
                    title={item.path}
                  >
                    <FileIcon width={15} height={15} className="recent-icon" />
                    <span className="recent-name">{item.name}</span>
                    <span className="recent-path">{item.path}</span>
                  </button>
                ))}
              </div>
            )}
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
