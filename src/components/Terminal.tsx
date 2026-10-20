import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Theme } from '../lib/themes';
import { startPtySession, type PtySession } from '../lib/pty';
import { tauriPtyTransport } from '../lib/tauri-transport';

function terminalTheme(theme: Theme) {
  const { colors, syntax } = theme;
  return {
    background: colors.terminal, foreground: colors.text, cursor: colors.accent,
    selectionBackground: colors.selection,
    black: colors.activity, red: syntax.property, green: syntax.string,
    yellow: syntax.type, blue: syntax.function, magenta: syntax.keyword,
    cyan: syntax.operator, white: colors.text,
    brightBlack: colors.subtle, brightRed: syntax.tag, brightGreen: syntax.string,
    brightYellow: syntax.type, brightBlue: syntax.function,
    brightMagenta: syntax.keyword, brightCyan: syntax.operator, brightWhite: colors.text,
  };
}

interface TerminalProps {
  id: string;
  isActive: boolean;
  shell?: string;
  cwd?: string | null;
  onClick: () => void;
  onTitleChange?: (title: string) => void;
  onSessionChange?: (id: string, sessionId: string | null) => void;
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  focusRequest: number;
  clearPromptOnStart: boolean;
}

export default function Terminal({ id, isActive, shell, cwd, onClick, onTitleChange, onSessionChange, theme, fontSize, fontFamily, focusRequest, clearPromptOnStart }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new XTerm({
      fontFamily: `'${fontFamily}', monospace`,
      fontSize,
      theme: terminalTheme(theme),
      cursorBlink: true,
    });
    xtermRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    let session: PtySession | null = null;
    const pendingInput: string[] = [];
    let disposed = false;
    let resizeListener: { dispose: () => void } | null = null;

    // Let layout settle before measuring the initial PTY size.
    const spawnTimeout = setTimeout(() => {
      fitAddon.fit();

      session = startPtySession(tauriPtyTransport, {
        rows: term.rows, cols: term.cols, shell, cwd, clearPromptOnStart,
        onOutput: data => { if (!disposed) term.write(data); },
        onError: error => {
          console.error(error);
          if (!disposed) term.write(`\r\n\x1b[1;31mTerminal error: ${error}\x1b[0m\r\n`);
        },
      });
      onSessionChange?.(id, session.id);
      for (const data of pendingInput) session.write(data);
      pendingInput.length = 0;

      resizeListener = term.onResize(({ rows, cols }) => {
        if (rows > 0 && cols > 0) {
          session?.resize(rows, cols);
        }
      });
    }, 50);

    // Track dynamic contextual heading updates from the shell
    const titleListener = term.onTitleChange((title) => {
      if (onTitleChange) onTitleChange(title);
    });

    // Send input to backend PTY
    term.onData((data: string) => {
      if (session) session.write(data);
      else pendingInput.push(data);
    });

    // Use ResizeObserver for pinpoint container detection
    const observer = new ResizeObserver(() => {
      if (term.element?.clientWidth) {
        fitAddon.fit();
      }
    });
    observer.observe(terminalRef.current);

    return () => {
      disposed = true;
      pendingInput.length = 0;
      onSessionChange?.(id, null);
      clearTimeout(spawnTimeout);
      observer.disconnect();
      if (resizeListener) resizeListener.dispose();
      titleListener.dispose();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      session?.dispose();
    };
  }, []);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.theme = terminalTheme(theme);
    term.options.fontSize = fontSize;
    term.options.fontFamily = `'${fontFamily}', monospace`;
    if (term.element?.clientWidth) fitAddonRef.current?.fit();
  }, [theme, fontSize, fontFamily]);

  useEffect(() => {
    if (focusRequest > 0 && isActive) xtermRef.current?.focus();
  }, [focusRequest, isActive]);

  return (
    <div
      ref={terminalRef}
      onFocus={onClick}
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--terminal)',
        padding: '8px',
        boxSizing: 'border-box',
        opacity: isActive ? 1.0 : 0.6,
        transition: 'opacity 0.2s',
        cursor: 'text'
      }}
    />
  );
}
