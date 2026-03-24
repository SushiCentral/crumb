import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

interface PtyPayload {
  id: string;
  data: string;
}

interface TerminalProps {
  id: string;
  isActive: boolean;
  onClick: () => void;
  onTitleChange?: (title: string) => void;
}

export default function Terminal({ id, isActive, onClick, onTitleChange }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const sessionIdRef = useRef(`${id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
  const sessionId = sessionIdRef.current;

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      theme: {
        background: '#0a0a0c', // Deeper distinction from editor
        foreground: '#cccccc',
        cursor: '#ffffff',
      },
      cursorBlink: true,
    });
    xtermRef.current = term;

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    let unlistenPromise: Promise<() => void> | null = null;
    let resizeListener: { dispose: () => void } | null = null;

    // Delay spawning by 50ms so CSS Engine perfectly calculates width/height.
    // This completely eradicates Xcode/macOS Zsh throwing initial inverted `%` lines
    // and sending duplicate prompt spam because it boots thinking it's 0x0 size!
    const spawnTimeout = setTimeout(() => {
      fitAddon.fit();

      invoke('spawn_pty', { id: sessionId, rows: term.rows, cols: term.cols }).catch((err) => {
        console.error(err);
        term.write(`\r\n\x1b[1;31mError spawning PTY: ${err}\x1b[0m\r\n`);
      }).then(() => {
        // macOS Zsh specific hack to clear the three buggy initialization prompts reliably
        setTimeout(() => invoke('write_pty', { id: sessionId, data: '\x0c' }).catch(console.error), 250);
      });

      unlistenPromise = listen<PtyPayload>('pty-output', (event) => {
        if (event.payload.id === sessionId) {
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
      clearTimeout(spawnTimeout);
      observer.disconnect();
      if (resizeListener) resizeListener.dispose();
      titleListener.dispose();
      term.dispose();
      if (unlistenPromise) unlistenPromise.then(un => un());
      invoke('kill_pty', { id: sessionId }).catch(console.error);
    };
  }, []);

  return (
    <div
      ref={terminalRef}
      onFocus={onClick}
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0a0a0c',
        padding: '8px',
        boxSizing: 'border-box',
        opacity: isActive ? 1.0 : 0.6,
        transition: 'opacity 0.2s',
        cursor: 'text'
      }}
    />
  );
}
