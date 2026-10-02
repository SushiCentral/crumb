import { useState, useRef, useEffect } from 'react';
import { readDir, readTextFile, stat, type DirEntry } from '@tauri-apps/plugin-fs';
import { CloseIcon, FileIcon } from './Icons';

interface MatchItem {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

interface FileSearchResult {
  filePath: string;
  fileName: string;
  matches: MatchItem[];
  expanded: boolean;
}

interface SearchPanelProps {
  rootPath: string | null;
  onOpenFile: (path: string, lineNumber?: number) => void;
  onClose?: () => void;
}

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'target', '.cargo', '.rustup',
  '.vscode', '.idea', 'build', '.next', '.cache', 'coverage', '.system_generated'
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'webp', 'bmp',
  'zip', 'tar', 'gz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib',
  'bin', 'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'wav', 'pdf',
  'lock', 'wasm', 'sqlite', 'db'
]);

const MAX_TOTAL_MATCHES = 500;
const MAX_FILES_SCANNED = 2000;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export default function SearchPanel({ rootPath, onOpenFile, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRunRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    return () => { searchRunRef.current++; };
  }, []);
  useEffect(() => {
    searchRunRef.current++;
    setIsSearching(false);
    setResults([]);
    setSearched(false);
    setStatusMessage(null);
  }, [rootPath]);

  const buildSearchRegex = (term: string) => {
    try {
      let pattern = isRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        pattern = `\\b${pattern}\\b`;
      }
      return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  };

  const cancelSearch = () => {
    searchRunRef.current++;
    setIsSearching(false);
    setStatusMessage('Search cancelled.');
  };

  const executeSearch = async () => {
    const runId = ++searchRunRef.current;
    const isCurrent = () => runId === searchRunRef.current;
    const term = query.trim();
    if (!term || !rootPath) {
      setResults([]);
      setSearched(false);
      setIsSearching(false);
      setStatusMessage(!rootPath ? 'Open a folder first to search files.' : null);
      return;
    }

    const regex = buildSearchRegex(term);
    if (!regex) {
      setIsSearching(false);
      setStatusMessage('Invalid regular expression syntax.');
      return;
    }

    setIsSearching(true);
    setResults([]);
    setStatusMessage(null);
    setSearched(true);

    const foundResults: FileSearchResult[] = [];
    let totalMatches = 0;
    let filesScanned = 0;
    let hitCap = false;

    const traverse = async (currentDir: string) => {
      if (!isCurrent() || totalMatches >= MAX_TOTAL_MATCHES || filesScanned >= MAX_FILES_SCANNED) {
        if (totalMatches >= MAX_TOTAL_MATCHES || filesScanned >= MAX_FILES_SCANNED) {
          hitCap = true;
        }
        return;
      }

      let entries: DirEntry[] = [];
      try {
        entries = await readDir(currentDir);
      } catch {
        return;
      }
      if (!isCurrent()) return;

      for (const entry of entries) {
        if (!isCurrent() || totalMatches >= MAX_TOTAL_MATCHES || filesScanned >= MAX_FILES_SCANNED) {
          if (totalMatches >= MAX_TOTAL_MATCHES || filesScanned >= MAX_FILES_SCANNED) {
            hitCap = true;
          }
          break;
        }

        const fullPath = `${currentDir}${currentDir.endsWith('/') || currentDir.endsWith('\\') ? '' : '/'}${entry.name}`;

        if (entry.isSymlink) continue;
        if (entry.isDirectory) {
          if (IGNORED_DIRS.has(entry.name) || entry.name === '.git') continue;

          await traverse(fullPath);
        } else {
          // Files: include dotfiles like .gitignore, .env!
          const ext = entry.name.split('.').pop()?.toLowerCase();
          if (ext && BINARY_EXTENSIONS.has(ext)) continue;

          filesScanned++;

          try {
            const fileInfo = await stat(fullPath);
            if (!isCurrent()) return;
            if (fileInfo.size > MAX_FILE_SIZE_BYTES) continue;
            const content = await readTextFile(fullPath);
            if (!isCurrent()) return;
            if (content.length > MAX_FILE_SIZE_BYTES) continue;

            const lines = content.split(/\r?\n/);
            const fileMatches: MatchItem[] = [];

            for (let i = 0; i < lines.length; i++) {
              if (totalMatches >= MAX_TOTAL_MATCHES) {
                hitCap = true;
                break;
              }
              const line = lines[i];
              regex.lastIndex = 0;
              let match: RegExpExecArray | null;

              while ((match = regex.exec(line)) !== null) {
                fileMatches.push({
                  lineNumber: i + 1,
                  lineContent: line.trim(),
                  matchStart: match.index,
                  matchEnd: match.index + match[0].length,
                });
                totalMatches++;
                if (fileMatches.length >= 50 || totalMatches >= MAX_TOTAL_MATCHES) break;
                if (match[0].length === 0) regex.lastIndex = match.index + 1;
              }
            }

            if (fileMatches.length > 0) {
              foundResults.push({
                filePath: fullPath,
                fileName: entry.name,
                matches: fileMatches,
                expanded: true,
              });
            }
          } catch {
            // Ignore unreadable or binary files
          }
        }
      }
    };

    try {
      await traverse(rootPath);
      if (isCurrent()) {
        setResults(foundResults);
        if (foundResults.length === 0) {
          setStatusMessage('No results found.');
        } else {
          const capNotice = hitCap ? ' (search limit reached)' : '';
          setStatusMessage(`Found ${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'} in ${foundResults.length} ${foundResults.length === 1 ? 'file' : 'files'}${capNotice}.`);
        }
      }
    } catch (err) {
      if (isCurrent()) setStatusMessage(`Search failed: ${String(err)}`);
    } finally {
      if (isCurrent()) setIsSearching(false);
    }
  };

  const toggleExpand = (filePath: string) => {
    setResults(prev =>
      prev.map(item =>
        item.filePath === filePath ? { ...item, expanded: !item.expanded } : item
      )
    );
  };

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <strong>SEARCH</strong>
        {onClose && (
          <button className="search-close-btn" onClick={onClose} title="Close search">
            <CloseIcon width={14} height={14} />
          </button>
        )}
      </div>

      <div className="search-input-section">
        <div className="search-input-wrapper">
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Search in files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void executeSearch();
            }}
          />
          <div className="search-options">
            <button
              className={`search-opt-btn ${caseSensitive ? 'active' : ''}`}
              title="Match Case (Alt+C)"
              onClick={() => setCaseSensitive(v => !v)}
            >
              Aa
            </button>
            <button
              className={`search-opt-btn ${wholeWord ? 'active' : ''}`}
              title="Match Whole Word (Alt+W)"
              onClick={() => setWholeWord(v => !v)}
            >
              \b
            </button>
            <button
              className={`search-opt-btn ${isRegex ? 'active' : ''}`}
              title="Use Regular Expression (Alt+R)"
              onClick={() => setIsRegex(v => !v)}
            >
              .*
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="search-submit-btn"
            disabled={isSearching || !query.trim()}
            onClick={() => void executeSearch()}
          >
            {isSearching ? 'Searching…' : 'Find'}
          </button>
          {isSearching && (
            <button
              className="panel-btn"
              onClick={cancelSearch}
              style={{ fontSize: '11px', padding: '4px 10px' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="search-status-bar">
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="search-results-list">
        {results.map((res) => (
          <div key={res.filePath} className="search-file-group">
            <div
              className="search-file-header"
              onClick={() => toggleExpand(res.filePath)}
              title={res.filePath}
            >
              <span className="search-chevron">{res.expanded ? '▾' : '▸'}</span>
              <FileIcon width={14} height={14} className="search-file-icon" />
              <span className="search-file-name">{res.fileName}</span>
              <span className="search-badge">{res.matches.length}</span>
            </div>

            {res.expanded && (
              <div className="search-file-matches">
                {res.matches.map((m, idx) => (
                  <div
                    key={`${m.lineNumber}-${idx}`}
                    className="search-match-row"
                    onClick={() => onOpenFile(res.filePath, m.lineNumber)}
                    title={`Line ${m.lineNumber}: ${m.lineContent}`}
                  >
                    <span className="search-line-number">{m.lineNumber}</span>
                    <span className="search-line-snippet">{m.lineContent}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {searched && results.length === 0 && !isSearching && (
          <div className="search-empty">No matches found for "{query}"</div>
        )}
      </div>
    </div>
  );
}
