import { shortcutLabel } from '../lib/platform';
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
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  const matchesRef = useRef<string[]>([]);
  const selectedRef = useRef(selected);
  /** Set only by an extra Ctrl+P press, never by the press that opens the field. */
  const ctrlCycleArmedRef = useRef(false);
  const chooseRef = useRef<(path: string) => void>(() => {});

  useImperativeHandle(ref, () => ({ focus: () => { ctrlCycleArmedRef.current = false; setIndexedRoot(null); setQuery(''); inputRef.current?.focus(); setOpen(true); } }), []);

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
      ctrlCycleArmedRef.current = false;
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

  matchesRef.current = matches;
  selectedRef.current = selected;
  openRef.current = open;

  useEffect(() => {
    // Ctrl+P cycles files only while this field still owns focus. A window
    // listener also observes Control release when focus has moved; the checks
    // below prevent a stale release from opening a file.
    const disarm = () => { ctrlCycleArmedRef.current = false; };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Control' || !ctrlCycleArmedRef.current) return;
      ctrlCycleArmedRef.current = false;
      if (!openRef.current) return;
      const container = containerRef.current;
      const active = document.activeElement;
      if (!container || !(active instanceof Node) || !container.contains(active)) return;
      const list = matchesRef.current;
      const index = Math.min(Math.max(selectedRef.current, 0), list.length - 1);
      const path = list[index];
      if (path) chooseRef.current(path);
    };
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', disarm);
    return () => {
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', disarm);
    };
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, matches]);

  const choose = (path: string) => {
    ctrlCycleArmedRef.current = false;
    onOpenFile(path);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };
  chooseRef.current = choose;

  return <div className={`quick-open${embedded ? ' quick-open-embedded' : ''}`} ref={containerRef} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
      ctrlCycleArmedRef.current = false;
      setOpen(false);
    }
  }}>
    {embedded && <button className="palette-back" onClick={onBack} aria-label="Back to commands">‹</button>}
    {!embedded && <svg className="quick-open-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 5 5" /></svg>}
    <input ref={inputRef} value={query} aria-label="Search files" role="combobox" aria-expanded={embedded || open} aria-controls="quick-open-results"
      placeholder={rootPath ? 'Search files by name' : 'Search open files'}
      onFocus={() => { ctrlCycleArmedRef.current = false; onActivate?.(); setIndexedRoot(null); setOpen(true); }}
      onChange={event => { ctrlCycleArmedRef.current = false; setQuery(event.target.value); setSelected(0); setOpen(true); }}
      onKeyDown={event => {
        // The press that opens Quick Open is consumed by App, so the first
        // Ctrl+P seen here is always an extra press: advance one file and arm
        // release-to-open. OS auto-repeat keeps the event from counting twice.
        if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          const list = matchesRef.current;
          if (!list.length) { ctrlCycleArmedRef.current = false; return; }
          const current = Math.min(Math.max(selectedRef.current, 0), list.length - 1);
          // The Ctrl+P cycle wraps after the last file; ordinary ArrowDown
          // remains bounded at the end of the list.
          const next = current >= list.length - 1 ? 0 : current + 1;
          selectedRef.current = next;
          setSelected(next);
          ctrlCycleArmedRef.current = true;
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          ctrlCycleArmedRef.current = false;
          setOpen(false);
          if (embedded) onBack?.();
          else { inputRef.current?.blur(); onDismiss?.('cancel'); }
        }
        if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(index + 1, matches.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(0, index - 1)); }
        if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); choose(matches[selected]); }
      }} />
    {!embedded && <kbd>{shortcutLabel('P')}</kbd>}
    {(embedded || open) && <div ref={listRef} className="quick-open-results" id="quick-open-results" role="listbox" aria-label="Matching files">
      {loading && <div className="quick-open-hint">Finding files in this folder…</div>}
      {!loading && matches.length === 0 && <div className="quick-open-hint">{query ? 'No matching files' : 'Type to search files'}</div>}
      {matches.map((path, index) => <button key={path} className={`quick-open-result ${index === selected ? 'selected' : ''}`}
        role="option" aria-selected={index === selected} onMouseMove={event => { if (event.movementX !== 0 || event.movementY !== 0) setSelected(index); }} onClick={() => choose(path)} title={path}>
        <span>{fileName(path)}</span><small>{rootPath && path.startsWith(rootPath) ? path.slice(rootPath.length).replace(/^[/\\]/, '') : path}</small>
      </button>)}
    </div>}
  </div>;
});

export default QuickOpen;
