import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SearchIcon } from './Icons';
import { codeFonts, type Theme } from '../lib/themes';

export interface PaletteCommand {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}

/**
 * Why the palette closed. Focus is returned to the invoking editor only for an
 * explicit cancel or an inline selection; an outside click belongs to the
 * element the user chose, and a command owns its own focus handoff.
 */
export type CommandPaletteCloseReason = 'cancel' | 'outside' | 'selection' | 'command';

interface Props {
  triggerRef: RefObject<HTMLButtonElement | null>;
  commands: PaletteCommand[];
  themes: Theme[];
  currentThemeId: string;
  codeFontOverride: string | null;
  onThemeChange: (id: string) => void;
  onCodeFontChange: (font: typeof codeFonts[number] | null) => void;
  onClose: (reason: CommandPaletteCloseReason) => void;
  /** Runs a command after the palette has released focus. */
  onRunCommand?: (command: PaletteCommand) => void;
}

function CommandLabel({ command }: { command: PaletteCommand }) {
  const separator = command.label.indexOf(': ');
  const category = separator >= 0 ? command.label.slice(0, separator) : '';
  const title = separator >= 0 ? command.label.slice(separator + 2) : command.label;
  return <span className="palette-option-label palette-command-label">
    <span className="palette-command-heading">
      {category && <span className="palette-option-category">{category}</span>}
      <span className="palette-option-title">{title}</span>
    </span>
    {command.detail && <small>{command.detail}</small>}
  </span>;
}

export default function CommandPalette({ triggerRef, commands, themes, currentThemeId, codeFontOverride, onThemeChange, onCodeFontChange, onClose, onRunCommand }: Props) {
  const [mode, setMode] = useState<'commands' | 'themes' | 'fonts'>('commands');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const dismiss = (event: Event) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        restoreFocusRef.current = false;
        onCloseRef.current('outside');
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
    document.removeEventListener('pointerdown', dismiss);
    document.removeEventListener('focusin', dismiss);
    if (!restoreFocusRef.current) return;
    if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
    else triggerRef.current?.focus();
    };
  }, [triggerRef]);
  const options = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (mode === 'themes') return themes.filter(theme => theme.name.toLowerCase().includes(search));
    if (mode === 'fonts') return ['Theme default', ...codeFonts].filter(font => font.toLowerCase().includes(search));
    return commands.filter(command => `${command.label} ${command.detail ?? ''}`.toLowerCase().includes(search));
  }, [commands, themes, mode, query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, mode, query]);

  const changeMode = (next: 'commands' | 'themes' | 'fonts') => {
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
      onClose('selection');
    } else if (mode === 'fonts') {
      onCodeFontChange(choice === 'Theme default' ? null : choice as typeof codeFonts[number]);
      onClose('selection');
    } else {
      const command = choice as PaletteCommand;
      if (command.id === 'theme') changeMode('themes');
      else if (command.id === 'code-font') changeMode('fonts');
      else {
        // The command (or its onRunCommand handler) owns focus from here; the
        // inline command palette must not pull focus back on unmount.
        restoreFocusRef.current = false;
        onClose('command');
        if (onRunCommand) onRunCommand(command);
        else command.run();
      }
    }
  };

  return (
    <>
      {/* A transparent backdrop keeps outside clicks from reaching the app and
          reports the dismissal as an outside interaction. */}
      <div className="palette-overlay" style={{ position: 'fixed', inset: 0 }} aria-hidden="true" />
      <div
        ref={containerRef}
        className="command-palette"
        role="search"
        aria-label="Commands"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose('cancel'); }
        }}
      >
        <div className="palette-input-row">
          {mode !== 'commands' ? <button className="palette-back" onClick={() => changeMode('commands')} aria-label="Back to commands">‹</button> : <SearchIcon />}
          <input
            ref={inputRef}
            className="palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            aria-activedescendant={options[selectedIndex] ? `palette-option-${mode}-${selectedIndex}` : undefined}
            aria-label={mode === 'themes' ? 'Search themes' : mode === 'fonts' ? 'Search editor fonts' : 'Search commands'}
            placeholder={mode === 'themes' ? 'Select Color Theme' : mode === 'fonts' ? 'Select Editor Font' : 'Type a command…'}
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
        <div ref={listRef} id="command-palette-results" className="palette-list" role="listbox" tabIndex={-1} aria-label={mode === 'themes' ? 'Themes' : mode === 'fonts' ? 'Editor fonts' : 'Commands'}>
          {options.length === 0 && <div className="palette-empty">No matches</div>}
          {options.map((option, index) => mode === 'themes' ? (
            <button
              key={(option as Theme).id}
              className={`palette-option ${selectedIndex === index ? 'selected' : ''}`}
              id={`palette-option-${mode}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={selectedIndex === index}
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="theme-swatch" style={{ background: (option as Theme).colors.editor, borderColor: (option as Theme).colors.accent }} />
              <span className="palette-option-label">{(option as Theme).name}</span>
              {(option as Theme).id === currentThemeId && <span className="palette-check">✓ Current</span>}
            </button>
          ) : mode === 'fonts' ? (
            <button
              key={option as string}
              className={`palette-option ${selectedIndex === index ? 'selected' : ''}`}
              id={`palette-option-${mode}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={selectedIndex === index}
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="palette-option-label font-option-label" style={{ fontFamily: option === 'Theme default' ? `var(--ui-font)` : `'${option}', monospace` }}>
                {option as string}<small>const crumb = 'Aa 0123456789';</small>
              </span>
              {((option === codeFontOverride) || (option === 'Theme default' && codeFontOverride === null)) && <span className="palette-check">✓ Current</span>}
            </button>
          ) : (
            <button
              key={(option as PaletteCommand).id}
              aria-label={[(option as PaletteCommand).label, (option as PaletteCommand).detail, (option as PaletteCommand).shortcut].filter(Boolean).join(', ')}
              className={`palette-option ${selectedIndex === index ? 'selected' : ''}`}
              id={`palette-option-${mode}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={selectedIndex === index}
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => choose(index)}
            >
              <CommandLabel command={option as PaletteCommand} />
              {(option as PaletteCommand).shortcut && <kbd>{(option as PaletteCommand).shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
