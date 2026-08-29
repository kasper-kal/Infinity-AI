/**
 * Analytics Dashboard
 *
 * Phase 21: AI-Powered Design Iteration
 * BuildView tab with charts, funnels, recommendations
 */

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Button, IconButton } from '@/components/ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  BarChart2,
  Users,
  MousePointer,
  Eye,
  Layers,
  Trophy,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Calendar,
  Filter,
  Zap,
  Shield,
  Smartphone,
  Monitor,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export interface AnalyticsDashboardProps {
  projectId: string;
  shareId?: string;
  className?: string;
}

interface AnalyticsAggregates {
  projectId: string;
  shareId?: string;
  period: 'hour' | 'day' | 'week' | 'month';
  periodStart: number;
  periodEnd: number;
  interactions: {
    total: number;
    byType: Record<string, number>;
    byElement: Record<string, number>;
    topElements: Array<{ selector: string; count: number }>;
  };
  vitals: {
    lcp?: { p50: number; p75: number; p95: number };
    fid?: { p50: number; p75: number; p95: number };
    cls?: { p50: number; p75: number; p95: number };
    fcp?: { p50: number; p75: number; p95: number };
    inp?: { p50: number; p75: number; p95: number };
    sampleCount: number;
  };
  funnels: Array<{
    funnelId: string;
    funnelName: string;
    sessions: number;
    completions: number;
    dropOffRate: number;
    avgTimeToComplete?: number;
    stepDropOffs: Array<{
      stepIndex: number;
      stepName: string;
      sessions: number;
      dropOffs: number;
    }>;
  }>;
}

interface DesignSuggestion {
  id: string;
  type: 'accessibility' | 'performance' | 'usability' | 'conversion' | 'mobile' | 'visual';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  evidence?: { metric: string; value: number; threshold: number; comparison?: string };
  affectedElements?: Array<{ selector: string; issue: string }>;
  fix: {
    description: string;
    codeChange?: string;
    componentIRPatch?: any;
    confidence: number;
    effort: 'trivial' | 'easy' | 'moderate' | 'hard';
  };
  source: 'rule' | 'llm' | 'hybrid';
  createdAt: number;
}

const PERIOD_OPTIONS = [
  { value: 'hour', label: 'Last Hour' },
  { value: 'day', label: 'Last 24h' },
  { value: 'week', label: 'Last 7 Days' },
  { value: 'month', label: 'Last 30 Days' },
];

const TYPE_COLORS: Record<string, string> = {
  click: 'bg-blue-500',
  hover: 'bg-purple-500',
  scroll: 'bg-green-500',
  form_submit: 'bg-orange-500',
  form_change: 'bg-cyan-500',
  navigation: 'bg-indigo-500',
  error: 'bg-red-500',
  custom: 'bg-gray-500',
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', icon: <AlertTriangle className="w-4 h-4" /> },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30', icon: <Zap className="w-4 h-4" /> },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30', icon: <Shield className="w-4 h-4" /> },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', icon: <Monitor className="w-4 h-4" /> },
  info: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/30', icon: <Settings className="w-4 h-4" /> },
};

const TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  accessibility: { bg: 'bg-purple-500/10', text: 'text-purple-400', icon: <Shield className="w-4 h-4" /> },
  performance: { bg: 'bg-orange-500/10', text: 'text-orange-400', icon: <Zap className="w-4 h-4" /> },
  usability: { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: <MousePointer className="w-4 h-4" /> },
  conversion: { bg: 'bg-green-500/10', text: 'text-green-400', icon: <Trophy className="w-4 h-4" /> },
  mobile: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', icon: <Smartphone className="w-4 h-4" /> },
  visual: { bg: 'bg-pink-500/10', text: 'text-pink-400', icon: <Monitor className="w-4 h-4" /> },
};

