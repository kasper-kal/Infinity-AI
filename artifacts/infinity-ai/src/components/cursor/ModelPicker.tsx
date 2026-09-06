/**
 * ModelPicker — Interactive model selection table with filters, benchmarks, and test button
 * Part of Phase 39: Enhanced LLM API Key System
 */
import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  Button,
  Input,
  Select,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Progress,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  IconButton,
  Checkbox,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui";
import {
  Search,
  Filter,
  Zap,
  Shield,
  DollarSign,
  Clock,
  Brain,
  Eye,
  Play,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useModelRouter, type ModelConfig, type ModelProvider, type TaskCategory, type BuildMode, type ModelBenchmark, type ModelSelectionResult } from "@/hooks/useModelRouter";

interface ModelPickerProps {
  /** Initial task category filter */
  initialTaskCategory?: TaskCategory;
  /** Initial build mode filter */
  initialBuildMode?: BuildMode;
  /** Callback when model is selected */
  onModelSelect?: (model: ModelConfig, result: ModelSelectionResult) => void;
  /** Show/hide provider filter */
  showProviderFilter?: boolean;
  /** Show/hide capability filter */
  showCapabilityFilter?: boolean;
  /** Compact mode for embedding */
  compact?: boolean;
  /** Project ID for cost tracking */
  projectId?: string;
  /** User ID */
  userId?: string;
}

