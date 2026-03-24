import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  spawnTerminal,
  writeTerminal,
  resizeTerminal,
  onTerminalOutput,
  killTerminal,
} from '../lib/ipc';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  cwd: string;
}

export function Terminal({ cwd }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<string | null>(null);
  const initialCwdRef = useRef(cwd || '.');

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let dataSubscription: { dispose: () => void } | null = null;
    let resizeSubscription: { dispose: () => void } | null = null;

    const term = new XTerm({
      theme: {
        background: '#11161e',
        foreground: '#d7deea',
        cursor: '#f2b66b',
        selectionBackground: '#43506a66',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.22,
      cursorBlink: true,
      letterSpacing: 0.2,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    const startTerminal = async () => {
      try {
        const id = await spawnTerminal(initialCwdRef.current);
        if (disposed) {
          await killTerminal(id);
          return;
        }
        terminalIdRef.current = id;

        unlisten = await onTerminalOutput(id, (data) => {
          if (!disposed) {
            term.write(data);
          }
        });

        dataSubscription = term.onData((data) => {
          void writeTerminal(id, data);
        });

        resizeSubscription = term.onResize(({ cols, rows }) => {
          void resizeTerminal(id, cols, rows);
        });

        fitAddon.fit();
        void resizeTerminal(id, term.cols, term.rows);
      } catch {
        term.writeln('');
        term.writeln('[terminal failed to start]');
      }
    };

    void startTerminal();

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (terminalIdRef.current) {
        void resizeTerminal(terminalIdRef.current, term.cols, term.rows);
      }
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSubscription?.dispose();
      resizeSubscription?.dispose();
      unlisten?.();
      term.dispose();
      const currentId = terminalIdRef.current;
      terminalIdRef.current = null;
      if (currentId) {
        void killTerminal(currentId);
      }
    };
  }, []);

  return (
    <div className="terminal-root">
      <div className="terminal-header">
        <span>terminal</span>
        <span className="terminal-header__hint">{initialCwdRef.current}</span>
      </div>
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}
