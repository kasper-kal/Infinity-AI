/**
 * A11yLinter
 *
 * Real-time accessibility checking using axe-core.
 * Integrates with preview to show WCAG violations inline.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  Info,
  Eye,
  EyeOff,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  Code2,
  ExternalLink,
  Copy,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui';
import { ScrollArea } from '@/components/ui';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Select as RadixSelect, SelectContent as RadixSelectContent, SelectItem as RadixSelectItem, SelectTrigger as RadixSelectTrigger, SelectValue as RadixSelectValue } from '@/components/ui';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface A11yViolation {
  id: string;
  ruleId: string;
  ruleDescription: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: A11yNode[];
  timestamp: number;
}

export interface A11yNode {
  target: string[];
  html: string;
  failureSummary: string;
  xpath?: string;
  selectors?: string[];
}

export interface A11yResult {
  violations: A11yViolation[];
  passes: A11yPass[];
  incomplete: A11yIncomplete[];
  inapplicable: A11yInapplicable[];
  timestamp: number;
  url: string;
}

export interface A11yPass {
  id: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: A11yNode[];
}

export interface A11yIncomplete {
  id: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: A11yNode[];
}

export interface A11yInapplicable {
  id: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: A11yNode[];
}

export interface A11yLinterProps {
  /** Preview iframe ref to analyze */
  previewRef?: React.RefObject<HTMLIFrameElement>;
  /** Preview document to analyze (alternative to ref) */
  previewDoc?: Document | null;
  /** Run automatically on mount */
  autoRun?: boolean;
  /** Run on preview content changes */
  runOnChange?: boolean;
  /** Debounce ms for change detection */
  debounceMs?: number;
  /** Rules to include (empty = all) */
  includedRules?: string[];
  /** Rules to exclude */
  excludedRules?: string[];
  /** Minimum impact level to report */
  minImpact?: 'critical' | 'serious' | 'moderate' | 'minor';
  /** Callback when results ready */
  onResults?: (results: A11yResult) => void;
  /** Callback when violations found */
  onViolations?: (violations: A11yViolation[]) => void;
  /** Custom className */
  className?: string;
  /** Show as panel (vs overlay) */
  asPanel?: boolean;
}

interface A11yLinterState {
  isRunning: boolean;
  lastResult: A11yResult | null;
  violations: A11yViolation[];
  passes: A11yPass[];
  incomplete: A11yIncomplete[];
  error: string | null;
  filter: {
    impact: string[];
    search: string;
    showPasses: boolean;
    showIncomplete: boolean;
  };
  expandedViolations: Set<string>;
}

