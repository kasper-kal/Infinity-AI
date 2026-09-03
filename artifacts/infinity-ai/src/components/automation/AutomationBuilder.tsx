"use client";

/**
 * Phase 33: AI Automation System — Automation Builder
 *
 * Visual builder for creating automations from natural language.
 * Features: NL input → parsed preview → visual flowchart → test run → save
 */

import React, { useState, useCallback, useEffect } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/Card";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/Dialog";
import { Toast, Toaster } from "@/components/ui/Toast";
import { Switch } from "@/components/ui/Switch";
import { Label } from "@/components/ui/Label";
import { Separator } from "@/components/ui/Separator";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  Zap,
  Play,
  Save,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Copy,
  CheckCircle,
  AlertCircle,
  Info,
  Settings,
  Plus,
  Trash2,
  Clock,
  GitBranch,
  TestTube,
  History,
  ArrowRight,
  Loader2,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { AutomationSpec, AutomationTrigger, AutomationAction, AutomationTriggerType, AutomationActionType, NotificationChannel } from "@workspace/api-server/src/lib/automation-parser";
import { AutomationFlow } from "./AutomationFlow";
import { AutomationList } from "./AutomationList";

// Types matching the backend schema
interface ParsedAutomation {
  spec: AutomationSpec;
  confidence: number;
  warnings?: string[];
  suggestions?: string[];
  clarifications?: Array<{
    question: string;
    field: string;
    options?: string[];
    required: boolean;
  }>;
}

interface AutomationBuilderProps {
  projectId: string;
  initialPrompt?: string;
  onAutomationCreated?: (automation: any) => void;
  onClose?: () => void;
}

const TRIGGER_TYPE_LABELS: Record<AutomationTriggerType, string> = {
  cron: "Scheduled (Cron)",
  webhook: "Webhook",
  manual: "Manual",
  api_call: "API Call",
  connector_event: "Connector Event",
};

const ACTION_TYPE_LABELS: Record<AutomationActionType, string> = {
  connector_action: "Connector Action",
  notification: "Notification",
  code_execution: "Code Execution",
  llm_call: "LLM Call",
  data_transform: "Data Transform",
  http_request: "HTTP Request",
  delay: "Delay",
  conditional: "Conditional",
  loop: "Loop",
  parallel: "Parallel",
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: "Email",
  push: "Push",
  slack: "Slack",
  discord: "Discord",
  webhook: "Webhook",
  in_app: "In-App",
};

