import React, { useRef, useEffect, useState, useCallback } from 'react';

interface TerminalProps {
  sessions: any[];
  activeSessionId: string | null;
  terminalOutput: Map<string, string>;
  onSessionChange: (id: string) => void;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onClose: (sessionId: string) => void;
  onRunCommand: (sessionId: string, command: string) => void;
  onCreateSession: () => void;
}

export function Terminal({
  sessions,
  activeSessionId,
  terminalOutput,
  onSessionChange,
  onInput,
  onResize,
  onClose,
  onRunCommand,
  onCreateSession
}: TerminalProps) {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [cols, setCols] = useState(80);
  const [rows, setRows] = useState(24);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const output = activeSessionId ? terminalOutput.get(activeSessionId) || '' : '';

  // Calculate terminal dimensions
  useEffect(() => {
    const updateSize = () => {
      if (terminalContainerRef.current) {
        const charWidth = 8.4; // approximate monospace char width
        const charHeight = 19; // approximate line height
        const newCols = Math.max(10, Math.floor(terminalContainerRef.current.clientWidth / charWidth));
        const newRows = Math.max(5, Math.floor(terminalContainerRef.current.clientHeight / charHeight));
        if (newCols !== cols || newRows !== rows) {
          setCols(newCols);
          setRows(newRows);
          if (activeSessionId) {
            onResize(activeSessionId, newCols, newRows);
          }
        }
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [cols, rows, activeSessionId, onResize]);

  // Auto-scroll to bottom
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!activeSessionId) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      onInput(activeSessionId, inputValue + '\r');
      setInputValue('');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onInput(activeSessionId, '\t');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Could implement history here
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
    } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onInput(activeSessionId, '\x03'); // Ctrl+C
    } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onInput(activeSessionId, '\x04'); // Ctrl+D
    }
  }, [activeSessionId, inputValue, onInput]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  const handleRunQuickCommand = useCallback((cmd: string) => {
    if (activeSessionId) {
      onRunCommand(activeSessionId, cmd);
    }
  }, [activeSessionId, onRunCommand]);

  if (sessions.length === 0) {
    return (
      <div className="terminal-empty">
        <div className="empty-state">
          <span className="empty-icon">⌨</span>
          <h3>No Terminal Sessions</h3>
          <p>Create a new terminal session to get started</p>
          <button className="btn primary" onClick={onCreateSession}>
            New Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-container" ref={terminalContainerRef}>
      <div className="terminal-tabs">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`terminal-tab ${activeSessionId === session.id ? 'active' : ''} ${session.status === 'exited' ? 'exited' : ''}`}
            onClick={() => onSessionChange(session.id)}
          >
            <span className="tab-name">{session.name}</span>
            <span className={`tab-status ${session.status}`}>{session.status}</span>
            <button
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onClose(session.id); }}
              title="Close terminal"
            >
              ×
            </button>
          </button>
        ))}
        <button className="terminal-tab new-tab" onClick={onCreateSession} title="New Terminal">
          +
        </button>
      </div>

      <div className="terminal-content">
        {activeSession && (
          <>
            <div className="terminal-output" ref={outputRef}>
              <pre>{output || '<no output>'}</pre>
            </div>
            <div className="terminal-input-area">
              <span className="prompt">{activeSession.cwd} $ </span>
              <input
                ref={inputRef}
                type="text"
                className="terminal-input"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type command..."
                autoFocus
              />
            </div>
          </>
        )}
      </div>

      <div className="terminal-quick-commands">
        <span className="quick-label">Quick:</span>
        <button className="quick-btn" onClick={() => handleRunQuickCommand('ls -la')}>ls -la</button>
        <button className="quick-btn" onClick={() => handleRunQuickCommand('git status')}>git status</button>
        <button className="quick-btn" onClick={() => handleRunQuickCommand('npm test')}>npm test</button>
        <button className="quick-btn" onClick={() => handleRunQuickCommand('npm run build')}>npm run build</button>
        <button className="quick-btn" onClick={() => handleRunQuickCommand('clear')}>clear</button>
      </div>
    </div>
  );
}