const IMPACT_CONFIG = {
  critical: { label: 'Critical', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-500/50', icon: AlertCircle },
  serious: { label: 'Serious', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-500/50', icon: AlertTriangle },
  moderate: { label: 'Moderate', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-500/50', icon: AlertTriangle },
  minor: { label: 'Minor', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-500/50', icon: Info },
} as const;

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'] as const;

export function A11yLinter({
  previewRef,
  previewDoc,
  autoRun = true,
  runOnChange = true,
  debounceMs = 500,
  includedRules = [],
  excludedRules = [],
  minImpact = 'minor',
  onResults,
  onViolations,
  className = '',
  asPanel = false,
}: A11yLinterProps) {
  const [state, setState] = useState<A11yLinterState>({
    isRunning: false,
    lastResult: null,
    violations: [],
    passes: [],
    incomplete: [],
    error: null,
    filter: {
      impact: ['critical', 'serious', 'moderate', 'minor'],
      search: '',
      showPasses: false,
      showIncomplete: false,
    },
    expandedViolations: new Set(),
  });

  const axeRef = useRef<any>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const lastContentRef = useRef<string>('');

  // Load axe-core dynamically
  const loadAxe = useCallback(async () => {
    if (axeRef.current) return axeRef.current;

    try {
      // Try to load from CDN
      const module = await import('axe-core');
      axeRef.current = module.default || module;
      return axeRef.current;
    } catch (error) {
      console.error('Failed to load axe-core:', error);
      throw new Error('axe-core not available. Please install axe-core package.');
    }
  }, []);

  // Run accessibility analysis
  const runAnalysis = useCallback(async (doc: Document) => {
    setState(prev => ({ ...prev, isRunning: true, error: null }));

    try {
      const axe = await loadAxe();

      const options = {
        runOnly: includedRules.length > 0 ? { type: 'rule', values: includedRules } : undefined,
        rules: excludedRules.reduce((acc, rule) => {
          acc[rule] = { enabled: false };
          return acc;
        }, {} as Record<string, { enabled: boolean }>),
      };

      const results = await axe.run(doc, options);

      const result: A11yResult = {
        violations: results.violations.map((v: any) => ({
          id: `violation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          ruleId: v.id,
          ruleDescription: v.description,
          impact: v.impact,
          tags: v.tags,
          description: v.help,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: n.failureSummary,
            xpath: n.xpath,
            selectors: n.target,
          })),
          timestamp: Date.now(),
        })),
        passes: results.passes.map((p: any) => ({
          id: p.id,
          description: p.description,
          help: p.help,
          helpUrl: p.helpUrl,
          nodes: p.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: '',
          })),
        })),
        incomplete: results.incomplete.map((i: any) => ({
          id: i.id,
          description: i.description,
          help: i.help,
          helpUrl: i.helpUrl,
          nodes: i.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: '',
          })),
        })),
        inapplicable: results.inapplicable.map((i: any) => ({
          id: i.id,
          description: i.description,
          help: i.help,
          helpUrl: i.helpUrl,
          nodes: i.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: '',
          })),
        })),
        timestamp: Date.now(),
        url: doc.URL,
      };

      // Filter by minimum impact
      const minImpactIndex = IMPACT_ORDER.indexOf(minImpact);
      const filteredViolations = result.violations.filter(v =>
        IMPACT_ORDER.indexOf(v.impact) <= minImpactIndex
      );

      setState(prev => ({
        ...prev,
        isRunning: false,
        lastResult: result,
        violations: filteredViolations,
        passes: result.passes,
        incomplete: result.incomplete,
      }));

      onResults?.(result);
      onViolations?.(filteredViolations);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setState(prev => ({ ...prev, isRunning: false, error: errorMessage }));
      return null;
    }
  }, [loadAxe, includedRules, excludedRules, minImpact, onResults, onViolations]);

  // Analyze preview content
  const analyzePreview = useCallback(async () => {
    let doc: Document | null = null;

    if (previewDoc) {
      doc = previewDoc;
    } else if (previewRef?.current?.contentDocument) {
      doc = previewRef.current.contentDocument;
    }

    if (!doc) {
      setState(prev => ({ ...prev, error: 'No preview document available' }));
      return;
    }

    await runAnalysis(doc);
  }, [previewRef, previewDoc, runAnalysis]);

  // Set up mutation observer for auto-run on change
  useEffect(() => {
    if (!runOnChange) return;

    const setupObserver = () => {
      let doc: Document | null = null;

      if (previewDoc) {
        doc = previewDoc;
      } else if (previewRef?.current?.contentDocument) {
        doc = previewRef.current.contentDocument;
      }

      if (!doc) return;

      observerRef.current = new MutationObserver(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const currentContent = doc!.documentElement.outerHTML;
          if (currentContent !== lastContentRef.current) {
            lastContentRef.current = currentContent;
            analyzePreview();
          }
        }, debounceMs);
      });

      observerRef.current.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      lastContentRef.current = doc.documentElement.outerHTML;
    };

    setupObserver();

    return () => {
      observerRef.current?.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [previewRef, previewDoc, runOnChange, debounceMs, analyzePreview]);

  // Auto-run on mount
  useEffect(() => {
    if (autoRun) {
      analyzePreview();
    }
  }, [autoRun, analyzePreview]);

  // Toggle violation expansion
  const toggleViolation = useCallback((id: string) => {
    setState(prev => {
      const expanded = new Set(prev.expandedViolations);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      return { ...prev, expandedViolations: expanded };
    });
  }, []);

  // Filter violations
  const filteredViolations = state.violations.filter(v => {
    if (!state.filter.impact.includes(v.impact)) return false;
    if (state.filter.search) {
      const search = state.filter.search.toLowerCase();
      return (
        v.ruleId.toLowerCase().includes(search) ||
        v.description.toLowerCase().includes(search) ||
        v.help.toLowerCase().includes(search) ||
        v.nodes.some(n => n.html.toLowerCase().includes(search))
      );
    }
    return true;
  });

  // Sort violations by impact severity
  const sortedViolations = [...filteredViolations].sort((a, b) => {
    return IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact);
  });

  // Group violations by impact
  const violationsByImpact = sortedViolations.reduce((acc, v) => {
    if (!acc[v.impact]) acc[v.impact] = [];
    acc[v.impact].push(v);
    return acc;
  }, {} as Record<string, A11yViolation[]>);

  const violationCount = state.violations.length;
  const criticalCount = state.violations.filter(v => v.impact === 'critical').length;
  const seriousCount = state.violations.filter(v => v.impact === 'serious').length;

  if (asPanel) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <HelpCircle className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Accessibility</h3>
              <p className="text-sm text-muted-foreground">
                {violationCount} violation{violationCount !== 1 ? 's' : ''} found
                {criticalCount > 0 && <span className="ml-2 text-red-600">({criticalCount} critical)</span>}
                {seriousCount > 0 && <span className="ml-2 text-orange-600">({seriousCount} serious)</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={analyzePreview} disabled={state.isRunning}>
              {state.isRunning ? 'Analyzing...' : 'Re-scan'}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-border bg-muted/30 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="a11y-search" className="text-xs text-muted-foreground">Search</Label>
              <Input
                id="a11y-search"
                placeholder="Filter violations..."
                value={state.filter.search}
                onChange={e => setState(prev => ({ ...prev, filter: { ...prev.filter, search: e.target.value } }))}
                className="w-48 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="a11y-impact" className="text-xs text-muted-foreground">Impact</Label>
              <Select value={state.filter.impact.join(',')} onValueChange={value => setState(prev => ({ ...prev, filter: { ...prev.filter, impact: value.split(',').filter(Boolean) } }))}>
                <SelectTrigger id="a11y-impact" className="w-40 text-sm">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical,serious,moderate,minor">All</SelectItem>
                  <SelectItem value="critical,serious">Critical & Serious</SelectItem>
                  <SelectItem value="critical">Critical Only</SelectItem>
                  <SelectItem value="serious,moderate,minor">Non-Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="a11y-passes"
                checked={state.filter.showPasses}
                onCheckedChange={checked => setState(prev => ({ ...prev, filter: { ...prev.filter, showPasses: checked } }))}
              />
              <Label htmlFor="a11y-passes" className="text-xs text-muted-foreground">Show passes</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="a11y-incomplete"
                checked={state.filter.showIncomplete}
                onCheckedChange={checked => setState(prev => ({ ...prev, filter: { ...prev.filter, showIncomplete: checked } }))}
              />
              <Label htmlFor="a11y-incomplete" className="text-xs text-muted-foreground">Show incomplete</Label>
            </div>
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="flex-1 overflow-y-auto">
          {state.error && (
            <div className="p-4 text-center text-destructive">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p>{state.error}</p>
            </div>
          )}

          {state.isRunning && !state.lastResult && (
            <div className="p-8 text-center text-muted-foreground">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
              <p>Analyzing accessibility...</p>
            </div>
          )}

          {!state.isRunning && state.lastResult && violationCount === 0 && (
            <div className="p-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h4 className="font-medium text-foreground mb-1">No violations found!</h4>
              <p className="text-sm text-muted-foreground">Your preview meets WCAG AA guidelines.</p>
            </div>
          )}

          {sortedViolations.length > 0 && (
            <div className="p-4 space-y-4">
              {IMPACT_ORDER.map(impact => {
                const violations = violationsByImpact[impact];
                if (!violations || violations.length === 0) return null;

                const config = IMPACT_CONFIG[impact];
                const Icon = config.icon;

                return (
                  <div key={impact} className="space-y-2">
                    <h4 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <Icon className={cn('w-4 h-4', config.color)} />
                      {config.label} ({violations.length})
                    </h4>
                    {violations.map(violation => (
                      <ViolationCard
                        key={violation.id}
                        violation={violation}
                        isExpanded={state.expandedViolations.has(violation.id)}
                        onToggle={() => toggleViolation(violation.id)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {state.filter.showPasses && state.passes.length > 0 && (
            <div className="p-4 border-t border-border">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Passed Checks ({state.passes.length})
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {state.passes.map(pass => (
                  <div key={pass.id} className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-500/20 rounded-lg">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">{pass.id}</p>
                    <p className="text-xs text-green-600 dark:text-green-500 mt-1">{pass.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.filter.showIncomplete && state.incomplete.length > 0 && (
            <div className="p-4 border-t border-border">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Needs Review ({state.incomplete.length})
              </h4>
              <div className="space-y-2">
                {state.incomplete.map(item => (
                  <div key={item.id} className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-500/20 rounded-lg">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{item.id}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  // Overlay mode
  if (violationCount === 0 && !state.isRunning) return null;

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 w-96 max-h-[70vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-slide-up',
        className
      )}
      role="region"
      aria-label="Accessibility violations"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-primary" />
          <span className="font-medium">Accessibility</span>
          <Badge variant="outline" className={cn(
            violationCount > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          )}>
            {violationCount} {violationCount === 1 ? 'issue' : 'issues'}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={analyzePreview} disabled={state.isRunning}>
          {state.isRunning ? (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          )}
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="max-h-[60vh] p-3">
        {state.error && (
          <div className="p-3 text-center text-destructive text-sm">
            <AlertCircle className="w-6 h-6 mx-auto mb-1" />
            <p>{state.error}</p>
          </div>
        )}

        {state.isRunning && !state.lastResult && (
          <div className="p-4 text-center text-muted-foreground text-sm">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
            <p>Analyzing...</p>
          </div>
        )}

        {!state.isRunning && violationCount === 0 && state.lastResult && (
          <div className="p-4 text-center">
            <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
            <p className="font-medium">No violations found!</p>
            <p className="text-xs text-muted-foreground mt-1">WCAG AA compliant</p>
          </div>
        )}

        {sortedViolations.length > 0 && (
          <div className="space-y-3">
            {IMPACT_ORDER.map(impact => {
              const violations = violationsByImpact[impact];
              if (!violations || violations.length === 0) return null;

              const config = IMPACT_CONFIG[impact];
              const Icon = config.icon;

              return (
                <div key={impact} className="space-y-2">
                  <h4 className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground px-1">
                    <Icon className={cn('w-3 h-3', config.color)} />
                    {config.label} ({violations.length})
                  </h4>
                  {violations.map(violation => (
                    <ViolationCard
                      key={violation.id}
                      violation={violation}
                      isExpanded={state.expandedViolations.has(violation.id)}
                      onToggle={() => toggleViolation(violation.id)}
                      compact
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-border bg-muted/50 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={analyzePreview} disabled={state.isRunning} className="flex-1">
          Re-scan
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(state.lastResult, null, 2))}>
          <Copy className="w-3.5 h-3.5 mr-1" />
          Copy Report
        </Button>
      </div>
    </div>
  );
}

interface ViolationCardProps {
  violation: A11yViolation;
  isExpanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}

function ViolationCard({ violation, isExpanded, onToggle, compact = false }: ViolationCardProps) {
  const config = IMPACT_CONFIG[violation.impact];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all duration-200',
        config.border,
        config.bg,
        compact ? 'text-sm' : ''
      )}
    >
      <div className="flex items-start gap-2" onClick={onToggle}>
        <div className={cn('flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center', config.bg)}>
          <Icon className={cn('w-3.5 h-3.5', config.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('font-medium', compact ? 'text-sm' : '')}>{violation.ruleId}</span>
            <Badge variant="outline" className={cn(config.color.replace('text-', 'bg-').replace('dark:text-', 'dark:bg-') + '/20', config.color)} style={{ fontSize: '0.6rem' }}>
              {config.label}
            </Badge>
          </div>
          <p className={cn('mt-1 text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>{violation.description}</p>
        </div>

        <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={onToggle} aria-expanded={isExpanded}>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>

      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleContent className={cn('mt-3 pt-3 border-t border-border/50 animate-accordion-down', compact ? 'text-xs' : '')}>
          <div className="space-y-3">
            {/* Help */}
            <div>
              <p className="font-medium mb-1">Why this matters:</p>
              <p className="text-muted-foreground">{violation.help}</p>
            </div>

            {/* Affected elements */}
            {violation.nodes.length > 0 && (
              <div>
                <p className="font-medium mb-1">Affected elements ({violation.nodes.length}):</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {violation.nodes.map((node, i) => (
                    <div key={i} className="p-2 bg-muted rounded font-mono text-xs overflow-x-auto">
                      <div className="text-muted-foreground mb-1">{node.failureSummary}</div>
                      <code>{node.html.length > 200 ? node.html.slice(0, 200) + '...' : node.html}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
              <Button variant="outline" size="sm" onClick={() => window.open(violation.helpUrl, '_blank')} className="gap-1">
                <ExternalLink className="w-3.5 h-3.5" />
                Learn More
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(violation, null, 2))} className="gap-1">
                <Copy className="w-3.5 h-3.5" />
                Copy Details
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(violation.nodes.map(n => n.html).join('\n'))} className="gap-1">
                <Code2 className="w-3.5 h-3.5" />
                Copy HTML
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// Need to import Input
import { Input } from '@/components/ui/Input';

/**
 * Hook for running accessibility checks
 */
export function useA11yCheck() {
  const [results, setResults] = useState<A11yResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (doc: Document) => {
    setIsRunning(true);
    setError(null);

    try {
      const axe = await import('axe-core');
      const axeCore = axe.default || axe;

      const result = await axeCore.run(doc);

      const formatted: A11yResult = {
        violations: result.violations.map((v: any) => ({
          id: `violation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          ruleId: v.id,
          ruleDescription: v.description,
          impact: v.impact,
          tags: v.tags,
          description: v.help,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: n.failureSummary,
            xpath: n.xpath,
            selectors: n.target,
          })),
          timestamp: Date.now(),
        })),
        passes: result.passes.map((p: any) => ({
          id: p.id,
          description: p.description,
          help: p.help,
          helpUrl: p.helpUrl,
          nodes: p.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: '',
          })),
        })),
        incomplete: result.incomplete.map((i: any) => ({
          id: i.id,
          description: i.description,
          help: i.help,
          helpUrl: i.helpUrl,
          nodes: i.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: '',
          })),
        })),
        inapplicable: result.inapplicable.map((i: any) => ({
          id: i.id,
          description: i.description,
          help: i.help,
          helpUrl: i.helpUrl,
          nodes: i.nodes.map((n: any) => ({
            target: n.target,
            html: n.html,
            failureSummary: '',
          })),
        })),
        timestamp: Date.now(),
        url: doc.URL,
      };

      setResults(formatted);
      return formatted;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setIsRunning(false);
    }
  }, []);

  return { results, isRunning, error, check };
}

/**
 * Component to highlight violations in preview
 */
export function A11yHighlighter({ violations, onSelectNode }: { violations: A11yViolation[]; onSelectNode?: (node: A11yNode) => void }) {
  // This would inject highlighting into the preview iframe
  // For now, it's a placeholder for the integration
  return null;
}