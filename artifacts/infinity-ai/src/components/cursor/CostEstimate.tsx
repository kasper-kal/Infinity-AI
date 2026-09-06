/**
 * CostEstimate — Cost estimation and tracking component
 * Part of Phase 39: Enhanced LLM API Key System
 */
import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  Badge,
  Progress,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  Select,
  Input,
  Button,
  IconButton,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Separator,
  Label,
  Slider,
} from "@/components/ui";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Download,
  Calendar,
  BarChart3,
  PieChart,
  Settings,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useModelRouter, type ModelConfig, type CostEstimate, type CostSummary, type BuildMode, type TaskCategory } from "@/hooks/useModelRouter";

interface CostEstimateProps {
  /** Model to estimate cost for */
  model?: ModelConfig;
  /** Estimated input tokens */
  inputTokens?: number;
  /** Estimated output tokens */
  outputTokens?: number;
  /** Build mode for estimation */
  buildMode?: BuildMode;
  /** Task category for estimation */
  taskCategory?: TaskCategory;
  /** Project ID for cost tracking */
  projectId?: string;
  /** User ID */
  userId?: string;
  /** Show detailed breakdown */
  showBreakdown?: boolean;
  /** Show cost history */
  showHistory?: boolean;
  /** Show budget alerts */
  showBudget?: boolean;
  /** Monthly budget in USD */
  monthlyBudget?: number;
  /** Compact mode */
  compact?: boolean;
  /** Callback when estimate changes */
  onEstimateChange?: (estimate: CostEstimate) => void;
}

const COST_THRESHOLDS = {
  warning: 0.50,    // 50% of budget
  danger: 0.80,     // 80% of budget
  critical: 0.95,   // 95% of budget
};

