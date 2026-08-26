/**
 * LivePreview Component
 *
 * Sandbox iframe with React 18 + Tailwind + shadcn/ui preloaded.
 * Features: HMR, console/error overlay, responsive viewport controls, code/preview split view.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Separator, Badge } from '@/components/ui';
import { Loader2, X, Maximize2, Minimize2, Bug, Terminal, Smartphone, Tablet, Monitor, RefreshCw, Copy, Download } from 'lucide-react';

interface LivePreviewProps {
  /** Generated components to preview */
  components: Array<{
    name: string;
    code: string;
    imports?: string[];
  }>;
  /** Framework for the preview */
  framework?: 'nextjs' | 'vite' | 'astro' | 'remix';
  /** Initial viewport size */
  initialViewport?: 'mobile' | 'tablet' | 'desktop';
  /** Callback when preview updates */
  onUpdate?: (html: string) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Class name for container */
  className?: string;
}

const VIEWPORTS = {
  mobile: { width: 375, height: 667, label: 'Mobile', icon: Smartphone },
  tablet: { width: 768, height: 1024, label: 'Tablet', icon: Tablet },
  desktop: { width: 1440, height: 900, label: 'Desktop', icon: Monitor },
} as const;

type ViewportKey = keyof typeof VIEWPORTS;

const TAILWIND_CDN = `
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(var(--border))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            primary: {
              DEFAULT: 'hsl(var(--primary))',
              foreground: 'hsl(var(--primary-foreground))',
            },
            secondary: {
              DEFAULT: 'hsl(var(--secondary))',
              foreground: 'hsl(var(--secondary-foreground))',
            },
            destructive: {
              DEFAULT: 'hsl(var(--destructive))',
              foreground: 'hsl(var(--destructive-foreground))',
            },
            muted: {
              DEFAULT: 'hsl(var(--muted))',
              foreground: 'hsl(var(--muted-foreground))',
            },
            accent: {
              DEFAULT: 'hsl(var(--accent))',
              foreground: 'hsl(var(--accent-foreground))',
            },
            popover: {
              DEFAULT: 'hsl(var(--popover))',
              foreground: 'hsl(var(--popover-foreground))',
            },
            card: {
              DEFAULT: 'hsl(var(--card))',
              foreground: 'hsl(var(--card-foreground))',
            },
          },
          borderRadius: {
            lg: 'var(--radius)',
            md: 'calc(var(--radius) - 2px)',
            sm: 'calc(var(--radius) - 4px)',
          },
          fontFamily: {
            sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
          },
        },
      },
    };
  </script>
`;

const REACT_CDN = `
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
`;

const SHADCN_UTILS = `
  const cn = (...classes) => classes.filter(Boolean).join(' ');
`;

const CSS_VARIABLES = `
  <style>
    :root {
      --background: 0 0% 100%;
      --foreground: 222.2 84% 4.9%;
      --card: 0 0% 100%;
      --card-foreground: 222.2 84% 4.9%;
      --popover: 0 0% 100%;
      --popover-foreground: 222.2 84% 4.9%;
      --primary: 221.2 83.2% 53.3%;
      --primary-foreground: 210 40% 98%;
      --secondary: 210 40% 96.1%;
      --secondary-foreground: 222.2 47.4% 11.2%;
      --muted: 210 40% 96.1%;
      --muted-foreground: 215.4 16.3% 46.9%;
      --accent: 210 40% 96.1%;
      --accent-foreground: 222.2 47.4% 11.2%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 210 40% 98%;
      --border: 214.3 31.8% 91.4%;
      --input: 214.3 31.8% 91.4%;
      --ring: 221.2 83.2% 53.3%;
      --radius: 0.5rem;
      --font-sans: 'Inter', system-ui, sans-serif;
    }
    .dark {
      --background: 222.2 84% 4.9%;
      --foreground: 210 40% 98%;
      --card: 222.2 84% 4.9%;
      --card-foreground: 210 40% 98%;
      --popover: 222.2 84% 4.9%;
      --popover-foreground: 210 40% 98%;
      --primary: 217.2 91.2% 59.8%;
      --primary-foreground: 222.2 47.4% 11.2%;
      --secondary: 217.2 32.6% 17.5%;
      --secondary-foreground: 210 40% 98%;
      --muted: 217.2 32.6% 17.5%;
      --muted-foreground: 215 20.2% 65.1%;
      --accent: 217.2 32.6% 17.5%;
      --accent-foreground: 210 40% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 210 40% 98%;
      --border: 217.2 32.6% 17.5%;
      --input: 217.2 32.6% 17.5%;
      --ring: 224.3 76.3% 48%;
    }
    * { border-color: hsl(var(--border)); }
    body { @apply bg-background text-foreground; font-family: var(--font-sans); }
  </style>
`;

