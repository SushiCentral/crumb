type ScaleKey = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export function scaleShortcut(event: ScaleKey): { target: 'zoom' | 'font'; delta: 1 | -1 } | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
  const increase = ['=', '+'].includes(event.key) || ['Equal', 'NumpadAdd'].includes(event.code);
  const decrease = ['-', '_'].includes(event.key) || ['Minus', 'NumpadSubtract'].includes(event.code);
  if (!increase && !decrease) return null;
  return { target: event.shiftKey ? 'font' : 'zoom', delta: increase ? 1 : -1 };
}

export function nextZoom(current: number, delta: 1 | -1): number {
  return Math.min(2, Math.max(0.5, Math.round((current + delta * 0.1) * 10) / 10));
}
