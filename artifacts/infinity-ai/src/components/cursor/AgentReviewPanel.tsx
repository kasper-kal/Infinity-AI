/**
 * AgentReviewPanel — UI for automated agent code reviews
 * Shows review results, review history, rules management, and allows running reviews
 */

import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Badge, Input, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger, TabsContent, ScrollArea, Separator, Progress, Alert, AlertDescription, AlertTitle } from "@/components/ui";
import {
  GitPullRequest,
  Play,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  FileText,
  Settings,
  Clock,
  Shield,
  Zap,
  Search,
  ChevronDown,
  ChevronUp,
  Filter,
  ExternalLink,
  Code,
  Loader2,
  GitBranch,
  Activity,
} from "lucide-react";

interface ReviewFinding {
  id: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "low" | "medium" | "high" | "critical";
  dimension: string;
  message: string;
  suggestion: string | null;
  code: string | null;
  confidence: number;
  falsePositiveLikelihood: number;
}

interface ReviewResult {
  id: string;
  projectId: string;
  prNumber: number | null;
  prUrl: string | null;
  baseCommit: string;
  headCommit: string;
  status: "running" | "completed" | "failed" | "cancelled";
  findings: ReviewFinding[];
  summary: {
    total: number;
    byDimension: Record<string, number>;
    bySeverity: Record<string, number>;
    approved: boolean;
  };
  metadata: {
    reviewedAt: string;
    durationMs: number;
    filesReviewed: number;
    linesReviewed: number;
    rulesEvaluated: number;
  };
}

interface ReviewRule {
  id: string;
  name: string;
  description: string;
  dimension: string;
  severity: string;
  pattern: string;
  message: string;
  fix?: string;
  enabled: boolean;
}

interface ReviewHistory {
  id: string;
  prNumber: number | null;
  prUrl: string | null;
  status: string;
  summary: {
    total: number;
    approved: boolean;
  };
  metadata: {
    reviewedAt: string;
    durationMs: number;
    filesReviewed: number;
  };
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-500",
  medium: "bg-yellow-500",
  high: "bg-orange-500",
  critical: "bg-red-500",
};

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  low: <Zap className="w-4 h-4 text-blue-500" />,
  medium: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
  high: <AlertCircle className="w-4 h-4 text-orange-500" />,
  critical: <XCircle className="w-4 h-4 text-red-500" />,
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle className="w-4 h-4 text-emerald-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  running: <Activity className="w-4 h-4 text-green-500 animate-pulse" />,
  cancelled: <XCircle className="w-4 h-4 text-gray-500" />,
};

