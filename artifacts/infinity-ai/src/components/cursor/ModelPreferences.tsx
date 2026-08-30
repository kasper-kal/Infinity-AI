import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Select,
  Switch,
  Tabs,
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ScrollArea,
  Separator,
  Label,
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Tooltip,
  TooltipTrigger,
  TooltipContent
} from "@/components/ui";
import {
  PlusIcon,
  EditIcon,
  TrashIcon,
  CopyIcon,
  CpuIcon,
  BrainIcon,
  GlobeIcon,
  FolderIcon,
  StarIcon,
  SearchIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  Loader2Icon,
  CheckIcon,
  XIcon,
  ZapIcon,
  ShieldIcon,
  DollarSignIcon
} from "lucide-react";
import { api } from "@/lib/api";

interface ModelPreference {
  id: string;
  capability: string;
  modelId: string;
  provider: string;
  displayName: string;
  scope: "user" | "project";
  priority: number;
  enabled: boolean;
  fallbackChain: string[];
  tags: string[];
  isCustom: boolean;
  isDefault: boolean;
}

interface AvailableModel {
  id: string;
  provider: string;
  displayName: string;
  capabilities: string[];
  contextWindow: number;
  maxOutput: number;
  pricing: { input: number; output: number } | null;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  isLocal: boolean;
  isFree: boolean;
  tags: string[];
}

interface ModelPreferencesProps {
  projectRoot: string;
  onPreferencesChange?: () => void;
}

const CAPABILITIES = [
  { id: "chat", label: "Chat", icon: BrainIcon, description: "General conversation and Q&A" },
  { id: "code", label: "Code Generation", icon: CpuIcon, description: "Writing, editing, refactoring code" },
  { id: "reasoning", label: "Complex Reasoning", icon: ZapIcon, description: "Multi-step logic, planning, analysis" },
  { id: "vision", label: "Vision/Multimodal", icon: GlobeIcon, description: "Image understanding, screenshots" },
  { id: "embedding", label: "Embeddings", icon: ShieldIcon, description: "Semantic search, similarity" },
  { id: "fast", label: "Fast/Quick Tasks", icon: ZapIcon, description: "Low-latency, simple tasks" },
  { id: "long-context", label: "Long Context", icon: BrainIcon, description: "Large files, full codebases" },
];

const CAPABILITY_COLORS: Record<string, string> = {
  chat: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  code: "bg-green-500/10 text-green-700 border-green-500/20",
  reasoning: "bg-purple-500/10 text-purple-700 border-purple-500/20",
  vision: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  embedding: "bg-pink-500/10 text-pink-700 border-pink-500/20",
  fast: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  "long-context": "bg-cyan-500/10 text-cyan-700 border-cyan-500/20",
};

