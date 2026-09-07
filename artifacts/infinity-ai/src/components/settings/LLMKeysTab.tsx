/**
 * LLMKeysTab — Enhanced LLM API Key Management with Model Pickers, Task Categories, Build Modes
 * Part of Phase 39: Enhanced LLM API Key System
 */
import React, { useState, useCallback, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
  Input,
  Select,
  Badge,
  Progress,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
  Switch,
  Separator,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  IconButton,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Textarea,
} from "@/components/ui";
import {
  Plus,
  Edit,
  Trash2,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Key,
  Shield,
  Zap,
  Brain,
  Crown,
  SlidersHorizontal,
  DollarSign,
  BarChart3,
  Settings,
  ExternalLink,
  Copy,
  Clipboard,
  Bell,
  BellOff,
} from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { ModelPicker } from "@/components/cursor/ModelPicker";
import { BuildModeSelector } from "@/components/cursor/BuildModeSelector";
import { CostEstimate } from "@/components/cursor/CostEstimate";
import { useModelRouter, type ModelConfig, type BuildMode, type TaskCategory, type LLMKeyMetadata } from "@/hooks/useModelRouter";

interface LLMKeyWithMetadata extends LLMKeyMetadata {
  id: string;
  name: string;
  provider: string;
  keyPreview: string;
  isValid: boolean;
  lastValidated: number;
  monthlySpend: number;
  monthlyBudget: number;
  spendThisMonth: number;
  budgetAlerts: { threshold: number; triggered: boolean }[];
  enabled: boolean;
  priority: number;
  modelAccess: string[];
  rateLimitRpm: number;
  rateLimitTpm: number;
  labels: string[];
  failoverKeyId?: string;
}

interface LLMKeysTabProps {
  projectId?: string;
}

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  openrouter: <Shield className="w-4 h-4" />,
  anthropic: <Brain className="w-4 h-4" />,
  openai: <Zap className="w-4 h-4" />,
  google: <Crown className="w-4 h-4" />,
  "nvidia-nim": <Settings className="w-4 h-4" />,
  ollama: <SlidersHorizontal className="w-4 h-4" />,
  "lm-studio": <SlidersHorizontal className="w-4 h-4" />,
  custom: <Key className="w-4 h-4" />,
};

