import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

export default function Terminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new XTerm({
      fontFamily: '"Fira Code", monospace',
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
      },
      cursorBlink: true,
    });
    xtermRef.current = term;

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    // Start PTY in backend
    invoke('spawn_pty').catch((err) => {
      console.error(err);
      term.write(`\r\n\x1b[1;31mError spawning PTY: ${err}\x1b[0m\r\n`);
    });

    // Listen for data from backend PTY
    let unlisten: () => void;
    listen<string>('pty-output', (event) => {
      term.write(event.payload);
    }).then((un) => {
      unlisten = un;
    });

    // Send input to backend PTY
    term.onData((data: string) => {
      invoke('write_pty', { data }).catch(console.error);
    });

    // Handle resize window
    const handleResize = () => {
      fitAddon.fit();
      const { rows, cols } = term;
      invoke('resize_pty', { rows, cols }).catch(console.error);
    };

    window.addEventListener('resize', handleResize);
    // Initial resize to inform backend
    handleResize();

    return () => {
      term.dispose();
      window.removeEventListener('resize', handleResize);
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <div
      ref={terminalRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e1e',
        padding: '8px',
        boxSizing: 'border-box'
      }}
    />
  );
}
