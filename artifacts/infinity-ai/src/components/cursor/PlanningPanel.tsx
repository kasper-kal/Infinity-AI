/**
 * Planning Panel — Phase 30: Advanced Agent Capabilities
 * UI for creating, reviewing, and executing multi-step plans
 */

import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/api";
import { Button, Input, Textarea, Tabs, TabsList, TabsTrigger, TabsContent, Card, CardHeader, CardTitle, CardContent, CardFooter, Badge, ScrollArea, Separator, Checkbox, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Alert, AlertTitle, AlertDescription, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "../../lib/i18n";

interface PlanStep {
  id: string;
  description: string;
  toolHint?: string;
  dependsOn: string[];
  verification: string;
  risk: "low" | "medium" | "high" | "critical";
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: any;
  estimatedTokens?: number;
}

interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  risks: Array<{ id: string; description: string; likelihood: string; impact: string; mitigation: string }>;
  successCriteria: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectContext {
  files?: string[];
  constraints?: string[];
}

export function PlanningPanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();

  // State
  const [activeTab, setActiveTab] = useState<"create" | "plans" | "execute">("create");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState<ProjectContext>({ files: [], constraints: [] });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [executeOptions, setExecuteOptions] = useState({
    enablePlanning: true,
    enableDebugging: true,
    enableGit: true,
    enableSubagents: true,
    maxSteps: 20,
    requireApproval: true,
  });
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);

  // Risk color mapping
  const riskColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    low: "default",
    medium: "secondary",
    high: "destructive",
    critical: "destructive",
  };

  const statusColors: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
    pending: "outline",
    running: "secondary",
    completed: "success",
    failed: "destructive",
    skipped: "default",
  };

  // Fetch plans on mount
  useEffect(() => {
    fetchPlans();
  }, [projectId]);

  const fetchPlans = useCallback(async () => {
    try {
      const response = await apiRequest(`/api/infinity/advanced-agent/plans?projectId=${projectId}`);
      if (response.success) {
        setPlans(response.data);
      }
    } catch (error) {
      console.error("Failed to fetch plans:", error);
      toast({ title: t("planning.fetchFailed"), description: String(error), variant: "destructive" });
    }
  }, [projectId, t, toast]);

  const createPlan = async () => {
    if (!goal.trim()) {
      toast({ title: t("planning.goalRequired"), variant: "destructive" });
      return;
    }

    setIsCreating(true);
    try {
      const response = await apiRequest("/api/infinity/advanced-agent/plan", {
        method: "POST",
        body: JSON.stringify({
          goal,
          projectId,
          context,
        }),
      });

      if (response.success) {
        const plan = response.data;
        setPlans(prev => [plan, ...prev]);
        setGoal("");
        setContext({ files: [], constraints: [] });
        setActiveTab("plans");

        if (executeOptions.requireApproval) {
          setPendingPlan(plan);
          setShowApprovalDialog(true);
        } else {
          // Auto-execute
          executePlan(plan.id);
        }

        toast({ title: t("planning.created"), description: `${plan.steps.length} ${t("planning.steps")}` });
      } else {
        toast({ title: t("planning.createFailed"), description: response.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: t("planning.createFailed"), description: String(error), variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const executePlan = async (planId: string, stepId?: string) => {
    setIsExecuting(true);
    try {
      const response = await apiRequest("/api/infinity/advanced-agent/plan/execute", {
        method: "POST",
        body: JSON.stringify({ planId, stepId, projectId }),
      });

      if (response.success) {
        // Refresh plan
        const planResponse = await apiRequest(`/api/infinity/advanced-agent/plan/${planId}?projectId=${projectId}`);
        if (planResponse.success) {
          const updatedPlan = planResponse.data;
          setPlans(prev => prev.map(p => p.id === planId ? updatedPlan : p));
          if (selectedPlan?.id === planId) {
            setSelectedPlan(updatedPlan);
          }
        }
        toast({ title: t("planning.stepExecuted"), description: response.summary });
      } else {
        toast({ title: t("planning.executionFailed"), description: response.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: t("planning.executionFailed"), description: String(error), variant: "destructive" });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleApprove = () => {
    if (pendingPlan) {
      executePlan(pendingPlan.id);
      setShowApprovalDialog(false);
      setPendingPlan(null);
    }
  };

  const handleReject = () => {
    setShowApprovalDialog(false);
    setPendingPlan(null);
  };

  const getNextPendingStep = (plan: Plan) => {
    return plan.steps.findIndex(s => s.status === "pending");
  };

  const renderStep = (step: PlanStep, index: number, plan: Plan) => {
    const isCurrent = index === currentStepIndex && step.status === "running";
    const canExecute = step.status === "pending" && index === getNextPendingStep(plan);

    return (
      <div
        key={step.id}
        className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
          isCurrent ? "ring-2 ring-primary bg-primary/5" : "bg-card hover:bg-accent/50"
        }`}
      >
        <div className="flex flex-col items-center gap-1 min-w-[40px]">
          <span className="text-xs font-mono text-muted-foreground">{index + 1}</span>
          <Badge variant={statusColors[step.status]} className="w-full text-xs">
            {step.status}
          </Badge>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{step.description}</span>
            {step.toolHint && (
              <Badge variant="outline" className="text-xs">
                {step.toolHint}
              </Badge>
            )}
            {step.risk !== "low" && (
              <Badge variant={riskColors[step.risk]} className="text-xs">
                {step.risk}
              </Badge>
            )}
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <div><strong>{t("planning.verification")}:</strong> {step.verification}</div>
            {step.dependsOn.length > 0 && (
              <div><strong>{t("planning.dependsOn")}:</strong> {step.dependsOn.join(", ")}</div>
            )}
            {step.estimatedTokens && (
              <div><strong>{t("planning.estTokens")}:</strong> {step.estimatedTokens}</div>
            )}
          </div>

          {step.result && (
            <div className="mt-2 p-2 bg-muted rounded text-xs font-mono max-h-20 overflow-auto">
              {typeof step.result === "string" ? step.result : JSON.stringify(step.result, null, 2)}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          {canExecute && !isExecuting && (
            <Button size="sm" onClick={() => executePlan(plan.id, step.id)} disabled={isExecuting}>
              {t("planning.executeStep")}
            </Button>
          )}
          {step.status === "running" && (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mb-4">
          <TabsTrigger value="create">{t("planning.create")}</TabsTrigger>
          <TabsTrigger value="plans">{t("planning.myPlans")} <Badge variant="secondary">{plans.length}</Badge></TabsTrigger>
          <TabsTrigger value="execute">{t("planning.execute")}</TabsTrigger>
        </TabsList>

        {/* Create Tab */}
        <TabsContent value="create" className="flex-1 overflow-auto space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("planning.newPlan")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t("planning.goal")}</Label>
                <Textarea
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder={t("planning.goalPlaceholder")}
                  rows={4}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>{t("planning.context")} (optional)</Label>
                <div className="grid gap-4 md:grid-cols-2 mt-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("planning.relevantFiles")}</Label>
                    <Textarea
                      value={context.files?.join("\n") || ""}
                      onChange={e => setContext(prev => ({ ...prev, files: e.target.value.split("\n").filter(f => f.trim()) }))}
                      placeholder={t("planning.filesPlaceholder")}
                      rows={3}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("planning.constraints")}</Label>
                    <Textarea
                      value={context.constraints?.join("\n") || ""}
                      onChange={e => setContext(prev => ({ ...prev, constraints: e.target.value.split("\n").filter(c => c.trim()) }))}
                      placeholder={t("planning.constraintsPlaceholder")}
                      rows={3}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="requireApproval"
                  checked={executeOptions.requireApproval}
                  onCheckedChange={checked => setExecuteOptions(prev => ({ ...prev, requireApproval: checked }))}
                />
                <Label htmlFor="requireApproval" className="text-sm">
                  {t("planning.requireApproval")}
                </Label>
              </div>

              <Button
                onClick={createPlan}
                disabled={isCreating || !goal.trim()}
                className="w-full"
                size="lg"
              >
                {isCreating ? t("planning.creating") : t("planning.createPlan")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Plans Tab */}
        <TabsContent value="plans" className="flex-1 overflow-auto">
          {plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <p>{t("planning.noPlans")}</p>
              <Button onClick={() => setActiveTab("create")} className="mt-4">
                {t("planning.createFirst")}
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="space-y-3 p-2">
                {plans.map(plan => (
                  <Card key={plan.id} className={selectedPlan?.id === plan.id ? "ring-2 ring-primary" : ""}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base">{plan.goal}</CardTitle>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Badge variant="outline">{plan.steps.length} {t("planning.steps")}</Badge>
                            <Badge variant="outline">{new Date(plan.createdAt).toLocaleDateString()}</Badge>
                            <span>{t("planning.updated")} {new Date(plan.updatedAt).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        <Button
                          variant={selectedPlan?.id === plan.id ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedPlan(selectedPlan?.id === plan.id ? null : plan)}
                        >
                          {selectedPlan?.id === plan.id ? t("planning.hide") : t("planning.view")}
                        </Button>
                      </div>
                    </CardHeader>

                    {selectedPlan?.id === plan.id && (
                      <CardContent className="space-y-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <h4 className="font-medium text-sm mb-2">{t("planning.risks")}</h4>
                            <div className="space-y-1 max-h-40 overflow-auto">
                              {plan.risks.map(risk => (
                                <Badge key={risk.id} variant="outline" className="w-full justify-start text-xs">
                                  {risk.description} ({risk.likelihood}/{risk.impact})
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-medium text-sm mb-2">{t("planning.successCriteria")}</h4>
                            <div className="space-y-1 max-h-40 overflow-auto">
                              {plan.successCriteria.map((c, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="w-5 h-5 rounded-full border flex items-center justify-center text-[10px]">{i + 1}</span>
                                  {c}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <Separator />

                        <h4 className="font-medium text-sm">{t("planning.steps")}</h4>
                        <div className="space-y-2 max-h-96 overflow-auto">
                          {plan.steps.map((step, index) => renderStep(step, index, plan))}
                        </div>

                        <CardFooter className="flex justify-end gap-2">
                          {plan.steps.some(s => s.status === "pending") && (
                            <Button
                              onClick={() => executePlan(plan.id)}
                              disabled={isExecuting}
                              size="sm"
                            >
                              {t("planning.executeAll")}
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => setSelectedPlan(null)}>
                            {t("planning.close")}
                          </Button>
                        </CardFooter>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* Execute Tab - Run advanced agent with full capabilities */}
        <TabsContent value="execute" className="flex-1 overflow-auto space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("planning.advancedAgent")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t("planning.goal")}</Label>
                <Textarea
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder={t("planning.advancedGoalPlaceholder")}
                  rows={4}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>{t("planning.mode")}</Label>
                <Select
                  value={executeOptions.maxSteps > 0 ? "auto" : "plan"}
                  onValueChange={value => setExecuteOptions(prev => ({ ...prev, maxSteps: value === "auto" ? 20 : 0 }))}
                  className="mt-1 w-full md:w-64"
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("planning.modeAuto")}</SelectItem>
                    <SelectItem value="plan">{t("planning.modePlan")}</SelectItem>
                    <SelectItem value="implement">{t("planning.modeImplement")}</SelectItem>
                    <SelectItem value="debug">{t("planning.modeDebug")}</SelectItem>
                    <SelectItem value="review">{t("planning.modeReview")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="font-medium">{t("planning.capabilities")}</Label>
                  <div className="space-y-1">
                    {[
                      { key: "enablePlanning", label: t("planning.capPlanning") },
                      { key: "enableDebugging", label: t("planning.capDebugging") },
                      { key: "enableGit", label: t("planning.capGit") },
                      { key: "enableSubagents", label: t("planning.capSubagents") },
                    ].map(cap => (
                      <Label key={cap.key} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={executeOptions[cap.key as keyof typeof executeOptions] as boolean}
                          onCheckedChange={checked => setExecuteOptions(prev => ({ ...prev, [cap.key]: checked }))}
                        />
                        <span className="text-sm">{cap.label}</span>
                      </Label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>{t("planning.maxSteps")}</Label>
                  <Input
                    type="number"
                    value={executeOptions.maxSteps}
                    onChange={e => setExecuteOptions(prev => ({ ...prev, maxSteps: parseInt(e.target.value) || 20 }))}
                    min={1}
                    max={50}
                    className="mt-1 w-full md:w-64"
                  />
                </div>
              </div>

              <Button
                onClick={async () => {
                  if (!goal.trim()) {
                    toast({ title: t("planning.goalRequired"), variant: "destructive" });
                    return;
                  }
                  setIsExecuting(true);
                  try {
                    const response = await apiRequest("/api/infinity/advanced-agent/run", {
                      method: "POST",
                      body: JSON.stringify({ projectId, goal, mode: "auto", options: executeOptions }),
                    });
                    if (response.success) {
                      toast({ title: t("planning.runComplete"), description: response.summary });
                      fetchPlans();
                    } else {
                      toast({ title: t("planning.runFailed"), description: response.error, variant: "destructive" });
                    }
                  } catch (error) {
                    toast({ title: t("planning.runFailed"), description: String(error), variant: "destructive" });
                  } finally {
                    setIsExecuting(false);
                  }
                }}
                disabled={isExecuting || !goal.trim()}
                className="w-full"
                size="lg"
              >
                {isExecuting ? t("planning.running") : t("planning.runAgent")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Approval Dialog */}
      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("planning.approvePlan")}</DialogTitle>
            <DialogDescription>
              {t("planning.approveDescription")}
            </DialogDescription>
          </DialogHeader>
          {pendingPlan && (
            <div className="space-y-3 py-4">
              <p className="font-medium">{pendingPlan.goal}</p>
              <div className="space-y-1 max-h-60 overflow-auto">
                {pendingPlan.steps.map((step, index) => (
                  <div key={step.id} className="flex items-center gap-2 text-sm p-2 bg-muted rounded">
                    <span className="w-5 h-5 rounded-full border flex items-center justify-center text-[10px] text-muted-foreground">{index + 1}</span>
                    <span className="flex-1">{step.description}</span>
                    <Badge variant={riskColors[step.risk]} className="text-xs">{step.risk}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleReject}>{t("planning.reject")}</Button>
            <Button onClick={handleApprove} disabled={isExecuting}>
              {t("planning.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}