const STATUS_BADGES = {
  healthy: { label: "Healthy", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  cooling: { label: "Cooling", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  quarantined: { label: "Quarantined", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  unknown: { label: "Unknown", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
};

export const LLMKeysTab: React.FC<LLMKeysTabProps> = ({ projectId }) => {
  const { t } = useI18n();
  const {
    getAllModels,
    selectModel,
    getBuildModeConfig,
    getAllBuildModes,
    estimateRequestCost,
    getModelBenchmarks,
  } = useModelRouter({ projectId });

  // State
  const [keys, setKeys] = useState<LLMKeyWithMetadata[]>([]);
  const [activeTab, setActiveTab] = useState<"keys" | "models" | "build-modes" | "costs" | "settings">("keys");
  const [isLoading, setIsLoading] = useState(false);
  const [showAddKeyDialog, setShowAddKeyDialog] = useState(false);
  const [editingKey, setEditingKey] = useState<LLMKeyWithMetadata | null>(null);
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [validatingKeyId, setValidatingKeyId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelConfig | null>(null);
  const [selectedBuildMode, setSelectedBuildMode] = useState<BuildMode>("balanced");
  const [selectedTaskCategory, setSelectedTaskCategory] = useState<TaskCategory>("coding");
  const [newKeyForm, setNewKeyForm] = useState({
    name: "",
    provider: "openrouter",
    apiKey: "",
    labels: "",
    modelAccess: "",
    monthlyBudget: 50,
    rateLimitRpm: 60,
    rateLimitTpm: 100000,
    priority: 1,
    enabled: true,
  });

  // Load keys from API
  const loadKeys = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/infinity/llm-keys${projectId ? `?projectId=${projectId}` : ""}`);
      if (response.ok) {
        const data = await response.json();
        setKeys(data.keys || []);
      }
    } catch (error) {
      console.error("Failed to load keys:", error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  // Form handlers
  const handleAddKey = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/infinity/llm-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newKeyForm,
          labels: newKeyForm.labels.split(",").map(s => s.trim()).filter(Boolean),
          modelAccess: newKeyForm.modelAccess.split(",").map(s => s.trim()).filter(Boolean),
          projectId,
        }),
      });
      if (response.ok) {
        setShowAddKeyDialog(false);
        setNewKeyForm({
          name: "",
          provider: "openrouter",
          apiKey: "",
          labels: "",
          modelAccess: "",
          monthlyBudget: 50,
          rateLimitRpm: 60,
          rateLimitTpm: 100000,
          priority: 1,
          enabled: true,
        });
        loadKeys();
      }
    } catch (error) {
      console.error("Failed to add key:", error);
    } finally {
      setIsLoading(false);
    }
  }, [newKeyForm, projectId, loadKeys]);

  const handleUpdateKey = useCallback(async () => {
    if (!editingKey) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/infinity/llm-keys/${editingKey.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editingKey,
          labels: editingKey.labels,
          modelAccess: editingKey.modelAccess,
        }),
      });
      if (response.ok) {
        setEditingKey(null);
        loadKeys();
      }
    } catch (error) {
      console.error("Failed to update key:", error);
    } finally {
      setIsLoading(false);
    }
  }, [editingKey, loadKeys]);

  const handleDeleteKey = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/infinity/llm-keys/${id}`, { method: "DELETE" });
      if (response.ok) {
        setDeletingKeyId(null);
        loadKeys();
      }
    } catch (error) {
      console.error("Failed to delete key:", error);
    } finally {
      setIsLoading(false);
    }
  }, [loadKeys]);

  const handleTestKey = useCallback(async (id: string) => {
    setTestingKeyId(id);
    try {
      const response = await fetch(`/api/infinity/llm-keys/${id}/test`, { method: "POST" });
      const data = await response.json();
      // Update key status
      setKeys(prev => prev.map(k =>
        k.id === id ? { ...k, isValid: data.valid, lastValidated: Date.now() } : k
      ));
    } catch (error) {
      console.error("Failed to test key:", error);
    } finally {
      setTestingKeyId(null);
    }
  }, []);

  const handleValidateKey = useCallback(async (id: string) => {
    setValidatingKeyId(id);
    try {
      const response = await fetch(`/api/infinity/llm-keys/${id}/validate`, { method: "POST" });
      const data = await response.json();
      setKeys(prev => prev.map(k =>
        k.id === id ? { ...k, isValid: data.valid, lastValidated: Date.now() } : k
      ));
    } catch (error) {
      console.error("Failed to validate key:", error);
    } finally {
      setValidatingKeyId(null);
    }
  }, []);

  const handleRotateKey = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/infinity/llm-keys/${id}/rotate`, { method: "POST" });
      if (response.ok) {
        loadKeys();
      }
    } catch (error) {
      console.error("Failed to rotate key:", error);
    } finally {
      setIsLoading(false);
    }
  }, [loadKeys]);

  const handleModelSelect = useCallback((model: ModelConfig) => {
    setSelectedModel(model);
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  };

  const getBudgetUtilization = (key: LLMKeyWithMetadata) => {
    if (key.monthlyBudget <= 0) return 0;
    return (key.spendThisMonth / key.monthlyBudget) * 100;
  };

  const getBudgetAlertLevel = (key: LLMKeyWithMetadata) => {
    const util = getBudgetUtilization(key);
    if (util >= 95) return "critical";
    if (util >= 80) return "danger";
    if (util >= 50) return "warning";
    return "none";
  };

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="keys">
            <Key className="w-4 h-4 mr-2" />
            {t("llmKeys.keys") || "API Keys"}
          </TabsTrigger>
          <TabsTrigger value="models">
            <Brain className="w-4 h-4 mr-2" />
            {t("llmKeys.models") || "Model Picker"}
          </TabsTrigger>
          <TabsTrigger value="build-modes">
            <SlidersHorizontal className="w-4 h-4 mr-2" />
            {t("llmKeys.buildModes") || "Build Modes"}
          </TabsTrigger>
          <TabsTrigger value="costs">
            <DollarSign className="w-4 h-4 mr-2" />
            {t("llmKeys.costs") || "Cost Tracking"}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="w-4 h-4 mr-2" />
            {t("llmKeys.settings") || "Settings"}
          </TabsTrigger>
        </TabsList>

        {/* Keys Tab */}
        <TabsContent value="keys" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{t("llmKeys.keys") || "LLM API Keys"}</h3>
              <p className="text-sm text-muted-foreground">
                {t("llmKeys.keysDescription") || "Manage your LLM API keys with metadata, budgets, and automatic failover"}
              </p>
            </div>
            <Button onClick={() => setShowAddKeyDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t("llmKeys.addKey") || "Add Key"}
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Key className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                <h4 className="font-medium mb-2">{t("llmKeys.noKeys") || "No API keys configured"}</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("llmKeys.noKeysDesc") || "Add your first API key to start using LLM models"}
                </p>
                <Button onClick={() => setShowAddKeyDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  {t("llmKeys.addFirstKey") || "Add First Key"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {keys.map(key => (
                <Card key={key.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="p-2 rounded-lg bg-bg-elevated/50">
                          {PROVIDER_ICONS[key.provider] || <Key className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{key.name}</span>
                            <Badge variant="outline" className={STATUS_BADGES[key.isValid ? "healthy" : "unknown"].className}>
                              {STATUS_BADGES[key.isValid ? "healthy" : "unknown"].label}
                            </Badge>
                            {key.enabled && <Badge variant="secondary" className="text-xs">Enabled</Badge>}
                            {!key.enabled && <Badge variant="outline" className="text-xs">Disabled</Badge>}
                            {key.failoverKeyId && (
                              <Badge variant="outline" className="text-xs">
                                <RotateCcw className="w-3 h-3 mr-1" />
                                Failover
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                            <span className="font-mono text-xs">{key.keyPreview}</span>
                            <span>•</span>
                            <span>Priority: {key.priority}</span>
                            <span>•</span>
                            <span>{key.modelAccess.length} models</span>
                            <span>•</span>
                            <span>{key.rateLimitRpm} req/min</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Budget Progress */}
                        {key.monthlyBudget > 0 && (
                          <div className="w-48 flex items-center gap-2">
                            <Progress
                              value={getBudgetUtilization(key)}
                              className="h-2 flex-1"
                              indicatorClassName={
                                getBudgetAlertLevel(key) === "critical" ? "bg-red-400" :
                                getBudgetAlertLevel(key) === "danger" ? "bg-orange-400" :
                                getBudgetAlertLevel(key) === "warning" ? "bg-yellow-400" :
                                "bg-green-400"
                              }
                            />
                            <span className="text-xs text-muted-foreground w-16 text-right">
                              {formatCurrency(key.spendThisMonth)} / {formatCurrency(key.monthlyBudget)}
                            </span>
                          </div>
                        )}

                        {/* Actions */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconButton
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingKey(key)}
                              disabled={isLoading}
                              aria-label={t("llmKeys.edit") || "Edit"}
                            >
                              <Edit className="w-4 h-4" />
                            </IconButton>
                          </TooltipTrigger>
                          <TooltipContent side="top">{t("llmKeys.edit") || "Edit"}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconButton
                              size="sm"
                              variant="ghost"
                              onClick={() => handleTestKey(key.id)}
                              disabled={isLoading || testingKeyId === key.id}
                              aria-label={t("llmKeys.test") || "Test"}
                            >
                              {testingKeyId === key.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            </IconButton>
                          </TooltipTrigger>
                          <TooltipContent side="top">{t("llmKeys.test") || "Test"}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconButton
                              size="sm"
                              variant="ghost"
                              onClick={() => handleValidateKey(key.id)}
                              disabled={isLoading || validatingKeyId === key.id}
                              aria-label={t("llmKeys.validate") || "Validate"}
                            >
                              {validatingKeyId === key.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                            </IconButton>
                          </TooltipTrigger>
                          <TooltipContent side="top">{t("llmKeys.validate") || "Validate"}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconButton
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRotateKey(key.id)}
                              disabled={isLoading}
                              aria-label={t("llmKeys.rotate") || "Rotate"}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </IconButton>
                          </TooltipTrigger>
                          <TooltipContent side="top">{t("llmKeys.rotate") || "Rotate"}</TooltipContent>
                        </Tooltip>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <IconButton
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeletingKeyId(key.id)}
                              disabled={isLoading}
                              aria-label={t("llmKeys.delete") || "Delete"}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </IconButton>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("llmKeys.deleteConfirm") || "Delete API Key"}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("llmKeys.deleteConfirmDesc") || "Are you sure? This cannot be undone."}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel") || "Cancel"}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteKey(key.id)}>{t("common.confirm") || "Confirm"}</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {/* Expanded details */}
                    <div className="mt-4 pt-4 border-t border-border-primary/50 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">{t("llmKeys.labels") || "Labels"}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {key.labels.map(label => (
                            <Badge key={label} variant="outline" className="text-xs">{label}</Badge>
                          ))}
                          {key.labels.length === 0 && <span className="text-xs text-muted-foreground">{t("llmKeys.noLabels") || "No labels"}</span>}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("llmKeys.modelAccess") || "Model Access"}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {key.modelAccess.slice(0, 5).map(model => (
                            <Badge key={model} variant="secondary" className="text-xs">{model}</Badge>
                          ))}
                          {key.modelAccess.length > 5 && (
                            <Badge variant="outline" className="text-xs">+{key.modelAccess.length - 5} more</Badge>
                          )}
                          {key.modelAccess.length === 0 && <span className="text-xs text-muted-foreground">{t("llmKeys.allModels") || "All models"}</span>}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("llmKeys.failover") || "Failover"}</p>
                        <p className="text-sm mt-1">
                          {key.failoverKeyId ? (
                            <span className="text-green-400">Configured → {keys.find(k => k.id === key.failoverKeyId)?.name || key.failoverKeyId}</span>
                          ) : (
                            <span className="text-muted-foreground">{t("llmKeys.noFailover") || "Not configured"}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Models Tab */}
        <TabsContent value="models" className="mt-4">
          <ModelPicker
            initialTaskCategory={selectedTaskCategory}
            initialBuildMode={selectedBuildMode}
            onModelSelect={handleModelSelect}
            projectId={projectId}
            compact={false}
          />
        </TabsContent>

        {/* Build Modes Tab */}
        <TabsContent value="build-modes" className="mt-4">
          <BuildModeSelector
            value={selectedBuildMode}
            onChange={(mode, config) => setSelectedBuildMode(mode)}
            projectId={projectId}
            showDetails={true}
            allowCustomEdit={true}
          />
        </TabsContent>

        {/* Costs Tab */}
        <TabsContent value="costs" className="mt-4">
          <CostEstimate
            model={selectedModel}
            buildMode={selectedBuildMode}
            taskCategory={selectedTaskCategory}
            projectId={projectId}
            showBreakdown={true}
            showHistory={true}
            showBudget={true}
            monthlyBudget={50}
          />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("llmKeys.failoverSettings") || "Failover Chain Settings"}</CardTitle>
              <CardDescription>
                {t("llmKeys.failoverDesc") || "Configure automatic failover between API keys when primary fails"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("llmKeys.defaultFailover") || "Default Failover Strategy"}</Label>
                <Select
                  value="sequential"
                  onChange={e => {}}
                  className="w-64"
                >
                  <option value="sequential">{t("llmKeys.sequential") || "Sequential (priority order)"}</option>
                  <option value="round-robin">{t("llmKeys.roundRobin") || "Round Robin"}</option>
                  <option value="least-used">{t("llmKeys.leastUsed") || "Least Recently Used"}</option>
                  <option value="cost-optimized">{t("llmKeys.costOptimized") || "Cost Optimized"}</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Switch defaultChecked />
                  <span>{t("llmKeys.autoFailover") || "Enable Automatic Failover"}</span>
                </Label>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("llmKeys.autoFailoverDesc") || "Automatically switch to backup key on rate limit, error, or quota exceeded"}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Switch defaultChecked />
                  <span>{t("llmKeys.notifyOnFailover") || "Notify on Failover"}</span>
                </Label>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("llmKeys.notifyOnFailoverDesc") || "Send notification when automatic failover occurs"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("llmKeys.budgetSettings") || "Budget & Alert Settings"}</CardTitle>
              <CardDescription>
                {t("llmKeys.budgetDesc") || "Configure default budget limits and alert thresholds"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("llmKeys.defaultMonthlyBudget") || "Default Monthly Budget"}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">$</span>
                    <Input type="number" min="0" step="1" defaultValue={50} className="w-24" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("llmKeys.warningThreshold") || "Warning Threshold"}</Label>
                  <Select defaultValue="50" className="w-64">
                    <option value="25">25%</option>
                    <option value="50">50%</option>
                    <option value="75">75%</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("llmKeys.criticalThreshold") || "Critical Threshold"}</Label>
                  <Select defaultValue="95" className="w-64">
                    <option value="80">80%</option>
                    <option value="90">90%</option>
                    <option value="95">95%</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Switch defaultChecked />
                  <span>{t("llmKeys.enforceBudget") || "Enforce Budget Limits"}</span>
                </Label>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("llmKeys.enforceBudgetDesc") || "Block requests that would exceed budget"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("llmKeys.modelValidation") || "Model Validation Settings"}</CardTitle>
              <CardDescription>
                {t("llmKeys.modelValidationDesc") || "Configure automatic model validation against declared access"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Switch defaultChecked />
                  <span>{t("llmKeys.validateOnAdd") || "Validate Models on Key Addition"}</span>
                </Label>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("llmKeys.validateOnAddDesc") || "Check that declared model access matches provider capabilities"}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Switch />
                  <span>{t("llmKeys.periodicValidation") || "Periodic Re-validation"}</span>
                </Label>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("llmKeys.periodicValidationDesc") || "Re-validate model access weekly"}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Switch defaultChecked />
                  <span>{t("llmKeys.blockInvalidModels") || "Block Invalid Models"}</span>
                </Label>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("llmKeys.blockInvalidModelsDesc") || "Prevent selection of models not in key's declared access list"}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Key Dialog */}
      <Dialog open={showAddKeyDialog} onOpenChange={setShowAddKeyDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("llmKeys.addKey") || "Add API Key"}</DialogTitle>
            <DialogDescription>
              {t("llmKeys.addKeyDesc") || "Configure a new LLM API key with metadata and budget controls"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("llmKeys.keyName") || "Key Name"}</Label>
                <Input
                  value={newKeyForm.name}
                  onChange={e => setNewKeyForm({ ...newKeyForm, name: e.target.value })}
                  placeholder={t("llmKeys.keyNamePlaceholder") || "e.g., Production OpenRouter Key"}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("llmKeys.provider") || "Provider"}</Label>
                <Select
                  value={newKeyForm.provider}
                  onChange={e => setNewKeyForm({ ...newKeyForm, provider: e.target.value })}
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                  <option value="nvidia-nim">NVIDIA NIM</option>
                  <option value="ollama">Ollama (Local)</option>
                  <option value="lm-studio">LM Studio (Local)</option>
                  <option value="custom">Custom</option>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("llmKeys.apiKey") || "API Key"}</Label>
              <div className="relative">
                <Input
                  type="password"
                  value={newKeyForm.apiKey}
                  onChange={e => setNewKeyForm({ ...newKeyForm, apiKey: e.target.value })}
                  placeholder="sk-... or leave blank for local providers"
                  className="pr-10"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-2"
                  onClick={() => {}}
                >
                  <Eye className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("llmKeys.apiKeyHint") || "Key is encrypted at rest. For local providers (Ollama/LM Studio), leave blank."}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("llmKeys.labels") || "Labels"}</Label>
                <Input
                  value={newKeyForm.labels}
                  onChange={e => setNewKeyForm({ ...newKeyForm, labels: e.target.value })}
                  placeholder="production, coding, high-priority"
                />
                <p className="text-xs text-muted-foreground">{t("llmKeys.labelsHint") || "Comma-separated labels for filtering"}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("llmKeys.modelAccess") || "Model Access"}</Label>
                <Input
                  value={newKeyForm.modelAccess}
                  onChange={e => setNewKeyForm({ ...newKeyForm, modelAccess: e.target.value })}
                  placeholder="anthropic/claude-3.5-sonnet, openai/gpt-4o"
                />
                <p className="text-xs text-muted-foreground">{t("llmKeys.modelAccessHint") || "Comma-separated model IDs. Leave empty for all models."}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t("llmKeys.monthlyBudget") || "Monthly Budget (USD)"}</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={newKeyForm.monthlyBudget}
                  onChange={e => setNewKeyForm({ ...newKeyForm, monthlyBudget: parseInt(e.target.value) })}
                  className="w-24"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("llmKeys.rateLimitRpm") || "Rate Limit (req/min)"}</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={newKeyForm.rateLimitRpm}
                  onChange={e => setNewKeyForm({ ...newKeyForm, rateLimitRpm: parseInt(e.target.value) })}
                  className="w-24"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("llmKeys.priority") || "Priority"}</Label>
                <Select
                  value={newKeyForm.priority.toString()}
                  onChange={e => setNewKeyForm({ ...newKeyForm, priority: parseInt(e.target.value) })}
                >
                  <option value="1">1 (Highest)</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5 (Lowest)</option>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Switch
                  checked={newKeyForm.enabled}
                  onCheckedChange={v => setNewKeyForm({ ...newKeyForm, enabled: v })}
                />
                <span>{t("llmKeys.enabled") || "Enabled"}</span>
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddKeyDialog(false)}>
              {t("common.cancel") || "Cancel"}
            </Button>
            <Button onClick={handleAddKey} disabled={isLoading || !newKeyForm.name || !newKeyForm.apiKey}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t("common.confirm") || "Add Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Key Dialog */}
      {editingKey && (
        <Dialog open={true} onOpenChange={open => { if (!open) setEditingKey(null); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("llmKeys.editKey") || "Edit API Key"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("llmKeys.keyName") || "Key Name"}</Label>
                  <Input
                    value={editingKey.name}
                    onChange={e => setEditingKey({ ...editingKey, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("llmKeys.provider") || "Provider"}</Label>
                  <Select
                    value={editingKey.provider}
                    onChange={e => setEditingKey({ ...editingKey, provider: e.target.value })}
                    disabled
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="google">Google</option>
                    <option value="nvidia-nim">NVIDIA NIM</option>
                    <option value="ollama">Ollama (Local)</option>
                    <option value="lm-studio">LM Studio (Local)</option>
                    <option value="custom">Custom</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("llmKeys.labels") || "Labels"}</Label>
                <Input
                  value={editingKey.labels.join(", ")}
                  onChange={e => setEditingKey({ ...editingKey, labels: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("llmKeys.modelAccess") || "Model Access"}</Label>
                <Textarea
                  value={editingKey.modelAccess.join("\n")}
                  onChange={e => setEditingKey({ ...editingKey, modelAccess: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
                  rows={4}
                  placeholder="anthropic/claude-3.5-sonnet\nopenai/gpt-4o"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("llmKeys.monthlyBudget") || "Monthly Budget (USD)"}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={editingKey.monthlyBudget}
                    onChange={e => setEditingKey({ ...editingKey, monthlyBudget: parseInt(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("llmKeys.rateLimitRpm") || "Rate Limit (req/min)"}</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={editingKey.rateLimitRpm}
                    onChange={e => setEditingKey({ ...editingKey, rateLimitRpm: parseInt(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("llmKeys.priority") || "Priority"}</Label>
                  <Select
                    value={editingKey.priority.toString()}
                    onChange={e => setEditingKey({ ...editingKey, priority: parseInt(e.target.value) })}
                  >
                    <option value="1">1 (Highest)</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5 (Lowest)</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Switch
                    checked={editingKey.enabled}
                    onCheckedChange={v => setEditingKey({ ...editingKey, enabled: v })}
                  />
                  <span>{t("llmKeys.enabled") || "Enabled"}</span>
                </Label>
              </div>

              <Separator />

              {/* Failover Configuration */}
              <div className="space-y-2">
                <Label>{t("llmKeys.failoverKey") || "Failover Key"}</Label>
                <Select
                  value={editingKey.failoverKeyId || ""}
                  onChange={e => setEditingKey({ ...editingKey, failoverKeyId: e.target.value || undefined })}
                >
                  <option value="">{t("llmKeys.noFailover") || "No failover"}</option>
                  {keys.filter(k => k.id !== editingKey.id && k.enabled).map(k => (
                    <option key={k.id} value={k.id}>{k.name} ({k.provider})</option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("llmKeys.failoverHint") || "Key to use when this key fails or is rate limited"}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingKey(null)}>
                {t("common.cancel") || "Cancel"}
              </Button>
              <Button onClick={handleUpdateKey} disabled={isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {t("common.save") || "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default LLMKeysTab;