import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, Bot, Play, Pause, Square, Hand, Loader2, Maximize2, Minimize2, ArrowLeft, ArrowRight, RotateCcw, Grid3X3 } from 'lucide-react';

interface BrowserWidgetProps {
  /** The goal/query to run in agent mode */
  goal: string;
  /** Called when the widget is closed */
  onClose?: () => void;
  /** Auto-start the agent on mount? */
  autoStart?: boolean;
}

interface AgentStep {
  step: number;
  action: string;
  reason?: string;
  success?: boolean;
  url?: string;
}

interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
}

/**
 * Browser Widget — a LIVE widget that shows what Infinity is currently doing
 * in its Puppeteer browser. Double-click to take over (AI pauses, you control).
 * When paused, a button appears beneath to let the AI resume.
 *
 * Uses the @Agent command — "search for Nike coupon codes on google, test them
 * on Nike.com and return a .txt file with every working code"
 */
export function BrowserWidget({ goal, onClose, autoStart = true }: BrowserWidgetProps) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [state, setState] = useState<BrowserState | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string>('Initializing...');
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [manualControl, setManualControl] = useState(false);
  const [lastDoubleTap, setLastDoubleTap] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stepIdRef = useRef(0);

  // Get WebSocket URL
  useEffect(() => {
    fetch('/api/infinity/browse/ws-url')
      .then((r) => r.json())
      .then((data) => {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const own = `${proto}//${window.location.host}/browser-ws`;
        const url = data.url;
        const isLocal = url && /localhost|127\.0\.0\.1|0\.0\.0\.0|:\d*8080/.test(url);
        setWsUrl(isLocal ? own : url);
      })
      .catch(() => {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        setWsUrl(`${proto}//${window.location.host}/browser-ws`);
      });
  }, []);

  // Connect WebSocket for live screenshots
  const connectWs = useCallback(() => {
    if (!wsUrl) return;
    if (wsRef.current) wsRef.current.close();

    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'screenshot') {
            setScreenshot(`data:image/jpeg;base64,${msg.data}`);
          } else if (msg.type === 'state') {
            setState(msg.data);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectAttemptsRef.current += 1;
        if (reconnectAttemptsRef.current < 3) {
          setTimeout(connectWs, 2000);
        }
      };
      ws.onerror = () => ws.close();
      wsRef.current = ws;
    } catch {
      setTimeout(connectWs, 5000);
    }
  }, [wsUrl]);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs]);

  // Start agent run
  const startAgentRun = useCallback(async () => {
    if (!goal.trim() || agentRunning) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAgentRunning(true);
    setAgentPaused(false);
    setSteps([]);
    setCurrentStep('Starting agent...');
    stepIdRef.current = 0;

    try {
      const res = await fetch('/api/infinity/browse/agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), maxSteps: 20, cellSize: 24 }),
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
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setCurrentStep(`Error: ${(err as Error).message}`);
      }
    } finally {
      setAgentRunning(false);
      abortRef.current = null;
    }
  }, [goal, agentRunning]);

  const handleAgentEvent = useCallback((msg: any) => {
    switch (msg.type) {
      case 'step': {
        const stepNum = msg.step ?? ++stepIdRef.current;
        let detail = `${msg.action}`;
        if (msg.action === 'click_element' && msg.index !== undefined) detail += ` element #${msg.index}`;
        if (msg.action === 'click' && msg.x && msg.y) detail += ` (${msg.x}, ${msg.y})`;
        if (msg.action === 'type' && msg.text) detail += ` "${msg.text}"${msg.enter ? ' + Enter' : ''}`;
        if (msg.action === 'navigate' && msg.url) detail += ` ${msg.url}`;
        if (msg.action === 'scroll' && msg.dy) detail += ` ${msg.dy}px`;
        setCurrentStep(detail + (msg.reason ? ` — ${msg.reason}` : ''));
        setSteps((prev) => [...prev, { step: stepNum, action: detail, reason: msg.reason }]);
        break;
      }
      case 'action':
        setCurrentStep(msg.success ? `${msg.action} done` : `${msg.action} failed`);
        setSteps((prev) => prev.map((s, i) =>
          i === prev.length - 1 ? { ...s, success: msg.success } : s
        ));
        break;
      case 'done':
        setCurrentStep(msg.summary ?? 'Task complete');
        setAgentRunning(false);
        break;
      case 'paused':
        setAgentPaused(true);
        setManualControl(true);
        setCurrentStep(msg.reason ?? 'Paused — you have control');
        break;
      case 'resumed':
        setAgentPaused(false);
        setManualControl(false);
        setCurrentStep('Resuming...');
        break;
      case 'error':
        setCurrentStep(`Error: ${msg.message ?? 'Unknown'}`);
        break;
    }
  }, []);

  // Auto-start on mount
  useEffect(() => {
    if (autoStart && goal.trim()) {
      const t = setTimeout(() => startAgentRun(), 1000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoStart, goal, startAgentRun]);

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Double-tap to take over
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastDoubleTap < 300) {
      // Double-tap detected
      if (agentRunning && !agentPaused) {
        // Pause the AI and take over
        setAgentPaused(true);
        setManualControl(true);
        fetch('/api/infinity/browse/pause', { method: 'POST' }).catch(() => {});
        setCurrentStep('You have control — AI paused. Press "Let AI Resume" when done.');
      }
    }
    setLastDoubleTap(now);
  }, [lastDoubleTap, agentRunning, agentPaused]);

  // Resume AI
  const resumeAgent = useCallback(() => {
    setAgentPaused(false);
    setManualControl(false);
    fetch('/api/infinity/browse/resume', { method: 'POST' }).catch(() => {});
    setCurrentStep('Resuming AI...');
  }, []);

  // Stop agent
  const stopAgent = useCallback(() => {
    abortRef.current?.abort();
    setAgentRunning(false);
    setAgentPaused(false);
    setManualControl(false);
    setCurrentStep('Stopped');
  }, []);

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border/50 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="flex-1 text-left truncate">Browser: {goal.slice(0, 30)}</span>
        {agentRunning && <Loader2 className="w-3 h-3 animate-spin" />}
      </button>
    );
  }

  return (
    <div className={`flex flex-col bg-card rounded-lg border border-border/50 overflow-hidden ${fullscreen ? 'fixed inset-4 z-50' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/30">
        <Globe className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-foreground truncate">{goal}</div>
          <div className="text-[9px] text-muted-foreground font-mono">
            {agentRunning ? (agentPaused ? 'PAUSED' : 'RUNNING') : 'IDLE'}
            {state?.url && ` · ${state.url.slice(0, 40)}`}
          </div>
        </div>
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
        <button
          onClick={() => setMinimized(true)}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
          title="Minimize"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setFullscreen(f => !f)}
          className={`p-1 rounded hover:bg-muted/50 transition-colors ${fullscreen ? 'text-primary' : 'text-muted-foreground'}`}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live status */}
      <div className="px-3 py-2 bg-background border-b border-border/30">
        <div className="flex items-start gap-2">
          <Bot className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${agentRunning && !agentPaused ? 'text-primary animate-pulse' : agentPaused ? 'text-amber-500' : 'text-muted-foreground'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-foreground font-medium break-words">
              {currentStep}
            </div>
            {agentRunning && !agentPaused && (
              <div className="text-[9px] text-muted-foreground mt-0.5">
                Step {steps.length + 1} · AI is browsing...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Browser viewport */}
      <div
        className={`relative cursor-pointer overflow-hidden bg-black ${fullscreen ? 'flex-1' : ''}`}
        style={{ minHeight: 250, maxHeight: fullscreen ? 'none' : 400 }}
        onDoubleClick={handleDoubleTap}
        title="Double-click to take over"
      >
        {screenshot ? (
          <>
            <img
              src={screenshot}
              alt="Browser view"
              className="w-full h-full object-contain"
              draggable={false}
            />
            {agentPaused && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-amber-500/90 backdrop-blur rounded-full text-[10px] font-mono text-white shadow-lg">
                PAUSED — Double-click to take over, or use button below
              </div>
            )}
            {state?.loading && (
              <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-primary animate-pulse">
                Loading...
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            {connected ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Globe className="w-8 h-8 text-muted-foreground/30 animate-pulse" />
            )}
            <span className="text-xs font-mono">
              {connected ? 'Waiting for browser...' : 'Connecting...'}
            </span>
          </div>
        )}
      </div>

      {/* Takeover / Resume button */}
      {agentPaused && manualControl && (
        <div className="px-3 py-2 bg-amber-500/10 border-t border-border/30">
          <button
            onClick={resumeAgent}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors text-xs font-medium"
          >
            <Play className="w-3.5 h-3.5" />
            Let AI Resume
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-t border-border/30">
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetch('/api/infinity/browse/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'back' }) })}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => fetch('/api/infinity/browse/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'forward' }) })}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
            title="Forward"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => fetch('/api/infinity/browse/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reload' }) })}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
            title="Reload"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {agentRunning ? (
            <button
              onClick={stopAgent}
              className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors text-[10px] font-mono"
            >
              <Square className="w-3 h-3" /> Stop
            </button>
          ) : (
            <button
              onClick={startAgentRun}
              className="flex items-center gap-1 px-2 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors text-[10px] font-mono"
            >
              <Play className="w-3 h-3" /> Run
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="px-2 py-1 rounded bg-muted/30 text-muted-foreground hover:bg-muted/50 transition-colors text-[10px]"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