const PROVIDER_COLORS: Record<ModelProvider, string> = {
  openrouter: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  anthropic: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  openai: "bg-green-500/20 text-green-400 border-green-500/30",
  google: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "nvidia-nim": "bg-green-600/20 text-green-400 border-green-600/30",
  ollama: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  "lm-studio": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  custom: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const CAPABILITY_LABELS: Record<string, string> = {
  chat: "Chat",
  composer: "Composer",
  agent: "Agent",
  "tab-autocomplete": "Tab Autocomplete",
  "cmd-k-edit": "Cmd+K Edit",
  "codebase-search": "Codebase Search",
  "deep-research": "Deep Research",
  "visual-editing": "Visual Editing",
  embeddings: "Embeddings",
  planning: "Planning",
  review: "Review",
  vision: "Vision",
  classification: "Classification",
  extraction: "Extraction",
  reasoning: "Reasoning",
};

const TASK_CATEGORIES: { value: TaskCategory; label: string; icon: React.ReactNode }[] = [
  { value: "chat", label: "Chat", icon: <Brain className="w-4 h-4" /> },
  { value: "coding", label: "Coding", icon: <Zap className="w-4 h-4" /> },
  { value: "research", label: "Research", icon: <Shield className="w-4 h-4" /> },
  { value: "planning", label: "Planning", icon: <DollarSign className="w-4 h-4" /> },
  { value: "review", label: "Review", icon: <Clock className="w-4 h-4" /> },
  { value: "vision", label: "Vision", icon: <Eye className="w-4 h-4" /> },
  { value: "embedding", label: "Embedding", icon: <Zap className="w-4 h-4" /> },
  { value: "classification", label: "Classification", icon: <Shield className="w-4 h-4" /> },
  { value: "extraction", label: "Extraction", icon: <Brain className="w-4 h-4" /> },
  { value: "reasoning", label: "Reasoning", icon: <Clock className="w-4 h-4" /> },
];

const BUILD_MODES: { value: BuildMode; label: string; description: string }[] = [
  { value: "speed", label: "Speed", description: "Fastest, minimal verification" },
  { value: "balanced", label: "Balanced", description: "Good balance of speed/quality" },
  { value: "quality", label: "Quality", description: "High quality, thorough verification" },
  { value: "max", label: "Maximum", description: "Best quality, adversarial verify" },
  { value: "custom", label: "Custom", description: "User-defined profile" },
];

export const ModelPicker: React.FC<ModelPickerProps> = ({
  initialTaskCategory = "chat",
  initialBuildMode = "balanced",
  onModelSelect,
  showProviderFilter = true,
  showCapabilityFilter = true,
  compact = false,
  projectId,
  userId,
}) => {
  const { t } = useI18n();
  const {
    getAllModels,
    getRecommendedModels,
    selectModel,
    getModelBenchmarks,
    getBuildModeConfig,
    estimateRequestCost,
    isLoading,
    error,
  } = useModelRouter({ projectId, userId });

  const [models, setModels] = useState<ModelConfig[]>([]);
  const [filteredModels, setFilteredModels] = useState<ModelConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ModelProvider | "all">("all");
  const [selectedCapability, setSelectedCapability] = useState<string>("all");
  const [selectedTaskCategory, setSelectedTaskCategory] = useState<TaskCategory>(initialTaskCategory);
  const [selectedBuildMode, setSelectedBuildMode] = useState<BuildMode>(initialBuildMode);
  const [sortField, setSortField] = useState<keyof ModelConfig | "cost" | "benchmark">("qualityScore");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ modelId: string; success: boolean; latency?: number; error?: string } | null>(null);
  const [benchmarks, setBenchmarks] = useState<Record<string, ModelBenchmark>>({});

  // Load models on mount and when filters change
  useEffect(() => {
    let mounted = true;
    getAllModels({ enabled: true }).then(data => {
      if (mounted) setModels(data);
    });
    return () => { mounted = false; };
  }, [getAllModels]);

  // Load benchmarks
  useEffect(() => {
    const benchmarksData = getModelBenchmarks();
    if (Object.keys(benchmarksData).length > 0) {
      setBenchmarks(benchmarksData);
    }
  }, [getModelBenchmarks]);

  // Filter and sort models
  useEffect(() => {
    let result = [...models];

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.modelId.toLowerCase().includes(q)
      );
    }

    // Provider filter
    if (selectedProvider !== "all") {
      result = result.filter(m => m.provider === selectedProvider);
    }

    // Capability filter
    if (selectedCapability !== "all") {
      result = result.filter(m => m.capabilities.includes(selectedCapability as any));
    }

    // Sort
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === "cost") {
        aVal = (a.costPer1kInputTokens || 0) + (a.costPer1kOutputTokens || 0);
        bVal = (b.costPer1kInputTokens || 0) + (b.costPer1kOutputTokens || 0);
      } else if (sortField === "benchmark") {
        const benchA = benchmarks[a.id];
        const benchB = benchmarks[b.id];
        aVal = benchA ? (benchA.coding + benchA.reasoning + benchA.chat) / 3 : 0;
        bVal = benchB ? (benchB.coding + benchB.reasoning + benchB.chat) / 3 : 0;
      } else {
        aVal = a[sortField];
        bVal = b[sortField];
      }
      if (aVal === bVal) return 0;
      const dir = sortDirection === "asc" ? 1 : -1;
      return (aVal > bVal ? 1 : -1) * dir;
    });

    setFilteredModels(result);
  }, [models, searchQuery, selectedProvider, selectedCapability, sortField, sortDirection, benchmarks]);

  const handleSort = useCallback((field: keyof ModelConfig | "cost" | "benchmark") => {
    if (sortField === field) {
      setSortDirection(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }, [sortField]);

  const handleTestModel = useCallback(async (model: ModelConfig) => {
    setTestingModel(model.id);
    try {
      const start = Date.now();
      const result = await selectModel(selectedTaskCategory, selectedBuildMode);
      const latency = Date.now() - start;

      if (result?.model.id === model.id) {
        setTestResult({ modelId: model.id, success: true, latency });
      } else {
        setTestResult({ modelId: model.id, success: false, error: "Different model selected" });
      }
    } catch (err) {
      setTestResult({ modelId: model.id, success: false, error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTestingModel(null);
    }
  }, [selectModel, selectedTaskCategory, selectedBuildMode]);

  const handleRowClick = useCallback((model: ModelConfig) => {
    selectModel(selectedTaskCategory, selectedBuildMode).then(result => {
      if (result) {
        onModelSelect?.(model, result);
      }
    });
  }, [selectModel, selectedTaskCategory, selectedBuildMode, onModelSelect]);

  const getCapabilitiesBadges = (model: ModelConfig) => {
    const displayCaps = model.capabilities.slice(0, 3);
    const remaining = model.capabilities.length - 3;
    return (
      <div className="flex flex-wrap gap-1">
        {displayCaps.map(cap => (
          <Badge key={cap} variant="outline" className="text-xs px-2 py-0.5">
            {CAPABILITY_LABELS[cap] || cap}
          </Badge>
        ))}
        {remaining > 0 && (
          <Badge variant="secondary" className="text-xs px-2 py-0.5">
            +{remaining}
          </Badge>
        )}
      </div>
    );
  };

  const getBenchmarkScore = (modelId: string, category: keyof ModelBenchmark) => {
    const bench = benchmarks[modelId];
    return bench?.[category] || 0;
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return t("modelPicker.free") || "Free";
    return `$${cost.toFixed(4)}/1k`;
  };

  const renderSortableHeader = (label: string, field: keyof ModelConfig | "cost" | "benchmark", icon?: React.ReactNode) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-bg-elevated/50"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortField === field && (
          sortDirection === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
        )}
        {icon}
      </div>
    </TableHead>
  );

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Select value={selectedTaskCategory} onChange={e => setSelectedTaskCategory(e.target.value as TaskCategory)} className="w-40">
            {TASK_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Select value={selectedBuildMode} onChange={e => setSelectedBuildMode(e.target.value as BuildMode)} className="w-40">
            {BUILD_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <Input placeholder={t("modelPicker.searchPlaceholder") || "Search models..."} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-48" />
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                {renderSortableHeader(t("modelPicker.name") || "Name", "name")}
                <TableHead>{t("modelPicker.provider") || "Provider"}</TableHead>
                <TableHead>{t("modelPicker.capabilities") || "Capabilities"}</TableHead>
                <TableHead className="text-right">{t("modelPicker.cost") || "Cost"}</TableHead>
                <TableHead className="text-right">{t("modelPicker.quality") || "Quality"}</TableHead>
                <TableHead className="text-right">{t("modelPicker.latency") || "Latency"}</TableHead>
                <TableHead>{t("modelPicker.actions") || "Actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.map(model => (
                <TableRow key={model.id} className="hover:bg-bg-elevated/50 cursor-pointer" onClick={() => handleRowClick(model)}>
                  <TableCell className="font-medium">{model.name}</TableCell>
                  <TableCell>
                    <Badge className={PROVIDER_COLORS[model.provider] || "bg-gray-500/20 text-gray-400"}>{model.provider}</Badge>
                  </TableCell>
                  <TableCell>{getCapabilitiesBadges(model)}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatCost((model.costPer1kInputTokens || 0) + (model.costPer1kOutputTokens || 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Progress value={((model.qualityScore || 5) / 10) * 100} className="w-20 h-1.5" />
                      <span className="text-xs text-muted-foreground">{model.qualityScore}/10</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {model.latencyMs}ms
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      onClick={e => { e.stopPropagation(); handleTestModel(model); }}
                      disabled={testingModel === model.id}
                      aria-label="Test model"
                    >
                      {testingModel === model.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("modelPicker.title") || "Model Picker"}</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedTaskCategory} onChange={e => setSelectedTaskCategory(e.target.value as TaskCategory)} className="w-40">
              {TASK_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            <Select value={selectedBuildMode} onChange={e => setSelectedBuildMode(e.target.value as BuildMode)} className="w-40">
              {BUILD_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t("modelPicker.searchPlaceholder") || "Search models..."}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {showProviderFilter && (
            <Select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value as ModelProvider | "all")} className="w-36">
              <option value="all">{t("modelPicker.allProviders") || "All Providers"}</option>
              {Object.values(ModelProvider).map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          )}

          {showCapabilityFilter && (
            <Select value={selectedCapability} onChange={e => setSelectedCapability(e.target.value)} className="w-40">
              <option value="all">{t("modelPicker.allCapabilities") || "All Capabilities"}</option>
              {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          )}
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{filteredModels.length} {t("modelPicker.modelsFound") || "models found"}</span>
          <div className="flex gap-1">
            {["name", "qualityScore", "latencyMs", "cost", "benchmark"] as const).map(field => (
              <IconButton
                key={field}
                size="sm"
                variant={sortField === field ? "secondary" : "ghost"}
                onClick={() => handleSort(field)}
                aria-label={`Sort by ${field}`}
              >
                {sortField === field ? (sortDirection === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />) : null}
              </IconButton>
            ))}
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Model Table */}
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={filteredModels.length > 0 && filteredModels.every(m => selectedModels.has(m.id))}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedModels(new Set(filteredModels.map(m => m.id)));
                      } else {
                        setSelectedModels(new Set());
                      }
                    }}
                    aria-label="Select all"
                  />
                </TableHead>
                {renderSortableHeader(t("modelPicker.name") || "Name", "name")}
                <TableHead>{t("modelPicker.provider") || "Provider"}</TableHead>
                <TableHead>{t("modelPicker.capabilities") || "Capabilities"}</TableHead>
                {renderSortableHeader(t("modelPicker.contextWindow") || "Context", "contextWindow")}
                {renderSortableHeader(t("modelPicker.cost") || "Cost", "cost", <DollarSign className="w-4 h-4" />)}
                {renderSortableHeader(t("modelPicker.quality") || "Quality", "qualityScore", <Brain className="w-4 h-4" />)}
                {renderSortableHeader(t("modelPicker.speed") || "Speed", "latencyMs", <Zap className="w-4 h-4" />)}
                {benchmarks && Object.keys(benchmarks).length > 0 && (
                  <>
                    {renderSortableHeader("Coding", "benchmark")}
                    {renderSortableHeader("Reasoning", "benchmark")}
                  </>
                )}
                <TableHead className="text-right">{t("modelPicker.actions") || "Actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    <p className="mt-2 text-muted-foreground">{t("modelPicker.loading") || "Loading models..."}</p>
                  </TableCell>
                </TableRow>
              ) : filteredModels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                    {t("modelPicker.noModels") || "No models match your filters"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredModels.map(model => {
                  const bench = benchmarks[model.id];
                  const cost = (model.costPer1kInputTokens || 0) + (model.costPer1kOutputTokens || 0);
                  const estCost = estimateRequestCost(model, 2000, 1000);

                  return (
                    <TableRow
                      key={model.id}
                      className={selectedModels.has(model.id) ? "bg-accent/5" : "hover:bg-bg-elevated/50"}
                      onClick={() => handleRowClick(model)}
                    >
                      <TableCell className="w-8">
                        <Checkbox
                          checked={selectedModels.has(model.id)}
                          onChange={e => {
                            e.stopPropagation();
                            const next = new Set(selectedModels);
                            if (e.target.checked) next.add(model.id);
                            else next.delete(model.id);
                            setSelectedModels(next);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium flex items-center gap-2">
                        {model.supportsVision && <Eye className="w-4 h-4 text-muted-foreground" title="Vision" />}
                        {model.supportsTools && <Zap className="w-4 h-4 text-muted-foreground" title="Tools" />}
                        <span>{model.name}</span>
                        <span className="text-xs text-muted-foreground">({model.modelId})</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={PROVIDER_COLORS[model.provider] || "bg-gray-500/20 text-gray-400"}>
                          {model.provider}
                        </Badge>
                      </TableCell>
                      <TableCell>{getCapabilitiesBadges(model)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {model.contextWindow.toLocaleString()} tokens
                      </TableCell>
                      <TableCell className="text-right">
                        {cost === 0 ? (
                          <Badge variant="outline" className="text-green-400 border-green-400/30">
                            {t("modelPicker.free") || "Free"}
                          </Badge>
                        ) : (
                          <span className="text-sm">{formatCost(cost)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Progress value={((model.qualityScore || 5) / 10) * 100} className="w-24 h-1.5" />
                          <span className="text-xs text-muted-foreground">{model.qualityScore}/10</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Zap className="w-3 h-3 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">{model.latencyMs}ms</span>
                        </div>
                      </TableCell>
                      {bench && (
                        <>
                          <TableCell className="text-right">
                            <Progress value={bench.coding} className="w-20 h-1.5" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Progress value={bench.reasoning} className="w-20 h-1.5" />
                          </TableCell>
                        </>
                      )}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            size="sm"
                            variant="ghost"
                            onClick={e => { e.stopPropagation(); handleTestModel(model); }}
                            disabled={testingModel === model.id || !model.enabled}
                            aria-label={t("modelPicker.testModel") || "Test model"}
                          >
                            {testingModel === model.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : testResult?.modelId === model.id ? (
                              testResult.success ? (
                                <CheckCircle className="w-4 h-4 text-green-400" />
                              ) : (
                                <AlertCircle className="w-4 h-4 text-red-400" />
                              )
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </IconButton>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <IconButton
                                size="sm"
                                variant="ghost"
                                onClick={e => { e.stopPropagation(); handleRowClick(model); }}
                                aria-label={t("modelPicker.selectModel") || "Select model"}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </IconButton>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {t("modelPicker.selectTooltip") || "Select this model"}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Test Result Modal */}
        {testResult && (
          <Dialog open={true} onOpenChange={open => { if (!open) setTestResult(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("modelPicker.testResult") || "Test Result"}</DialogTitle>
                <DialogDescription>
                  {testResult.success
                    ? `${t("modelPicker.testSuccess") || "Model test successful"} (${testResult.latency}ms)`
                    : `${t("modelPicker.testFailed") || "Model test failed"}: ${testResult.error}`}
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        )}

        {/* Selection Summary */}
        {selectedModels.size > 0 && (
          <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-between">
            <span className="text-sm">
              {selectedModels.size} {t("modelPicker.selected") || "models selected"}
            </span>
            <Button size="sm" variant="outline" onClick={() => setSelectedModels(new Set())}>
              {t("common.clear") || "Clear"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ModelPicker;