export function ModelPreferences({ projectRoot, onPreferencesChange }: ModelPreferencesProps) {
  const { t } = useTranslation();
  const [userPreferences, setUserPreferences] = useState<ModelPreference[]>([]);
  const [projectPreferences, setProjectPreferences] = useState<ModelPreference[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"user" | "project" | "models">("project");
  const [editingPref, setEditingPref] = useState<ModelPreference | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [formData, setFormData] = useState({
    capability: "chat",
    modelId: "",
    priority: 0,
    enabled: true,
    fallbackChain: "" as string,
    tags: "" as string
  });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/customization/model-preferences", { params: { projectRoot } });
      setUserPreferences(response.data.userPreferences || []);
      setProjectPreferences(response.data.projectPreferences || []);
      setAvailableModels(response.data.availableModels || []);
    } catch (error) {
      console.error("Failed to load model preferences:", error);
      setToast({ message: t("settings.models.loadError"), type: "error" });
    } finally {
      setLoading(false);
    }
  }, [projectRoot, t]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingPref) {
        await api.patch(`/customization/model-preferences/${editingPref.id}`, {
          projectRoot,
          scope: editingPref.scope,
          capability: formData.capability,
          modelId: formData.modelId,
          priority: formData.priority,
          enabled: formData.enabled,
          fallbackChain: formData.fallbackChain.split(",").map(m => m.trim()).filter(m => m),
          tags: formData.tags.split(",").map(t => t.trim()).filter(t => t)
        });
        setToast({ message: t("settings.models.updated"), type: "success" });
      } else {
        await api.post("/customization/model-preferences", {
          projectRoot,
          capability: formData.capability,
          modelId: formData.modelId,
          priority: formData.priority,
          enabled: formData.enabled,
          fallbackChain: formData.fallbackChain.split(",").map(m => m.trim()).filter(m => m),
          tags: formData.tags.split(",").map(t => t.trim()).filter(t => t)
        });
        setToast({ message: t("settings.models.created"), type: "success" });
      }
      setEditingPref(null);
      setShowCreateDialog(false);
      resetForm();
      fetchPreferences();
      onPreferencesChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.models.saveError"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pref: ModelPreference) => {
    if (!confirm(t("settings.models.confirmDelete", { model: pref.displayName }))) return;
    try {
      await api.delete(`/customization/model-preferences/${pref.id}`, {
        params: { projectRoot, scope: pref.scope }
      });
      setToast({ message: t("settings.models.deleted"), type: "success" });
      fetchPreferences();
      onPreferencesChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.models.deleteError"), type: "error" });
    }
  };

  const handleTestModel = async (modelId: string) => {
    setTestingModel(modelId);
    try {
      await api.post("/customization/model-preferences/test", { projectRoot, modelId });
      setToast({ message: t("settings.models.testSuccess"), type: "success" });
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.models.testError"), type: "error" });
    } finally {
      setTestingModel(null);
    }
  };

  const handleSetDefault = async (pref: ModelPreference) => {
    try {
      await api.post(`/customization/model-preferences/${pref.id}/set-default`, {
        projectRoot,
        scope: pref.scope
      });
      setToast({ message: t("settings.models.setDefault"), type: "success" });
      fetchPreferences();
      onPreferencesChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.models.defaultError"), type: "error" });
    }
  };

  const resetForm = () => {
    setFormData({
      capability: "chat",
      modelId: "",
      priority: 0,
      enabled: true,
      fallbackChain: "",
      tags: ""
    });
  };

  const handleNewPreference = () => {
    resetForm();
    setEditingPref(null);
    setShowCreateDialog(true);
  };

  const handleEdit = (pref: ModelPreference) => {
    setEditingPref(pref);
    setFormData({
      capability: pref.capability,
      modelId: pref.modelId,
      priority: pref.priority,
      enabled: pref.enabled,
      fallbackChain: pref.fallbackChain.join(", "),
      tags: pref.tags.join(", ")
    });
    setShowCreateDialog(true);
  };

  const getPreferencesForTab = () => {
    return activeTab === "user" ? userPreferences : projectPreferences;
  };

  const getModelsForCapability = (capability: string) => {
    return availableModels.filter(m => m.capabilities.includes(capability));
  };

  const getCapabilityInfo = (id: string) => {
    return CAPABILITIES.find(c => c.id === id) || { id, label: id, icon: BrainIcon, description: "" };
  };

  const formatPricing = (pricing: { input: number; output: number } | null) => {
    if (!pricing) return t("settings.models.free");
    return `$${pricing.input.toFixed(4)}/1K in, $${pricing.output.toFixed(4)}/1K out`;
  };

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="h-full flex items-center justify-center">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <ToastProvider>
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t("settings.models.title")}</CardTitle>
            <CardDescription>{t("settings.models.description")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleNewPreference}>
              <PlusIcon className="h-4 w-4 mr-1" />
              {t("settings.models.newPreference")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("models")}>
              <CpuIcon className="h-4 w-4 mr-1" />
              {t("settings.models.browseModels")}
            </Button>
          </div>
        </CardHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab as any} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-3 border-b">
            <TabsTrigger value="user">
              <GlobeIcon className="h-4 w-4 mr-1" />
              {t("settings.models.tabs.user")} <Badge variant="outline">{userPreferences.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="project">
              <FolderIcon className="h-4 w-4 mr-1" />
              {t("settings.models.tabs.project")} <Badge variant="outline">{projectPreferences.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="models">
              <CpuIcon className="h-4 w-4 mr-1" />
              {t("settings.models.tabs.available")} <Badge variant="outline">{availableModels.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1">
            <TabsContent value="user" className="p-4">
              <PreferencesTable
                preferences={getPreferencesForTab()}
                availableModels={availableModels}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onTest={handleTestModel}
                onSetDefault={handleSetDefault}
                testingModel={testingModel}
                t={t}
              />
            </TabsContent>

            <TabsContent value="project" className="p-4">
              <PreferencesTable
                preferences={getPreferencesForTab()}
                availableModels={availableModels}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onTest={handleTestModel}
                onSetDefault={handleSetDefault}
                testingModel={testingModel}
                t={t}
              />
            </TabsContent>

            <TabsContent value="models" className="p-4">
              <ModelsBrowser
                models={availableModels}
                userPreferences={userPreferences}
                projectPreferences={projectPreferences}
                onTest={handleTestModel}
                testingModel={testingModel}
                t={t}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        {/* Summary */}
        <CardFooter className="border-t pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <h4 className="font-medium mb-1">{t("settings.models.summary.capabilities")}</h4>
              <div className="flex flex-wrap gap-1">
                {CAPABILITIES.map(cap => {
                  const hasUser = userPreferences.some(p => p.capability === cap.id && p.enabled);
                  const hasProject = projectPreferences.some(p => p.capability === cap.id && p.enabled);
                  return (
                    <Badge
                      key={cap.id}
                      variant={hasProject ? "default" : hasUser ? "secondary" : "outline"}
                      className={CAPABILITY_COLORS[cap.id] + " text-xs"}
                    >
                      {cap.label} {hasProject ? "🏠" : hasUser ? "👤" : ""}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-1">{t("settings.models.summary.totalModels")}</h4>
              <p className="text-muted-foreground">
                {new Set([...userPreferences, ...projectPreferences].map(p => p.modelId)).size} unique
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-1">{t("settings.models.summary.providers")}</h4>
              <p className="text-muted-foreground">
                {new Set([...userPreferences, ...projectPreferences].map(p => p.provider)).size} providers
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-1">{t("settings.models.summary.custom")}</h4>
              <p className="text-muted-foreground">
                {[...userPreferences, ...projectPreferences].filter(p => p.isCustom).length} custom
              </p>
            </div>
          </div>
        </CardFooter>

        {/* Create/Edit Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>{editingPref ? t("settings.models.editPreference") : t("settings.models.newPreference")}</DialogTitle>
              <DialogDescription>{t("settings.models.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <Label>{t("settings.models.capability")} *</Label>
                <Select value={formData.capability} onValueChange={v => setFormData({ ...formData, capability: v })}>
                  {CAPABILITIES.map(cap => (
                    <Select.Option key={cap.id} value={cap.id}>
                      {cap.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>{t("settings.models.model")} *</Label>
                <Select value={formData.modelId} onValueChange={v => setFormData({ ...formData, modelId: v })}>
                  {getModelsForCapability(formData.capability).map(model => (
                    <Select.Option key={model.id} value={model.id}>
                      {model.displayName} ({model.provider})
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("settings.models.priority")}</Label>
                  <Input
                    type="number"
                    value={formData.priority}
                    onChange={e => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                    min={-100}
                    max={100}
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t("settings.models.priorityHint")}</p>
                </div>
                <div className="flex items-end">
                  <Label className="flex items-center gap-2 w-full">
                    <input
                      type="checkbox"
                      checked={formData.enabled}
                      onChange={e => setFormData({ ...formData, enabled: e.target.checked })}
                      className="rounded border-input"
                    />
                    <span className="text-sm">{t("settings.models.enabled")}</span>
                  </Label>
                </div>
              </div>
              <div>
                <Label>{t("settings.models.fallbackChain")}</Label>
                <Input
                  value={formData.fallbackChain}
                  onChange={e => setFormData({ ...formData, fallbackChain: e.target.value })}
                  placeholder="model-1, model-2, model-3"
                />
                <p className="text-xs text-muted-foreground mt-1">{t("settings.models.fallbackHint")}</p>
              </div>
              <div>
                <Label>{t("settings.models.tags")}</Label>
                <Input
                  value={formData.tags}
                  onChange={e => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="primary, backup, reasoning"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving || !formData.capability || !formData.modelId}>
                {saving ? <Loader2Icon className="h-4 w-4 animate-spin mr-2" /> : null}
                {editingPref ? t("common.save") : t("common.create")}
              </Button>
            </DialogFooter          </DialogContent>
        </Dialog>

        <ToastViewport className="bottom-4 right-4">
          {toast && (
            <Toast>
              <div className="grid gap-1">
                <ToastTitle className={toast.type === "error" ? "text-destructive" : ""}>
                  {toast.type === "success" ? "✓" : "✕"} {toast.message}
                </ToastTitle>
              </div>
            </Toast>
          )}
        </ToastViewport>
      </Card>
    );
  }
}

function PreferencesTable({
  preferences,
  availableModels,
  onEdit,
  onDelete,
  onTest,
  onSetDefault,
  testingModel,
  t
}: {
  preferences: ModelPreference[];
  availableModels: AvailableModel[];
  onEdit: (pref: ModelPreference) => void;
  onDelete: (pref: ModelPreference) => void;
  onTest: (modelId: string) => void;
  onSetDefault: (pref: ModelPreference) => void;
  testingModel: string | null;
  t: any;
}) {
  if (preferences.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CpuIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>{t("settings.models.empty.preferences")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {preferences.map(pref => {
        const model = availableModels.find(m => m.id === pref.modelId);
        const capability = CAPABILITIES.find(c => c.id === pref.capability);
        const CapIcon = capability?.icon || BrainIcon;
        return (
          <Card key={pref.id}>
            <CardContent className="py-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 w-48 min-w-[180px]">
                  <CapIcon className={`h-5 w-5 ${CAPABILITY_COLORS[pref.capability]?.replace("bg-", "text-").replace("/10", "") || "text-muted-foreground"}`} />
                  <div>
                    <p className="font-medium">{capability?.label || pref.capability}</p>
                    <p className="text-xs text-muted-foreground font-mono">{pref.capability}</p>
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{pref.displayName}</p>
                    <p className="text-sm text-muted-foreground truncate font-mono">{pref.provider} · {pref.modelId}</p>
                  </div>
                  {pref.fallbackChain.length > 0 && (
                    <Tooltip content={t("settings.models.fallbackChain", { chain: pref.fallbackChain.join(" → ") })}>
                      <Badge variant="outline" className="text-xs whitespace-nowrap">
                        <ZapIcon className="h-3 w-3 mr-1" />
                        {pref.fallbackChain.length} fallback{pref.fallbackChain.length > 1 ? "s" : ""}
                      </Badge>
                    </Tooltip>
                  )}
                  <Badge variant={pref.scope === "user" ? "default" : "secondary"} className="text-xs">
                    {pref.scope === "user" ? t("settings.models.scopes.user") : t("settings.models.scopes.project")}
                  </Badge>
                  {pref.isDefault && (
                    <Badge variant="default" className="text-xs">
                      <StarIcon className="h-3 w-3 mr-1 fill-current" />
                      {t("settings.models.default")}
                    </Badge>
                  )}
                  {pref.isCustom && (
                    <Badge variant="outline" className="text-xs">
                      <StarIcon className="h-3 w-3 mr-1" />
                      {t("settings.models.custom")}
                    </Badge>
                  )}
                  {!pref.enabled && (
                    <Badge variant="destructive" className="text-xs">
                      <XIcon className="h-3 w-3 mr-1" />
                      {t("settings.models.disabled")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onTest(pref.modelId)}
                    disabled={testingModel === pref.modelId}
                    className="h-8 w-8"
                  >
                    {testingModel === pref.modelId ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <ZapIcon className="h-4 w-4" />
                    )}
                    <Tooltip content={t("settings.models.test")}><span /></Tooltip>
                  </Button>
                  {!pref.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onSetDefault(pref)}
                      className="h-8 w-8"
                    >
                      <StarIcon className="h-4 w-4" />
                      <Tooltip content={t("settings.models.makeDefault")}><span /></Tooltip>
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ChevronDownIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(pref)}>
                        <EditIcon className="h-4 w-4 mr-2" />
                        {t("common.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onDelete(pref)} className="text-destructive focus:text-destructive">
                        <TrashIcon className="h-4 w-4 mr-2" />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ModelsBrowser({
  models,
  userPreferences,
  projectPreferences,
  onTest,
  testingModel,
  t
}: {
  models: AvailableModel[];
  userPreferences: ModelPreference[];
  projectPreferences: ModelPreference[];
  onTest: (modelId: string) => void;
  testingModel: string | null;
  t: any;
}) {
  const allPrefs = [...userPreferences, ...projectPreferences];

  return (
    <div className="space-y-4">
      {CAPABILITIES.map(cap => {
        const capModels = models.filter(m => m.capabilities.includes(cap.id));
        if (capModels.length === 0) return null;

        const capPrefs = allPrefs.filter(p => p.capability === cap.id && p.enabled);
        const preferredIds = new Set(capPrefs.map(p => p.modelId));

        return (
          <Card key={cap.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <cap.icon className={`h-5 w-5 ${CAPABILITY_COLORS[cap.id]?.replace("bg-", "text-").replace("/10", "") || "text-muted-foreground"}`} />
                <h4 className="font-medium">{cap.label}</h4>
                <Badge variant="outline" className="text-xs">{capModels.length} {t("settings.models.available")}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {capModels.map(model => {
                  const isPreferred = preferredIds.has(model.id);
                  const isTesting = testingModel === model.id;
                  return (
                    <Card
                      key={model.id}
                      className={isPreferred ? "ring-2 ring-primary/50" : ""}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{model.displayName}</p>
                            <p className="text-xs text-muted-foreground font-mono">{model.provider}</p>
                          </div>
                          {isPreferred && (
                            <Badge variant="default" className="text-xs shrink-0">
                              <CheckIcon className="h-3 w-3 mr-1" />
                              {t("settings.models.preferred")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {model.isFree && (
                            <Badge variant="outline" className="text-xs">
                              <DollarSignIcon className="h-2.5 w-2.5 mr-1" />
                              {t("settings.models.free")}
                            </Badge>
                          )}
                          {model.isLocal && (
                            <Badge variant="outline" className="text-xs">
                              <CpuIcon className="h-2.5 w-2.5 mr-1" />
                              {t("settings.models.local")}
                            </Badge>
                          )}
                          {model.supportsTools && (
                            <Badge variant="outline" className="text-xs">
                              <ShieldIcon className="h-2.5 w-2.5 mr-1" />
                              {t("settings.models.tools")}
                            </Badge>
                          )}
                          {model.supportsVision && (
                            <Badge variant="outline" className="text-xs">
                              <GlobeIcon className="h-2.5 w-2.5 mr-1" />
                              {t("settings.models.vision")}
                            </Badge>
                          )}
                          {model.supportsStreaming && (
                            <Badge variant="outline" className="text-xs">
                              <ZapIcon className="h-2.5 w-2.5 mr-1" />
                              {t("settings.models.streaming")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          {t("settings.models.context", { window: model.contextWindow.toLocaleString() })}
                          {model.pricing && (
                            <> · {formatPricing(model.pricing)}</>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={isPreferred ? "secondary" : "outline"}
                          className="w-full"
                          onClick={() => onTest(model.id)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <Loader2Icon className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <ZapIcon className="h-4 w-4 mr-2" />
                          )}
                          {isTesting ? t("settings.models.testing") : t("settings.models.test")}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent          </Card>
        );
      })}
    </div>
  );
}