/**
 * BuildModeSelector — Build mode selection with visual cards showing configuration
 * Part of Phase 39: Enhanced LLM API Key System
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  Badge,
  Progress,
  Input,
  Label,
  Slider,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Separator,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui";
import {
  Zap,
  Shield,
  Brain,
  Crown,
  SlidersHorizontal,
  Check,
  ChevronRight,
  Settings,
  Users,
  Clock,
  DollarSign,
  Layers,
  GitBranch,
} from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useModelRouter, type BuildMode, type BuildModeConfig } from "@/hooks/useModelRouter";

interface BuildModeSelectorProps {
  /** Current selected build mode */
  value?: BuildMode;
  /** Callback when build mode changes */
  onChange?: (mode: BuildMode, config: BuildModeConfig) => void;
  /** Show detailed configuration */
  showDetails?: boolean;
  /** Allow editing custom mode */
  allowCustomEdit?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Project ID */
  projectId?: string;
  /** User ID */
  userId?: string;
  /** Disable certain modes */
  disabledModes?: BuildMode[];
}

const BUILD_MODE_ICONS: Record<BuildMode, React.ReactNode> = {
  speed: <Zap className="w-6 h-6" />,
  balanced: <Shield className="w-6 h-6" />,
  quality: <Brain className="w-6 h-6" />,
  max: <Crown className="w-6 h-6" />,
  custom: <SlidersHorizontal className="w-6 h-6" />,
};

const BUILD_MODE_COLORS: Record<BuildMode, string> = {
  speed: "border-green-500/30 bg-green-500/5",
  balanced: "border-blue-500/30 bg-blue-500/5",
  quality: "border-purple-500/30 bg-purple-500/5",
  max: "border-gold-500/30 bg-gold-500/5",
  custom: "border-gray-500/30 bg-gray-500/5",
};

const VERIFICATION_DEPTH_LABELS: Record<BuildModeConfig["verificationDepth"], string> = {
  minimal: "Minimal",
  standard: "Standard",
  thorough: "Thorough",
  adversarial: "Adversarial",
};

const VERIFICATION_DEPTH_DESC: Record<BuildModeConfig["verificationDepth"], string> = {
  minimal: "Single pass, no verification",
  standard: "Basic validation + 1 retry",
  thorough: "Multi-step verification + 2 retries",
  adversarial: "Adversarial verification + 3 retries + consensus",
};

