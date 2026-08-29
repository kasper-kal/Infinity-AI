/**
 * UI Builder View — Phase 21: AI-Powered Design Iteration
 * Main view combining VariationsPanel sidebar with preview area,
 * managing component IR state and handling apply/preview callbacks.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input, Textarea } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Sparkles,
  Zap,
  Eye,
  EyeOff,
  Code,
  Copy,
  Download,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Palette,
  Type,
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings,
  Trash2,
  GitBranch,
  Trophy,
  Layers,
  BarChart2,
  MousePointer,
  Smartphone,
  Monitor,
  Tablet,
  Laptop,
} from 'lucide-react';
import { VariationsPanel, DesignVariation } from './VariationsPanel';
import { ABPreview } from './ABPreview';

export interface ComponentIR {
  name: string;
  type: string;
  jsx: string;
  props: Record<string, any>;
  imports?: string[];
  exports?: string[];
  dependencies?: string[];
  metadata?: Record<string, any>;
}

export interface UIBuilderViewProps {
  projectId?: string;
  initialComponentIR?: ComponentIR;
  initialFramework?: string;
  designSystem?: Record<string, any>;
  onComponentChange?: (componentIR: ComponentIR, frameworkCode: string) => void;
  className?: string;
}

const VIEWPORT_OPTIONS = [
  { value: 'mobile', label: 'Mobile (375px)', width: 375, icon: Smartphone },
  { value: 'tablet', label: 'Tablet (768px)', width: 768, icon: Tablet },
  { value: 'desktop', label: 'Desktop (1440px)', width: 1440, icon: Monitor },
  { value: 'wide', label: 'Wide (1920px)', width: 1920, icon: Laptop },
];

const FRAMEWORK_OPTIONS = [
  { value: 'nextjs', label: 'Next.js' },
  { value: 'vite-react', label: 'Vite + React' },
  { value: 'astro', label: 'Astro' },
  { value: 'remix', label: 'Remix' },
  { value: 'sveltekit', label: 'SvelteKit' },
  { value: 'vue-nuxt', label: 'Vue/Nuxt' },
  { value: 'solidstart', label: 'SolidStart' },
];

const DEFAULT_COMPONENT_IR: ComponentIR = {
  name: 'Button',
  type: 'button',
  jsx: `<button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
  Button
</button>`,
  props: {
    children: 'Button',
    variant: 'default',
    size: 'default',
    disabled: false,
  },
  imports: ['react'],
  exports: ['default'],
  dependencies: [],
  metadata: {},
};

const DEFAULT_DESIGN_SYSTEM = {
  colors: {
    primary: '#3b82f6',
    'primary-foreground': '#ffffff',
    secondary: '#64748b',
    'secondary-foreground': '#ffffff',
    background: '#ffffff',
    foreground: '#0f172a',
    muted: '#f1f5f9',
    'muted-foreground': '#64748b',
    accent: '#f97316',
    'accent-foreground': '#ffffff',
    destructive: '#ef4444',
    'destructive-foreground': '#ffffff',
    border: '#e2e8f0',
    input: '#e2e8f0',
    ring: '#3b82f6',
  },
  spacing: {
    0: '0px',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    10: '2.5rem',
    12: '3rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
  },
  typography: {
    fontFamily: 'system-ui, sans-serif',
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
    },
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
    lineHeight: {
      tight: '1.25',
      normal: '1.5',
      relaxed: '1.75',
    },
  },
  borderRadius: {
    none: '0',
    sm: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  },
};

function generatePreviewCode(componentIR: ComponentIR, framework: string, designSystem?: Record<string, any>): string {
  const tailwindCDN = '<script src="https://cdn.tailwindcss.com"><\/script>';
  const reactCDN = `
    <script crossorigin src="https://esm.sh/react@18.2.0"><\/script>
    <script crossorigin src="https://esm.sh/react-dom@18.2.0/client"><\/script>
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
      </style>
    </head>
    <body>
      <div id="root"></div>
      ${reactCDN}
      <script type="module">
        import React from 'react';
        import { createRoot } from 'react-dom/client';

        const Component = () => ${componentIR.jsx};

        const root = createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
      <\/script>
    </body>
    </html>
  `;
}

export function UIBuilderView({
  projectId,
  initialComponentIR,
  initialFramework = 'nextjs',
  designSystem,
  onComponentChange,
  className = '',
}: UIBuilderViewProps) {
  const [componentIR, setComponentIR] = useState<ComponentIR>(initialComponentIR || DEFAULT_COMPONENT_IR);
  const [framework, setFramework] = useState<string>(initialFramework);
  const [designSystemState, setDesignSystemState] = useState<Record<string, any>>(designSystem || DEFAULT_DESIGN_SYSTEM);
  const [previewCode, setPreviewCode] = useState<string>('');
  const [originalCode, setOriginalCode] = useState<string>('');
  const [abPreviewOpen, setAbPreviewOpen] = useState(false);
  const [selectedVariation, setSelectedVariation] = useState<DesignVariation | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'builder' | 'code' | 'preview'>('builder');
  const [viewport, setViewport] = useState<'mobile' | 'tablet' | 'desktop' | 'wide'>('desktop');
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const { toast } = useToast();

  // Generate preview code when component IR changes
  useEffect(() => {
    const code = generatePreviewCode(componentIR, framework, designSystemState);
    setPreviewCode(code);
    setOriginalCode(code);
    if (onComponentChange) {
      onComponentChange(componentIR, code);
    }
  }, [componentIR, framework, designSystemState, onComponentChange]);

  const handleApplyVariation = useCallback((variation: DesignVariation) => {
    setComponentIR(variation.componentIR);
    setSelectedVariation(variation);
    setAbPreviewOpen(false);
    toast({
      title: 'Variation applied',
      description: `${variation.name} applied to component`,
      variant: 'default',
    });
  }, [toast]);

  const handlePreviewVariation = useCallback((variation: DesignVariation) => {
    setSelectedVariation(variation);
    setAbPreviewOpen(true);
  }, []);

  const handleAbWinner = useCallback((winner: 'original' | 'variation') => {
    if (winner === 'variation' && selectedVariation) {
      setComponentIR(selectedVariation.componentIR);
      toast({
        title: 'Variation selected as winner',
        description: 'Changes merged into component',
        variant: 'default',
      });
    } else {
      toast({
        title: 'Original kept',
        description: 'No changes applied',
        variant: 'default',
      });
    }
    setAbPreviewOpen(false);
    setSelectedVariation(null);
  }, [selectedVariation, toast]);

  const handleCloseAbPreview = useCallback(() => {
    setAbPreviewOpen(false);
    setSelectedVariation(null);
  }, []);

  const copyCode = async () => {
    await navigator.clipboard.writeText(previewCode);
    toast({ title: 'Copied', description: 'Component code copied to clipboard', variant: 'default' });
  };

  const downloadCode = () => {
    const ext = framework === 'vue-nuxt' ? '.vue' : framework === 'sveltekit' ? '.svelte' : '.tsx';
    const blob = new Blob([previewCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${componentIR.name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCodeChange = (newCode: string) => {
    // Parse the new code back to ComponentIR - simplified for now
    setPreviewCode(newCode);
  };

  const currentViewport = VIEWPORT_OPTIONS.find(v => v.value === viewport) || VIEWPORT_OPTIONS[2];

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-lg">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">AI Design Iteration</span>
          </div>
          <Badge variant="outline" className="text-xs">{componentIR.name}</Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Framework Selector */}
          <Select value={framework} onValueChange={setFramework}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Framework" />
            </SelectTrigger>
            <SelectContent>
              {FRAMEWORK_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Viewport Selector */}
          <Select value={viewport} onValueChange={setViewport}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Viewport" />
            </SelectTrigger>
            <SelectContent>
              {VIEWPORT_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <opt.icon className="w-4 h-4 mr-2" />
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* View Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="hidden sm:flex">
            <TabsList className="grid w-auto grid-cols-3 bg-muted p-1 rounded-lg">
              <TabsTrigger value="builder" className="gap-1">
                <LayoutGrid className="w-3.5 h-3.5" />
                Builder
              </TabsTrigger>
              <TabsTrigger value="code" className="gap-1">
                <Code className="w-3.5 h-3.5" />
                Code
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1">
                <Eye className="w-3.5 h-3.5" />
                Preview
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Actions */}
          <div className="flex items-center gap-1 ml-auto">
            <Button variant="ghost" size="sm" onClick={copyCode} title="Copy Code">
              <Copy className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadCode} title="Download">
              <Download className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCodeEditor(!showCodeEditor)} title="Toggle Code">
              <Code className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Tab Bar */}
      <div className="sm:hidden border-b bg-card">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="builder">
              <LayoutGrid className="w-4 h-4 mx-auto" />
            </TabsTrigger>
            <TabsTrigger value="code">
              <Code className="w-4 h-4 mx-auto" />
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="w-4 h-4 mx-auto" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Builder Tab - Variations Panel + Preview */}
        <AnimatePresence mode="wait">
          {activeTab === 'builder' && (
            <motion.div
              key="builder"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col h-full"
            >
              <div className="flex-1 flex overflow-hidden">
                {/* Variations Panel Sidebar */}
                <div className="w-80 sm:w-96 flex-shrink-0 border-r bg-card">
                  <VariationsPanel
                    currentComponentIR={componentIR}
                    currentFramework={framework}
                    designSystem={designSystemState}
                    onApplyVariation={handleApplyVariation}
                    onPreviewVariation={handlePreviewVariation}
                    isGenerating={isGenerating}
                  />
                </div>

                {/* Main Preview Area */}
                <div className="flex-1 flex flex-col min-w-0 relative">
                  <div className="flex items-center justify-between p-3 border-b bg-card">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {currentViewport.icon && <currentViewport.icon className="w-3 h-3 mr-1" />}
                        {currentViewport.label}
                      </Badge>
                      <span className="text-sm text-muted-foreground">Live Preview</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePreviewVariation({
                          id: 'current',
                          name: 'Current Design',
                          description: 'Preview current component',
                          category: 'layout',
                          changes: [],
                          componentIR,
                          previewCode,
                          framework,
                          confidence: 1,
                          estimatedImpact: { visual: 0.5, accessibility: 0.5, performance: 0.5 },
                        })}
                        disabled={!selectedVariation}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Preview
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 relative overflow-hidden bg-muted/30">
                    <iframe
                      srcDoc={previewCode}
                      className="w-full h-full border-0"
                      style={{
                        width: currentViewport.width,
                        height: '100%',
                        transform: 'none',
                      }}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                      title="Component Preview"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Code Tab */}
          {activeTab === 'code' && (
            <motion.div
              key="code"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col h-full"
            >
              <div className="flex items-center justify-between p-3 border-b bg-card">
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">Component Code ({framework})</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={copyCode}>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    Copy
                  </Button>
                  <Button variant="ghost" size="sm" onClick={downloadCode}>
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
              <div className="flex-1 p-3 overflow-auto">
                <pre className="bg-black/80 text-green-300 p-4 rounded font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                  {previewCode}
                </pre>
              </div>
            </motion.div>
          )}

          {/* Preview Tab - Full Screen Preview */}
          {activeTab === 'preview' && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col h-full"
            >
              <div className="flex items-center justify-between p-3 border-b bg-card">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">Full Preview</span>
                  <Badge variant="outline" className="text-xs">{currentViewport.label}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={viewport} onValueChange={setViewport}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Viewport" />
                    </SelectTrigger>
                    <SelectContent>
                      {VIEWPORT_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <opt.icon className="w-4 h-4 mr-2" />
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex-1 relative overflow-hidden bg-muted/30">
                <iframe
                  srcDoc={previewCode}
                  className="w-full h-full border-0"
                  style={{
                    width: currentViewport.width,
                    height: '100%',
                    transform: 'none',
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                  title="Full Component Preview"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* A/B Preview Modal */}
      <AnimatePresence>
        {abPreviewOpen && selectedVariation && (
          <ABPreview
            originalCode={originalCode}
            variationCode={selectedVariation.previewCode}
            variation={{
              id: selectedVariation.id,
              name: selectedVariation.name,
              description: selectedVariation.description,
              category: selectedVariation.category,
            }}
            framework={framework}
            designSystem={designSystemState}
            onSelectWinner={handleAbWinner}
            onClose={handleCloseAbPreview}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default UIBuilderView;