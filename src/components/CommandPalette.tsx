import { useEffect, useMemo, useRef, useState } from 'react';
import type { Theme } from '../lib/themes';

export interface PaletteCommand {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}

interface Props {
  commands: PaletteCommand[];
  themes: Theme[];
  currentThemeId: string;
  onThemeChange: (id: string) => void;
  onClose: () => void;
}

export default function CommandPalette({ commands, themes, currentThemeId, onThemeChange, onClose }: Props) {
  const [mode, setMode] = useState<'commands' | 'themes'>('commands');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  const options = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (mode === 'themes') return themes.filter(theme => theme.name.toLowerCase().includes(search));
    return commands.filter(command => `${command.label} ${command.detail ?? ''}`.toLowerCase().includes(search));
  }, [commands, themes, mode, query]);

  const changeMode = (next: 'commands' | 'themes') => {
    setMode(next);
    setQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus();
  };

  const choose = (index: number) => {
    const choice = options[index];
    if (!choice) return;
    if (mode === 'themes') {
      onThemeChange((choice as Theme).id);
      onClose();
    } else {
      const command = choice as PaletteCommand;
      if (command.id === 'theme') changeMode('themes');
      else { onClose(); command.run(); }
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          if (event.key === 'Tab') { event.preventDefault(); inputRef.current?.focus(); }
        }}
      >
        <div className="palette-input-row">
          {mode === 'themes' && <button className="palette-back" onClick={() => changeMode('commands')} aria-label="Back to commands">‹</button>}
          <input
            ref={inputRef}
            className="palette-input"
            aria-label={mode === 'themes' ? 'Search themes' : 'Search commands'}
            placeholder={mode === 'themes' ? 'Select Color Theme' : 'Type a command…'}
            value={query}
            onChange={event => { setQuery(event.target.value); setSelectedIndex(0); }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex(index => Math.min(index + 1, options.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex(index => Math.max(index - 1, 0)); }
              if (event.key === 'Enter') { event.preventDefault(); choose(selectedIndex); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" role="listbox" aria-label={mode === 'themes' ? 'Themes' : 'Commands'}>
          {options.length === 0 && <div className="palette-empty">No matches</div>}
          {options.map((option, index) => mode === 'themes' ? (
            <button
              key={(option as Theme).id}
              className={`palette-option ${selectedIndex === index ? 'selected' : ''}`}
              role="option"
              aria-selected={selectedIndex === index}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="theme-swatch" style={{ background: (option as Theme).colors.editor, borderColor: (option as Theme).colors.accent }} />
              <span className="palette-option-label">{(option as Theme).name}</span>
              {(option as Theme).id === currentThemeId && <span className="palette-check">✓ Current</span>}
            </button>
          ) : (
            <button
              key={(option as PaletteCommand).id}
              className={`palette-option ${selectedIndex === index ? 'selected' : ''}`}
              role="option"
              aria-selected={selectedIndex === index}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="palette-option-label">{(option as PaletteCommand).label}<small>{(option as PaletteCommand).detail}</small></span>
              {(option as PaletteCommand).shortcut && <kbd>{(option as PaletteCommand).shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
