import { codeFonts, type Theme } from '../lib/themes';
import { CloseIcon } from './Icons';
import type { EditorPreferences } from '../lib/preferences';

interface SettingsModalProps {
  themes: Theme[];
  currentThemeId: string;
  onThemeChange: (id: string) => void;
  codeFontOverride: string | null;
  onCodeFontChange: (font: typeof codeFonts[number] | null) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  wordWrap: boolean;
  onWordWrapChange: (enabled: boolean) => void;
  onClose: () => void;
  onResetLayout: () => void;
  editorPreferences: EditorPreferences;
  onEditorPreferencesChange: (preferences: EditorPreferences) => void;
}

export default function SettingsModal({
  themes,
  currentThemeId,
  onThemeChange,
  codeFontOverride,
  onCodeFontChange,
  fontSize,
  onFontSizeChange,
  wordWrap,
  onWordWrapChange,
  onClose,
  onResetLayout,
  editorPreferences,
  onEditorPreferencesChange,
}: SettingsModalProps) {
  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Editor Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <div className="settings-title-group">
            <h2>Settings</h2>
            <span className="settings-subtitle">Manage workspace and editor preferences</span>
          </div>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className="settings-body">
          {/* Appearance Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">Color Theme</h3>
            <p className="settings-section-desc">Select the workspace color palette and editor styling</p>
            <div className="theme-grid">
              {themes.map((t) => {
                const isSelected = t.id === currentThemeId;
                return (
                  <button
                    key={t.id}
                    className={`theme-card ${isSelected ? 'active' : ''}`}
                    onClick={() => onThemeChange(t.id)}
                  >
                    <div className="theme-card-preview">
                      <span className="swatch" style={{ background: t.colors.editor }} title="Editor background" />
                      <span className="swatch" style={{ background: t.colors.sidebar }} title="Sidebar background" />
                      <span className="swatch" style={{ background: t.colors.accent }} title="Accent color" />
                      <span className="swatch" style={{ background: t.colors.terminal }} title="Terminal background" />
                    </div>
                    <div className="theme-card-footer">
                      <span className="theme-card-name">{t.name}</span>
                      {isSelected && <span className="theme-card-tag">Active</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Typography Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">Font & Typography</h3>
            <p className="settings-section-desc">Configure typography for the code editor and integrated terminal</p>

            <div className="settings-row">
              <div className="settings-row-label">
                <label htmlFor="font-family-select">Editor Font Family</label>
                <small>Select from bundled high-legibility coding fonts</small>
              </div>
              <div className="settings-row-control">
                <select
                  id="font-family-select"
                  className="settings-select"
                  value={codeFontOverride ?? 'default'}
                  onChange={(e) => onCodeFontChange(e.target.value === 'default' ? null : e.target.value as typeof codeFonts[number])}
                >
                  <option value="default">Theme Default</option>
                  {codeFonts.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <label htmlFor="font-size-slider">Font Size ({fontSize}px)</label>
                <small>Controls editor and terminal font scaling (10px – 24px)</small>
              </div>
              <div className="settings-row-control font-size-control">
                <input
                  id="font-size-slider"
                  type="range"
                  min="10"
                  max="24"
                  value={fontSize}
                  onChange={(e) => onFontSizeChange(Number(e.target.value))}
                  className="settings-range"
                />
                <input
                  type="number"
                  min="10"
                  max="24"
                  value={fontSize}
                  onChange={(e) => onFontSizeChange(Math.min(24, Math.max(10, Number(e.target.value))))}
                  className="settings-number-input"
                />
              </div>
            </div>

            {/* Font Preview */}
            <div
              className="font-preview-box"
              style={{
                fontSize: `${fontSize}px`,
                fontFamily: codeFontOverride ? `'${codeFontOverride}', monospace` : 'var(--code-font)',
              }}
            >
              <code>
                {`// Typography Preview\nfunction preview() {\n  const message = "Crumb Fast IDE";\n  return 42;\n}`}
              </code>
            </div>
          </section>

          {/* Editor Behavior */}
          <section className="settings-section">
            <h3 className="settings-section-title">Editor Behavior</h3>
            <p className="settings-section-desc">Code editing experience and view formatting</p>

            {([
              ['lineNumbers', 'Line numbers'], ['bracketMatching', 'Bracket matching'],
              ['autoCloseBrackets', 'Auto-close brackets'], ['highlightActiveLine', 'Highlight active line'],
            ] as const).map(([key, label]) => <div className="settings-row" key={key}>
              <label htmlFor={`editor-${key}`}>{label}</label>
              <button id={`editor-${key}`} className={`toggle-switch ${editorPreferences[key] ? 'checked' : ''}`} role="switch" aria-checked={editorPreferences[key]} onClick={() => onEditorPreferencesChange({ ...editorPreferences, [key]: !editorPreferences[key] })}><span className="toggle-slider" /></button>
            </div>)}
            <div className="settings-row">
              <label htmlFor="indent-size">Indent size</label>
              <select id="indent-size" className="settings-select" value={editorPreferences.indentSize} onChange={event => onEditorPreferencesChange({ ...editorPreferences, indentSize: Number(event.target.value) as 2 | 3 | 4 })}>
                {[2, 3, 4].map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor="indent-with">Indent with</label>
              <select id="indent-with" className="settings-select" value={editorPreferences.indentWith} onChange={event => onEditorPreferencesChange({ ...editorPreferences, indentWith: event.target.value as 'spaces' | 'tabs' })}>
                <option value="spaces">Spaces</option><option value="tabs">Tabs</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <label htmlFor="word-wrap-toggle">Word Wrap</label>
                <small>Wrap long lines automatically in the code editor</small>
              </div>
              <div className="settings-row-control">
                <button
                  id="word-wrap-toggle"
                  className={`toggle-switch ${wordWrap ? 'checked' : ''}`}
                  onClick={() => onWordWrapChange(!wordWrap)}
                  role="switch"
                  aria-checked={wordWrap}
                >
                  <span className="toggle-slider" />
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <button className="settings-done-btn" onClick={onResetLayout}>Reset layout</button>
          <button className="settings-done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
