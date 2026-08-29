/**
 * Variations Panel
 *
 * Phase 21: AI-Powered Design Iteration
 * Sidebar showing auto-generated design variations with one-click apply
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, ChevronRight, Sparkles, Zap, Eye, Check, Loader2, Trash2, Copy, Download } from 'lucide-react';

export interface DesignVariation {
  id: string;
  name: string;
  description: string;
  category: 'layout' | 'color' | 'typography' | 'spacing' | 'accessibility' | 'performance' | 'combined';
  changes: Array<{
    type: 'layout' | 'color' | 'typography' | 'spacing' | 'component' | 'prop' | 'style';
    description: string;
    before?: string;
    after?: string;
  }>;
  componentIR: any;
  previewCode: string;
  framework: string;
  confidence: number;
  estimatedImpact: {
    visual: number;
    accessibility: number;
    performance: number;
  };
}

export interface VariationsPanelProps {
  currentComponentIR: any;
  currentFramework: string;
  designSystem?: Record<string, any>;
  onApplyVariation: (variation: DesignVariation) => void;
  onPreviewVariation: (variation: DesignVariation) => void;
  isGenerating?: boolean;
  className?: string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  layout: <Zap className="w-4 h-4" />,
  color: <span className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }} />,
  typography: <span className="w-4 h-4 font-serif text-xs">Aa</span>,
  spacing: <span className="w-4 h-4 border-b-2 border-current" />,
  accessibility: <span className="w-4 h-4" role="img" aria-label="accessibility">♿</span>,
  performance: <span className="w-4 h-4" role="img" aria-label="performance">⚡</span>,
  combined: <Sparkles className="w-4 h-4" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  layout: 'Layout',
  color: 'Color',
  typography: 'Typography',
  spacing: 'Spacing',
  accessibility: 'A11y',
  performance: 'Perf',
  combined: 'Combined',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export function VariationsPanel({
  currentComponentIR,
  currentFramework,
  designSystem,
  onApplyVariation,
  onPreviewVariation,
  isGenerating = false,
  className = '',
}: VariationsPanelProps) {
  const [variations, setVariations] = useState<DesignVariation[]>([]);
  const [selectedVariation, setSelectedVariation] = useState<DesignVariation | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'layout' | 'color' | 'typography' | 'spacing' | 'accessibility' | 'performance'>('all');
  const [generationCount, setGenerationCount] = useState(5);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const { toast } = useToast();

  const filteredVariations = activeTab === 'all'
    ? variations
    : variations.filter(v => v.category === activeTab);

  const generateVariations = useCallback(async () => {
    if (!currentComponentIR) {
      toast({ title: 'No component selected', description: 'Select a component in the preview to generate variations', variant: 'destructive' });
      return;
    }

    try {
      const response = await fetch('/api/infinity/design-variations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentIR: currentComponentIR,
          framework: currentFramework,
          designSystem,
          count: generationCount,
          focusAreas: focusAreas.length > 0 ? focusAreas : undefined,
        }),
      });

      const result = await response.json();

      if (result.success && result.variations) {
        setVariations(result.variations);
        toast({ title: 'Variations generated', description: `Created ${result.variations.length} design variations`, variant: 'default' });
      } else {
        toast({ title: 'Generation failed', description: result.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Generation failed', description: error instanceof Error ? error.message : 'Network error', variant: 'destructive' });
    }
  }, [currentComponentIR, currentFramework, designSystem, generationCount, focusAreas, toast]);

  const handleApply = (variation: DesignVariation) => {
    onApplyVariation(variation);
    setSelectedVariation(variation);
    toast({ title: 'Variation applied', description: `${variation.name} applied to component`, variant: 'default' });
  };

  const handlePreview = (variation: DesignVariation) => {
    onPreviewVariation(variation);
    setSelectedVariation(variation);
  };

  const handleDelete = (id: string) => {
    setVariations(v => v.filter(v => v.id !== id));
  };

  const handleCopyCode = async (variation: DesignVariation) => {
    await navigator.clipboard.writeText(variation.previewCode);
    toast({ title: 'Code copied', description: 'Variation code copied to clipboard', variant: 'default' });
  };

  const handleDownload = (variation: DesignVariation) => {
    const blob = new Blob([variation.previewCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${variation.name.replace(/\s+/g, '-')}.tsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getImpactBar = (value: number, label: string) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="h-full bg-primary rounded-full"
        />
      </div>
      <span className="w-8 text-right">{Math.round(value * 100)}%</span>
    </div>
  );

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Design Variations</h3>
          <Badge variant="outline" className="text-xs">{variations.length}</Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={generateVariations}
          disabled={isGenerating || !currentComponentIR}
          className="gap-1"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            'Generate'
          )}
        </Button>
      </div>

      {/* Generation Options */}
      <Card className="m-4 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Count</label>
            <select
              value={generationCount}
              onChange={e => setGenerationCount(Number(e.target.value))}
              className="w-full px-2 py-1 text-sm border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {[3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <option key={n} value={n}>{n} variations</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Focus Areas</label>
            <div className="flex flex-wrap gap-1">
              {(['layout', 'color', 'typography', 'spacing', 'accessibility', 'performance'] as const).map(area => (
                <button
                  key={area}
                  type="button"
                  onClick={() => setFocusAreas(prev =>
                    prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
                  )}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    focusAreas.includes(area)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {CATEGORY_LABELS[area]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Category Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mx-4 mb-2">
        <TabsList className="grid w-full grid-cols-7 gap-1 p-1 bg-muted">
          {(['all', 'layout', 'color', 'typography', 'spacing', 'accessibility', 'performance'] as const).map(tab => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="px-2 py-1 text-xs gap-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              {tab !== 'all' && CATEGORY_ICONS[tab]}
              <span className="hidden sm:inline">{tab === 'all' ? 'All' : CATEGORY_LABELS[tab]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Variations List */}
      <ScrollArea className="flex-1 p-4">
        <AnimatePresence mode="popLayout">
          {filteredVariations.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground"
            >
              <Sparkles className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-sm">No variations yet</p>
              <p className="text-xs mt-1">Click "Generate" to create design variations</p>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3"
            >
              {filteredVariations.map((variation, index) => (
                <motion.div
                  key={variation.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`relative group p-3 rounded-lg border transition-all ${
                    selectedVariation?.id === variation.id
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border bg-card hover:border-primary/30'
                  }`}
                >
                  {/* Category Badge */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Badge
                      variant="outline"
                      className={`text-xs gap-1 ${SEVERITY_COLORS[variant.category]}`}
                    >
                      {CATEGORY_ICONS[variation.category]}
                      {CATEGORY_LABELS[variation.category]}
                    </Badge>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconButton
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePreview(variation)}
                        title="Preview"
                        aria-label="Preview variation"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopyCode(variation)}
                        title="Copy Code"
                        aria-label="Copy variation code"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownload(variation)}
                        title="Download"
                        aria-label="Download variation"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(variation.id)}
                        title="Delete"
                        aria-label="Delete variation"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </div>

                  {/* Variation Info */}
                  <div className="mb-2">
                    <h4 className="font-medium text-sm">{variation.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{variation.description}</p>
                  </div>

                  {/* Confidence & Impact */}
                  <div className="mb-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className={getConfidenceColor(variation.confidence)} font-medium>
                        {Math.round(variation.confidence * 100)}%
                      </span>
                    </div>
                    {getImpactBar(variation.estimatedImpact.visual, 'Visual')}
                    {getImpactBar(variation.estimatedImpact.accessibility, 'A11y')}
                    {getImpactBar(variation.estimatedImpact.performance, 'Perf')}
                  </div>

                  {/* Changes Summary */}
                  {variation.changes.length > 0 && (
                    <details className="mb-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                        Changes ({variation.changes.length})
                      </summary>
                      <ul className="mt-1 ml-4 text-xs text-muted-foreground space-y-0.5 list-disc">
                        {variation.changes.map((change, i) => (
                          <li key={i}>{change.description}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      variant={selectedVariation?.id === variation.id ? 'default' : 'outline'}
                      onClick={() => handleApply(variation)}
                      className="flex-1"
                      disabled={selectedVariation?.id === variation.id}
                    >
                      {selectedVariation?.id === variation.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Applied
                        </>
                      ) : (
                        'Apply'
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePreview(variation)}
                      className="flex-1"
                    >
                      Preview
                    </Button>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>

      {/* Selected Variation Preview */}
      {selectedVariation && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="border-t p-4 bg-muted/50"
        >
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-sm">Selected: {selectedVariation.name}</h4>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={() => setSelectedVariation(null)}
              aria-label="Close preview"
            >
              <ChevronLeft className="w-4 h-4" />
            </IconButton>
          </div>
          <ScrollArea className="max-h-48 font-mono text-xs bg-background border rounded p-2">
            <pre>{selectedVariation.previewCode.slice(0, 2000)}</pre>
          </ScrollArea>
        </motion.div>
      )}
    </div>
  );
}

// Re-export types
export type { DesignVariation };