const EFFORT_STYLES: Record<string, { bg: string; text: string }> = {
  trivial: { bg: 'bg-green-500/10', text: 'text-green-400' },
  easy: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  moderate: { bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  hard: { bg: 'bg-red-500/10', text: 'text-red-400' },
};

const formatNumber = (num: number): string => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

export function AnalyticsDashboard({ projectId, shareId, className = '' }: AnalyticsDashboardProps) {
  const [period, setPeriod] = useState<'hour' | 'day' | 'week' | 'month'>('day');
  const [analytics, setAnalytics] = useState<AnalyticsAggregates | null>(null);
  const [suggestions, setSuggestions] = useState<DesignSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const { toast } = useToast();

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (shareId) params.set('shareId', shareId);

      const response = await fetch(`/api/infinity/analytics/aggregates/${projectId}?${params}`);
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSuggestions = async () => {
    if (!analytics) return;
    setIsGeneratingSuggestions(true);
    try {
      const response = await fetch('/api/infinity/analytics/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, shareId, analytics }),
      });
      const data = await response.json();
      if (data.success) {
        setSuggestions(data.suggestions || []);
        toast({ title: 'Suggestions generated', description: `Found ${data.suggestions?.length || 0} recommendations`, variant: 'default' });
      }
    } catch (error) {
      toast({ title: 'Failed to generate suggestions', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [projectId, shareId, period]);

  // Summary cards
  const summaryCards = useMemo(() => {
    if (!analytics) return [];

    const { interactions, vitals, funnels } = analytics;
    const totalSessions = funnels.reduce((sum, f) => sum + f.sessions, 0);
    const totalCompletions = funnels.reduce((sum, f) => sum + f.completions, 0);
    const avgConversion = totalSessions > 0 ? (totalCompletions / totalSessions * 100).toFixed(1) : '0';

    return [
      {
        title: 'Total Interactions',
        value: formatNumber(interactions.total),
        icon: MousePointer,
        trend: '+12%',
        trendUp: true,
      },
      {
        title: 'Active Sessions',
        value: formatNumber(totalSessions),
        icon: Users,
        trend: '+8%',
        trendUp: true,
      },
      {
        title: 'Conversion Rate',
        value: `${avgConversion}%`,
        icon: Trophy,
        trend: '+2.3%',
        trendUp: true,
      },
      {
        title: 'LCP (p75)',
        value: vitals.lcp ? `${Math.round(vitals.lcp.p75)}ms` : 'N/A',
        icon: Zap,
        trend: vitals.lcp && vitals.lcp.p75 > 2500 ? 'Slow' : 'Good',
        trendUp: !(vitals.lcp && vitals.lcp.p75 > 2500),
      },
      {
        title: 'CLS (p75)',
        value: vitals.cls ? vitals.cls.p75.toFixed(3) : 'N/A',
        icon: Layers,
        trend: vitals.cls && vitals.cls.p75 > 0.1 ? 'Poor' : 'Good',
        trendUp: !(vitals.cls && vitals.cls.p75 > 0.1),
      },
      {
        title: 'INP (p75)',
        value: vitals.inp ? `${Math.round(vitals.inp.p75)}ms` : 'N/A',
        icon: Monitor,
        trend: vitals.inp && vitals.inp.p75 > 200 ? 'Slow' : 'Good',
        trendUp: !(vitals.inp && vitals.inp.p75 > 200),
      },
    ];
  }, [analytics]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border-b">
        <div className="flex items-center gap-3">
          <BarChart2 className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Analytics Dashboard</h2>
            <p className="text-sm text-muted-foreground">
              {shareId ? 'Shared Preview' : 'Project'} Analytics
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod as any}>
            <SelectTrigger className="w-40 sm:w-48">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={fetchAnalytics} disabled={isLoading} className="gap-1">
            <RefreshCw className={isLoading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            Refresh
          </Button>

          <Button variant="outline" size="sm" onClick={fetchSuggestions} disabled={isGeneratingSuggestions || !analytics} className="gap-1">
            <Zap className="w-4 h-4" />
            {isGeneratingSuggestions ? 'Generating...' : 'AI Suggestions'}
          </Button>

          <Button variant="ghost" size="sm" className="gap-1">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 p-4">
        {summaryCards.map((card, i) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{card.title}</p>
                <p className="text-2xl font-bold mt-1">{card.value}</p>
                <div className="flex items-center gap-1 mt-1">
                  <card.icon className={`w-3.5 h-3.5 ${card.trendUp ? 'text-green-400' : 'text-red-400'}`} />
                  <span className={`text-xs font-medium ${card.trendUp ? 'text-green-400' : 'text-red-400'}`}>
                    {card.trend}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="flex-1">
        <TabsList className="mx-4 mb-4 grid w-auto grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="interactions">Interactions</TabsTrigger>
          <TabsTrigger value="funnels">Funnels</TabsTrigger>
          <TabsTrigger value="suggestions">AI Suggestions</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Web Vitals */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Core Web Vitals
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics?.vitals ? (
                  <div className="space-y-4">
                    {([
                      { key: 'lcp', label: 'LCP', threshold: 2500, unit: 'ms', lowerBetter: true },
                      { key: 'fid', label: 'FID', threshold: 100, unit: 'ms', lowerBetter: true },
                      { key: 'inp', label: 'INP', threshold: 200, unit: 'ms', lowerBetter: true },
                      { key: 'cls', label: 'CLS', threshold: 0.1, unit: '', lowerBetter: true },
                      { key: 'fcp', label: 'FCP', threshold: 1800, unit: 'ms', lowerBetter: true },
                    ] as const).map(({ key, label, threshold, unit, lowerBetter }) => {
                      const metric = analytics.vitals[key as keyof typeof analytics.vitals];
                      if (!metric) return null;

                      const p75 = metric.p75;
                      const isGood = lowerBetter ? p75 <= threshold : p75 >= threshold;
                      const percentage = Math.min(100, lowerBetter ? (threshold / p75) * 100 : (p75 / threshold) * 100);

                      return (
                        <div key={key} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{label}</span>
                            <span className={`font-mono ${isGood ? 'text-green-400' : 'text-red-400'}`}>
                              {p75.toFixed(key === 'cls' ? 3 : 0)}{unit}
                            </span>
                          </div>
                          <Progress
                            value={percentage}
                            className={`h-2 ${isGood ? 'bg-green-500' : 'bg-red-500'}`}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>p50: {metric.p50.toFixed(key === 'cls' ? 3 : 0)}{unit}</span>
                            <span>Threshold: {threshold}{unit}</span>
                            <span>p95: {metric.p95.toFixed(key === 'cls' ? 3 : 0)}{unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No Web Vitals data available</p>
                )}
              </CardContent>
            </Card>

            {/* Interaction Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" />
                  Interaction Types
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics?.interactions ? (
                  <div className="space-y-3">
                    {Object.entries(analytics.interactions.byType).map(([type, count]) => (
                      <div key={type} className="flex items-center gap-3">
                        <div
                          className={`w-3 h-3 rounded ${TYPE_COLORS[type] || 'bg-gray-500'}`}
                        />
                        <span className="capitalize text-sm flex-1">{type.replace('_', ' ')}</span>
                        <span className="text-sm font-mono text-muted-foreground">{formatNumber(count)}</span>
                        <Progress
                          value={analytics.interactions.total > 0 ? (count / analytics.interactions.total) * 100 : 0}
                          className="w-32 h-1.5"
                        />
                      </div>
                    ))}
                    {Object.keys(analytics.interactions.byType).length === 0 && (
                      <p className="text-muted-foreground text-center py-4">No interaction data yet</p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">Loading...</p>
                )}
              </CardContent>
            </Card>

            {/* Top Elements */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MousePointer className="w-4 h-4" />
                  Top Interacted Elements
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics?.interactions.topElements.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4">Element</th>
                          <th className="pb-2 pr-4">Interactions</th>
                          <th className="pb-2 pr-4">Share</th>
                          <th className="pb-2">Visualization</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.interactions.topElements.slice(0, 15).map((el, i) => (
                          <tr key={el.selector} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-mono text-xs max-w-xs truncate">{el.selector}</td>
                            <td className="py-2 pr-4 font-mono">{formatNumber(el.count)}</td>
                            <td className="py-2 pr-4">
                              {analytics.interactions.total > 0
                                ? `${((el.count / analytics.interactions.total) * 100).toFixed(1)}%`
                                : '0%'}
                            </td>
                            <td className="py-2">
                              <Progress
                                value={analytics.interactions.total > 0 ? (el.count / analytics.interactions.topElements[0].count) * 100 : 0}
                                className="h-1.5 w-full max-w-xs"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No element interaction data</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Interactions Tab */}
        <TabsContent value="interactions" className="p-4">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Interaction Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100%-80px)]">
                {analytics?.interactions.byElement && Object.keys(analytics.interactions.byElement).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(analytics.interactions.byElement)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 50)
                      .map(([selector, count]) => (
                        <div
                          key={selector}
                          className="flex items-center justify-between p-3 rounded-lg bg-card border hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-sm truncate">{selector}</p>
                            <p className="text-xs text-muted-foreground">{formatNumber(count)} interactions</p>
                          </div>
                          <Progress
                            value={analytics.interactions.total > 0 ? (count / analytics.interactions.total) * 100 : 0}
                            className="w-40 h-2"
                          />
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No interaction data</p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Funnels Tab */}
        <TabsContent value="funnels" className="p-4">
          {analytics?.funnels.length ? (
            <div className="space-y-4">
              {analytics.funnels.map((funnel) => (
                <Card key={funnel.funnelId}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{funnel.funnelName}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {funnel.sessions} sessions · {funnel.completions} completed · {(funnel.dropOffRate * 100).toFixed(1)}% drop-off
                      </p>
                    </div>
                    <Badge variant={funnel.dropOffRate > 0.5 ? 'destructive' : funnel.dropOffRate > 0.3 ? 'secondary' : 'default'}>
                      {(funnel.dropOffRate * 100).toFixed(1)}% drop-off
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {funnel.stepDropOffs.map((step, i) => {
                        const rate = step.sessions > 0 ? step.dropOffs / step.sessions : 0;
                        return (
                          <div
                            key={step.stepIndex}
                            className={`flex flex-col items-center gap-1 p-3 rounded-lg border ${
                              rate > 0.4 ? 'border-red-500/30 bg-red-500/5' : rate > 0.2 ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-green-500/30 bg-green-500/5'
                            }`}
                          >
                            <div className="font-medium text-sm text-center">{step.stepName}</div>
                            <div className="flex items-center gap-2">
                              <div className="text-2xl font-bold" style={{ color: rate > 0.4 ? '#ef4444' : rate > 0.2 ? '#f59e0b' : '#22c55e' }}>
                                {step.sessions - step.dropOffs}/{step.sessions}
                              </div>
                              <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${step.sessions > 0 ? (1 - rate) * 100 : 0}%`,
                                    background: rate > 0.4 ? '#ef4444' : rate > 0.2 ? '#f59e0b' : '#22c55e',
                                  }}
                                />
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {rate > 0 ? `${(rate * 100).toFixed(0)}% drop` : 'No drop'}
                            </div>
                            {i < funnel.stepDropOffs.length - 1 && (
                              <div className="w-0.5 h-8 bg-muted" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No funnel data configured</p>
                <p className="text-sm mt-1">Set up funnels in the Analytics settings to track conversion flows</p>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Suggestions Tab */}
        <TabsContent value="suggestions" className="p-4">
          <div className="flex items-center justify-between mb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4" />
              AI-Powered Suggestions
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {suggestions.filter(s => s.severity === 'critical' || s.severity === 'high').length} high priority
            </Badge>
          </div>

          {isGeneratingSuggestions ? (
            <Card className="h-64 flex items-center justify-center">
              <div className="text-center">
                <Zap className="w-8 h-8 mx-auto mb-4 animate-spin text-primary" />
                <p>Analyzing analytics with AI...</p>
                <p className="text-sm text-muted-foreground mt-1">This may take a moment</p>
              </div>
            </Card>
          ) : suggestions.length > 0 ? (
            <div className="space-y-3">
              {suggestions.map((suggestion) => {
                const severityStyle = SEVERITY_STYLES[suggestion.severity];
                const typeStyle = TYPE_STYLES[suggestion.type];
                const effortStyle = EFFORT_STYLES[suggestion.fix.effort];

                return (
                  <motion.div
                    key={suggestion.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-4 rounded-lg border ${severityStyle.bg} ${severityStyle.border}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeStyle.bg} ${typeStyle.text}`}>
                            {typeStyle.icon}
                            {suggestion.type}
                          </span>
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${severityStyle.bg} ${severityStyle.text} ${severityStyle.border}`}>
                            {severityStyle.icon}
                            {suggestion.severity}
                          </span>
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${effortStyle.bg} ${effortStyle.text}`}>
                            {suggestion.fix.effort}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {suggestion.source}
                          </Badge>
                        </div>
                        <h4 className="font-medium mb-1">{suggestion.title}</h4>
                        <p className="text-sm text-muted-foreground mb-3">{suggestion.description}</p>

                        {suggestion.evidence && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                            <span>Metric: {suggestion.evidence.metric}</span>
                            <span className="font-mono">{suggestion.evidence.value.toFixed(suggestion.evidence.metric === 'CLS' ? 3 : 0)}</span>
                            {suggestion.evidence.threshold && (
                              <>
                                <span>/</span>
                                <span className="font-mono">{suggestion.evidence.threshold}</span>
                              </>
                            )}
                          </div>
                        )}

                        {suggestion.affectedElements?.length && (
                          <div className="mb-3">
                            <p className="text-xs text-muted-foreground mb-1">Affected elements:</p>
                            <div className="flex flex-wrap gap-1">
                              {suggestion.affectedElements.map((el, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {el.selector}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="pt-3 border-t">
                          <p className="text-sm font-medium mb-1">Suggested Fix:</p>
                          <p className="text-sm text-muted-foreground mb-2">{suggestion.fix.description}</p>
                          {suggestion.fix.codeChange && (
                            <details className="group">
                              <summary className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                                Show code change
                                <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                              </summary>
                              <pre className="mt-2 p-2 bg-muted rounded text-xs font-mono overflow-x-auto">{suggestion.fix.codeChange}</pre>
                            </details>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            <span>Confidence: {Math.round(suggestion.fix.confidence * 100)}%</span>
                            <span className={`px-2 py-0.5 rounded ${effortStyle.bg} ${effortStyle.text}`}>
                              Effort: {suggestion.fix.effort}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : analytics ? (
            <Card className="h-64 flex items-center justify-center">
              <div className="text-center">
                <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No suggestions generated yet</p>
                <p className="text-sm text-muted-foreground mb-4">Click "AI Suggestions" to analyze your analytics data</p>
                <Button onClick={fetchSuggestions} disabled={isGeneratingSuggestions}>
                  <Zap className="w-4 h-4 mr-2" />
                  Generate Suggestions
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="h-64 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No analytics data available</p>
                <p className="text-sm mt-1">Collect analytics data first to generate suggestions</p>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}