export const AutomationBuilder: React.FC<AutomationBuilderProps> = ({
  projectId,
  initialPrompt,
  onAutomationCreated,
  onClose,
}) => {
  const { t } = useI18n();
  const [step, setStep] = useState<"input" | "preview" | "builder" | "test" | "saved">("input");
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [parsed, setParsed] = useState<ParsedAutomation | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output?: any; error?: string; logs: string[] } | null>(null);
  const [savedAutomation, setSavedAutomation] = useState<any>(null);
  const [showClarifications, setShowClarifications] = useState(false);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});

  // Trigger clarifications dialog if needed
  useEffect(() => {
    if (parsed?.clarifications && parsed.clarifications.length > 0) {
      setShowClarifications(true);
    }
  }, [parsed]);

  const handleParse = useCallback(async () => {
    if (!prompt.trim()) return;

    setIsParsing(true);
    try {
      const response = await fetch("/api/infinity/automations/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, projectId }),
      });

      const data = await response.json();
      if (data.spec) {
        setParsed(data);
      } else {
        setParsed(data);
        setShowClarifications(true);
      }
    } catch (err) {
      console.error("Parse failed:", err);
    } finally {
      setIsParsing(false);
    }
  }, [prompt, projectId]);

  const handleSave = useCallback(async () => {
    if (!parsed?.spec) return;

    try {
      const response = await fetch("/api/infinity/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          spec: parsed.spec,
        }),
      });

      const data = await response.json();
      if (data.automation) {
        setSavedAutomation(data.automation);
        setStep("saved");
        onAutomationCreated?.(data.automation);
      }
    } catch (err) {
      console.error("Save failed:", err);
    }
  }, [parsed, projectId, onAutomationCreated]);

  const handleTestRun = useCallback(async () => {
    if (!parsed?.spec) return;

    setTestRunning(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/infinity/automations/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: parsed.spec }),
      });

      const data = await response.json();
      setTestResult({
        success: data.valid,
        output: data,
        error: data.valid ? undefined : data.errors?.join(", "),
        logs: data.valid ? ["Validation passed"] : data.errors || ["Validation failed"],
      });
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : "Test failed",
        logs: ["Error: " + (err instanceof Error ? err.message : "Unknown error")],
      });
    } finally {
      setTestRunning(false);
    }
  }, [parsed]);

  const handleClarificationSubmit = useCallback(async () => {
    if (!parsed || !parsed.clarifications) return;

    const updatedPrompt = prompt + "\n\nClarifications:\n" +
      parsed.clarifications.map((c, i) =>
        `${c.field}: ${clarificationAnswers[c.field] || clarificationAnswers[i.toString()] || ""}`
      ).join("\n");

    setPrompt(updatedPrompt);
    setShowClarifications(false);
    await handleParse();
  }, [parsed, prompt, clarificationAnswers, handleParse]);

  const renderTriggerCard = (trigger: AutomationTrigger) => (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="w-4 h-4 text-brand-500" />
          {t("automation.builder.trigger")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-sm">{TRIGGER_TYPE_LABELS[trigger.type]}</Badge>
          {trigger.cronExpression && (
            <span className="font-mono text-sm bg-muted px-2 py-1 rounded">{trigger.cronExpression}</span>
          )}
          {trigger.webhookPath && (
            <span className="font-mono text-sm bg-muted px-2 py-1 rounded">{trigger.webhookPath}</span>
          )}
          {trigger.connectorId && trigger.connectorEvent && (
            <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
              {trigger.connectorId} → {trigger.connectorEvent}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderConditionsCard = (conditions: any[]) => (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="w-4 h-4 text-amber-500" />
          {t("automation.builder.conditions")} ({conditions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {conditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("automation.builder.noConditions")}</p>
        ) : (
          <div className="space-y-2">
            {conditions.map((cond, i) => (
              <div key={cond.id || i} className="p-3 bg-muted/50 rounded-lg text-sm">
                <div className="font-mono text-foreground">{cond.field}</div>
                <div className="flex items-center gap-2 text-muted-foreground mt-1">
                  <Badge variant="secondary">{cond.operator}</Badge>
                  {cond.value !== undefined && (
                    <span className="font-mono">{JSON.stringify(cond.value)}</span>
                  )}
                  {cond.customExpression && (
                    <span className="font-mono text-xs">{cond.customExpression}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderActionsCard = (actions: AutomationAction[]) => (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Play className="w-4 h-4 text-green-500" />
          {t("automation.builder.actions")} ({actions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {actions.map((action, i) => (
            <div key={action.id || i} className="p-3 bg-muted/50 rounded-lg border border-border-primary/50">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">{ACTION_TYPE_LABELS[action.type]}</Badge>
                <span className="font-medium">{action.name}</span>
              </div>
              {action.description && (
                <p className="text-sm text-muted-foreground mb-2">{action.description}</p>
              )}

              {action.type === "connector_action" && (
                <div className="text-sm text-muted-foreground font-mono">
                  {action.connectorId} → {action.connectorAction}
                </div>
              )}
              {action.type === "notification" && (
                <div className="text-sm text-muted-foreground font-mono">
                  {CHANNEL_LABELS[action.notificationChannel!]} → {action.notificationRecipients?.join(", ")}
                </div>
              )}
              {action.type === "code_execution" && (
                <div className="text-sm text-muted-foreground font-mono max-h-24 overflow-auto">
                  {action.code?.slice(0, 200)}{action.code && action.code.length > 200 ? "..." : ""}
                </div>
              )}
              {action.type === "llm_call" && (
                <div className="text-sm text-muted-foreground font-mono max-h-24 overflow-auto">
                  {action.llmPrompt?.slice(0, 200)}{action.llmPrompt && action.llmPrompt.length > 200 ? "..." : ""}
                </div>
              )}
              {action.dependsOn?.length && (
                <div className="text-xs text-muted-foreground mt-1">
                  Depends on: {action.dependsOn.join(", ")}
                </div>
              )}
              {(action.thenActions?.length || action.elseActions?.length) && (
                <div className="text-xs text-muted-foreground mt-1">
                  Branches: {action.thenActions?.length || 0} then, {action.elseActions?.length || 0} else
                </div>
              )}
              {action.loopActions?.length && (
                <div className="text-xs text-muted-foreground mt-1">
                  Loop: {action.loopType} × {action.loopCount || action.loopCollection || "while"}
                </div>
              )}
              {action.parallelActions?.length && (
                <div className="text-xs text-muted-foreground mt-1">
                  Parallel: {action.parallelActions.length} actions
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const renderSettingsCard = (settings: any) => (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings className="w-4 h-4 text-muted-foreground" />
          {t("automation.builder.settings")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-muted-foreground">{t("automation.builder.maxConcurrentRuns")}</span>
            <div className="font-mono">{settings.maxConcurrentRuns}</div>
          </div>
          <div>
            <span className="text-muted-foreground">{t("automation.builder.timeoutMs")}</span>
            <div className="font-mono">{settings.timeoutMs}ms</div>
          </div>
          <div>
            <span className="text-muted-foreground">{t("automation.builder.retryOnFailure")}</span>
            <div className="font-mono">{settings.retryOnFailure ? t("common.yes") : t("common.no")}</div>
          </div>
          <div>
            <span className="text-muted-foreground">{t("automation.builder.logLevel")}</span>
            <div className="font-mono capitalize">{settings.logLevel}</div>
          </div>
        </div>
        {settings.tags?.length && (
          <div className="flex flex-wrap gap-1">
            {settings.tags.map((tag: string) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Step 1: Natural Language Input
  if (step === "input") {
    return (
      <div className="flex flex-col h-full max-w-3xl mx-auto p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{t("automation.builder.title")}</h1>
          <p className="text-muted-foreground">{t("automation.builder.subtitle")}</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("automation.builder.placeholder")}
              className="min-h-[150px] font-sans text-base"
              rows={6}
            />
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="w-4 h-4" />
                <span>{t("automation.builder.examples")}</span>
              </div>
              <Button
                onClick={handleParse}
                disabled={isParsing || !prompt.trim()}
                size="lg"
                className="w-full sm:w-auto"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    {t("automation.builder.parsing")}
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    {t("automation.builder.parse")}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4" /> {t("automation.builder.exampleTriggers")}
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• "Every morning at 8:00 AM..."</li>
                <li>• "When a new Linear issue is created..."</li>
                <li>• "On GitHub PR merged to main..."</li>
                <li>• "When a Slack message in #alerts contains 'urgent'..."</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Play className="w-4 h-4" /> {t("automation.builder.exampleActions")}
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• "...send Slack notification to #channel"</li>
                <li>• "...create Linear issue with high priority"</li>
                <li>• "...run tests and deploy to Vercel"</li>
                <li>• "...generate summary using AI"</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Step 2-4: Preview / Builder / Test
  if (parsed) {
    const spec = parsed.spec;

    return (
      <div className="flex flex-col h-full max-w-5xl mx-auto p-4 space-y-4">
        {/* Progress indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {(["input", "preview", "builder", "test", "saved"] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div
                  className={`flex items-center gap-2 ${
                    (step === s || (step === "builder" && s === "preview") || (step === "test" && (s === "preview" || s === "builder"))) ? "text-brand-500" : "text-muted-foreground"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 ${
                      step === s ? "bg-brand-500 border-brand-500 text-white" :
                      (step === "builder" && s === "preview") || (step === "test" && (s === "preview" || s === "builder")) ? "bg-brand-500 border-brand-500 text-white" :
                      "border-border-primary bg-background"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span className="hidden sm:inline text-sm">{t(`automation.builder.step.${s}`)}</span>
                </div>
                {i < 4 && (
                  <div className={`w-12 h-0.5 ${
                    (step === "builder" && i < 1) || (step === "test" && i < 2) || step === "saved" ? "bg-brand-500" : "bg-border-primary"
                  }`} />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowRawJson(!showRawJson)}>
              {showRawJson ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{showRawJson ? t("common.hide") : t("common.show")} JSON</span>
            </Button>
            {step !== "saved" && (
              <Button variant="ghost" size="sm" onClick={() => setStep("preview")}>
                <RefreshCw className="w-4 h-4 mr-1" />
                {t("automation.builder.reparse")}
              </Button>
            )}
            {onClose && step === "saved" && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="w-4 h-4 mr-1" />
                {t("common.done")}
              </Button>
            )}
          </div>
        </div>

        {showRawJson && (
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("automation.builder.rawSpec")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <pre className="p-4 text-xs overflow-auto max-h-96 font-mono text-muted-foreground">
                {JSON.stringify(spec, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Warnings */}
        {parsed.warnings && parsed.warnings.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-medium text-amber-700 dark:text-amber-300">{t("automation.builder.warnings")}</h4>
                  <ul className="list-disc list-inside text-sm text-amber-600 dark:text-amber-400 mt-1 space-y-1">
                    {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Suggestions */}
        {parsed.suggestions && parsed.suggestions.length > 0 && (
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-medium text-blue-700 dark:text-blue-300">{t("automation.builder.suggestions")}</h4>
                  <ul className="list-disc list-inside text-sm text-blue-600 dark:text-blue-400 mt-1 space-y-1">
                    {parsed.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Clarifications Dialog */}
        <Dialog open={showClarifications} onOpenChange={setShowClarifications}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("automation.builder.clarificationsNeeded")}</DialogTitle>
              <DialogDescription>{t("automation.builder.clarificationsDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {parsed.clarifications?.map((c, i) => (
                <div key={c.field || i} className="space-y-2">
                  <Label className="font-medium">{c.question}</Label>
                  {c.options && c.options.length > 0 ? (
                    <Select
                      value={clarificationAnswers[c.field] || clarificationAnswers[i.toString()] || ""}
                      onValueChange={(v) => setClarificationAnswers(prev => ({ ...prev, [c.field || i.toString()]: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("automation.builder.selectOption")} />
                      </SelectTrigger>
                      <SelectContent>
                        {c.options.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={clarificationAnswers[c.field] || clarificationAnswers[i.toString()] || ""}
                      onChange={(e) => setClarificationAnswers(prev => ({ ...prev, [c.field || i.toString()]: e.target.value }))}
                      placeholder={t("automation.builder.enterValue")}
                    />
                  )}
                  {c.required && <span className="text-xs text-amber-500">{t("automation.builder.required")}</span>}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={handleClarificationSubmit} disabled={Object.keys(clarificationAnswers).length === 0}>
                {t("automation.builder.continue")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Visual Flowchart */}
        <Card className="flex-1 min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="w-4 h-4" />
              {t("automation.builder.visualFlow")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            <AutomationFlow
              spec={spec}
              className="h-full"
            />
          </CardContent>
        </Card>

        {/* Spec Details Tabs */}
        <Card>
          <Tabs
            tabs={[
              { id: "trigger", label: t("automation.builder.trigger"), icon: <Zap className="w-4 h-4" /> },
              { id: "conditions", label: t("automation.builder.conditions"), icon: <GitBranch className="w-4 h-4" /> },
              { id: "actions", label: t("automation.builder.actions"), icon: <Play className="w-4 h-4" /> },
              { id: "settings", label: t("automation.builder.settings"), icon: <Settings className="w-4 h-4" /> },
            ]}
            activeTab={step === "preview" ? "trigger" : step}
            onChange={(tab) => setStep(tab as any)}
            variant="pills"
            className="w-full"
          />
          <CardContent className="pt-4">
            {step === "preview" || step === "trigger" ? renderTriggerCard(spec.trigger) : null}
            {step === "preview" || step === "conditions" ? renderConditionsCard(spec.conditions || []) : null}
            {step === "preview" || step === "actions" ? renderActionsCard(spec.actions) : null}
            {step === "preview" || step === "settings" ? renderSettingsCard(spec.settings) : null}
          </CardContent>
        </Card>

        {/* Test Run Section */}
        {step === "test" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TestTube className="w-4 h-4 text-brand-500" />
                {t("automation.builder.testRun")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleTestRun}
                disabled={testRunning}
                className="w-full"
                size="lg"
              >
                {testRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    {t("automation.builder.runningTest")}
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    {t("automation.builder.runTest")}
                  </>
                )}
              </Button>

              {testResult && (
                <div className={`p-4 rounded-lg ${testResult.success ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {testResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className="font-medium">
                      {testResult.success ? t("automation.builder.testPassed") : t("automation.builder.testFailed")}
                    </span>
                  </div>
                  {testResult.logs.length > 0 && (
                    <div className="font-mono text-xs text-muted-foreground space-y-1 max-h-40 overflow-auto">
                      {testResult.logs.map((log, i) => (
                        <div key={i}>{log}</div>
                      ))}
                    </div>
                  )}
                  {testResult.error && (
                    <div className="text-sm text-red-500 mt-2">{testResult.error}</div>
                  )}
                </div>
              )}

              <p className="text-sm text-muted-foreground text-center">
                {t("automation.builder.testNote")}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Saved Success */}
        {step === "saved" && savedAutomation && (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-xl font-bold mb-2">{t("automation.builder.savedSuccess")}</h3>
              <p className="text-muted-foreground mb-4">{savedAutomation.name}</p>
              <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(savedAutomation.createdAt).toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <History className="w-3 h-3" />
                  v{savedAutomation.version}
                </span>
              </div>
              <div className="mt-6 flex items-center justify-center gap-4">
                <Button variant="outline" onClick={() => setStep("builder")}>
                  <ArrowRight className="w-4 h-4 mr-1" />
                  {t("automation.builder.continueEditing")}
                </Button>
                <Button onClick={() => onClose?.()}>
                  <X className="w-4 h-4 mr-1" />
                  {t("common.done")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        {step !== "saved" && step !== "test" && (
          <div className="flex items-center justify-end gap-4 pt-4 border-t border-border-primary">
            <Button variant="ghost" onClick={() => setStep("input")}>
              <RefreshCw className="w-4 h-4 mr-1" />
              {t("automation.builder.startOver")}
            </Button>
            <Button variant="outline" onClick={() => setStep("test")}>
              <TestTube className="w-4 h-4 mr-1" />
              {t("automation.builder.test")}
            </Button>
            <Button onClick={handleSave} disabled={!parsed?.spec}>
              <Save className="w-4 h-4 mr-1" />
              {t("automation.builder.save")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default AutomationBuilder;