export function readNumber(raw: string | null, fallback: number, min: number, max: number): number {
  const value = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function readBoolean(raw: string | null, fallback: boolean): boolean {
  return raw === 'true' ? true : raw === 'false' ? false : fallback;
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
