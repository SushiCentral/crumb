import { useEffect, useState } from 'react';
import { listDir, readFile, DirEntry } from '../lib/ipc';

interface FileTreeProps {
  onFileSelect: (path: string, content: string) => void;
  activePath: string | null;
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  activePath: string | null;
  onFileSelect: (path: string, content: string) => void;
}

function TreeNode({ entry, depth, activePath, onFileSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const isActive = activePath === entry.path;

  useEffect(() => {
    const isParentOfActive =
      !!activePath &&
      entry.isDir &&
      (activePath === entry.path ||
        activePath.startsWith(`${entry.path}/`) ||
        activePath.startsWith(`${entry.path}\\`));

    if (isParentOfActive) {
      if (!open) {
        void listDir(entry.path).then(setChildren);
      }
      setOpen(true);
    }
  }, [activePath, entry.isDir, entry.path, open]);

  const handleClick = async () => {
    if (entry.isDir) {
      if (!open) {
        const entries = await listDir(entry.path);
        setChildren(entries);
      }
      setOpen(!open);
    } else {
      const content = await readFile(entry.path);
      onFileSelect(entry.path, content);
    }
  };

  return (
    <div className="tree-node">
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`tree-row ${isActive ? 'tree-row--active' : ''}`}
      >
        <span className="tree-row__icon" aria-hidden="true">
          {entry.isDir ? (open ? '▾' : '▸') : '•'}
        </span>
        <span className="tree-row__name">{entry.name}</span>
      </div>

      {open && children.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          activePath={activePath}
          onFileSelect={onFileSelect}
        />
      ))}
    </div>
  );
}

export function FileTree({ onFileSelect, activePath }: FileTreeProps) {
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);

  useEffect(() => {
    listDir('.').then(setRootEntries);
  }, []);

  return (
    <div className="file-tree">
      <div className="file-tree__header">
        Explorer
      </div>
      <div className="file-tree__list">
        {rootEntries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            activePath={activePath}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    </div>
  );
}
