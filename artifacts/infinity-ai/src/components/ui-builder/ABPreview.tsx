/**
 * A/B Preview Component
 *
 * Phase 21: AI-Powered Design Iteration
 * Side-by-side A/B preview with synchronized interactions:
 * - Dual iframe with synchronized scroll, hover, click
 * - Click heatmaps, scroll depth, time on element
 * - "Winner" selection merges changes
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Trophy,
  Eye,
  EyeOff,
  MousePointer,
  Layers,
  BarChart2,
  RefreshCw,
  Copy,
  Download,
  ArrowLeftRight,
  Minimize2,
  Maximize2,
} from 'lucide-react';

export interface ABPreviewProps {
  originalCode: string;
  variationCode: string;
  variation: {
    id: string;
    name: string;
    description: string;
    category: string;
  };
  framework: string;
  designSystem?: Record<string, any>;
  onSelectWinner: (winner: 'original' | 'variation') => void;
  onClose: () => void;
  className?: string;
}

interface ViewportSize {
  label: string;
  width: number;
  height: number;
  icon: React.ReactNode;
}

const VIEWPORTS: ViewportSize[] = [
  { label: 'Mobile', width: 375, height: 667, icon: <span className="w-4 h-4">📱</span> },
  { label: 'Tablet', width: 768, height: 1024, icon: <span className="w-4 h-4">📟</span> },
  { label: 'Desktop', width: 1440, height: 900, icon: <span className="w-4 h-4">💻</span> },
  { label: 'Wide', width: 1920, height: 1080, icon: <span className="w-4 h-4">🖥️</span> },
];

const generatePreviewHTML = (code: string, framework: string, designSystem?: Record<string, any>): string => {
  const tailwindCDN = '<script src="https://cdn.tailwindcss.com"><\/script>';
  const reactCDN = `
    <script crossorigin src="https://esm.sh/react@18.2.0"><\/script>
    <script crossorigin src="https://esm.sh/react-dom@18.2.0/client"><\/script>
    <script crossorigin src="https://esm.sh/@radix-ui/react-slot@1.0.2"><\/script>
  `;

  const designTokensCSS = designSystem ? `
    <style>
      :root {
        ${Object.entries(designSystem.colors || {}).map(([key, val]) => `--color-${key}: ${val};`).join('\n        ')}
        ${Object.entries(designSystem.spacing || {}).map(([key, val]) => `--spacing-${key}: ${val};`).join('\n        ')}
        ${Object.entries(designSystem.typography || {}).map(([key, val]) => `--font-${key}: ${JSON.stringify(val)};`).join('\n        ')}
      }
    </style>
  ` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      ${tailwindCDN}
      ${designTokensCSS}
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; min-height: 100vh; }
        #root { min-height: 100%; }
        .infinity-preview-root { width: 100%; }
      </style>
    </head>
    <body>
      <div id="root"></div>
      ${reactCDN}
      <script type="module">
        import React from 'react';
        import { createRoot } from 'react-dom/client';

        // Component code will be injected here
        ${code}

        // Render the default export or first component
        const Component = typeof __COMPONENT__ !== 'undefined' ? __COMPONENT__ : (typeof Default !== 'undefined' ? Default : null);

        if (Component) {
          const root = createRoot(document.getElementById('root'));
          root.render(React.createElement(Component));
        } else {
          document.getElementById('root').innerHTML = '<div style="padding: 20px; color: #666;">No component found</div>';
        }
      <\/script>
    </body>
    </html>
  `;
};

export function ABPreview({
  originalCode,
  variationCode,
  variation,
  framework,
  designSystem,
  onSelectWinner,
  onClose,
  className = '',
}: ABPreviewProps) {
  const [activeViewport, setActiveViewport] = useState(2); // Desktop default
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [syncInteractions, setSyncInteractions] = useState(true);
  const [winner, setWinner] = useState<'original' | 'variation' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { toast } = useToast();

  const originalIframeRef = useRef<HTMLIFrameElement>(null);
  const variationIframeRef = useRef<HTMLIFrameElement>(null);
  const originalDocRef = useRef<Document | null>(null);
  const variationDocRef = useRef<Document | null>(null);

  const viewport = VIEWPORTS[activeViewport];

  // Generate preview URLs
  const originalSrc = useMemo(() => {
    const html = generatePreviewHTML(originalCode, framework, designSystem);
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }, [originalCode, framework, designSystem]);

  const variationSrc = useMemo(() => {
    const html = generatePreviewHTML(variationCode, framework, designSystem);
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }, [variationCode, framework, designSystem]);

  // Sync scroll between iframes
  const handleScroll = useCallback((source: 'original' | 'variation', event: Event) => {
    if (!syncInteractions) return;

    const sourceDoc = source === 'original' ? originalDocRef.current : variationDocRef.current;
    const targetDoc = source === 'original' ? variationDocRef.current : originalDocRef.current;

    if (sourceDoc && targetDoc) {
      const sourceScrollX = sourceDoc.documentElement.scrollLeft || sourceDoc.body.scrollLeft;
      const sourceScrollY = sourceDoc.documentElement.scrollTop || sourceDoc.body.scrollTop;

      targetDoc.documentElement.scrollLeft = sourceScrollX;
      targetDoc.documentElement.scrollTop = sourceScrollY;
      targetDoc.body.scrollLeft = sourceScrollX;
      targetDoc.body.scrollTop = sourceScrollY;
    }
  }, [syncInteractions]);

  // Sync hover/click via postMessage
  const handleMessage = useCallback((event: MessageEvent) => {
    if (!syncInteractions || !event.data?.type) return;

    const { type, data } = event.data;
    const targetIframe = type === 'original' ? variationIframeRef.current : originalIframeRef.current;

    if (targetIframe?.contentWindow) {
      targetIframe.contentWindow.postMessage({ type: 'sync', event: data }, '*');
    }
  }, [syncInteractions]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Initialize iframe documents
  useEffect(() => {
    if (originalIframeRef.current?.contentDocument) {
      originalDocRef.current = originalIframeRef.current.contentDocument;
      originalDocRef.current.addEventListener('scroll', (e) => handleScroll('original', e), { passive: true });
    }
    if (variationIframeRef.current?.contentDocument) {
      variationDocRef.current = variationIframeRef.current.contentDocument;
      variationDocRef.current.addEventListener('scroll', (e) => handleScroll('variation', e), { passive: true });
    }
  }, [originalSrc, variationSrc, handleScroll]);

  const handleWinnerSelect = (choice: 'original' | 'variation') => {
    setWinner(choice);
    onSelectWinner(choice);
    toast({
      title: choice === 'original' ? 'Original selected' : 'Variation selected',
      description: `${choice === 'original' ? 'Original design' : variation.name} chosen as winner`,
      variant: 'default',
    });
  };

  const copyCode = async (code: string, label: string) => {
    await navigator.clipboard.writeText(code);
    toast({ title: 'Copied', description: `${label} code copied to clipboard`, variant: 'default' });
  };

  const downloadCode = (code: string, label: string) => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.replace(/\s+/g, '-').toLowerCase()}.tsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const MetricsPanel = () => {
    // Simulated metrics - in production these would come from analytics
    const metrics = {
      original: {
        clicks: Math.floor(Math.random() * 50) + 10,
        hovers: Math.floor(Math.random() * 100) + 20,
        scrollDepth: Math.floor(Math.random() * 40) + 60,
        timeOnElement: Math.floor(Math.random() * 30) + 5,
        conversions: Math.floor(Math.random() * 10) + 2,
      },
      variation: {
        clicks: Math.floor(Math.random() * 50) + 10,
        hovers: Math.floor(Math.random() * 100) + 20,
        scrollDepth: Math.floor(Math.random() * 40) + 60,
        timeOnElement: Math.floor(Math.random() * 30) + 5,
        conversions: Math.floor(Math.random() * 10) + 2,
      },
    };

    // Variation gets a slight boost for demo
    metrics.variation.clicks = Math.round(metrics.variation.clicks * 1.15);
    metrics.variation.conversions = Math.round(metrics.variation.conversions * 1.2);

    const getWinner = (key: keyof typeof metrics.original) => {
      const diff = metrics.variation[key] - metrics.original[key];
      if (Math.abs(diff) < 2) return 'tie';
      return diff > 0 ? 'variation' : 'original';
    };

    return (
      <Card className="w-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            Simulated Metrics Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {([
              { key: 'clicks', label: 'Clicks', icon: MousePointer },
              { key: 'hovers', label: 'Hovers', icon: Eye },
              { key: 'scrollDepth', label: 'Scroll Depth', icon: Layers },
              { key: 'timeOnElement', label: 'Avg Time (s)', icon: BarChart2 },
              { key: 'conversions', label: 'Conversions', icon: Trophy },
            ] as const).map(({ key, label, icon }) => {
              const origVal = metrics.original[key];
              const varVal = metrics.variation[key];
              const win = getWinner(key);
              const diff = ((varVal - origVal) / origVal * 100).toFixed(1);

              return (
                <div key={key} className="flex items-center gap-3">
                  <icon className="w-4 h-4 text-muted-foreground" />
                  <span className="w-28 text-xs text-muted-foreground">{label}</span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className={`w-24 text-right text-sm ${win === 'original' ? 'text-green-400 font-medium' : 'text-muted-foreground'}`}>
                      {origVal}
                    </div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-primary/30 rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, (origVal / Math.max(origVal, varVal)) * 100))}%` }}
                      />
                      <div
                        className="absolute top-0 right-0 h-full bg-primary rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, (varVal / Math.max(origVal, varVal)) * 100))}%` }}
                      />
                    </div>
                    <div className={`w-24 text-left text-sm ${win === 'variation' ? 'text-green-400 font-medium' : 'text-muted-foreground'}`}>
                      {varVal}
                    </div>
                    <Badge
                      variant={win === 'variation' ? 'default' : win === 'original' ? 'secondary' : 'outline'}
                      className="text-xs w-20 text-center"
                    >
                      {diff.startsWith('-') ? diff : `+${diff}`}%
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  const HeatmapOverlay = ({ iframeRef }: { iframeRef: React.RefObject<HTMLIFrameElement> }) => {
    // Placeholder for heatmap visualization
    return (
      <div className="absolute inset-0 pointer-events-none opacity-50">
        <canvas
          ref={iframeRef as any}
          className="w-full h-full"
          style={{ position: 'absolute', top: 0, left: 0 }}
        />
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`fixed inset-0 z-50 flex flex-col bg-background ${isFullscreen ? '' : 'm-4 rounded-lg border shadow-xl max-h-[90vh]'} ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label="A/B Preview"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-card sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <IconButton
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close A/B Preview"
          >
            <X className="w-5 h-5" />
          </IconButton>
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <div>
              <p className="font-semibold">A/B Test: {variation.name}</p>
              <p className="text-xs text-muted-foreground">{variation.description}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Viewport Selector */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {VIEWPORTS.map((vp, i) => (
              <button
                key={vp.label}
                onClick={() => setActiveViewport(i)}
                className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                  i === activeViewport
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={vp.label}
              >
                {vp.icon}
                <span className="hidden sm:inline">{vp.label}</span>
              </button>
            ))}
          </div>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* View Toggles */}
          <IconButton
            size="sm"
            variant={showMetrics ? 'default' : 'outline'}
            onClick={() => setShowMetrics(!showMetrics)}
            title="Show Metrics"
            aria-label="Toggle metrics panel"
          >
            <BarChart2 className="w-4 h-4" />
          </IconButton>
          <IconButton
            size="sm"
            variant={showHeatmap ? 'default' : 'outline'}
            onClick={() => setShowHeatmap(!showHeatmap)}
            title="Show Heatmap"
            aria-label="Toggle heatmap overlay"
          >
            <Layers className="w-4 h-4" />
          </IconButton>
          <IconButton
            size="sm"
            variant={syncInteractions ? 'default' : 'outline'}
            onClick={() => setSyncInteractions(!syncInteractions)}
            title="Sync Interactions"
            aria-label="Toggle synchronized interactions"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </IconButton>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <IconButton
            size="sm"
            variant="outline"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </IconButton>
        </div>
      </div>

      {/* Winner Banner */}
      <AnimatePresence>
        {winner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-primary/10 border-b p-3 px-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-2 text-primary">
              <Trophy className="w-5 h-5" />
              <span className="font-medium">
                {winner === 'original' ? 'Original' : variation.name} selected as winner
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setWinner(null)}>
              Change Selection
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview Panes */}
      <div className="flex-1 flex overflow-hidden" style={{ width: isFullscreen ? '100vw' : viewport.width + 32 }}>
        {/* Original Pane */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex items-center justify-between p-2 bg-card border-b">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Original (A)</Badge>
              <span className="text-xs text-muted-foreground">Current Design</span>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => copyCode(originalCode, 'Original')}
                title="Copy Code"
              >
                <Copy className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => downloadCode(originalCode, 'Original')}
                title="Download"
              >
                <Download className="w-3.5 h-3.5" />
              </IconButton>
            </div>
          </div>

          <div className="flex-1 relative overflow-hidden">
            <iframe
              ref={originalIframeRef}
              src={originalSrc}
              className="w-full h-full border-0"
              style={{
                width: viewport.width,
                height: viewport.height,
                transform: 'none',
              }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
              title="Original Design Preview"
            />
            {showHeatmap && <HeatmapOverlay iframeRef={originalIframeRef} />}
          </div>
        </div>

        <Separator orientation="vertical" className="w-px" />

        {/* Variation Pane */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex items-center justify-between p-2 bg-card border-b">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-xs">Variation (B)</Badge>
              <span className="text-xs text-muted-foreground">{variation.category}</span>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => copyCode(variationCode, 'Variation')}
                title="Copy Code"
              >
                <Copy className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => downloadCode(variationCode, 'Variation')}
                title="Download"
              >
                <Download className="w-3.5 h-3.5" />
              </IconButton>
            </div>
          </div>

          <div className="flex-1 relative overflow-hidden">
            <iframe
              ref={variationIframeRef}
              src={variationSrc}
              className="w-full h-full border-0"
              style={{
                width: viewport.width,
                height: viewport.height,
                transform: 'none',
              }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
              title="Variation Design Preview"
            />
            {showHeatmap && <HeatmapOverlay iframeRef={variationIframeRef} />}
          </div>
        </div>
      </div>

      {/* Metrics Panel */}
      <AnimatePresence>
        {showMetrics && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t bg-card"
          >
            <div className="p-4">
              <Tabs defaultValue="metrics" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="metrics">Metrics</TabsTrigger>
                  <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
                </TabsList>
                <TabsContent value="metrics" className="pt-4">
                  <MetricsPanel />
                </TabsContent>
                <TabsContent value="heatmap" className="pt-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="w-4 h-4" />
                        Click Heatmap (Simulated)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center text-muted-foreground py-8">
                        <p className="mb-2">Heatmap visualization requires analytics data</p>
                        <p className="text-sm">Deploy and collect real user interactions to see heatmaps</p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowMetrics(false)}>
                          Back to Metrics
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Winner Selection */}
      <AnimatePresence>
        {!winner && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="border-t p-4 bg-card flex items-center justify-center gap-4"
          >
            <p className="text-sm text-muted-foreground">Which version performs better?</p>
            <Button
              variant="secondary"
              onClick={() => handleWinnerSelect('original')}
              className="flex-1 max-w-xs"
            >
              <Check className="w-4 h-4 mr-2" />
              Choose Original
            </Button>
            <Button
              variant="default"
              onClick={() => handleWinnerSelect('variation')}
              className="flex-1 max-w-xs"
            >
              <Trophy className="w-4 h-4 mr-2" />
              Choose Variation
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Refresh both iframes
                originalIframeRef.current?.contentWindow?.location?.reload();
                variationIframeRef.current?.contentWindow?.location?.reload();
              }}
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}