export function AgentReviewPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"new" | "history" | "rules" | "settings">("new");
  const [reviews, setReviews] = useState<ReviewHistory[]>([]);
  const [selectedReview, setSelectedReview] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningReview, setRunningReview] = useState(false);
  const [diffInput, setDiffInput] = useState("");
  const [prNumber, setPrNumber] = useState("");
  const [reviewMode, setReviewMode] = useState<"diff" | "pr" | "quick">("diff");
  const [rules, setRules] = useState<ReviewRule[]>([]);
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([
    "correctness", "security", "performance", "style", "tests", "breaking-changes"
  ]);
  const [severityThreshold, setSeverityThreshold] = useState("medium");
  const [learningStats, setLearningStats] = useState<{ totalFeedback: number; falsePositiveRate: number }>({ totalFeedback: 0, falsePositiveRate: 0 });
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterDimension, setFilterDimension] = useState<string>("all");
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/infinity/agent-review/history?projectId=${projectId}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        setReviews(data.reviews || []);
      }
    } catch (error) {
      console.error("Failed to fetch review history:", error);
    }
  }, [projectId]);

  const fetchRules = useCallback(async () => {
    try {
      const response = await fetch(`/api/infinity/agent-review/rules?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setRules(data.rules || []);
      }
    } catch (error) {
      console.error("Failed to fetch rules:", error);
    }
  }, [projectId]);

  const fetchLearningStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/infinity/agent-review/learning/stats?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setLearningStats(data.stats || { totalFeedback: 0, falsePositiveRate: 0 });
      }
    } catch (error) {
      console.error("Failed to fetch learning stats:", error);
    }
  }, [projectId]);

  useEffect(() => {
    fetchHistory();
    fetchRules();
    fetchLearningStats();
  }, [fetchHistory, fetchRules, fetchLearningStats]);

  const handleRunReview = async () => {
    setRunningReview(true);
    try {
      const body: Record<string, unknown> = {
        projectId,
        config: {
          dimensions: selectedDimensions,
          severityThreshold,
        },
      };

      if (reviewMode === "pr" && prNumber) {
        body.prNumber = parseInt(prNumber, 10);
      } else if (reviewMode === "diff" && diffInput) {
        body.diff = diffInput;
      }

      const response = await fetch("/api/infinity/agent-review/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        // Poll for result
        const reviewId = data.reviewId;
        await pollReviewResult(reviewId);
      }
    } catch (error) {
      console.error("Failed to start review:", error);
    } finally {
      setRunningReview(false);
    }
  };

  const pollReviewResult = async (reviewId: string) => {
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const response = await fetch(`/api/infinity/agent-review/result/${reviewId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.result && data.result.status === "completed") {
            setSelectedReview(data.result);
            fetchHistory();
            return;
          }
        }
      } catch (error) {
        console.error("Failed to poll review:", error);
      }
      attempts++;
    }
  };

  const handleQuickReview = async (filePath: string, content: string) => {
    try {
      const response = await fetch("/api/infinity/agent-review/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, projectRoot: "/", filePath, content }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.findings) {
          // Convert quick review findings to full format for display
          setSelectedReview({
            id: `quick-${Date.now()}`,
            projectId,
            prNumber: null,
            prUrl: null,
            baseCommit: "",
            headCommit: "",
            status: "completed",
            findings: data.findings,
            summary: {
              total: data.findings.length,
              byDimension: {},
              bySeverity: {},
              approved: data.findings.length === 0,
            },
            metadata: {
              reviewedAt: new Date().toISOString(),
              durationMs: 0,
              filesReviewed: 1,
              linesReviewed: content.split("\n").length,
              rulesEvaluated: rules.length,
            },
          });
        }
      }
    } catch (error) {
      console.error("Quick review failed:", error);
    }
  };

  const handleSubmitFeedback = async (findingId: string, isFalsePositive: boolean) => {
    try {
      await fetch("/api/infinity/agent-review/learning/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, findingId, isFalsePositive }),
      });
      fetchLearningStats();
    } catch (error) {
      console.error("Failed to submit feedback:", error);
    }
  };

  const getFilteredFindings = () => {
    if (!selectedReview) return [];
    return selectedReview.findings.filter(f => {
      if (filterSeverity !== "all" && f.severity !== filterSeverity) return false;
      if (filterDimension !== "all" && f.dimension !== filterDimension) return false;
      return true;
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest className="w-5 h-5" />
            {t("agentReview.title") || "Agent Review"}
          </CardTitle>
          <Badge variant="outline" className="ml-2">
            {reviews.length} reviews
          </Badge>
        </div>
        <CardDescription>
          {t("agentReview.description") || "Automated code review with AI-powered analysis"}
        </CardDescription>
      </CardHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="flex-shrink-0 border-b">
          <TabsTrigger value="new">
            <Play className="w-4 h-4 mr-2" />
            {t("agentReview.tabs.new") || "New Review"}
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="w-4 h-4 mr-2" />
            {t("agentReview.tabs.history") || "History"}
            <Badge variant="secondary" className="ml-1">{reviews.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="rules">
            <Settings className="w-4 h-4 mr-2" />
            {t("agentReview.tabs.rules") || "Rules"}
            <Badge variant="secondary" className="ml-1">{rules.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Shield className="w-4 h-4 mr-2" />
            {t("agentReview.tabs.settings") || "Settings"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="flex-1 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {/* Review Mode Selection */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("agentReview.new.title") || "Run Code Review"}</CardTitle>
                  <CardDescription>
                    {t("agentReview.new.description") || "Analyze code for bugs, security issues, and improvements"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      variant={reviewMode === "diff" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReviewMode("diff")}
                    >
                      <Code className="w-4 h-4 mr-2" />
                      {t("agentReview.new.diff") || "Paste Diff"}
                    </Button>
                    <Button
                      variant={reviewMode === "pr" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReviewMode("pr")}
                    >
                      <GitPullRequest className="w-4 h-4 mr-2" />
                      {t("agentReview.new.pr") || "PR Number"}
                    </Button>
                    <Button
                      variant={reviewMode === "quick" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReviewMode("quick")}
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      {t("agentReview.new.quick") || "Quick Review"}
                    </Button>
                  </div>

                  {reviewMode === "diff" && (
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        {t("agentReview.new.pasteDiff") || "Paste your diff (git diff format)"}
                      </label>
                      <Textarea
                        value={diffInput}
                        onChange={(e) => setDiffInput(e.target.value)}
                        placeholder={t("agentReview.new.diffPlaceholder") || `Paste git diff format here...`}
                        rows={12}
                        className="font-mono text-sm"
                      />
                    </div>
                  )}

                  {reviewMode === "pr" && (
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        {t("agentReview.new.prNumber") || "Pull Request Number"}
                      </label>
                      <Input
                        type="number"
                        value={prNumber}
                        onChange={(e) => setPrNumber(e.target.value)}
                        placeholder={t("agentReview.new.prPlaceholder") || "e.g. 123"}
                        className="max-w-xs"
                      />
                    </div>
                  )}

                  {reviewMode === "quick" && (
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        {t("agentReview.new.quickHint") || "Quick review: paste file content for instant analysis"}
                      </label>
                      <Textarea
                        value={diffInput}
                        onChange={(e) => setDiffInput(e.target.value)}
                        placeholder={t("agentReview.new.quickPlaceholder") || "Paste file content here..."}
                        rows={8}
                        className="font-mono text-sm"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Dimension Selection */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("agentReview.new.dimensions") || "Review Dimensions"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {["correctness", "security", "performance", "style", "tests", "breaking-changes", "documentation", "dependencies"].map((dim) => (
                      <Badge
                        key={dim}
                        variant={selectedDimensions.includes(dim) ? "default" : "outline"}
                        className="cursor-pointer hover:opacity-80"
                        onClick={() => {
                          if (selectedDimensions.includes(dim)) {
                            setSelectedDimensions(selectedDimensions.filter(d => d !== dim));
                          } else {
                            setSelectedDimensions([...selectedDimensions, dim]);
                          }
                        }}
                      >
                        {dim}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Run Button */}
              <div className="flex justify-end gap-2">
                <Button
                  onClick={handleRunReview}
                  disabled={runningReview || (reviewMode === "diff" && !diffInput) || (reviewMode === "pr" && !prNumber)}
                >
                  {runningReview ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t("agentReview.new.running") || "Reviewing..."}
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      {t("agentReview.new.run") || "Run Review"}
                    </>
                  )}
                </Button>
              </div>

              {/* Review Results */}
              {selectedReview && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{t("agentReview.results.title") || "Review Results"}</CardTitle>
                      <div className="flex items-center gap-2">
                        {STATUS_ICONS[selectedReview.status]}
                        <Badge variant={selectedReview.summary.approved ? "default" : "destructive"}>
                          {selectedReview.summary.approved ? "Approved" : "Changes Requested"}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription className="flex items-center gap-4 text-sm">
                      <span>{selectedReview.summary.total} findings</span>
                      <span>{selectedReview.metadata.filesReviewed} files</span>
                      <span>{formatDuration(selectedReview.metadata.durationMs)}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {Object.entries(selectedReview.summary.bySeverity).map(([severity, count]) => (
                        <div key={severity} className="p-3 bg-muted rounded-lg text-center">
                          <div className="flex items-center justify-center gap-2">
                            {SEVERITY_ICONS[severity]}
                            <span className="text-2xl font-bold">{count}</span>
                          </div>
                          <p className="text-sm text-muted-foreground capitalize">{severity}</p>
                        </div>
                      ))}
                    </div>

                    {/* Filters */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-muted-foreground" />
                        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Severity" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Severity</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="low">Low</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Select value={filterDimension} onValueChange={setFilterDimension}>
                        <SelectTrigger className="w-36">
                          <SelectValue placeholder="Dimension" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Dimensions</SelectItem>
                          {Object.keys(selectedReview.summary.byDimension).map((dim) => (
                            <SelectItem key={dim} value={dim}>{dim}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Findings List */}
                    <div className="space-y-2">
                      {getFilteredFindings().length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                          <CheckCircle className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
                          <p>{t("agentReview.results.noFindings") || "No findings found!"}</p>
                        </div>
                      ) : (
                        getFilteredFindings().map((finding) => (
                          <Card
                            key={finding.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setExpandedFinding(expandedFinding === finding.id ? null : finding.id)}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start gap-3">
                                {SEVERITY_ICONS[finding.severity]}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className="text-xs">
                                      {finding.dimension}
                                    </Badge>
                                    <Badge className={`${SEVERITY_COLORS[finding.severity]} text-white text-xs`}>
                                      {finding.severity}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {finding.file}:{finding.line}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm">{finding.message}</p>
                                  {expandedFinding === finding.id && (
                                    <div className="mt-3 space-y-2">
                                      {finding.suggestion && (
                                        <div className="p-2 bg-muted rounded text-sm">
                                          <span className="font-medium">Suggestion: </span>
                                          {finding.suggestion}
                                        </div>
                                      )}
                                      {finding.code && (
                                        <pre className="p-2 bg-muted rounded text-xs font-mono overflow-x-auto">
                                          {finding.code}
                                        </pre>
                                      )}
                                      <div className="flex gap-2 mt-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSubmitFeedback(finding.id, true);
                                          }}
                                        >
                                          Mark False Positive
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {expandedFinding === finding.id ? (
                                  <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {reviews.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <GitPullRequest className="w-12 h-12 mb-4 opacity-50" />
                  <p>{t("agentReview.history.empty") || "No review history yet. Run your first review!"}</p>
                </div>
              ) : (
                reviews.map((review) => (
                  <Card
                    key={review.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={async () => {
                      try {
                        const response = await fetch(`/api/infinity/agent-review/result/${review.id}`);
                        if (response.ok) {
                          const data = await response.json();
                          setSelectedReview(data.result);
                          setActiveTab("new");
                        }
                      } catch (error) {
                        console.error("Failed to load review:", error);
                      }
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          {STATUS_ICONS[review.status]}
                          <div>
                            <div className="flex items-center gap-2">
                              {review.prNumber && (
                                <Badge variant="outline" className="gap-1">
                                  <GitPullRequest className="w-3 h-3" />
                                  PR #{review.prNumber}
                                </Badge>
                              )}
                              <Badge variant={review.summary.approved ? "default" : "destructive"}>
                                {review.summary.approved ? "Approved" : "Changes Requested"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {review.metadata.filesReviewed} files · {review.summary.total} findings · {formatDuration(review.metadata.durationMs)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          {new Date(review.metadata.reviewedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="rules" className="flex-1 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium">{t("agentReview.rules.title") || "Review Rules"}</h3>
                <Button variant="outline" size="sm" onClick={fetchRules}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
              {rules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Settings className="w-12 h-12 mb-4 opacity-50" />
                  <p>{t("agentReview.rules.empty") || "No custom rules configured. Using defaults."}</p>
                </div>
              ) : (
                rules.map((rule) => (
                  <Card key={rule.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={rule.enabled ? "default" : "secondary"}>
                              {rule.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                            <Badge variant="outline">{rule.dimension}</Badge>
                            <Badge className={`${SEVERITY_COLORS[rule.severity]} text-white`}>
                              {rule.severity}
                            </Badge>
                          </div>
                          <h4 className="font-medium mt-2">{rule.name}</h4>
                          <p className="text-sm text-muted-foreground">{rule.description}</p>
                          {rule.pattern && (
                            <code className="block mt-2 p-2 bg-muted rounded text-xs font-mono">
                              {rule.pattern}
                            </code>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("agentReview.settings.title") || "Review Settings"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {t("agentReview.settings.severityThreshold") || "Severity Threshold"}
                    </label>
                    <Select value={severityThreshold} onValueChange={setSeverityThreshold}>
                      <SelectTrigger className="w-full max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low - Report all findings</SelectItem>
                        <SelectItem value="medium">Medium - Report medium and above</SelectItem>
                        <SelectItem value="high">High - Report high and critical only</SelectItem>
                        <SelectItem value="critical">Critical - Report critical only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("agentReview.settings.learning") || "Learning System"}</CardTitle>
                  <CardDescription>
                    {t("agentReview.settings.learningDesc") || "Track false positives to improve review accuracy over time"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-muted rounded-lg text-center">
                      <p className="text-3xl font-bold">{learningStats.totalFeedback}</p>
                      <p className="text-sm text-muted-foreground">Total Feedback</p>
                    </div>
                    <div className="p-4 bg-muted rounded-lg text-center">
                      <p className="text-3xl font-bold">
                        {learningStats.totalFeedback > 0
                          ? `${Math.round((learningStats.falsePositiveRate || 0) * 100)}%`
                          : "0%"}
                      </p>
                      <p className="text-sm text-muted-foreground">False Positive Rate</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </Card>
  );
}

export default AgentReviewPanel;
