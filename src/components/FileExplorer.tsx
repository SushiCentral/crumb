import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { create, exists, mkdir, readDir, remove, rename, watch, type DirEntry } from '@tauri-apps/plugin-fs';
import { FileIcon, FolderIcon, NewFileIcon, NewFolderIcon } from './Icons';

type Action = 'new-file' | 'new-folder' | 'rename' | 'delete';
type Target = { path: string; name: string; isDirectory: boolean };
const joinPath = (parent: string, name: string) => `${parent}${parent.endsWith('/') || parent.endsWith('\\') ? '' : parent.includes('\\') ? '\\' : '/'}${name}`;
const parentPath = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
const sorted = (entries: DirEntry[]) => entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

type NodeProps = {
  entry: DirEntry; path: string; level: number; refresh: number; activeFilePath: string | null;
  onFileSelect: (path: string) => void; onMenu: (event: MouseEvent, target: Target) => void;
};

function TreeNode({ entry, path, level, refresh, activeFilePath, onFileSelect, onMenu }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const target = { path, name: entry.name, isDirectory: entry.isDirectory };
  useEffect(() => {
    if (!entry.isDirectory || !expanded) return;
    let cancelled = false;
    readDir(path).then(items => { if (!cancelled) { setChildren(sorted(items)); setError(null); } })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [entry.isDirectory, expanded, path, refresh]);

  return <>
    <div className={`tree-row ${activeFilePath === path ? 'active' : ''}`} style={{ paddingLeft: level * 14 + 8 }} title={path}
      onClick={() => entry.isDirectory ? setExpanded(value => !value) : onFileSelect(path)}
      onContextMenu={event => onMenu(event, target)}>
      <span className="tree-chevron">{entry.isDirectory ? expanded ? '▾' : '▸' : ''}</span>
      {entry.isDirectory ? <FolderIcon className="tree-icon" /> : <FileIcon className="tree-icon" />}
      <span className="tree-name">{entry.name}</span>
      <button className="tree-more" aria-label={`Actions for ${entry.name}`} title="File actions"
        onClick={event => { event.stopPropagation(); onMenu(event, target); }}>⋯</button>
    </div>
    {expanded && error && <div className="tree-error" role="alert">{error}</div>}
    {expanded && children.map(child => <TreeNode key={child.name} entry={child} path={joinPath(path, child.name)} level={level + 1} refresh={refresh}
      activeFilePath={activeFilePath} onFileSelect={onFileSelect} onMenu={onMenu} />)}
  </>;
}

interface Props {
  onFileSelect: (path: string) => void;
  activeFilePath: string | null;
  onRename: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  onDelete: (path: string, isDirectory: boolean) => void;
  onRootPathChange: (path: string | null) => void;
  onFolderOpened: (path: string) => void;
  terminalFolderRequest: { path: string; sequence: number } | null;
  onOpenTerminalFolder: () => void;
  terminalFolderError: string | null;
}

export default function FileExplorer({ onFileSelect, activeFilePath, onRename, onDelete, onRootPathChange, onFolderOpened, terminalFolderRequest, onOpenTerminalFolder, terminalFolderError }: Props) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [rootFiles, setRootFiles] = useState<DirEntry[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ action: Action; target: Target } | null>(null);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; target: Target } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { onRootPathChange(rootPath); }, [rootPath, onRootPathChange]);

  useEffect(() => {
    if (terminalFolderRequest) { setRootPath(terminalFolderRequest.path); setRefresh(value => value + 1); }
  }, [terminalFolderRequest]);
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    readDir(rootPath).then(items => { if (!cancelled) { setRootFiles(sorted(items)); setError(null); } })
      .catch(reason => { if (!cancelled) setError(`Could not open folder: ${String(reason)}`); });
    return () => { cancelled = true; };
  }, [rootPath, refresh]);
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    let unwatch: (() => void) | undefined;
    watch(rootPath, () => setRefresh(value => value + 1), { recursive: true, delayMs: 150 })
      .then(stop => { if (cancelled) stop(); else unwatch = stop; })
      .catch(reason => { if (!cancelled) setError(`File watching unavailable: ${String(reason)}`); });
    return () => { cancelled = true; unwatch?.(); };
  }, [rootPath]);
  useEffect(() => { if (dialog) inputRef.current?.focus(); }, [dialog]);

  const chooseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string') {
        const items = await readDir(selected);
        setRootFiles(sorted(items));
        setRootPath(selected);
        setRefresh(value => value + 1);
        setError(null);
        onFolderOpened(selected);
      }
    } catch (reason) { setError(`Could not open folder: ${String(reason)}`); }
  };
  const start = (action: Action, target: Target) => {
    setMenu(null); setDialog({ action, target }); setName(action === 'rename' ? target.name : ''); setError(null);
  };
  const finish = async () => {
    if (!dialog) return;
    const { action, target } = dialog;
    const value = name.trim();
    if (action !== 'delete' && (!value || value === '.' || value === '..' || /[/\\]/.test(value))) {
      setError('Enter a name without slashes.'); return;
    }
    try {
      if (action === 'new-file' || action === 'new-folder') {
        const path = joinPath(target.path, value);
        if (await exists(path)) throw new Error('An item with that name already exists.');
        if (action === 'new-folder') await mkdir(path);
        else { const file = await create(path); await file.close(); onFileSelect(path); }
      } else if (action === 'rename') {
        const newPath = joinPath(parentPath(target.path), value);
        if (newPath !== target.path) {
          if (await exists(newPath)) throw new Error('An item with that name already exists.');
          await rename(target.path, newPath);
          onRename(target.path, newPath, target.isDirectory);
        }
      } else {
        await remove(target.path, { recursive: target.isDirectory });
        onDelete(target.path, target.isDirectory);
      }
      setDialog(null); setError(null); setRefresh(current => current + 1);
    } catch (reason) { setError(`${action.replace('-', ' ')} failed: ${String(reason)}`); }
  };

  const rootTarget = rootPath ? { path: rootPath, name: rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath, isDirectory: true } : null;
  const showMenu = (event: MouseEvent, target: Target) => {
    event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, target });
  };
  return <div className="file-explorer">
    <div className="explorer-header"><strong>EXPLORER</strong><div className="explorer-actions">
      {rootTarget && <>
        <button title="New File" aria-label="New File" onClick={() => start('new-file', rootTarget)}><NewFileIcon /></button>
        <button title="New Folder" aria-label="New Folder" onClick={() => start('new-folder', rootTarget)}><NewFolderIcon /></button>
      </>}
      <button title="Open current terminal's folder" onClick={onOpenTerminalFolder}>Terminal folder</button>
      <button title="Open Folder" aria-label="Open Folder" onClick={chooseFolder}><FolderIcon /></button>
    </div></div>
    {(terminalFolderError || error) && <div className="tree-error" role="alert">{terminalFolderError || error}</div>}
    <div className="explorer-tree">{rootPath ? <>
      <div className="explorer-root" title={rootPath}>{rootTarget?.name}</div>
      {rootFiles.map(entry => <TreeNode key={`${rootPath}-${entry.name}`} entry={entry} path={joinPath(rootPath, entry.name)} level={0} refresh={refresh}
        activeFilePath={activeFilePath} onFileSelect={onFileSelect} onMenu={showMenu} />)}
      {rootFiles.length === 0 && !error && <div className="explorer-empty">Empty directory</div>}
    </> : <div className="explorer-empty"><button className="explorer-open" onClick={chooseFolder}>Open Folder</button></div>}</div>
    {menu && <div className="tree-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={event => { event.preventDefault(); setMenu(null); }}>
      <div className="tree-menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}>
        {menu.target.isDirectory && <><button onClick={() => start('new-file', menu.target)}>New File</button><button onClick={() => start('new-folder', menu.target)}>New Folder</button></>}
        <button onClick={() => start('rename', menu.target)}>Rename</button><button onClick={() => start('delete', menu.target)}>Delete</button>
      </div>
    </div>}
    {dialog && <div className="file-dialog-backdrop" role="presentation"><form className="file-dialog" role="dialog" aria-modal="true" aria-label={dialog.action.replace('-', ' ')}
      onSubmit={event => { event.preventDefault(); void finish(); }}>
      <strong>{({ 'new-file': 'New File', 'new-folder': 'New Folder', rename: 'Rename', delete: 'Delete' })[dialog.action]}</strong>
      {dialog.action === 'delete' ? <p>Delete {dialog.target.name}{dialog.target.isDirectory ? ' and everything inside it' : ''}?</p> :
        <input ref={inputRef} value={name} onChange={event => setName(event.target.value)} aria-label="Name" placeholder="Name" />}
      {error && <p role="alert" style={{ color: 'var(--warning)' }}>{error}</p>}
      <div className="file-dialog-actions"><button type="button" onClick={() => { setDialog(null); setError(null); }}>Cancel</button>
        <button className="primary" type="submit">{dialog.action === 'delete' ? 'Delete' : 'Confirm'}</button></div>
    </form></div>}
  </div>;
}
