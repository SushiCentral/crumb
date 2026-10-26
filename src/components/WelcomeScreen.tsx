import { FolderIcon, KeyboardIcon, SearchIcon, SettingsIcon, TerminalIcon } from './Icons';
import type { RecentProject } from '../lib/recent-projects';
import { shortcutLabel } from '../lib/platform';

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

function projectPath(path: string) {
  return path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~')
    .replace(/^[a-z]:\\Users\\[^\\]+(?=\\|$)/i, '~');
}

function lastOpenedLabel(date: Date) {
  if (!Number.isFinite(date.getTime())) return 'Recently';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export default function WelcomeScreen({
  onNewFile, onOpenFile, onOpenFolder, onOpenSearch, onOpenPalette,
  onOpenSettings, onToggleTerminal, recentProjects, onOpenProject, onClearRecentProjects,
}: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-container">
        <header className="welcome-header">
          <div className="welcome-intro">
            <h1 className="welcome-title">Crumb</h1>
            <p className="welcome-subtitle">{recentProjects.length ? 'Pick up where you left off.' : 'A fresh start for your next project.'}</p>
          </div>
          <div className="welcome-start" aria-label="Start working">
            <button className="welcome-open-folder" onClick={onOpenFolder}>
              <FolderIcon width={18} height={18} />Open folder…
            </button>
            <div className="welcome-file-actions">
              <button onClick={onNewFile} title={`New file (${shortcutLabel('N')})`}>New file</button>
              <button onClick={() => onOpenFile()} title={`Open file (${shortcutLabel('O')})`}>Open file…</button>
            </div>
          </div>
        </header>

        <div className="welcome-grid">
          <section className="welcome-projects" aria-label="Recent projects">
            <div className="welcome-section-header">
              <h2>Recent projects</h2>
              {recentProjects.length > 0 && <button className="welcome-clear-btn" onClick={onClearRecentProjects} title="Clear recent project history">Clear</button>}
            </div>
            {recentProjects.length === 0 ? (
              <div className="welcome-empty-recent">
                <p>No recent projects yet</p>
                <span>Open a folder to get started. Your recent projects will appear here next time.</span>
              </div>
            ) : (
              <div className="welcome-recent-list">
                {recentProjects.map(item => {
                  const openedAt = new Date(item.lastOpened);
                  const validDate = Number.isFinite(openedAt.getTime());
                  return <button key={item.path} className="welcome-recent-item" onClick={() => onOpenProject(item.path)} title={item.path}>
                    <span className="recent-project-initial" aria-hidden="true">{Array.from(item.name.trim())[0]?.toLocaleUpperCase() || <FolderIcon />}</span>
                    <span className="recent-project-details"><span className="recent-name">{item.name}</span><span className="recent-path">{projectPath(item.path)}</span></span>
                    <time className="recent-opened" dateTime={validDate ? openedAt.toISOString() : undefined} title={validDate ? openedAt.toLocaleString() : undefined}>{lastOpenedLabel(openedAt)}</time>
                  </button>;
                })}
              </div>
            )}
          </section>
          <section className="welcome-tools" aria-label="Find your way">
            <div className="welcome-section-header"><h2>Find your way</h2></div>
            <div className="welcome-action-list">
              <button className="welcome-action-btn" onClick={onToggleTerminal}>
                <TerminalIcon /><span>Terminal</span><kbd>Ctrl+`</kbd>
              </button>
              <button className="welcome-action-btn" onClick={onOpenPalette}>
                <KeyboardIcon /><span>Command palette</span><kbd>{shortcutLabel('Shift+P')}</kbd>
              </button>
              <button className="welcome-action-btn" onClick={onOpenSearch}>
                <SearchIcon /><span>Find in files</span><kbd>{shortcutLabel('Shift+F')}</kbd>
              </button>
              <button className="welcome-action-btn" onClick={onOpenSettings}>
                <SettingsIcon /><span>Editor settings</span><kbd>{shortcutLabel(',')}</kbd>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