export const BuildModeSelector: React.FC<BuildModeSelectorProps> = ({
  value = "balanced",
  onChange,
  showDetails = true,
  allowCustomEdit = true,
  compact = false,
  projectId,
  userId,
  disabledModes = [],
}) => {
  const { t } = useI18n();
  const { getBuildModeConfig, getAllBuildModes, updateBuildModeConfig } = useModelRouter({ projectId, userId });

  const [selectedMode, setSelectedMode] = useState<BuildMode>(value);
  const [customConfig, setCustomConfig] = useState<Partial<BuildModeConfig>>({});
  const [showCustomEditor, setShowCustomEditor] = useState(false);

  const allModes = getAllBuildModes();
  const currentConfig = allModes[selectedMode] || getBuildModeConfig(selectedMode);

  // Sync with external value
  React.useEffect(() => {
    setSelectedMode(value);
  }, [value]);

  const handleModeChange = useCallback((mode: BuildMode) => {
    if (disabledModes.includes(mode)) return;
    setSelectedMode(mode);
    setShowCustomEditor(mode === "custom");
    const config = allModes[mode] || getBuildModeConfig(mode);
    onChange?.(mode, config);
  }, [allModes, disabledModes, getBuildModeConfig, onChange]);

  const handleCustomConfigChange = useCallback((key: keyof BuildModeConfig, value: any) => {
    const nextConfig = { ...customConfig, [key]: value };
    setCustomConfig(nextConfig);

    if (selectedMode === "custom") {
      const updatedConfig = { ...currentConfig, ...nextConfig };
      updateBuildModeConfig("custom", nextConfig);
      onChange?.("custom", updatedConfig);
    }
  }, [customConfig, currentConfig, onChange, selectedMode, updateBuildModeConfig]);

  const renderModeCard = (mode: BuildMode) => {
    const config = allModes[mode] || getBuildModeConfig(mode);
    const isSelected = selectedMode === mode;
    const isDisabled = disabledModes.includes(mode);

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Card
            className={`relative cursor-pointer transition-all ${
              isSelected
                ? "ring-2 ring-accent border-accent/50 shadow-lg shadow-accent/10"
                : BUILD_MODE_COLORS[mode]
            } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={() => !isDisabled && handleModeChange(mode)}
          >
            <div className="absolute top-2 right-2">
              {isSelected && <Check className="w-5 h-5 text-accent" />}
            </div>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${BUILD_MODE_COLORS[mode].replace("border-", "bg-").replace("/30", "/20").replace("/5", "/10")}`}>
                    {BUILD_MODE_ICONS[mode]}
                  </div>
                  <div>
                    <CardTitle className="text-base">{t(`buildMode.${mode}.name`) || mode}</CardTitle>
                    <CardDescription className="text-xs">
                      {t(`buildMode.${mode}.description`) || config.description}
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Users className="w-3 h-3" />
                  <span>{config.parallelAgents} agents</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Layers className="w-3 h-3" />
                  <span>{VERIFICATION_DEPTH_LABELS[config.verificationDepth]}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <DollarSign className="w-3 h-3" />
                  <span>${config.maxCostPerRequest}/req</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{config.maxLatencyMs / 1000}s max</span>
                </div>
              </div>

              {showDetails && !compact && (
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Context Budget</span>
                    <span className="font-medium">{config.contextBudget}x</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Temperature</span>
                    <span className="font-medium">{config.temperature}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {config.preferLocal && <Badge variant="outline" className="text-xs"><GitBranch className="w-3 h-3 mr-1" />Local</Badge>}
                    {config.preferSpeed && <Badge variant="outline" className="text-xs"><Zap className="w-3 h-3 mr-1" />Speed</Badge>}
                    {config.preferCost && <Badge variant="outline" className="text-xs"><DollarSign className="w-3 h-3 mr-1" />Cost</Badge>}
                    {config.preferQuality && <Badge variant="outline" className="text-xs"><Brain className="w-3 h-3 mr-1" />Quality</Badge>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          <div className="space-y-1">
            <p className="font-medium">{t(`buildMode.${mode}.name`) || mode}</p>
            <p className="text-xs text-muted-foreground">{t(`buildMode.${mode}.description`) || config.description}</p>
            <Separator />
            <p className="text-xs">Verification: {VERIFICATION_DEPTH_LABELS[config.verificationDepth]}</p>
            <p className="text-xs">{VERIFICATION_DEPTH_DESC[config.verificationDepth]}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  if (compact) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-2">
        {Object.keys(allModes).map(mode => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <Button
                variant={selectedMode === mode ? "primary" : "outline"}
                size="sm"
                disabled={disabledModes.includes(mode as BuildMode)}
                onClick={() => handleModeChange(mode as BuildMode)}
                className="whitespace-nowrap"
              >
                <span className="flex items-center gap-1">
                  {BUILD_MODE_ICONS[mode as BuildMode]}
                  <span>{t(`buildMode.${mode}.name`) || mode}</span>
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t(`buildMode.${mode}.description`) || (allModes[mode as BuildMode]?.description)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {Object.keys(allModes).map(mode => renderModeCard(mode as BuildMode))}
      </div>

      {/* Custom Mode Editor */}
      {showDetails && (selectedMode === "custom" || showCustomEditor) && allowCustomEdit && (
        <Card className="border-accent/30 bg-accent/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                <CardTitle>{t("buildMode.custom.title") || "Custom Mode Configuration"}</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCustomEditor(!showCustomEditor)}
              >
                {showCustomEditor ? "Hide" : "Edit"} <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          {showCustomEditor && (
            <CardContent className="space-y-4">
              <Tabs defaultValue="general" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="general">{t("buildMode.custom.general") || "General"}</TabsTrigger>
                  <TabsTrigger value="preferences">{t("buildMode.custom.preferences") || "Preferences"}</TabsTrigger>
                  <TabsTrigger value="limits">{t("buildMode.custom.limits") || "Limits"}</TabsTrigger>
                  <TabsTrigger value="advanced">{t("buildMode.custom.advanced") || "Advanced"}</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("buildMode.custom.parallelAgents") || "Parallel Agents"}</Label>
                      <div className="flex items-center gap-3">
                        <Input
                          type="number"
                          min="1"
                          max="10"
                          value={customConfig.parallelAgents || currentConfig.parallelAgents}
                          onChange={e => handleCustomConfigChange("parallelAgents", parseInt(e.target.value))}
                          className="w-20"
                        />
                        <span className="text-sm text-muted-foreground">(1-10)</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("buildMode.custom.temperature") || "Temperature"}</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          value={customConfig.temperature ?? currentConfig.temperature}
                          onValueChange={v => handleCustomConfigChange("temperature", v)}
                          className="flex-1"
                        />
                        <span className="w-10 text-sm text-muted-foreground">
                          {(customConfig.temperature ?? currentConfig.temperature).toFixed(1)}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("buildMode.custom.contextBudget") || "Context Budget"}</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          min={0.1}
                          max={3}
                          step={0.1}
                          value={customConfig.contextBudget ?? currentConfig.contextBudget}
                          onValueChange={v => handleCustomConfigChange("contextBudget", v)}
                          className="flex-1"
                        />
                        <span className="w-10 text-sm text-muted-foreground">
                          {(customConfig.contextBudget ?? currentConfig.contextBudget).toFixed(1)}x
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("buildMode.custom.verificationDepth") || "Verification Depth"}</Label>
                      <Select
                        value={customConfig.verificationDepth || currentConfig.verificationDepth}
                        onChange={e => handleCustomConfigChange("verificationDepth", e.target.value)}
                        className="w-full"
                      >
                        <option value="minimal">{t("buildMode.custom.minimal") || "Minimal"}</option>
                        <option value="standard">{t("buildMode.custom.standard") || "Standard"}</option>
                        <option value="thorough">{t("buildMode.custom.thorough") || "Thorough"}</option>
                        <option value="adversarial">{t("buildMode.custom.adversarial") || "Adversarial"}</option>
                      </Select>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="preferences" className="mt-4 space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {t("buildMode.custom.preferencesDesc") || "Configure model selection preferences"}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Switch
                          checked={customConfig.preferLocal ?? currentConfig.preferLocal}
                          onCheckedChange={v => handleCustomConfigChange("preferLocal", v)}
                        />
                        <span>{t("buildMode.custom.preferLocal") || "Prefer Local Models"}</span>
                      </Label>
                      <p className="text-xs text-muted-foreground ml-6">
                        {t("buildMode.custom.preferLocalDesc") || "Prioritize Ollama/LM Studio models"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Switch
                          checked={customConfig.preferSpeed ?? currentConfig.preferSpeed}
                          onCheckedChange={v => handleCustomConfigChange("preferSpeed", v)}
                        />
                        <span>{t("buildMode.custom.preferSpeed") || "Prefer Speed"}</span>
                      </Label>
                      <p className="text-xs text-muted-foreground ml-6">
                        {t("buildMode.custom.preferSpeedDesc") || "Prioritize low latency models"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Switch
                          checked={customConfig.preferCost ?? currentConfig.preferCost}
                          onCheckedChange={v => handleCustomConfigChange("preferCost", v)}
                        />
                        <span>{t("buildMode.custom.preferCost") || "Prefer Low Cost"}</span>
                      </Label>
                      <p className="text-xs text-muted-foreground ml-6">
                        {t("buildMode.custom.preferCostDesc") || "Prioritize free/cheap models"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Switch
                          checked={customConfig.preferQuality ?? currentConfig.preferQuality}
                          onCheckedChange={v => handleCustomConfigChange("preferQuality", v)}
                        />
                        <span>{t("buildMode.custom.preferQuality") || "Prefer Quality"}</span>
                      </Label>
                      <p className="text-xs text-muted-foreground ml-6">
                        {t("buildMode.custom.preferQualityDesc") || "Prioritize high quality models"}
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="limits" className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("buildMode.custom.maxCostPerRequest") || "Max Cost per Request"}</Label>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">$</span>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={customConfig.maxCostPerRequest ?? currentConfig.maxCostPerRequest}
                          onChange={e => handleCustomConfigChange("maxCostPerRequest", parseFloat(e.target.value))}
                          className="w-24"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("buildMode.custom.maxLatencyMs") || "Max Latency (ms)"}</Label>
                      <Input
                        type="number"
                        min="100"
                        max="300000"
                        step="100"
                        value={customConfig.maxLatencyMs ?? currentConfig.maxLatencyMs}
                        onChange={e => handleCustomConfigChange("maxLatencyMs", parseInt(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="advanced" className="mt-4 space-y-4">
                  <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                    <p className="text-sm text-muted-foreground">
                      {t("buildMode.custom.advancedDesc") || "Advanced settings for power users. Changes here affect all custom mode usages."}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Reset to defaults
                      setCustomConfig({});
                      updateBuildModeConfig("custom", getBuildModeConfig("custom"));
                    }}
                  >
                    {t("buildMode.custom.resetDefaults") || "Reset to Defaults"}
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          )}
        </Card>
      )}

      {/* Current Mode Summary */}
      {showDetails && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BUILD_MODE_ICONS[selectedMode] />
              {t("buildMode.currentConfig") || "Current Configuration"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("buildMode.parallelAgents") || "Parallel Agents"}</p>
                <p className="text-2xl font-bold">{currentConfig.parallelAgents}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("buildMode.verificationDepth") || "Verification"}</p>
                <p className="font-medium capitalize">{VERIFICATION_DEPTH_LABELS[currentConfig.verificationDepth]}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("buildMode.maxCost") || "Max Cost/Request"}</p>
                <p className="text-2xl font-bold">${currentConfig.maxCostPerRequest}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("buildMode.maxLatency") || "Max Latency"}</p>
                <p className="text-2xl font-bold">{currentConfig.maxLatencyMs / 1000}s</p>
              </div>
            </div>

            <Separator className="my-4" />

            <div className="flex flex-wrap gap-2">
              {currentConfig.preferLocal && <Badge variant="outline"><GitBranch className="w-3 h-3 mr-1" />Local</Badge>}
              {currentConfig.preferSpeed && <Badge variant="outline"><Zap className="w-3 h-3 mr-1" />Speed</Badge>}
              {currentConfig.preferCost && <Badge variant="outline"><DollarSign className="w-3 h-3 mr-1" />Cost</Badge>}
              {currentConfig.preferQuality && <Badge variant="outline"><Brain className="w-3 h-3 mr-1" />Quality</Badge>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BuildModeSelector;