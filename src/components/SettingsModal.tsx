import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { codeFonts, type Theme } from '../lib/themes';
import { CloseIcon } from './Icons';
import type { EditorPreferences } from '../lib/preferences';

interface SettingsModalProps {
  themes: Theme[];
  currentThemeId: string;
  onThemeChange: (id: string) => void;
  onThemePreview: (id: string | null) => void;
  codeFontOverride: string | null;
  onCodeFontChange: (font: typeof codeFonts[number] | null) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  wordWrap: boolean;
  onWordWrapChange: (enabled: boolean) => void;
  editorPreferences: EditorPreferences;
  onEditorPreferencesChange: (preferences: EditorPreferences) => void;
  clearPromptOnStart: boolean;
  onClearPromptOnStartChange: (enabled: boolean) => void;
  onResetLayout: () => void;
  onClose: () => void;
}

const tabs = ['Appearance', 'Editor', 'Terminal', 'Workspace'] as const;
type SettingsTab = typeof tabs[number];

function Toggle({ id, label, description, checked, onChange }: {
  id: string; label: string; description?: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  return <div className="settings-row">
    <div className="settings-row-label"><label htmlFor={id}>{label}</label>{description && <small>{description}</small>}</div>
    <button id={id} className={`toggle-switch ${checked ? 'checked' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span className="toggle-slider" /></button>
  </div>;
}

export default function SettingsModal({ themes, currentThemeId, onThemeChange, onThemePreview, codeFontOverride, onCodeFontChange, fontSize, onFontSizeChange, wordWrap, onWordWrapChange, editorPreferences, onEditorPreferencesChange, clearPromptOnStart, onClearPromptOnStartChange, onResetLayout, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('Appearance');
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => { previousFocus?.focus(); };
  }, []);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), select, input') ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return <div className="settings-overlay" onMouseDown={onClose}>
    <div ref={modalRef} className="settings-modal" role="dialog" aria-modal="true" aria-label="Editor Settings" onMouseDown={event => event.stopPropagation()} onKeyDown={handleKeyDown}>
      <div className="settings-header">
        <div className="settings-title-group"><h2>Settings</h2><span className="settings-subtitle">Make Crumb feel like your workspace</span></div>
        <button className="settings-close-btn" onClick={onClose} aria-label="Close settings"><CloseIcon width={16} height={16} /></button>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((name, index) => <button key={name} id={`settings-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`settings-panel-${name}`} tabIndex={tab === name ? 0 : -1}
          onClick={() => { onThemePreview(null); setTab(name); }}
          onKeyDown={event => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault(); onThemePreview(null); setTab(tabs[next]);
            modalRef.current?.querySelector<HTMLButtonElement>(`#settings-tab-${tabs[next]}`)?.focus();
          }}>{name}</button>)}
      </div>

      <div className="settings-body" id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'Appearance' && <>
          <section className="settings-section">
            <h3 className="settings-section-title">Color theme</h3>
            <p className="settings-section-desc">Hover or focus to preview. Click to keep a theme.</p>
            <div className="theme-grid">
              {themes.map(t => <button key={t.id} className={`theme-card ${t.id === currentThemeId ? 'active' : ''}`} aria-pressed={t.id === currentThemeId}
                onMouseEnter={() => onThemePreview(t.id)} onMouseLeave={() => onThemePreview(null)}
                onFocus={() => onThemePreview(t.id)} onBlur={() => onThemePreview(null)} onClick={() => onThemeChange(t.id)}>
                <pre className="theme-code-preview" aria-hidden="true" style={{ background: t.colors.editor, color: t.colors.text, fontFamily: `'${t.codeFont}', monospace` }}>
                  <span style={{ color: t.syntax.keyword }}>function </span><span style={{ color: t.syntax.function }}>hello</span><span style={{ color: t.syntax.punctuation }}>(</span><span style={{ color: t.syntax.variable }}>name</span><span style={{ color: t.syntax.punctuation }}>{') {\n'}</span>
                  <span style={{ color: t.syntax.comment }}>{'  // Welcome back\n'}</span>
                  <span style={{ color: t.syntax.keyword }}>{'  return '}</span><span style={{ color: t.syntax.string }}>{'"Hi, "'}</span><span style={{ color: t.syntax.operator }}>{' + '}</span><span style={{ color: t.syntax.variable }}>name</span><span style={{ color: t.syntax.punctuation }}>{';\n}'}</span>
                </pre>
                <div className="theme-card-footer"><span className="theme-card-name">{t.name}</span>{t.id === currentThemeId && <span className="theme-card-tag">Active</span>}</div>
              </button>)}
            </div>
          </section>
          <section className="settings-section">
            <h3 className="settings-section-title">Font & typography</h3>
            <div className="settings-row">
              <div className="settings-row-label"><label htmlFor="font-family-select">Editor font</label><small>Shared by the code editor and terminal</small></div>
              <select id="font-family-select" className="settings-select" value={codeFontOverride ?? 'default'} onChange={event => onCodeFontChange(event.target.value === 'default' ? null : event.target.value as typeof codeFonts[number])}>
                <option value="default">Theme default</option>{codeFonts.map(font => <option key={font} value={font}>{font}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <div className="settings-row-label"><label htmlFor="font-size-slider">Font size ({fontSize}px)</label><small>10–24px · Ctrl+Shift+= / −</small></div>
              <div className="settings-row-control font-size-control">
                <input id="font-size-slider" type="range" min="10" max="24" value={fontSize} onChange={event => onFontSizeChange(Number(event.target.value))} className="settings-range" />
                <input type="number" aria-label="Font size in pixels" min="10" max="24" value={fontSize} onChange={event => onFontSizeChange(Math.min(24, Math.max(10, Number(event.target.value))))} className="settings-number-input" />
              </div>
            </div>
            <pre className="font-preview-box" style={{ fontSize: `${fontSize}px`, fontFamily: codeFontOverride ? `'${codeFontOverride}', monospace` : 'var(--code-font)' }}>{'// Typography preview\nfunction hello() {\n  return "Welcome to Crumb";\n}'}</pre>
          </section>
        </>}

        {tab === 'Editor' && <section className="settings-section">
          <h3 className="settings-section-title">Editing & display</h3>
          {([
            ['lineNumbers', 'Line numbers', 'Keep code-folding controls visible when numbers are hidden'],
            ['bracketMatching', 'Bracket matching', 'Highlight the matching bracket near the cursor'],
            ['autoCloseBrackets', 'Auto-close brackets', 'Insert closing brackets and quotes as you type'],
            ['highlightActiveLine', 'Highlight active line', 'Highlight the current line and its line number'],
          ] as const).map(([key, label, description]) => <Toggle key={key} id={`editor-${key}`} label={label} description={description} checked={editorPreferences[key]} onChange={checked => onEditorPreferencesChange({ ...editorPreferences, [key]: checked })} />)}
          <Toggle id="word-wrap-toggle" label="Word wrap" description="Wrap long lines to the editor width" checked={wordWrap} onChange={onWordWrapChange} />
          <div className="settings-row"><label htmlFor="indent-size">Indent size</label><select id="indent-size" className="settings-select" value={editorPreferences.indentSize} onChange={event => onEditorPreferencesChange({ ...editorPreferences, indentSize: Number(event.target.value) as 2 | 3 | 4 })}>{[2, 3, 4].map(size => <option key={size} value={size}>{size}</option>)}</select></div>
          <div className="settings-row"><label htmlFor="indent-with">Indent with</label><select id="indent-with" className="settings-select" value={editorPreferences.indentWith} onChange={event => onEditorPreferencesChange({ ...editorPreferences, indentWith: event.target.value as 'spaces' | 'tabs' })}><option value="spaces">Spaces</option><option value="tabs">Tabs</option></select></div>
        </section>}

        {tab === 'Terminal' && <section className="settings-section">
          <h3 className="settings-section-title">Terminal startup</h3>
          <Toggle id="terminal-clear-prompt" label="Clear prompt on start" description="Send Ctrl-L shortly after startup. Applies to new terminals; may clear shell startup messages." checked={clearPromptOnStart} onChange={onClearPromptOnStartChange} />
        </section>}

        {tab === 'Workspace' && <section className="settings-section">
          <h3 className="settings-section-title">Layout</h3>
          <p className="settings-section-desc">Sidebar width, panel height, sidebar tab, and zoom are remembered between launches. Oversized panels are clamped to keep the editor visible.</p>
          <div className="settings-row"><div className="settings-row-label"><span>Reset layout</span><small>Restore panel sizes and visibility, Explorer, and split widths. Your files, theme, font, and zoom are unchanged.</small></div><button className="settings-done-btn" onClick={onResetLayout}>Reset layout</button></div>
        </section>}
      </div>
      <div className="settings-footer"><button className="settings-done-btn" onClick={onClose}>Done</button></div>
    </div>
  </div>;
}
