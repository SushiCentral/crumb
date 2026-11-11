/** Display the same platform modifier for shortcuts throughout the interface. */
export function shortcutLabel(keys: string, platform = typeof navigator === 'undefined' ? '' : navigator.platform): string {
  const modifier = /Mac|iPod|iPhone|iPad/.test(platform) ? '⌘' : 'Ctrl';
  return `${modifier}+${keys}`;
}
