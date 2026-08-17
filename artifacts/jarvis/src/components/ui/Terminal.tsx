/**
 * Terminal Component — Liquid Glass Design System
 */

import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import "./Terminal.css";

export interface TerminalProps {
  /** Initial command to run */
  command?: string;
  /** Command arguments */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Terminal dimensions */
  cols?: number;
  rows?: number;
  /** Font size */
  fontSize?: number;
  /** Font family */
  fontFamily?: string;
  /** Line height */
  lineHeight?: number;
  /** Cursor blink */
  cursorBlink?: boolean;
  /** Cursor style */
  cursorStyle?: "block" | "underline" | "bar";
  /** Scrollback buffer size */
  scrollback?: number;
  /** Allow paste */
  allowPaste?: boolean;
  /** Allow transpose */
  allowTranspose?: boolean;
  /** Theme */
  theme?: "light" | "dark" | "auto";
  /** Callback when terminal is ready */
  onReady?: (terminal: TerminalInstance) => void;
  /** Callback when data is received */
  onData?: (data: string) => void;
  /** Callback when process exits */
  onExit?: (code: number) => void;
  /** Callback when title changes */
  onTitleChange?: (title: string) => void;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export interface TerminalInstance {
  /** Write data to terminal */
  write: (data: string) => void;
  /** Write line to terminal */
  writeln: (data: string) => void;
  /** Resize terminal */
  resize: (cols: number, rows: number) => void;
  /** Clear terminal */
  clear: () => void;
  /** Reset terminal */
  reset: () => void;
  /** Focus terminal */
  focus: () => void;
  /** Get terminal element */
  element: HTMLElement | null;
  /** Process ID */
  pid?: number;
  /** Is process running */
  running: boolean;
}

const Terminal = forwardRef<HTMLDivElement, TerminalProps>(
  (
    {
      command,
      args = [],
      cwd = process.env.HOME || "/",
      env = {},
      cols = 80,
      rows = 24,
      fontSize = 14,
      fontFamily = "var(--font-mono)",
      lineHeight = 1.4,
      cursorBlink = true,
      cursorStyle = "block",
      scrollback = 10000,
      allowPaste = true,
      allowTranspose = true,
      theme = "auto",
      onReady,
      onData,
      onExit,
      onTitleChange,
      className = "",
      style,
    },
    ref
  ) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<any>(null);
    const fitAddonRef = useRef<any>(null);
    const [ready, setReady] = useState(false);
    const [running, setRunning] = useState(false);
    const [pid, setPid] = useState<number | undefined>();

    // Initialize xterm.js
    useEffect(() => {
      let mounted = true;

      const initTerminal = async () => {
        try {
          // Dynamic imports for xterm.js
          const { Terminal: XTermTerminal } = await import("xterm");
          const { FitAddon } = await import("xterm-addon-fit");
          const { WebLinksAddon } = await import("xterm-addon-web-links");
          const { SearchAddon } = await import("xterm-addon-search");

          const term = new XTermTerminal({
            cols,
            rows,
            fontSize,
            fontFamily,
            lineHeight,
            cursorBlink,
            cursorStyle,
            scrollback,
            allowPaste,
            allowTranspose,
            theme: getTheme(theme),
            convertEol: true,
            disableStdin: false,
            macOptionIsMeta: true,
            macOptionClickForcesSelection: false,
            minimumContrastRatio: 1,
            rightClickSelectsWord: true,
            screenReaderMode: false,
            tabStopWidth: 8,
            unicodeVersion: "15",
            windowsMode: false,
            windowsPty: undefined,
          });

          const fitAddon = new FitAddon();
          term.loadAddon(fitAddon);
          term.loadAddon(new WebLinksAddon());
          term.loadAddon(new SearchAddon());

          if (terminalRef.current && mounted) {
            term.open(terminalRef.current);
            fitAddon.fit();

            xtermRef.current = term;
            fitAddonRef.current = fitAddon;
            setReady(true);

            const instance: TerminalInstance = {
              write: (data: string) => term.write(data),
              writeln: (data: string) => term.writeln(data),
              resize: (c: number, r: number) => {
                term.resize(c, r);
                fitAddon.fit();
              },
              clear: () => term.clear(),
              reset: () => term.reset(),
              focus: () => term.focus(),
              element: terminalRef.current,
              running: false,
            };

            onReady?.(instance);
          }

          // Handle data output
          term.onData((data: string) => {
            onData?.(data);
          });

          // Handle title changes
          term.onTitleChange((title: string) => {
            onTitleChange?.(title);
          });

          // Start process if command provided
          if (command) {
            startProcess(term, command, args, cwd, env);
          }
        } catch (err) {
          console.error("Failed to initialize terminal:", err);
        }
      };

      initTerminal();

      return () => {
        mounted = false;
        if (xtermRef.current) {
          xtermRef.current.dispose();
          xtermRef.current = null;
        }
      };
    }, [command, args, cwd, env, cols, rows, fontSize, fontFamily, lineHeight, cursorBlink, cursorStyle, scrollback, allowPaste, allowTranspose, theme, onReady, onData, onExit, onTitleChange]);

    // Resize handler
    useEffect(() => {
      if (!ready || !fitAddonRef.current) return;

      const handleResize = () => {
        fitAddonRef.current?.fit();
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, [ready]);

    // Theme change handler
    useEffect(() => {
      if (!xtermRef.current) return;
      xtermRef.current.options.theme = getTheme(theme);
    }, [theme]);

    const startProcess = async (term: any, cmd: string, args: string[], cwd: string, env: Record<string, string>) => {
      try {
        // For web environment, we'd use a WebSocket connection to a backend PTY
        // This is a simplified version - in production you'd connect to a PTY server
        setRunning(true);

        // Simulate a shell prompt
        term.write("\r\n$ ");
        term.onData((data: string) => {
          // Echo input for demo
          term.write(data);
          if (data === "\r") {
            term.write("\r\n$ ");
          }
        });
      } catch (err) {
        console.error("Failed to start process:", err);
        setRunning(false);
      }
    };

    const getTheme = (theme: string) => {
      if (theme === "light") return { background: "#fafafa", foreground: "#171717", cursor: "#6366f1", selection: "rgba(99, 102, 241, 0.3)" };
      if (theme === "dark") return { background: "#0a0a0a", foreground: "#fafafa", cursor: "#818cf8", selection: "rgba(129, 140, 248, 0.3)" };
      // Auto - use CSS variables
      return {
        background: "var(--bg-base)",
        foreground: "var(--text-primary)",
        cursor: "var(--color-brand-500)",
        selection: "rgba(99, 102, 241, 0.3)",
        black: "var(--color-neutral-900)",
        red: "var(--color-error-500)",
        green: "var(--color-success-500)",
        yellow: "var(--color-warning-500)",
        blue: "var(--color-brand-500)",
        magenta: "#a855f7",
        cyan: "var(--color-info-500)",
        white: "var(--color-neutral-100)",
        brightBlack: "var(--color-neutral-500)",
        brightRed: "var(--color-error-400)",
        brightGreen: "var(--color-success-400)",
        brightYellow: "var(--color-warning-400)",
        brightBlue: "var(--color-brand-400)",
        brightMagenta: "#c084fc",
        brightCyan: "var(--color-info-400)",
        brightWhite: "var(--color-neutral-50)",
      };
    };

    useImperativeHandle(ref, () => ({
      write: (data: string) => xtermRef.current?.write(data),
      writeln: (data: string) => xtermRef.current?.writeln(data),
      resize: (c: number, r: number) => {
        xtermRef.current?.resize(c, r);
        fitAddonRef.current?.fit();
      },
      clear: () => xtermRef.current?.clear(),
      reset: () => xtermRef.current?.reset(),
      focus: () => xtermRef.current?.focus(),
      element: terminalRef.current,
      pid,
      running,
    }));

    const classNames = ["terminal", `terminal--${theme}`, ready && "terminal--ready", running && "terminal--running", className].filter(Boolean).join(" ");

    return (
      <div
        ref={terminalRef}
        className={classNames}
        style={{
          ...style,
          fontFamily,
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight,
        } as React.CSSProperties}
        tabIndex={0}
      />
    );
  }
);

Terminal.displayName = "Terminal";

/** Terminal Toolbar */
export interface TerminalToolbarProps {
  terminal: TerminalInstance | null;
  title?: string;
  showControls?: boolean;
  onClear?: () => void;
  onReset?: () => void;
  onResize?: (cols: number, rows: number) => void;
  className?: string;
}

export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  terminal,
  title = "Terminal",
  showControls = true,
  onClear,
  onReset,
  onResize,
  className = "",
}) => {
  const classNames = ["terminal-toolbar", className].filter(Boolean).join(" ");

  return (
    <div className={classNames} role="toolbar" aria-label="Terminal controls">
      <div className="terminal-toolbar__title">{title}</div>
      {showControls && (
        <div className="terminal-toolbar__actions">
          <button
            className="terminal-toolbar__btn"
            onClick={onClear}
            disabled={!terminal}
            aria-label="Clear terminal"
            title="Clear"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button
            className="terminal-toolbar__btn"
            onClick={onReset}
            disabled={!terminal}
            aria-label="Reset terminal"
            title="Reset"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7" />
              <path d="M21 3l-7 7" />
              <path d="M14 3v4h4" />
            </svg>
          </button>
          <div className="terminal-toolbar__size">
            <select
              className="terminal-toolbar__select"
              onChange={(e) => onResize?.(parseInt(e.target.value.split("x")[0]), parseInt(e.target.value.split("x")[1]))}
              aria-label="Terminal size"
            >
              <option value="80x24">80×24</option>
              <option value="120x30">120×30</option>
              <option value="160x40">160×40</option>
              <option value="200x50">200×50</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

/** Terminal Session — manages multiple terminal tabs */
export interface TerminalSessionProps {
  sessions: Array<{
    id: string;
    title: string;
    terminal: TerminalInstance | null;
    active: boolean;
  }>;
  activeSessionId: string;
  onSwitchSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onNewSession: () => void;
  className?: string;
}

export const TerminalSession: React.FC<TerminalSessionProps> = ({
  sessions,
  activeSessionId,
  onSwitchSession,
  onCloseSession,
  onNewSession,
  className = "",
}) => {
  const classNames = ["terminal-session", className].filter(Boolean).join(" ");

  return (
    <div className={classNames}>
      <div className="terminal-session__tabs" role="tablist">
        {sessions.map((session) => (
          <button
            key={session.id}
            role="tab"
            aria-selected={session.id === activeSessionId}
            className={`terminal-session__tab ${session.id === activeSessionId ? "terminal-session__tab--active" : ""}`}
            onClick={() => onSwitchSession(session.id)}
            type="button"
          >
            <span className="terminal-session__tab-title">{session.title}</span>
            <button
              className="terminal-session__tab-close"
              onClick={(e) => { e.stopPropagation(); onCloseSession(session.id); }}
              aria-label={`Close ${session.title}`}
              type="button"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </button>
        ))}
        <button
          className="terminal-session__new-tab"
          onClick={onNewSession}
          aria-label="New terminal"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="terminal-session__content" role="tabpanel">
        {sessions.find((s) => s.id === activeSessionId)?.terminal?.element && (
          <div className="terminal-session__active">
            {sessions.find((s) => s.id === activeSessionId)?.terminal?.element}
          </div>
        )}
      </div>
    </div>
  );
};