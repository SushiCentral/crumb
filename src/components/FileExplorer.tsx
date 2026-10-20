import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { create, exists, mkdir, readDir, remove, rename, watch, type DirEntry } from '@tauri-apps/plugin-fs';
import { FolderIcon, NewFileIcon, NewFolderIcon } from './Icons';
import { fileTreeIcon } from '../lib/file-icons';

function TreeIcon({ name, directory, expanded = false }: { name: string; directory: boolean; expanded?: boolean }) {
  return <img className="tree-file-icon" src={`/file-icons/${fileTreeIcon(name, directory, expanded)}.svg`} alt="" aria-hidden="true" draggable={false} />;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return <svg className={`tree-chevron-icon ${expanded ? 'expanded' : ''}`} width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type Action = 'new-file' | 'new-folder' | 'rename' | 'delete';
type Target = { path: string; name: string; isDirectory: boolean };
const joinPath = (parent: string, name: string) => `${parent}${parent.endsWith('/') || parent.endsWith('\\') ? '' : parent.includes('\\') ? '\\' : '/'}${name}`;
const parentPath = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
const sorted = (entries: DirEntry[]) => entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
// Keep useful configuration dotfiles visible, but avoid exposing Git's internal database.
const visibleEntries = (entries: DirEntry[]) => sorted(entries.filter(entry => !(entry.isDirectory && entry.name === '.git')));

type NodeProps = {
  entry: DirEntry; path: string; refresh: number; activeFilePath: string | null;
  onFileSelect: (path: string) => void; onMenu: (event: MouseEvent, target: Target) => void;
};

function TreeNode({ entry, path, refresh, activeFilePath, onFileSelect, onMenu }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const target = { path, name: entry.name, isDirectory: entry.isDirectory };
  useEffect(() => {
    if (!entry.isDirectory || !expanded) return;
    let cancelled = false;
    readDir(path).then(items => { if (!cancelled) { setChildren(visibleEntries(items)); setError(null); } })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [entry.isDirectory, expanded, path, refresh]);

  return <>
    <div className={`tree-row ${activeFilePath === path ? 'active' : ''}`} title={path} onContextMenu={event => onMenu(event, target)}>
      <button className="tree-entry" aria-expanded={entry.isDirectory ? expanded : undefined} aria-current={!entry.isDirectory && activeFilePath === path ? 'page' : undefined}
        onClick={() => entry.isDirectory ? setExpanded(value => !value) : onFileSelect(path)}>
        <span className="tree-chevron">{entry.isDirectory && <Chevron expanded={expanded} />}</span>
        <TreeIcon name={entry.name} directory={entry.isDirectory} expanded={expanded} />
        <span className="tree-name">{entry.name}</span>
      </button>
      <button className="tree-more" aria-label={`Actions for ${entry.name}`} title="File actions"
        onClick={event => { event.stopPropagation(); onMenu(event, target); }}>⋯</button>
    </div>
    {expanded && error && <div className="tree-error" role="alert">{error}</div>}
    {expanded && entry.isDirectory && <div className="tree-children">{children.map(child => <TreeNode key={child.name} entry={child} path={joinPath(path, child.name)} refresh={refresh}
      activeFilePath={activeFilePath} onFileSelect={onFileSelect} onMenu={onMenu} />)}</div>}
  </>;
}

interface Props {
  rootPath: string | null;
  onFileSelect: (path: string) => void;
  onFileOpenInSplit: (path: string) => void;
  activeFilePath: string | null;
  onRename: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  onDelete: (path: string, isDirectory: boolean) => void;
  onFolderOpened: (path: string) => void;
  onOpenTerminalFolder: () => void;
  terminalFolderError: string | null;
}

export default function FileExplorer({ rootPath, onFileSelect, onFileOpenInSplit, activeFilePath, onRename, onDelete, onFolderOpened, onOpenTerminalFolder, terminalFolderError }: Props) {
  const [rootFiles, setRootFiles] = useState<DirEntry[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ action: Action; target: Target } | null>(null);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; target: Target } | null>(null);
  const [isExplorerMenuOpen, setIsExplorerMenuOpen] = useState(false);
  const [isRootExpanded, setIsRootExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const explorerMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setRootFiles([]); setError(null); setIsRootExpanded(true); }, [rootPath]);
  useEffect(() => {
    if (!isExplorerMenuOpen) return;
    const dismiss = (event: PointerEvent) => { if (!explorerMenuRef.current?.contains(event.target as Node)) setIsExplorerMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setIsExplorerMenuOpen(false); explorerMenuRef.current?.querySelector<HTMLButtonElement>('.explorer-menu-toggle')?.focus(); } };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); };
  }, [isExplorerMenuOpen]);
  useEffect(() => {
    if (!rootPath) { setRootFiles([]); return; }
    let cancelled = false;
    readDir(rootPath).then(items => { if (!cancelled) { setRootFiles(visibleEntries(items)); setError(null); } })
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
    <div className="explorer-header"><strong>Explorer</strong><div className="explorer-actions">
      {rootTarget && <>
        <button title="New File" aria-label="New File" onClick={() => start('new-file', rootTarget)}><NewFileIcon /></button>
        <button title="New Folder" aria-label="New Folder" onClick={() => start('new-folder', rootTarget)}><NewFolderIcon /></button>
      </>}
      <div className="explorer-menu-anchor" ref={explorerMenuRef}>
        <button className="explorer-menu-toggle" title="Explorer actions" aria-label="Explorer actions" aria-expanded={isExplorerMenuOpen} aria-controls="explorer-actions-menu" onClick={() => setIsExplorerMenuOpen(value => !value)}>⋯</button>
        {isExplorerMenuOpen && <div id="explorer-actions-menu" className="explorer-dropdown">
          <button onClick={() => { setIsExplorerMenuOpen(false); void chooseFolder(); }}><FolderIcon />Open Folder…</button>
          <button onClick={() => { setIsExplorerMenuOpen(false); onOpenTerminalFolder(); }}><FolderIcon />Open Terminal Folder</button>
        </div>}
      </div>
    </div></div>
    {(terminalFolderError || error) && <div className="tree-error" role="alert">{terminalFolderError || error}</div>}
    <div className="explorer-tree">{rootPath ? <>
      <button className="explorer-root" title={rootPath} aria-expanded={isRootExpanded} onClick={() => setIsRootExpanded(value => !value)}><Chevron expanded={isRootExpanded} /><span>{rootTarget?.name}</span></button>
      {isRootExpanded && <div className="explorer-root-children">{rootFiles.map(entry => <TreeNode key={`${rootPath}-${entry.name}`} entry={entry} path={joinPath(rootPath, entry.name)} refresh={refresh}
        activeFilePath={activeFilePath} onFileSelect={onFileSelect} onMenu={showMenu} />)}
      {rootFiles.length === 0 && !error && <div className="explorer-empty">Empty directory</div>}</div>}
    </> : <div className="explorer-empty"><button className="explorer-open" onClick={chooseFolder}>Open Folder</button></div>}</div>
    {menu && <div className="tree-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={event => { event.preventDefault(); setMenu(null); }}>
      <div className="tree-menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}>
        {!menu.target.isDirectory && <button onClick={() => { onFileOpenInSplit(menu.target.path); setMenu(null); }}>Open in Split View</button>}
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
