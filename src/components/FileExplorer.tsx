import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, DirEntry } from '@tauri-apps/plugin-fs';

import documentIcon from '../assets/document.svg';
import folderOpenIcon from '../assets/folder-open.svg';

interface FileTreeNodeProps {
  name: string;
  path: string;
  isDirectory: boolean;
  level: number;
  onFileSelect: (path: string) => void;
}

function FileTreeNode({ name, path, isDirectory, level, onFileSelect }: FileTreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (isDirectory) {
      if (!isOpen && children === null) {
        setIsLoading(true);
        try {
          const entries = await readDir(path);
          const sorted = entries.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });
          setChildren(sorted);
        } catch (error) {
          console.error("Failed to read directory", error);
        } finally {
          setIsLoading(false);
        }
      }
      setIsOpen(!isOpen);
    } else {
      onFileSelect(path);
    }
  };

  return (
    <div>
      <div 
        style={{ 
          padding: '4px 8px', 
          paddingLeft: `${level * 12 + 8}px`,
          cursor: 'pointer', 
          display: 'flex', 
          alignItems: 'center',
          gap: '6px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          userSelect: 'none'
        }}
        onClick={handleClick}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        title={path}
      >
        {isDirectory ? (
          <span style={{ fontSize: '10px', width: '12px', display: 'inline-block', textAlign: 'center', transition: 'transform 0.1s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            ▶
          </span>
        ) : (
          <span style={{ width: '12px', display: 'inline-block' }}></span>
        )}
        
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px' }}>
          {isDirectory ? (
             <img src={folderOpenIcon} alt="folder" style={{ width: '14px', height: '14px', opacity: isOpen ? 1 : 0.7 }} />
          ) : (
             <img src={documentIcon} alt="file" style={{ width: '14px', height: '14px', opacity: 0.8 }} />
          )}
        </span>

        <span>{name}</span>
      </div>
      
      {isOpen && isLoading && (
        <div style={{ paddingLeft: `${(level + 1) * 12 + 8 + 16}px`, color: '#888', fontStyle: 'italic', fontSize: '12px', padding: '4px 0' }}>
          Loading...
        </div>
      )}

      {isOpen && children && (
        <div>
          {children.map((child, i) => {
            const separator = path.endsWith('/') || path.endsWith('\\') ? '' : '/';
            const childPath = path + separator + child.name;
            return (
              <FileTreeNode 
                key={`${childPath}-${i}`}
                name={child.name}
                path={childPath}
                isDirectory={child.isDirectory}
                level={level + 1}
                onFileSelect={onFileSelect}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface FileExplorerProps {
  onFileSelect: (path: string) => void;
}

export default function FileExplorer({ onFileSelect }: FileExplorerProps) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [rootFiles, setRootFiles] = useState<DirEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadDirectory = async (path: string) => {
    setIsLoading(true);
    try {
      const entries = await readDir(path);
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      setRootFiles(sorted);
      setRootPath(path);
    } catch (error) {
      console.error("Failed to read directory", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string') {
        await loadDirectory(selected);
      }
    } catch (error) {
      console.error("Failed to open folder", error);
    }
  };

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column', 
      color: '#cccccc', 
      fontSize: '13px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #333' }}>
        <div style={{ fontWeight: 'bold', fontSize: '11px', letterSpacing: '0.5px' }}>EXPLORER</div>
        <button 
          onClick={handleOpenFolder} 
          style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          title="Open Folder"
        >
          <img src={folderOpenIcon} alt="Open Folder" style={{ width: '16px', height: '16px' }} />
        </button>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {rootPath ? (
          <>
            <div style={{ padding: '8px', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', color: '#999', wordBreak: 'break-all' }}>
              {rootPath.split(/[\/\\]/).filter(Boolean).pop()}
            </div>
            {isLoading ? (
               <div style={{ padding: '10px', color: '#888', fontStyle: 'italic' }}>Loading...</div>
            ) : (
               <>
                 {rootFiles.map((file, i) => {
                   const separator = rootPath.endsWith('/') || rootPath.endsWith('\\') ? '' : '/';
                   return (
                     <FileTreeNode 
                       key={`${rootPath}-${file.name}-${i}`}
                       name={file.name}
                       path={rootPath + separator + file.name}
                       isDirectory={file.isDirectory}
                       level={0}
                       onFileSelect={onFileSelect}
                     />
                   );
                 })}
                 {rootFiles.length === 0 && (
                   <div style={{ padding: '10px', color: '#666', fontStyle: 'italic' }}>Empty directory</div>
                 )}
               </>
            )}
          </>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <button 
              onClick={handleOpenFolder} 
              style={{ 
                padding: '6px 12px', 
                background: '#0e639c', 
                color: '#fff', 
                border: 'none', 
                borderRadius: '4px', 
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '13px'
              }}
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
