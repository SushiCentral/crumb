import type { CursorInfo } from '../lib/editor-extensions';
import type { EditorPreferences } from '../lib/preferences';

export interface VimStatus {
  mode: 'normal' | 'insert' | 'visual' | 'replace' | 'command' | 'terminal' | string;
  pending?: {
    command?: string;
    count?: string | number;
    register?: string;
  };
}

interface StatusBarProps {
  hasDocument: boolean;
  cursor?: CursorInfo;
  vimStatus?: VimStatus;
  preferences: EditorPreferences;
  lineEnding: string;
  language: string;
  wordWrap: boolean;
  zoom: number;
  theme: string;
}

export default function StatusBar({ hasDocument, cursor, vimStatus, preferences, lineEnding, language, wordWrap, zoom, theme }: StatusBarProps) {
  const mode = vimStatus?.mode;
  const pending = vimStatus?.pending;
  const modeClass = mode?.toLowerCase().replace(/[^a-z0-9_-]/g, '');

  return <footer className="status-bar" aria-label="Editor status">
    <div className="status-bar-group">
      {vimStatus && <div className="vim-status" role="group" aria-label={`Vim mode: ${mode}`}>
        <span className={`vim-status-mode vim-status-mode-${modeClass}`} aria-hidden="true">{mode}</span>
        {pending?.count != null && <span className="vim-status-pending" aria-label={`Count ${pending.count}`}>Count {pending.count}</span>}
        {pending?.register != null && <span className="vim-status-pending" aria-label={`Register ${pending.register}`}>Reg {pending.register}</span>}
        {pending?.command != null && <span className="vim-status-pending" aria-label={`Pending command ${pending.command}`}>Cmd {pending.command}</span>}
      </div>}
      {hasDocument ? <>
        <span>Ln {cursor?.line ?? '—'}, Col {cursor?.column ?? '—'}</span>
        {cursor != null && cursor.selected > 0 && <span>Sel: {cursor.selected}</span>}
        <span>{preferences.indentWith === 'tabs' ? 'Tabs' : 'Spaces'}: {preferences.indentSize}</span>
        <span>UTF-8</span><span>{lineEnding}</span>
      </> : <span>Ready</span>}
    </div>
    <div className="status-bar-group status-bar-right">
      {hasDocument && <><span>{language}</span><span>Wrap: {wordWrap ? 'On' : 'Off'}</span></>}
      <span>{Math.round(zoom * 100)}%</span><span>{theme}</span>
    </div>
  </footer>;
}