export const CostEstimate: React.FC<CostEstimateProps> = ({
  model,
  inputTokens = 2000,
  outputTokens = 1000,
  buildMode = "balanced",
  taskCategory = "chat",
  projectId,
  userId,
  showBreakdown = true,
  showHistory = true,
  showBudget = true,
  monthlyBudget = 50,
  compact = false,
  onEstimateChange,
}) => {
  const { t } = useI18n();
  const { estimateRequestCost, estimateDeepResearchCost, getCostSummary } = useModelRouter({ projectId, userId });

  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [deepResearchEstimate, setDeepResearchEstimate] = useState<CostEstimate | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState(30);
  const [showDetailedHistory, setShowDetailedHistory] = useState(false);
  const [budgetAlert, setBudgetAlert] = useState<"none" | "warning" | "danger" | "critical">("none");

  // Calculate estimate when model or tokens change
  useEffect(() => {
    if (model) {
      const est = estimateRequestCost(model, inputTokens, outputTokens);
      setEstimate(est);
      onEstimateChange?.(est);

      // Deep research estimate
      const drEst = estimateDeepResearchCost(model, 5);
      setDeepResearchEstimate(drEst);
    } else {
      setEstimate(null);
      setDeepResearchEstimate(null);
    }
  }, [model, inputTokens, outputTokens, estimateRequestCost, estimateDeepResearchCost, onEstimateChange]);

  // Load cost summary
  useEffect(() => {
    if (projectId) {
      setIsLoading(true);
      getCostSummary(projectId, historyPeriod).then(data => {
        setCostSummary(data);
        setIsLoading(false);

        // Check budget alert
        if (monthlyBudget > 0 && data.totalCost > 0) {
          const utilization = data.totalCost / monthlyBudget;
          if (utilization >= COST_THRESHOLDS.critical) setBudgetAlert("critical");
          else if (utilization >= COST_THRESHOLDS.danger) setBudgetAlert("danger");
          else if (utilization >= COST_THRESHOLDS.warning) setBudgetAlert("warning");
          else setBudgetAlert("none");
        }
      }).catch(() => setIsLoading(false));
    }
  }, [projectId, historyPeriod, getCostSummary, monthlyBudget]);

  const formatCost = useCallback((cost: number) => {
    if (cost === 0) return t("costEstimate.free") || "Free";
    if (cost < 0.01) return `$${cost.toFixed(6)}`;
    if (cost < 1) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  }, [t]);

  const getBudgetUtilization = useCallback(() => {
    if (!costSummary || monthlyBudget <= 0) return 0;
    return (costSummary.totalCost / monthlyBudget) * 100;
  }, [costSummary, monthlyBudget]);

  const getAlertIcon = () => {
    switch (budgetAlert) {
      case "warning": return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case "danger": return <AlertTriangle className="w-5 h-5 text-orange-400" />;
      case "critical": return <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />;
      default: return <CheckCircle className="w-5 h-5 text-green-400" />;
    }
  };

  const getAlertText = () => {
    switch (budgetAlert) {
      case "warning": return t("costEstimate.budgetWarning") || "Budget at 50%";
      case "danger": return t("costEstimate.budgetDanger") || "Budget at 80%";
      case "critical": return t("costEstimate.budgetCritical") || "Budget at 95%!";
      default: return t("costEstimate.budgetOk") || "Budget healthy";
    }
  };

  const getAlertColor = () => {
    switch (budgetAlert) {
      case "warning": return "border-yellow-400/30 bg-yellow-400/5 text-yellow-400";
      case "danger": return "border-orange-400/30 bg-orange-400/5 text-orange-400";
      case "critical": return "border-red-400/30 bg-red-400/5 text-red-400";
      default: return "border-green-400/30 bg-green-400/5 text-green-400";
    }
  };

  if (compact) {
    return (
      <Card className="w-full">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {estimate ? formatCost(estimate.estimatedCostUsd) : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("costEstimate.estimatedCost") || "Estimated cost"}
                </p>
              </div>
            </div>
            {showBudget && monthlyBudget > 0 && costSummary && (
              <div className="flex items-center gap-2">
                <Progress value={getBudgetUtilization()} className="w-32 h-1.5" />
                <span className="text-xs text-muted-foreground">
                  {getBudgetUtilization().toFixed(0)}%
                </span>
              </div>
            )}
            {model && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton size="sm" variant="ghost" onClick={() => setShowDetailedHistory(!showDetailedHistory)}>
                    <Eye className="w-4 h-4" />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t("costEstimate.showDetails") || "Show details"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current Estimate Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            <CardTitle>{t("costEstimate.currentEstimate") || "Current Estimate"}</CardTitle>
          </div>
          {model && (
            <div className="flex items-center gap-2">
              <Select
                value={buildMode}
                onChange={e => {}}
                className="w-32"
                disabled
              >
                <option value="speed">Speed</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality</option>
                <option value="max">Maximum</option>
              </Select>
              <Select
                value={taskCategory}
                onChange={e => {}}
                className="w-32"
                disabled
              >
                <option value="chat">Chat</option>
                <option value="coding">Coding</option>
                <option value="research">Research</option>
                <option value="planning">Planning</option>
                <option value="review">Review</option>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {model && estimate && (
            <>
              {/* Main Estimate */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-bg-elevated/50 border border-border-primary/50 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    {t("costEstimate.inputTokens") || "Input Tokens"}
                  </p>
                  <p className="text-3xl font-bold">{inputTokens.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-bg-elevated/50 border border-border-primary/50 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    {t("costEstimate.outputTokens") || "Output Tokens"}
                  </p>
                  <p className="text-3xl font-bold">{outputTokens.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-accent/10 border border-accent/20 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    {t("costEstimate.estimatedCost") || "Estimated Cost"}
                  </p>
                  <p className="text-3xl font-bold text-accent-foreground">
                    {formatCost(estimate.estimatedCostUsd)}
                  </p>
                </div>
              </div>

              {/* Breakdown */}
              {showBreakdown && estimate.breakdown && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("costEstimate.breakdown") || "Cost Breakdown"}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {t("costEstimate.inputCost") || "Input Cost"}
                        </span>
                        <span className="font-medium">{formatCost(estimate.breakdown.inputCost)}</span>
                      </div>
                      <Progress value={(estimate.breakdown.inputCost / estimate.estimatedCostUsd) * 100} className="h-1.5 mt-1" />
                    </div>
                    <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {t("costEstimate.outputCost") || "Output Cost"}
                        </span>
                        <span className="font-medium">{formatCost(estimate.breakdown.outputCost)}</span>
                      </div>
                      <Progress value={(estimate.breakdown.outputCost / estimate.estimatedCostUsd) * 100} className="h-1.5 mt-1" />
                    </div>
                  </div>
                </div>
              )}

              {/* Token Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("costEstimate.inputTokens") || "Input Tokens"}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      max="200000"
                      step="100"
                      value={inputTokens}
                      onChange={e => {}}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">tokens</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("costEstimate.outputTokens") || "Output Tokens"}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      max="32000"
                      step="100"
                      value={outputTokens}
                      onChange={e => {}}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">tokens</span>
                  </div>
                </div>
              </div>

              {/* Deep Research Estimate */}
              {deepResearchEstimate && taskCategory === "research" && (
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-400/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-400" />
                      <span className="font-medium">{t("costEstimate.deepResearch") || "Deep Research (5 steps)"}</span>
                    </div>
                    <span className="text-lg font-bold text-purple-400">
                      {formatCost(deepResearchEstimate.estimatedCostUsd)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    {t("costEstimate.deepResearchDesc") || "Estimated: 5 search steps + synthesis"}
                  </p>
                </div>
              )}
            </>
          )}

          {!model && (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>{t("costEstimate.selectModel") || "Select a model to see cost estimate"}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Budget Alert */}
      {showBudget && monthlyBudget > 0 && costSummary && (
        <Card className={getAlertColor()}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getAlertIcon()}
                <div>
                  <p className="font-medium">{getAlertText()}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("costEstimate.budgetUsed") || "Used"}: {formatCost(costSummary.totalCost)} / {formatCost(monthlyBudget)} ({getBudgetUtilization().toFixed(1)}%)
                  </p>
                </div>
              </div>
              <Progress value={getBudgetUtilization()} className="w-48 h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cost History */}
      {showHistory && projectId && costSummary && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              <CardTitle>{t("costEstimate.costHistory") || "Cost History"}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Select value={historyPeriod} onChange={e => setHistoryPeriod(parseInt(e.target.value))} className="w-32">
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </Select>
              <IconButton size="sm" variant="ghost" onClick={() => { /* refresh */ }}>
                <RefreshCw className="w-4 h-4" />
              </IconButton>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50 text-center">
                    <p className="text-2xl font-bold">{formatCost(costSummary.totalCost)}</p>
                    <p className="text-xs text-muted-foreground">{t("costEstimate.totalCost") || "Total Cost"}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50 text-center">
                    <p className="text-2xl font-bold">{Object.keys(costSummary.costByModel).length}</p>
                    <p className="text-xs text-muted-foreground">{t("costEstimate.modelsUsed") || "Models Used"}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50 text-center">
                    <p className="text-2xl font-bold">{Object.keys(costSummary.costByCategory).length}</p>
                    <p className="text-xs text-muted-foreground">{t("costEstimate.categories") || "Categories"}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50 text-center">
                    <p className="text-2xl font-bold">{getBudgetUtilization().toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">{t("costEstimate.budgetUsed") || "Budget Used"}</p>
                  </div>
                </div>

                {/* Cost by Model */}
                {Object.keys(costSummary.costByModel).length > 0 && (
                  <div className="space-y-4">
                    <p className="text-sm font-medium">{t("costEstimate.byModel") || "Cost by Model"}</p>
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("costEstimate.model") || "Model"}</TableHead>
                          <TableHead className="text-right">{t("costEstimate.cost") || "Cost"}</TableHead>
                          <TableHead className="text-right">{t("costEstimate.percentage") || "%"}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(costSummary.costByModel)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 10)
                          .map(([modelId, cost]) => (
                            <TableRow key={modelId}>
                              <TableCell className="font-mono text-sm">{modelId}</TableCell>
                              <TableCell className="text-right">{formatCost(cost)}</TableCell>
                              <TableCell className="text-right">
                                <Progress value={(cost / costSummary.totalCost) * 100} className="w-32 h-1.5" />
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Cost by Category */}
                {Object.keys(costSummary.costByCategory).length > 0 && (
                  <div className="space-y-4">
                    <p className="text-sm font-medium">{t("costEstimate.byCategory") || "Cost by Category"}</p>
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("costEstimate.category") || "Category"}</TableHead>
                          <TableHead className="text-right">{t("costEstimate.cost") || "Cost"}</TableHead>
                          <TableHead className="text-right">{t("costEstimate.percentage") || "%"}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(costSummary.costByCategory)
                          .sort(([, a], [, b]) => b - a)
                          .map(([category, cost]) => (
                            <TableRow key={category}>
                              <TableCell className="capitalize">{category}</TableCell>
                              <TableCell className="text-right">{formatCost(cost)}</TableCell>
                              <TableCell className="text-right">
                                <Progress value={(cost / costSummary.totalCost) * 100} className="w-32 h-1.5" />
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Daily Cost Chart (simplified) */}
                {costSummary.costByDay.length > 0 && showDetailedHistory && (
                  <div className="space-y-4">
                    <p className="text-sm font-medium">{t("costEstimate.dailyTrend") || "Daily Trend"}</p>
                    <div className="h-48 flex items-end gap-1">
                      {costSummary.costByDay.slice(-30).map((day, i) => (
                        <div
                          key={day.date}
                          className="flex-1 flex flex-col items-center"
                          style={{ height: `${Math.max((day.cost / Math.max(...costSummary.costByDay.map(d => d.cost), 1)) * 100, 4)}%` }}
                        >
                          <div className="w-full bg-accent/50 rounded-t transition-all hover:bg-accent" style={{ height: "100%" }} />
                          <span className="text-xs text-muted-foreground mt-1">{new Date(day.date).getDate()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {costSummary.costByDay.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>{t("costEstimate.noHistory") || "No cost history available"}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Export Button */}
      {projectId && costSummary && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => { /* export CSV */ }}>
            <Download className="w-4 h-4 mr-2" />
            {t("costEstimate.exportCsv") || "Export CSV"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default CostEstimate;