export const LivePreview: React.FC<LivePreviewProps> = ({
  components,
  framework = 'nextjs',
  initialViewport = 'desktop',
  onUpdate,
  onError,
  className,
}) => {
  const [viewport, setViewport] = useState<ViewportKey>(initialViewport);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<Array<{ type: 'log' | 'error' | 'warn'; message: string; timestamp: Date }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'console'>('preview');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewKey = useRef(0);

  const viewportConfig = VIEWPORTS[viewport];

  // Generate preview HTML
  const generatePreviewHTML = useCallback(() => {
    if (!components.length) return '';

    const componentCode = components.map(c => c.code).join('\n\n');
    const imports = components.flatMap(c => c.imports || []).filter((v, i, a) => a.indexOf(v) === i);

    // Transform imports for browser preview (remove external imports)
    const transformedImports = imports
      .filter(imp => !imp.startsWith('@/') && !imp.startsWith('./') && !imp.startsWith('../'))
      .map(imp => `import ${imp.split('/').pop()} from '${imp}';`)
      .join('\n');

    const componentDefinitions = components.map(c => {
      // Remove import statements
      const codeWithoutImports = c.code
        .split('\n')
        .filter(line => !line.trim().startsWith('import '))
        .join('\n');
      return codeWithoutImports;
    }).join('\n\n');

    const renderCode = components.map(c => `<${c.name} key="${c.name}" />`).join('\n        ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI Preview - ${components.map(c => c.name).join(', ')}</title>
  ${TAILWIND_CDN}
  ${REACT_CDN}
  ${CSS_VARIABLES}
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
    body { margin: 0; padding: 1.5rem; min-height: 100vh; background: hsl(var(--background)); color: hsl(var(--foreground)); }
    #root { width: 100%; }
    .preview-container { max-width: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    ${SHADCN_UTILS}
    ${transformedImports}

    ${componentDefinitions}

    const App = () => (
      <div className="preview-container space-y-8">
        ${renderCode}
      </div>
    );

    // Override console for capture
    const originalConsole = { ...console };
    ['log', 'error', 'warn'].forEach(method => {
      console[method] = (...args) => {
        originalConsole[method](...args);
        window.parent.postMessage({
          type: 'console',
          payload: { type: method, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') }
        }, '*');
      };
    });

    // Handle errors
    window.addEventListener('error', (event) => {
      window.parent.postMessage({
        type: 'error',
        payload: { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno }
      }, '*');
    });

    window.addEventListener('unhandledrejection', (event) => {
      window.parent.postMessage({
        type: 'error',
        payload: { message: event.reason?.message || String(event.reason) }
      }, '*');
    });

    try {
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<App />);
      window.parent.postMessage({ type: 'ready' }, '*');
    } catch (e) {
      window.parent.postMessage({ type: 'error', payload: { message: e.message } }, '*');
    }
  </script>
</body></html>`;
  }, [components]);

  // Handle messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'ready') {
        setIsLoading(false);
        setPreviewError(null);
      } else if (event.data.type === 'console') {
        setConsoleLogs(prev => [...prev, {
          type: event.data.payload.type,
          message: event.data.payload.message,
          timestamp: new Date(),
        }].slice(-100));
      } else if (event.data.type === 'error') {
        setPreviewError(event.data.payload.message);
        setConsoleLogs(prev => [...prev, {
          type: 'error',
          message: event.data.payload.message,
          timestamp: new Date(),
        }].slice(-100));
        onError?.(new Error(event.data.payload.message));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onError]);

  // Update iframe src when components change
  useEffect(() => {
    setIsLoading(true);
    setPreviewError(null);
    previewKey.current += 1;
    onUpdate?.(generatePreviewHTML());
  }, [components, framework, generatePreviewHTML, onUpdate]);

  // Handle fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFullscreen]);

  const handleRefresh = useCallback(() => {
    previewKey.current += 1;
    setIsLoading(true);
    setPreviewError(null);
  }, []);

  const handleCopyHTML = useCallback(() => {
    navigator.clipboard.writeText(generatePreviewHTML());
  }, [generatePreviewHTML]);

  const handleDownloadHTML = useCallback(() => {
    const blob = new Blob([generatePreviewHTML()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preview-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generatePreviewHTML]);

  const ConsoleIcons = ({
    type,
  }: {
    type: 'log' | 'error' | 'warn';
  }) => {
    switch (type) {
      case 'log':
        return <Terminal className="w-3 h-3 text-muted-foreground" />;
      case 'error':
        return <Bug className="w-3 h-3 text-destructive" />;
      case 'warn':
        return <Bug className="w-3 h-3 text-yellow-500" />;
    }
  };

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="flex items-center gap-1">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="hidden sm:flex">
            <TabsList className="bg-transparent p-0">
              <TabsTrigger value="preview" className="px-3 py-1.5 text-sm">
                Preview
              </TabsTrigger>
              <TabsTrigger value="console" className="px-3 py-1.5 text-sm">
                Console {consoleLogs.filter(l => l.type === 'error').length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1.5 text-xs">
                    {consoleLogs.filter(l => l.type === 'error').length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Viewport Selector */}
          <Select value={viewport} onValueChange={setViewport as (v: ViewportKey) => void} className="w-40">
            {Object.entries(VIEWPORTS).map(([key, config]) => (
              <Select.Item key={key} value={key as ViewportKey} className="flex items-center gap-2">
                <config.icon className="w-4 h-4" />
                <span>{config.label}</span>
              </Select.Item>
            ))}
          </Select>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Dark mode toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: 'toggle-dark' }, '*')}
            title="Toggle dark mode"
          >
            <span className="w-4 h-4">🌙</span>
          </Button>

          <div className="flex-1" />

          {/* Actions */}
          <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh" disabled={isLoading}>
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleCopyHTML} title="Copy HTML">
            <Copy className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDownloadHTML} title="Download HTML">
            <Download className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        <div
          className={cn(
            'relative w-full h-full transition-all duration-300',
            isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''
          )}
          style={{
            width: isFullscreen ? '100vw' : viewportConfig.width,
            height: isFullscreen ? '100vh' : viewportConfig.height,
            maxWidth: isFullscreen ? 'none' : '100%',
          }}
        >
          <iframe
            ref={iframeRef}
            key={previewKey.current}
            srcDoc={generatePreviewHTML()}
            className="w-full h-full border-0 rounded-lg shadow-lg bg-white dark:bg-gray-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            title="Live Preview"
          />

          {previewError && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center p-4 bg-destructive/10 border border-destructive/20 rounded-lg z-10">
              <div className="text-center max-w-md">
                <Bug className="w-12 h-12 text-destructive mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-destructive mb-2">Preview Error</h3>
                <p className="text-sm text-muted-foreground mb-4">{previewError}</p>
                <Button onClick={handleRefresh} size="sm">Try Again</Button>
              </div>
            </div>
          )}
        </div>

        {/* Viewport label when not fullscreen */}
        {!isFullscreen && (
          <div className="absolute bottom-2 right-2 bg-background/90 backdrop-blur px-2 py-1 rounded text-xs text-muted-foreground">
            {viewportConfig.width} × {viewportConfig.height}
          </div>
        )}
      </div>

      {/* Console Panel */}
      {activeTab === 'console' && (
        <div className="border-t border-border h-64 overflow-hidden flex flex-col bg-muted/50">
          <div className="flex items-center justify-between p-2 border-b border-border">
            <h4 className="text-sm font-medium">Console</h4>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setConsoleLogs([])} title="Clear">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
            {consoleLogs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No console output yet</p>
            ) : (
              <div className="space-y-1">
                {consoleLogs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      'px-2 py-1 rounded font-mono text-xs whitespace-pre-wrap break-all',
                      log.type === 'error' && 'text-destructive bg-destructive/10',
                      log.type === 'warn' && 'text-yellow-500 bg-yellow-500/10',
                      log.type === 'log' && 'text-muted-foreground'
                    )}
                  >
                    <span className="text-muted-foreground mr-2">{log.timestamp.toLocaleTimeString()}</span>
                    <ConsoleIcons type={log.type} />
                    <span className="ml-1">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen exit hint */}
      {isFullscreen && (
        <div className="fixed top-4 right-4 z-50 bg-background/90 backdrop-blur px-3 py-1.5 rounded-lg shadow-lg border border-border text-sm text-muted-foreground">
          Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-foreground">Esc</kbd> to exit fullscreen
        </div>
      )}
    </div>
  );
};

export default LivePreview;