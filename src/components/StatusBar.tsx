import type { CursorInfo } from '../lib/editor-extensions';
import type { EditorPreferences } from '../lib/preferences';

interface StatusBarProps {
  cursor?: CursorInfo;
  preferences: EditorPreferences;
  lineEnding: string;
  language: string;
  wordWrap: boolean;
  zoom: number;
  theme: string;
}

export default function StatusBar({ cursor, preferences, lineEnding, language, wordWrap, zoom, theme }: StatusBarProps) {
  return <footer className="status-bar" aria-label="Editor status">
    <div className="status-bar-group">
      <span>Ln {cursor?.line ?? '—'}, Col {cursor?.column ?? '—'}</span>
      {cursor != null && cursor.selected > 0 && <span>Sel: {cursor.selected}</span>}
      <span>{preferences.indentWith === 'tabs' ? 'Tabs' : 'Spaces'}: {preferences.indentSize}</span>
      <span>UTF-8</span><span>{lineEnding}</span>
    </div>
    <div className="status-bar-group status-bar-right">
      <span>{language}</span><span>Wrap: {wordWrap ? 'On' : 'Off'}</span>
      <span>{Math.round(zoom * 100)}%</span><span>{theme}</span>
    </div>
  </footer>;
}
