import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';
import type { Theme } from '../lib/themes';

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

interface PtyPayload {
  id: string;
  data: string;
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
}

export default function Terminal({ id, isActive, shell, cwd, onClick, onTitleChange, onSessionChange, theme, fontSize, fontFamily, focusRequest }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(`${id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
  const sessionId = sessionIdRef.current;

  useEffect(() => {
    if (!terminalRef.current) return;
    onSessionChange?.(id, sessionId);

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
    let unlistenPromise: Promise<() => void> | null = null;
    let spawnPromise: Promise<void> | null = null;
    let disposed = false;
    let clearPromptTimeout: ReturnType<typeof setTimeout> | null = null;
    let resizeListener: { dispose: () => void } | null = null;

    // Delay spawning by 50ms so CSS Engine perfectly calculates width/height.
    // This completely eradicates Xcode/macOS Zsh throwing initial inverted `%` lines
    // and sending duplicate prompt spam because it boots thinking it's 0x0 size!
    const spawnTimeout = setTimeout(() => {
      fitAddon.fit();

      spawnPromise = invoke<void>('spawn_pty', { id: sessionId, rows: term.rows, cols: term.cols, shell, cwd });
      void spawnPromise.then(() => {
        if (!disposed) {
          clearPromptTimeout = setTimeout(() => {
            if (!disposed) void invoke('write_pty', { id: sessionId, data: '\x0c' }).catch(console.error);
          }, 250);
        }
      }).catch(() => { /* The error is shown by the handler below. */ });
      void spawnPromise.catch((err) => {
        console.error(err);
        if (!disposed) term.write(`\r\n\x1b[1;31mError spawning PTY: ${err}\x1b[0m\r\n`);
      });

      unlistenPromise = listen<PtyPayload>('pty-output', (event) => {
        if (!disposed && event.payload.id === sessionId) {
          term.write(event.payload.data);
        }
      });

      resizeListener = term.onResize(({ rows, cols }) => {
        if (rows > 0 && cols > 0) {
          invoke('resize_pty', { id: sessionId, rows, cols }).catch(console.error);
        }
      });
    }, 50);

    // Track dynamic contextual heading updates from the shell
    const titleListener = term.onTitleChange((title) => {
      if (onTitleChange) onTitleChange(title);
    });

    // Send input to backend PTY
    term.onData((data: string) => {
      invoke('write_pty', { id: sessionId, data }).catch(console.error);
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
      onSessionChange?.(id, null);
      clearTimeout(spawnTimeout);
      if (clearPromptTimeout) clearTimeout(clearPromptTimeout);
      observer.disconnect();
      if (resizeListener) resizeListener.dispose();
      titleListener.dispose();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      if (unlistenPromise) void unlistenPromise.then(un => un()).catch(console.error);
      if (spawnPromise) {
        void spawnPromise.then(() => invoke('kill_pty', { id: sessionId })).catch(console.error);
      }
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
