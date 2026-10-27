import { shortcutLabel } from '../lib/platform';
import { createPointerMoveGuard } from '../lib/pointer-selection';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { readDir } from '@tauri-apps/plugin-fs';

export interface QuickOpenHandle { focus: () => void }
export type QuickOpenDismissReason = 'cancel' | 'outside';
interface Props {
  rootPath: string | null;
  openPaths: string[];
  onOpenFile: (path: string) => void;
  /** Remember the surface that owned focus when this field was entered. */
  onActivate?: () => void;
  /** Reported when the field closes without opening a file. */
  onDismiss?: (reason: QuickOpenDismissReason) => void;
  embedded?: boolean;
  onBack?: () => void;
}

const ignoredDirectories = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next', '.venv', 'vendor']);
const joinPath = (parent: string, name: string) => `${parent}${parent.endsWith('/') || parent.endsWith('\\') ? '' : parent.includes('\\') ? '\\' : '/'}${name}`;
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

const QuickOpen = forwardRef<QuickOpenHandle, Props>(function QuickOpen({ rootPath, openPaths, onOpenFile, onActivate, onDismiss, embedded = false, onBack }, ref) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [indexed, setIndexed] = useState<string[]>([]);
  const [indexedRoot, setIndexedRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerMoveGuardRef = useRef(createPointerMoveGuard());

  useImperativeHandle(ref, () => ({ focus: () => { setIndexedRoot(null); setQuery(''); inputRef.current?.focus(); setOpen(true); } }), []);

  useEffect(() => {
    if (!open || !rootPath || indexedRoot === rootPath) return;
    let cancelled = false;
    setLoading(true);
    setIndexed([]);
    const index = async () => {
      const directories = [rootPath];
      const files: string[] = [];
      let scanned = 0;
      while (!cancelled && directories.length && scanned < 800 && files.length < 5000) {
        const batch = directories.splice(0, 8);
        scanned += batch.length;
        const results = await Promise.all(batch.map(path => readDir(path).then(entries => ({ path, entries })).catch(() => null)));
        for (const result of results) {
          if (!result) continue;
          for (const entry of result.entries) {
            const path = joinPath(result.path, entry.name);
            if (entry.isDirectory && !ignoredDirectories.has(entry.name)) directories.push(path);
            else if (!entry.isDirectory) files.push(path);
          }
        }
      }
      if (!cancelled) { setIndexed(files); setIndexedRoot(rootPath); setLoading(false); }
    };
    void index();
    return () => { cancelled = true; };
  }, [open, rootPath, indexedRoot]);

  useEffect(() => {
    if (!open || embedded) return;
    const dismiss = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      // An outside click belongs to the clicked control; release focus rather
      // than pulling it back to the editor when the field hides.
      setOpen(false);
      inputRef.current?.blur();
      onDismiss?.('outside');
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onDismiss, embedded]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const paths = [...new Set([...openPaths, ...(indexedRoot === rootPath ? indexed : [])])];
    if (!needle) return paths.slice(0, 10);
    return paths.filter(path => path.toLowerCase().includes(needle))
      .sort((a, b) => Number(fileName(b).toLowerCase().startsWith(needle)) - Number(fileName(a).toLowerCase().startsWith(needle)) || a.length - b.length)
      .slice(0, 12);
  }, [query, openPaths, indexed, indexedRoot, rootPath]);

  const choose = (path: string) => {
    onOpenFile(path);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return <div className={`quick-open${embedded ? ' quick-open-embedded' : ''}`} ref={containerRef} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    {embedded && <button className="palette-back" onClick={onBack} aria-label="Back to commands">‹</button>}
    {!embedded && <svg className="quick-open-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 5 5" /></svg>}
    <input ref={inputRef} value={query} aria-label="Search files" role="combobox" aria-expanded={embedded || open} aria-controls="quick-open-results"
      placeholder={rootPath ? 'Search files by name' : 'Search open files'}
      onFocus={() => { onActivate?.(); setIndexedRoot(null); setOpen(true); }}
      onChange={event => { setQuery(event.target.value); setSelected(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          if (embedded) onBack?.();
          else { inputRef.current?.blur(); onDismiss?.('cancel'); }
        }
        if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(index + 1, matches.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(0, index - 1)); }
        if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); choose(matches[selected]); }
      }} />
    {!embedded && <kbd>{shortcutLabel('P')}</kbd>}
    {(embedded || open) && <div className="quick-open-results" id="quick-open-results" role="listbox" aria-label="Matching files">
      {loading && <div className="quick-open-hint">Finding files in this folder…</div>}
      {!loading && matches.length === 0 && <div className="quick-open-hint">{query ? 'No matching files' : 'Type to search files'}</div>}
      {matches.map((path, index) => <button key={path} className={`quick-open-result ${index === selected ? 'selected' : ''}`}
        role="option" aria-selected={index === selected} onMouseMove={event => { if (pointerMoveGuardRef.current(event)) setSelected(index); }} onClick={() => choose(path)} title={path}>
        <span>{fileName(path)}</span><small>{rootPath && path.startsWith(rootPath) ? path.slice(rootPath.length).replace(/^[/\\]/, '') : path}</small>
      </button>)}
    </div>}
  </div>;
});

export default QuickOpen;
