export function readNumber(raw: string | null, fallback: number, min: number, max: number): number {
  const value = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function readBoolean(raw: string | null, fallback: boolean): boolean {
  return raw === 'true' ? true : raw === 'false' ? false : fallback;
}

export interface EditorPreferences {
  lineNumbers: boolean;
  bracketMatching: boolean;
  autoCloseBrackets: boolean;
  highlightActiveLine: boolean;
  indentSize: 2 | 3 | 4;
  indentWith: 'spaces' | 'tabs';
}

export const defaultEditorPreferences: EditorPreferences = {
  lineNumbers: true, bracketMatching: true, autoCloseBrackets: true,
  highlightActiveLine: true, indentSize: 2, indentWith: 'spaces',
};

export function readEditorPreferences(read: (key: string) => string | null): EditorPreferences {
  const size = Number(read('crumb.indentSize'));
  return {
    lineNumbers: readBoolean(read('crumb.lineNumbers'), true),
    bracketMatching: readBoolean(read('crumb.bracketMatching'), true),
    autoCloseBrackets: readBoolean(read('crumb.autoCloseBrackets'), true),
    highlightActiveLine: readBoolean(read('crumb.highlightActiveLine'), true),
    indentSize: size === 2 || size === 3 || size === 4 ? size : 2,
    indentWith: read('crumb.indentWith') === 'tabs' ? 'tabs' : 'spaces',
  };
}

export function clampPanelHeight(value: number, windowHeight: number): number {
  const max = Math.max(0, Math.min(windowHeight * 0.6, windowHeight - 160));
  // Very short windows must still reserve some space for the editor.
  const available = windowHeight < 280 ? Math.max(0, windowHeight * 0.6) : max;
  return Math.min(available, Math.max(Math.min(120, available), value));
}

export function clampSidebarWidth(value: number, windowWidth: number): number {
  const max = Math.max(160, windowWidth - 280);
  return Math.max(160, Math.min(max, value));
}

export function lineEnding(content: string): 'LF' | 'CRLF' | 'CR' | 'Mixed' {
  const crlf = content.includes('\r\n');
  const remaining = content.replace(/\r\n/g, '');
  const lf = remaining.includes('\n');
  const cr = remaining.includes('\r');
  return Number(crlf) + Number(lf) + Number(cr) > 1 ? 'Mixed' : crlf ? 'CRLF' : cr ? 'CR' : 'LF';
}
