import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Globe, ArrowLeft, ArrowRight, RotateCcw, Maximize2, Minimize2, Bot, Play, Square, Pause, Grid3X3, Loader2, MousePointer2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  cursorX: number;
  cursorY: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface AgentLogEntry {
  id: number;
  type: 'start' | 'step' | 'action' | 'done' | 'error';
  message: string;
  ok?: boolean;
}

interface InfinityBrowserProps {
  /** CSS class name */
  className?: string;
  /** Called when a new action is taken (for voice command feedback) */
  onAction?: (action: string) => void;
  /** When set (non-empty), the agent loop starts automatically with this goal */
  autoRunGoal?: string | null;
  /** Called after autoRunGoal has been consumed (so the parent can reset it) */
  onGoalHandled?: () => void;
}

/**
 * Infinity's Personal Browser component.
 * Displays live screenshots from the Puppeteer browser on the backend.
 * The user can see exactly what Infinity is browsing, and take control.
 *
 * Includes the autonomous agent mode: give Infinity a goal and the vision LLM
 * drives the browser using a fine-grained grid (tiny cubes) so even small
 * buttons can be clicked precisely.
 */
export function InfinityBrowser({ className = '', onAction, autoRunGoal, onGoalHandled }: InfinityBrowserProps) {
  const { t } = useI18n();
  const [state, setState] = useState<BrowserState | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [connectionFailed, setConnectionFailed] = useState(false);
  const reconnectAttemptsRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Agent mode state ────────────────────────────────────────────
  const [agentGoal, setAgentGoal] = useState('');
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [cellSize, setCellSize] = useState(24);
  const [imgRect, setImgRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);
  const logIdRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const addLog = useCallback((type: AgentLogEntry['type'], message: string, ok?: boolean) => {
    const id = ++logIdRef.current;
    setAgentLog((prev) => [...prev, { id, type, message, ok }]);
  }, []);

  // ── Compute the displayed image rect so the grid overlay aligns ──
  useEffect(() => {
    const container = viewportRef.current;
    const img = imgRef.current;
    if (!container || !img) {
      setImgRect(null);
      return;
    }
    const compute = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const nw = img.naturalWidth || 1280;
      const nh = img.naturalHeight || 720;
      const scale = Math.min(cw / nw, ch / nh);
      const w = nw * scale;
      const h = nh * scale;
      setImgRect({ left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [screenshot, fullscreen]);

  // Get WebSocket URL from backend
  useEffect(() => {
    fetch('/api/jarvis/browse/ws-url')
      .then((r) => r.json())
      .then((data) => {
        // If the server returned an internal/local URL (e.g. behind a proxy
        // that rewrites the Host header), prefer this page's own origin, the
        // browser WebSocket is always served on the same origin via /browser-ws.
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const own = `${proto}//${window.location.host}/browser-ws`;
        const url = data.url;
        const isLocal = url && /localhost|127\.0\.0\.1|0\.0\.0\.0|:\d*8080/.test(url);
        setWsUrl(isLocal ? own : url);
      })
      .catch(() => {
        // Fallback: derive from current location (same-origin /browser-ws path)
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        setWsUrl(`${proto}//${window.location.host}/browser-ws`);
      });
  }, []);

  // Connect to WebSocket for live screenshots
  const connectWs = useCallback(() => {
    if (!wsUrl) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        onAction?.('Browser connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'screenshot') {
            setScreenshot(`data:image/jpeg;base64,${msg.data}`);
          } else if (msg.type === 'state') {
            setState(msg.data);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectAttemptsRef.current += 1;
        // After 2 failed attempts, show the browser-service unavailable state
        // with a retry button, don't keep silently reconnecting.
        if (reconnectAttemptsRef.current >= 2) {
          setConnectionFailed(true);
          return;
        }
        // Auto-reconnect once more after a short pause
        reconnectTimerRef.current = setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      // Connection failed, retry later
      reconnectTimerRef.current = setTimeout(connectWs, 5000);
    }
  }, [wsUrl, onAction]);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectWs]);

  // ── Agent loop: consume the auto-run goal, then stream SSE events ──
  const startAgentRun = useCallback(async (goalText?: string) => {
    const goal = (goalText ?? agentGoal).trim();
    if (!goal || agentRunning) return;

    if (agentAbortRef.current) agentAbortRef.current.abort();
    const controller = new AbortController();
    agentAbortRef.current = controller;
    setAgentRunning(true);
    setAgentPaused(false);
    setAgentError(null);
    setAgentLog([]);
    logIdRef.current = 0;
    addLog('start', `Goal: ${goal}`);

    try {
      const res = await fetch('/api/jarvis/browse/agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, maxSteps: 20, cellSize }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const msg = JSON.parse(data);
            handleAgentEvent(msg);
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const message = (err as Error).message;
        setAgentError(message);
        addLog('error', `Run failed: ${message}`);
      }
    } finally {
      setAgentRunning(false);
      agentAbortRef.current = null;
    }
  }, [agentGoal, agentRunning, cellSize, addLog]);

  const handleAgentEvent = useCallback((msg: any) => {
    switch (msg.type) {
      case 'start':
        break; // already logged
      case 'step': {
        let detail = `${msg.action}`;
        if (msg.action === 'click_element' && msg.index !== undefined) detail += ` element #${msg.index}`;
        if (msg.action === 'click' && msg.x && msg.y) detail += ` cell (${msg.x}, ${msg.y})`;
        if (msg.action === 'type') detail += ` into #${msg.index !== undefined ? msg.index : 'focused'} "${msg.text ?? ''}"${msg.enter ? ' + Enter' : ''}`;
        if (msg.action === 'navigate') detail += ` ${msg.url}`;
        if (msg.action === 'scroll') detail += ` ${msg.dy ?? ''}px`;
        addLog('step', `Step ${msg.step}: ${detail}${msg.reason ? `, ${msg.reason}` : ''}`);
        break;
      }
      case 'action':
        addLog('action', msg.success ? `${msg.action} done` : `${msg.action} failed: ${msg.error ?? 'unknown'}`, msg.success);
        break;
      case 'done':
        addLog('done', msg.summary ?? 'Task complete.');
        setAgentRunning(false);
        break;
      case 'paused':
        setAgentPaused(true);
        addLog('step', '[PAUSED] You have control');
        break;
      case 'resumed':
        setAgentPaused(false);
        addLog('step', '[RESUMED]');
        break;
      case 'error':
        addLog('error', msg.message ?? 'Unknown error');
        break;
    }
  }, [addLog]);

  const stopAgentRun = useCallback(() => {
    agentAbortRef.current?.abort();
    setAgentRunning(false);
    setAgentPaused(false);
    addLog('error', 'Run stopped by user');
  }, [addLog]);

  const pauseAgentRun = useCallback(() => {
    setAgentPaused(true);
    fetch('/api/jarvis/browse/pause', { method: 'POST' }).catch(() => {});
    addLog('step', '[PAUSED] Take control of the browser');
  }, [addLog]);

  const resumeAgentRun = useCallback(() => {
    setAgentPaused(false);
    fetch('/api/jarvis/browse/resume', { method: 'POST' }).catch(() => {});
    addLog('step', '[RESUMING]');
  }, [addLog]);

  // Auto-start when the parent sets a goal (agent mode / search detection)
  useEffect(() => {
    if (autoRunGoal && autoRunGoal.trim()) {
      setAgentGoal(autoRunGoal);
      const goal = autoRunGoal.trim();
      // Slight delay so the WebSocket/screenshot stream is ready.
      const t = setTimeout(() => {
        startAgentRun(goal);
        onGoalHandled?.();
      }, 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoRunGoal, startAgentRun, onGoalHandled]);

  // Abort any running agent loop on unmount
  useEffect(() => {
    return () => agentAbortRef.current?.abort();
  }, []);

  // Execute a browser action via the REST API
  const executeAction = useCallback(async (action: string, payload?: any) => {
    // Manual takeover: touching the browser mid-run pauses the agent loop.
    if (agentRunning && !agentPaused) {
      pauseAgentRun();
    }
    try {
      const res = await fetch('/api/jarvis/browse/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      const data = await res.json();
      if (data.browserState) {
        setState(data.browserState);
      }
      return data;
    } catch (err) {
      console.error('Browser action failed:', err);
      return { success: false };
    }
  }, [agentRunning, agentPaused, pauseAgentRun]);

  // Navigate to a URL
  const handleNavigate = useCallback((url?: string) => {
    const target = url || urlInput;
    if (!target) return;

    let fullUrl = target;
    if (!/^https?:\/\//i.test(target)) {
      fullUrl = 'https://' + target;
    }

    executeAction('navigate', fullUrl);
    setUrlInput(fullUrl);
    onAction?.(`Opening ${target}`);
  }, [urlInput, executeAction, onAction]);

  // Click on the page at a position
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    executeAction('click', { x, y });
    onAction?.(`Clicked at (${Math.round(x)}, ${Math.round(y)})`);
  }, [executeAction, onAction]);

  // Keyboard shortcut for URL input
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNavigate();
    }
  }, [handleNavigate]);

  // Scroll the page
  const handleScroll = useCallback((dx: number, dy: number) => {
    executeAction('scroll', { dx, dy });
  }, [executeAction]);

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className={`flex items-center gap-2 px-3 py-2 bg-card border border-border/50 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground transition-colors ${className}`}
      >
        <Globe className="w-3.5 h-3.5" />
        <span>Infinity's Browser</span>
        {state?.title && <span className="text-[10px] truncate max-w-[120px]">{state.title}</span>}
        <Maximize2 className="w-3 h-3 ml-1" />
      </button>
    );
  }

  return (
    <div className={`flex flex-col bg-card rounded-lg border border-border/50 overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/30 border-b border-border/30">
        {/* Navigation buttons */}
        <button
          onClick={() => executeAction('back')}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => executeAction('forward')}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Forward"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleNavigate(state?.url)}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Reload"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-1.5 px-2 bg-background rounded border border-border/30">
          <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('browser.urlPlaceholder')}
            className="flex-1 bg-transparent text-xs font-mono py-1 outline-none text-foreground placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Connection indicator */}
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} flex-shrink-0`} title={connected ? 'Connected' : 'Disconnected'} />

        {/* Grid overlay toggle, the tiny cubes the agent clicks */}
        <button
          onClick={() => setShowGrid(g => !g)}
          className={`p-1 rounded hover:bg-muted/50 transition-colors ${showGrid ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          title={showGrid ? 'Hide click grid' : 'Show click grid (tiny cubes)'}
        >
          <Grid3X3 className="w-3.5 h-3.5" />
        </button>

        {/* Minimize button */}
        <button
          onClick={() => setMinimized(true)}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Minimize"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
        {/* Fullscreen toggle */}
        <button
          onClick={() => setFullscreen(f => !f)}
          className={`p-1 rounded hover:bg-muted/50 transition-colors ${fullscreen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          title={fullscreen ? 'Collapse' : 'Fullscreen'}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Agent control bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-primary/5 border-b border-border/30">
        <Bot className={`w-3.5 h-3.5 flex-shrink-0 ${agentRunning ? 'text-primary animate-pulse' : 'text-primary/70'}`} />
        <input
          type="text"
          value={agentGoal}
          onChange={(e) => setAgentGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') startAgentRun(); }}
          placeholder={t('browser.agentPlaceholder')}
          disabled={agentRunning}
          className="flex-1 bg-transparent text-[11px] font-mono py-1 outline-none text-foreground placeholder:text-muted-foreground/50 disabled:opacity-50"
        />
        <select
          value={cellSize}
          onChange={(e) => setCellSize(Number(e.target.value))}
          disabled={agentRunning}
          className="bg-background border border-border/30 rounded text-[10px] font-mono text-muted-foreground px-1 py-0.5 outline-none disabled:opacity-50"
          title="Grid cell size (px), smaller = more precise for tiny buttons"
        >
          <option value={16}>16px</option>
          <option value={24}>24px</option>
          <option value={32}>32px</option>
        </select>
        {agentRunning ? (
          <>
            {agentPaused ? (
              <button
                onClick={resumeAgentRun}
                className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 transition-colors text-[10px] font-mono"
                title="Resume the agent - it continues the same goal"
              >
                <Play className="w-3 h-3" /> Resume
              </button>
            ) : (
              <button
                onClick={pauseAgentRun}
                className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 transition-colors text-[10px] font-mono"
                title="Pause the agent and take over the browser yourself"
              >
                <Pause className="w-3 h-3" /> Pause
              </button>
            )}
            <button
              onClick={stopAgentRun}
              className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors text-[10px] font-mono"
              title="Stop the agent"
            >
              <Square className="w-3 h-3" /> Stop
            </button>
          </>
        ) : (
          <button
            onClick={() => startAgentRun()}
            className="flex items-center gap-1 px-2 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors text-[10px] font-mono"
            title="Start the agent"
          >
            <Play className="w-3 h-3" /> Run
          </button>
        )}
      </div>

      {/* Live agent log */}
      {agentLog.length > 0 && (
        <div className="max-h-24 overflow-y-auto px-2 py-1.5 bg-black/40 border-b border-border/30 font-mono text-[9px] space-y-0.5">
          {agentLog.map((entry) => (
            <div
              key={entry.id}
              className={`flex items-start gap-1 ${
                entry.type === 'error' ? 'text-red-400'
                : entry.type === 'done' ? 'text-green-400'
                : entry.type === 'action' ? (entry.ok ? 'text-emerald-300/90' : 'text-red-300/90')
                : entry.type === 'step' ? 'text-primary/90'
                : 'text-muted-foreground'
              }`}
            >
               <span className="flex-shrink-0 select-none" aria-hidden="true">
                 {entry.type === 'start' && <Play className="w-2.5 h-2.5 fill-current" />}
                 {entry.type === 'done' && <CheckCircle2 className="w-2.5 h-2.5" />}
                 {entry.type === 'error' && <AlertTriangle className="w-2.5 h-2.5" />}
                 {entry.type === 'action' && <Circle className="w-2 h-2 fill-current" />}
                 {entry.type === 'step' && <ChevronRight className="w-2.5 h-2.5" />}
               </span>
              <span className="break-words">{entry.message}</span>
            </div>
          ))}
          {agentRunning && (
            <div className="flex items-center gap-1 text-muted-foreground/70">
              <Loader2 className="w-2.5 h-2.5 animate-spin" /> thinking…
            </div>
          )}
        </div>
      )}

      {/* Browser viewport */}
      <div
        ref={viewportRef}
        className={`relative cursor-crosshair overflow-hidden ${fullscreen ? 'flex-1' : ''} ${screenshot ? 'bg-black' : 'bg-card'}`}
        style={{ minHeight: 300, maxHeight: fullscreen ? 'none' : 500 }}
        onClick={handleCanvasClick}
      >
        {screenshot ? (
          <>
            <img
              ref={imgRef}
              src={screenshot}
              alt="Infinity's Browser"
              className="w-full h-full object-contain"
              draggable={false}
            />
            {/* Tiny-cube click grid overlay (aligned to the displayed image) */}
            {showGrid && imgRect && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: imgRect.left,
                  top: imgRect.top,
                  width: imgRect.width,
                  height: imgRect.height,
                  backgroundImage: `repeating-linear-gradient(to right, rgba(255,90,150,0.5) 0px, rgba(255,90,150,0.5) 1px, transparent 1px, transparent ${(cellSize / 1280) * imgRect.width}px), repeating-linear-gradient(to bottom, rgba(90,220,255,0.5) 0px, rgba(90,220,255,0.5) 1px, transparent 1px, transparent ${(cellSize / 720) * imgRect.height}px)`,
                  backgroundSize: `${(cellSize / 1280) * imgRect.width}px ${(cellSize / 720) * imgRect.height}px`,
                }}
              />
            )}
            {/* Cursor indicator */}
            {state && (
              <div
                className="absolute w-4 h-4 pointer-events-none"
                style={{
                  left: (state.cursorX / state.viewportWidth) * 100 + '%',
                  top: (state.cursorY / state.viewportHeight) * 100 + '%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <MousePointer2 className="w-4 h-4 text-emerald-400" strokeWidth={2} />
              </div>
            )}
            {/* Paused takeover banner */}
            {agentPaused && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-amber-500/90 backdrop-blur rounded-full text-[10px] font-mono text-white shadow-apple-md z-10">
                PAUSED - you have control. Press Resume to hand it back.
              </div>
            )}
            {/* Loading indicator */}
            {state?.loading && (
              <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-primary animate-pulse">
                Loading...
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-xs font-mono">
            {connectionFailed ? (
              <>
                <Globe className="w-8 h-8 text-muted-foreground/40" />
                <span className="text-center max-w-[240px] font-sans text-muted-foreground">
                  <span className="block font-semibold text-foreground mb-1">Browser service unavailable</span>
                  Infinity could not connect to the in-app browser. Make sure the Infinity API is running and Chromium is installed on the server.
                </span>
                <button
                  onClick={() => { setConnectionFailed(false); reconnectAttemptsRef.current = 0; connectWs(); }}
                  className="px-3 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors text-[11px]"
                >
                  Retry connection
                </button>
              </>
            ) : connected ? (
              <span>Waiting for browser view...</span>
            ) : (
              <>
                <Globe className="w-8 h-8 text-muted-foreground/30 animate-pulse" />
                <span className="text-center max-w-[200px]">
                  Connecting to browser...
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-2 py-1 bg-muted/20 border-t border-border/30">
        <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[60%]">
          {state?.url || 'No page loaded'}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {state?.title || ''}
        </span>
      </div>

      {/* Scroll controls */}
      <div className="flex justify-center gap-4 px-2 py-1 bg-muted/10 border-t border-border/20">
        <button
          onClick={() => handleScroll(0, -200)}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          Scroll Up
        </button>
        <button
          onClick={() => handleScroll(0, 200)}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          Scroll Down
        </button>
        <button
          onClick={() => executeAction('type', { text: 'Hello from Infinity' })}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          Type Test
        </button>
      </div>
    </div>
  );
}
