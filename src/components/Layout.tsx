import { useCallback, useEffect, useMemo, useState } from 'react';
import { Editor } from './Editor';
import { Terminal } from './Terminal';
import { FileTree } from './FileTree';
import { writeFile } from '../lib/ipc';

export function Layout() {
  const [fileContent, setFileContent] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);

  const handleFileSelect = useCallback((path: string, content: string) => {
    setFilePath(path);
    setFileContent(content);
    setSaved(true);
  }, []);

  const handleChange = useCallback((value: string) => {
    setFileContent(value);
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!filePath) return;
    await writeFile(filePath, fileContent);
    setSaved(true);
  }, [fileContent, filePath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  const currentFileName = useMemo(() => {
    if (!filePath) return null;
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
  }, [filePath]);

  const currentDirectory = useMemo(() => {
    if (!filePath) return '.';
    const parts = filePath.split(/[\\/]/);
    parts.pop();
    return parts.join('/') || '.';
  }, [filePath]);

  return (
    <div className="app-shell">
      <div className="app-shell__backdrop" />

      <header className="titlebar">
        <div className="titlebar__brand">
          <span className="titlebar__brand-mark" />
          <span className="titlebar__brand-name">crumb</span>
          <span className="titlebar__version">v0.1</span>
        </div>

        <div className="titlebar__path" title={filePath ?? 'No file open'}>
          {filePath ?? 'No file open'}
          {!saved && <span className="dirty-indicator">unsaved</span>}
        </div>

        <button
          type="button"
          className="save-button"
          onClick={() => void handleSave()}
          disabled={!filePath || saved}
        >
          Save
        </button>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <FileTree onFileSelect={handleFileSelect} activePath={filePath} />
        </aside>

        <section className="main-pane">
          <div className="editor-pane">
            {filePath ? (
              <Editor
                content={fileContent}
                filePath={filePath}
                saved={saved}
                onChange={handleChange}
              />
            ) : (
              <div className="empty-state">
                <p className="empty-state__title">Open a file to get started</p>
                <p className="empty-state__subtitle">
                  Explore your workspace on the left, then click any file.
                </p>
              </div>
            )}
          </div>

          <div className="pane-divider" />

          <div className="terminal-pane">
            <Terminal cwd={currentDirectory} />
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <span>{currentFileName ?? 'No file selected'}</span>
        <span>{saved ? 'All changes saved' : 'Unsaved changes'}</span>
      </footer>
    </div>
  );
}
