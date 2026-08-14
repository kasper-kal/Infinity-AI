import { useEffect, useRef, useState, useCallback } from 'react';
import {
  RefreshCw, Maximize2, Minimize2, X, Monitor, Smartphone, Tablet,
  Terminal, WifiOff, RotateCcw, Bug, Trash2, Download, Copy,
  ChevronLeft, ChevronRight, Check, AlertTriangle
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import '@/lib/build-ui-theme.css';

export interface ConsoleEntry {
  id: string;
  timestamp: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

export interface DeviceProfile {
  id: string;
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string;
}

export const DEVICE_PROFILES: DeviceProfile[] = [
  { id: 'desktop', name: 'Desktop', width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: '' },
  { id: 'mobile-se', name: 'iPhone SE', width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15' },
  { id: 'mobile-14', name: 'iPhone 14', width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
  { id: 'mobile-android', name: 'Pixel 7', width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36' },
  { id: 'tablet-ipad', name: 'iPad', width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
  { id: 'tablet-landscape', name: 'iPad Landscape', width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
];

export interface BuildLivePreviewProps {
  url: string;
  open: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  onConsoleEntry?: (entry: ConsoleEntry) => void;
  title?: string;
  height?: number;
}

const CONSOLE_LEVEL_STYLES: Record<ConsoleEntry['level'], { icon: typeof Check; color: string; bg: string }> = {
  log: { icon: Check, color: 'text-foreground', bg: 'bg-transparent' },
  info: { icon: Check, color: 'text-primary', bg: 'bg-primary/10' },
  warn: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  error: { icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-400/10' },
  debug: { icon: Bug, color: 'text-muted-foreground', bg: 'bg-secondary' },
};

function ConsolePanel({
  entries,
  onClear,
  onFilterChange,
  filter,
  maxEntries = 500,
}: {
  entries: ConsoleEntry[];
  onClear: () => void;
  onFilterChange: (level: ConsoleEntry['level'] | 'all') => void;
  filter: ConsoleEntry['level'] | 'all';
  maxEntries?: number;
}) {
  const { t } = useI18n();
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const filteredEntries = entries.filter(e => filter === 'all' || e.level === filter);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [filteredEntries.length, autoScroll]);

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  };

  const copyEntry = async (entry: ConsoleEntry) => {
    const text = `[${formatTimestamp(entry.timestamp)}] ${entry.level.toUpperCase()}: ${entry.message}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // silent fail
    }
  };

  const counts = {
    all: entries.length,
    log: entries.filter(e => e.level === 'log').length,
    info: entries.filter(e => e.level === 'info').length,
    warn: entries.filter(e => e.level === 'warn').length,
    error: entries.filter(e => e.level === 'error').length,
    debug: entries.filter(e => e.level === 'debug').length,
  };

  return (
    <div className="flex flex-col h-full bg-card border-t border-border">
      {/* Console header */}
      <header className="flex-shrink-0 flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-secondary p-1.5 text-muted-foreground">
            <Terminal className="h-4 w-4" />
          </div>
          <h4 className="text-sm font-medium text-foreground">{t('studio.build.consoleTitle') || 'Console'}</h4>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* Filter buttons */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary p-0.5">
            {(['all', 'error', 'warn', 'info', 'log', 'debug'] as const).map(level => (
              <button
                key={level}
                type="button"
                onClick={() => onFilterChange(level)}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                  filter === level
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {level === 'all' ? 'All' : level}
                <span className="ml-1 rounded-full bg-current/20 px-1.5 text-[9px]">
                  {counts[level]}
                </span>
              </button>
            ))}
          </div>

          {/* Clear button */}
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Clear console"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          {/* Auto-scroll toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`rounded-lg p-1.5 transition ${autoScroll ? 'text-primary' : 'text-muted-foreground'} hover:bg-secondary`}
            title={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
          >
            <ChevronDown className={`h-4 w-4 ${autoScroll ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </header>

      {/* Console entries */}
      <div
        ref={logRef}
        className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 font-mono text-[11px] build-scrollbar-thin"
        onScroll={(e) => {
          const target = e.currentTarget;
          const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
          setAutoScroll(isAtBottom);
        }}
      >
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/50">
            <p className="text-sm">No console output</p>
          </div>
        ) : (
          filteredEntries.slice(-maxEntries).map((entry) => {
            const style = CONSOLE_LEVEL_STYLES[entry.level];
            const Icon = style.icon;
            const isExpanded = expandedEntry === entry.id;

            return (
              <div
                key={entry.id}
                className={`flex gap-2 rounded-lg px-2 py-1 transition ${style.bg} hover:bg-secondary/30`}
                onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
              >
                <span className="shrink-0 text-muted-foreground/50 font-mono w-24">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <Icon className={`shrink-0 h-3.5 w-3.5 mt-0.5 ${style.color}`} />
                <span className={`flex-1 min-w-0 break-all ${style.color}`}>
                  {entry.message}
                </span>
                {entry.source && (
                  <span className="shrink-0 text-muted-foreground/50 text-[10px] font-mono">
                    {entry.source}:{entry.line || 1}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); copyEntry(entry); }}
                  className="shrink-0 p-1 opacity-0 hover:opacity-100 transition-opacity text-muted-foreground"
                  title="Copy"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
        {/* Bottom sentinel for auto-scroll */}
        <div ref={logRef} style={{ height: 1 }} />
      </div>

      {expandedEntry && (
        <div className="border-t border-border p-3 bg-secondary/30 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium text-muted-foreground">Expanded</span>
            <button
              type="button"
              onClick={() => setExpandedEntry(null)}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-all text-[11px] text-foreground">{expandedEntry}</pre>
        </div>
      )}

      <style jsx>{`
        .build-scrollbar-thin {
          scrollbar-width: thin;
          scrollbar-color: var(--build-border) transparent;
        }
        .build-scrollbar-thin::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .build-scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .build-scrollbar-thin::-webkit-scrollbar-thumb {
          background-color: var(--build-border);
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}

function DeviceToolbar({
  currentDevice,
  onDeviceChange,
  orientation,
  onOrientationChange,
  zoom,
  onZoomChange,
}: {
  currentDevice: DeviceProfile;
  onDeviceChange: (device: DeviceProfile) => void;
  orientation: 'portrait' | 'landscape';
  onOrientationChange: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex-shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 bg-secondary/30">
      {/* Device selector */}
      <div className="relative">
        <select
          value={currentDevice.id}
          onChange={e => onDeviceChange(DEVICE_PROFILES.find(d => d.id === e.target.value) || DEVICE_PROFILES[0])}
          className="rounded-lg border border-border bg-input px-3 py-1.5 pr-8 text-sm text-foreground outline-none appearance-none cursor-pointer"
        >
          {DEVICE_PROFILES.map(d => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.width}×{d.height})
            </option>
          ))}
        </select>
        <Monitor className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Orientation toggle */}
      <button
        type="button"
        onClick={onOrientationChange}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
          orientation === 'portrait' ? 'bg-primary text-white' : 'bg-secondary text-foreground hover:bg-secondary/80'
        }`}
        title={orientation === 'portrait' ? 'Switch to landscape' : 'Switch to portrait'}
      >
        {orientation === 'portrait' ? (
          <>
            <Smartphone className="h-4 w-4" />
            <span>Portrait</span>
          </>
        ) : (
          <>
            <Tablet className="h-4 w-4" />
            <span>Landscape</span>
          </>
        )}
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Zoom control */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Zoom out"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="w-16 text-center text-[11px] font-mono text-foreground">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => onZoomChange(Math.min(3, zoom + 0.25))}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Zoom in"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onZoomChange(1)}
          className="rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Reset zoom"
        >
          100%
        </button>
      </div>

      <div className="w-px h-6 bg-border mx-1 ml-auto" />

      {/* Refresh button */}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
        title="Refresh preview"
      >
        <RefreshCw className="h-4 w-4" />
        <span>Refresh</span>
      </button>
    </div>
  );
}

function PreviewFrame({
  src,
  device,
  orientation,
  zoom,
  onLoad,
  onError,
  onConsoleMessage,
}: {
  src: string;
  device: DeviceProfile;
  orientation: 'portrait' | 'landscape';
  zoom: number;
  onLoad: () => void;
  onError: (error: Error) => void;
  onConsoleMessage?: (entry: ConsoleEntry) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const width = orientation === 'landscape' ? device.height : device.width;
  const height = orientation === 'landscape' ? device.width : device.height;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    setIsLoading(true);
    setLoadError(null);

    const handleLoad = () => {
      setIsLoading(false);
      onLoad();
    };

    const handleError = () => {
      const error = new Error('Failed to load preview');
      setLoadError(error);
      setIsLoading(false);
      onError(error);
    };

    iframe.addEventListener('load', handleLoad);
    iframe.addEventListener('error', handleError);

    // Inject console capture script
    const injectConsoleCapture = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc && !doc.getElementById('build-console-capture')) {
          const script = doc.createElement('script');
          script.id = 'build-console-capture';
          script.textContent = `
            (function() {
              const originalLog = console.log;
              const originalInfo = console.info;
              const originalWarn = console.warn;
              const originalError = console.error;
              const originalDebug = console.debug;

              function sendToParent(level, args) {
                const message = args.map(arg =>
                  typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                ).join(' ');
                window.parent.postMessage({
                  type: 'build-console',
                  level: level,
                  message: message,
                  timestamp: Date.now(),
                  source: new Error().stack?.split('\\n')[2]?.trim()
                }, '*');
              }

              console.log = function(...args) { sendToParent('log', args); originalLog.apply(console, args); };
              console.info = function(...args) { sendToParent('info', args); originalInfo.apply(console, args); };
              console.warn = function(...args) { sendToParent('warn', args); originalWarn.apply(console, args); };
              console.error = function(...args) { sendToParent('error', args); originalError.apply(console, args); };
              console.debug = function(...args) { sendToParent('debug', args); originalDebug.apply(console, args); };

              window.addEventListener('error', function(e) {
                sendToParent('error', [e.message + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno]);
              });

              window.addEventListener('unhandledrejection', function(e) {
                sendToParent('error', ['Unhandled Promise Rejection: ' + e.reason]);
              });
            })();
          `;
          doc.head.appendChild(script);
        }
      } catch {
        // Cross-origin, can't inject
      }
    };

    // Try to inject after load
    iframe.addEventListener('load', injectConsoleCapture, { once: true });

    return () => {
      iframe.removeEventListener('load', handleLoad);
      iframe.removeEventListener('error', handleError);
    };
  }, [src, onLoad, onError]);

  // Listen for console messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'build-console' && onConsoleMessage) {
        onConsoleMessage({
          id: `console-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          timestamp: event.data.timestamp,
          level: event.data.level,
          message: event.data.message,
          source: event.data.source,
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onConsoleMessage]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full bg-card text-center p-6">
        <div>
          <WifiOff className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-foreground mb-1">Failed to load preview</p>
          <p className="text-[11px] text-muted-foreground">{loadError.message}</p>
          <button
            type="button"
            onClick={() => iframeRef.current?.contentWindow?.location.reload()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-auto bg-background" style={{ backgroundColor: 'var(--color-background)' }}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/90 z-10">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading preview…</p>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title="Live Preview"
        className="w-full h-full border-0"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `scale(${zoom})`,
          transformOrigin: 'top center',
          minWidth: `${width}px`,
          minHeight: `${height}px`,
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation"
        allow="camera; microphone; geolocation; accelerometer; gyroscope; magnetometer; payment"
        loading="eager"
      />
    </div>
  );
}

export function BuildLivePreview({
  url,
  open,
  onClose,
  onRefresh,
  onConsoleEntry,
  title = 'Live Preview',
  height = 600,
}: BuildLivePreviewProps) {
  const { t } = useI18n();
  const [currentDevice, setCurrentDevice] = useState(DEVICE_PROFILES[0]);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [zoom, setZoom] = useState(1);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [consoleFilter, setConsoleFilter] = useState<ConsoleEntry['level'] | 'all'>('all');

  const handleConsoleEntry = useCallback((entry: ConsoleEntry) => {
    setConsoleEntries(prev => [...prev.slice(-499), entry]);
    onConsoleEntry?.(entry);
  }, [onConsoleEntry]);

  const handleRefresh = useCallback(() => {
    setConsoleEntries([]);
    onRefresh?.();
  }, [onRefresh]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ height: `${height}px` }}
    >
      <div className="flex h-full w-full max-w-[1400px] flex-col mx-auto bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/15 p-2 text-primary">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground truncate max-w-[300px]">{title}</h3>
              <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[400px]">{url}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowConsole(!showConsole)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${showConsole ? 'bg-primary text-white' : 'border border-border text-foreground hover:bg-secondary'}`}
            >
              <Terminal className="h-3.5 w-3.5 mr-1" />
              Console
              {consoleEntries.filter(e => e.level === 'error').length > 0 && (
                <span className="ml-1.5 rounded-full bg-rose-400 px-1.5 text-[9px] text-white">
                  {consoleEntries.filter(e => e.level === 'error').length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Device Toolbar */}
        <DeviceToolbar
          currentDevice={currentDevice}
          onDeviceChange={setCurrentDevice}
          orientation={orientation}
          onOrientationChange={() => setOrientation(o => o === 'portrait' ? 'landscape' : 'portrait')}
          zoom={zoom}
          onZoomChange={setZoom}
        />

        {/* Preview Frame */}
        <div className="flex-1 min-h-0 relative">
          <PreviewFrame
            src={url}
            device={currentDevice}
            orientation={orientation}
            zoom={zoom}
            onLoad={handleRefresh}
            onError={handleRefresh}
            onConsoleMessage={handleConsoleEntry}
          />
        </div>

        {/* Console Panel */}
        {showConsole && (
          <ConsolePanel
            entries={consoleEntries}
            onClear={() => setConsoleEntries([])}
            onFilterChange={setConsoleFilter}
            filter={consoleFilter}
          />
        )}
      </div>
    </div>
  );
}