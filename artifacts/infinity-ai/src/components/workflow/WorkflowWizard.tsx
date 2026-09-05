/**
 * Workflow Wizard — Step-by-step NL → Deployed Product Flow
 *
 * Guides user through: Goal Input → Clarification → Tech Stack → Generation → Deploy → Verify
 * Integrates with backend workflow orchestrator API
 */

import React, { useState, useCallback, useEffect } from "react";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BuildProgressRing } from "@/components/build-progress-ring";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Loader2, ArrowRight, ArrowLeft, Zap, Brain, Server, Rocket, Check, X, Settings, Terminal } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { WorkflowPhase } from "./WorkflowPhase";
import { RequirementClarifier } from "./RequirementClarifier";
import { TechStackSelector } from "./TechStackSelector";
import { DeploymentStatus } from "./DeploymentStatus";

export interface WorkflowWizardProps {
  projectId?: string | null;
  onComplete?: (workflowId: string, deployUrl: string) => void;
  onBack?: () => void;
}

export const WorkflowWizard: React.FC<WorkflowWizardProps> = ({
  projectId,
  onComplete,
  onBack,
}) => {
  const { t } = useI18n();
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('goal');
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [clarification, setClarification] = useState<any>(null);
  const [prd, setPrd] = useState<string>('');
  const [techStack, setTechStack] = useState<any>(null);
  const [deploymentResult, setDeploymentResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sseEventSource, setSseEventSource] = useState<EventSource | null>(null);

  // Workflow steps in order
  const steps: WorkflowStep[] = ['goal', 'clarify', 'techstack', 'generate', 'deploy', 'verify'];

  const stepLabels: Record<WorkflowStep, string> = {
    goal: t('workflow.steps.goal'),
    clarify: t('workflow.steps.clarify'),
    techstack: t('workflow.steps.techstack'),
    generate: t('workflow.steps.generate'),
    deploy: t('workflow.steps.deploy'),
    verify: t('workflow.steps.verify'),
  };

  const stepIcons: Record<WorkflowStep, React.ReactNode> = {
    goal: <Zap className="w-5 h-5" />,
    clarify: <Brain className="w-5 h-5" />,
    techstack: <Settings className="w-5 h-5" />,
    generate: <Server className="w-5 h-5" />,
    deploy: <Rocket className="w-5 h-5" />,
    verify: <CheckCircle className="w-5 h-5" />,
  };

  const stepDescriptions: Record<WorkflowStep, string> = {
    goal: t('workflow.steps.goalDesc'),
    clarify: t('workflow.steps.clarifyDesc'),
    techstack: t('workflow.steps.techstackDesc'),
    generate: t('workflow.steps.generateDesc'),
    deploy: t('workflow.steps.deployDesc'),
    verify: t('workflow.steps.verifyDesc'),
  };

  // Clean up SSE on unmount
  useEffect(() => {
    return () => {
      if (sseEventSource) {
        sseEventSource.close();
      }
    };
  }, [sseEventSource]);

  // Start workflow with goal
  const handleStartWorkflow = useCallback(async () => {
    if (!goal.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/infinity/workflow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goal.trim(),
          projectId,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to start workflow');
      }

      const data = await response.json();
      setWorkflowId(data.workflowId);
      setCurrentStep('clarify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start workflow');
    } finally {
      setIsLoading(false);
    }
  }, [goal, projectId]);

  // Handle clarification complete
  const handleClarificationComplete = useCallback(async (answers: any) => {
    if (!workflowId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/infinity/workflow/${workflowId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to submit clarification');
      }

      const data = await response.json();
      setPrd(data.prd);
      setCurrentStep('techstack');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit clarification');
    } finally {
      setIsLoading(false);
    }
  }, [workflowId]);

  // Handle PRD approval
  const handlePrdApprove = useCallback(async () => {
    if (!workflowId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/infinity/workflow/${workflowId}/approve-prd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to approve PRD');
      }

      const data = await response.json();
      setTechStack(data.techStack);
      setCurrentStep('techstack');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve PRD');
    } finally {
      setIsLoading(false);
    }
  }, [workflowId]);

  // Handle tech stack selection
  const handleTechStackSelect = useCallback(async (selectedStack: any) => {
    if (!workflowId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/infinity/workflow/${workflowId}/select-stack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stack: selectedStack }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to select tech stack');
      }

      const data = await response.json();
      setCurrentStep('generate');
      // Start SSE for generation progress
      connectSSE(data.workflowId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select tech stack');
    } finally {
      setIsLoading(false);
    }
  }, [workflowId]);

  // Connect to SSE for real-time progress
  const connectSSE = useCallback((id: string) => {
    const es = new EventSource(`/api/infinity/workflow/${id}/stream`);
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.phase === 'generate' && data.status === 'complete') {
        setCurrentStep('deploy');
        es.close();
      } else if (data.phase === 'deploy' && data.status === 'complete') {
        setDeploymentResult(data.result);
        setCurrentStep('verify');
        es.close();
      } else if (data.status === 'error') {
        setError(data.error);
        es.close();
      }
    };
    es.onerror = () => {
      es.close();
    };
    setSseEventSource(es);
  }, []);

  // Handle deployment approval
  const handleDeployApprove = useCallback(async () => {
    if (!workflowId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/infinity/workflow/${workflowId}/approve-deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to approve deployment');
      }

      // SSE will handle the rest
      connectSSE(workflowId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve deployment');
    } finally {
      setIsLoading(false);
    }
  }, [workflowId, connectSSE]);

  // Handle verification complete
  const handleVerifyComplete = useCallback(() => {
    if (deploymentResult?.url && onComplete && workflowId) {
      onComplete(workflowId, deploymentResult.url);
    }
  }, [deploymentResult, onComplete, workflowId]);

  // Go to previous step
  const goBack = useCallback(() => {
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  }, [currentStep]);

  // Reset wizard
  const handleReset = useCallback(() => {
    setCurrentStep('goal');
    setWorkflowId(null);
    setGoal('');
    setClarification(null);
    setPrd('');
    setTechStack(null);
    setDeploymentResult(null);
    setError(null);
    if (sseEventSource) {
      sseEventSource.close();
      setSseEventSource(null);
    }
  }, [sseEventSource]);

  const currentStepIndex = steps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('workflow.wizard.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('workflow.wizard.subtitle')}</p>
        </div>
        {onBack && (
          <IconButton
            onClick={onBack}
            aria-label={t('common.back')}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </IconButton>
        )}
      </div>

      {/* Progress indicator */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <BuildProgressRing
            total={steps.length}
            completed={currentStepIndex + 1}
            status="working"
            currentLabel={stepLabels[currentStep]}
            className="flex-shrink-0"
          />
          <div className="flex-1">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium">{stepLabels[currentStep]}</span>
              <span className="text-muted-foreground">{Math.round(progress)}%</span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {steps.map((step, index) => (
                <div
                  key={step}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                    index < currentStepIndex
                      ? 'bg-green-500/10 text-green-400'
                      : index === currentStepIndex
                      ? 'bg-brand-500/10 text-brand-400'
                      : 'bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <span className="flex-shrink-0">{stepIcons[step]}</span>
                  <span className="hidden sm:inline font-medium">{stepLabels[step]}</span>
                  {index < steps.length - 1 && (
                    <div
                      className={`flex-1 h-1 mx-2 max-w-xs ${
                        index < currentStepIndex ? 'bg-green-500' : 'bg-border-primary'
                      }`}
/>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertTitle>{t('workflow.error')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step content */}
      <div className="flex-1 min-h-0">
        {currentStep === 'goal' && (
          <GoalStep
            goal={goal}
            onGoalChange={setGoal}
            onStart={handleStartWorkflow}
            isLoading={isLoading}
            t={t}
          />
        )}

        {currentStep === 'clarify' && workflowId && (
          <RequirementClarifier
            workflowId={workflowId}
            onComplete={handleClarificationComplete}
            isLoading={isLoading}
            t={t}
          />
        )}

        {currentStep === 'techstack' && workflowId && (
          <TechStackSelector
            workflowId={workflowId}
            prd={prd}
            techStack={techStack}
            onSelect={handleTechStackSelect}
            onPrdApprove={handlePrdApprove}
            isLoading={isLoading}
            t={t}
          />
        )}

        {currentStep === 'generate' && workflowId && (
          <GenerationPhase
            workflowId={workflowId}
            t={t}
          />
        )}

        {currentStep === 'deploy' && workflowId && (
          <DeploymentPhase
            workflowId={workflowId}
            techStack={techStack}
            onApprove={handleDeployApprove}
            isLoading={isLoading}
            t={t}
          />
        )}

        {currentStep === 'verify' && workflowId && deploymentResult && (
          <VerificationPhase
            result={deploymentResult}
            onComplete={handleVerifyComplete}
            t={t}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border-primary">
        <Button
          variant="ghost"
          onClick={goBack}
          disabled={currentStep === 'goal' || isLoading}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t('common.back')}
        </Button>

        <div className="flex items-center gap-2">
          {currentStep === 'goal' && (
            <Button
              onClick={handleStartWorkflow}
              disabled={!goal.trim() || isLoading}
              variant="primary"
              size="lg"
            >
              {isLoading ? t('common.running') : t('workflow.start')}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {currentStep === 'verify' && (
            <Button
              onClick={handleReset}
              variant="secondary"
              size="lg"
            >
              {t('workflow.newWorkflow')}
              <Zap className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

type WorkflowStep = 'goal' | 'clarify' | 'techstack' | 'generate' | 'deploy' | 'verify';

// Goal input step
const GoalStep: React.FC<{
  goal: string;
  onGoalChange: (value: string) => void;
  onStart: () => void;
  isLoading: boolean;
  t: any;
}> = ({ goal, onGoalChange, onStart, isLoading, t }) => (
  <Card className="h-full flex flex-col">
    <CardHeader>
      <CardTitle>{t('workflow.steps.goal')}</CardTitle>
    </CardHeader>
    <CardContent className="flex-1 flex flex-col justify-center space-y-6">
      <Textarea
        value={goal}
        onChange={(e) => onGoalChange(e.target.value)}
        placeholder={t('workflow.goalPlaceholder')}
        rows={6}
        className="font-mono text-base"
        disabled={isLoading}
      />
      <div className="text-sm text-muted-foreground space-y-2">
        <p>{t('workflow.goalHint')}</p>
        <p className="font-mono bg-muted px-3 py-2 rounded">
          {t('workflow.goalExample')}
        </p>
      </div>
    </CardContent>
    <CardFooter className="justify-end">
      <Button
        onClick={onStart}
        disabled={!goal.trim() || isLoading}
        variant="primary"
        size="lg"
      >
        {isLoading ? t('common.running') : t('workflow.start')}
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </CardFooter>
  </Card>
);

// Generation phase - shows progress
const GenerationPhase: React.FC<{
  workflowId: string;
  t: any;
}> = ({ workflowId, t }) => (
  <Card className="h-full flex flex-col">
    <CardHeader>
      <CardTitle>{t('workflow.steps.generate')}</CardTitle>
    </CardHeader>
    <CardContent className="flex-1 flex flex-col items-center justify-center space-y-6">
      <div className="text-center space-y-4">
        <div className="w-24 h-24 rounded-full bg-brand-500/10 flex items-center justify-center mx-auto">
          <Server className="w-12 h-12 text-brand-400 animate-spin" />
        </div>
        <div>
          <h3 className="text-xl font-semibold">{t('workflow.generating')}</h3>
          <p className="text-muted-foreground mt-1">{t('workflow.generatingDesc')}</p>
        </div>
      </div>

      <WorkflowPhase
        workflowId={workflowId}
        phase="generate"
        t={t}
      />
    </CardContent>
  </Card>
);

// Deployment phase - approval gate
const DeploymentPhase: React.FC<{
  workflowId: string;
  techStack: any;
  onApprove: () => void;
  isLoading: boolean;
  t: any;
}> = ({ workflowId, techStack, onApprove, isLoading, t }) => (
  <Card className="h-full flex flex-col">
    <CardHeader>
      <CardTitle>{t('workflow.steps.deploy')}</CardTitle>
    </CardHeader>
    <CardContent className="flex-1 flex flex-col justify-center space-y-6">
      <Alert>
        <Rocket className="w-4 h-4" />
        <AlertTitle>{t('workflow.deployReady')}</AlertTitle>
        <AlertDescription>
          {t('workflow.deployReadyDesc')}
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>{t('workflow.framework')}</span>
              <span className="font-mono">{techStack?.framework || 'Next.js'}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('workflow.hosting')}</span>
              <span className="font-mono">{techStack?.hosting || 'Vercel'}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('workflow.database')}</span>
              <span className="font-mono">{techStack?.database || 'PostgreSQL'}</span>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <WorkflowPhase
        workflowId={workflowId}
        phase="deploy"
        t={t}
      />
    </CardContent>
    <CardFooter className="justify-end">
      <Button
        onClick={onApprove}
        disabled={isLoading}
        variant="primary"
        size="lg"
      >
        {isLoading ? t('common.running') : t('workflow.approveDeploy')}
        <Rocket className="w-4 h-4 ml-2" />
      </Button>
    </CardFooter>
  </Card>
);

// Verification phase - shows result
const VerificationPhase: React.FC<{
  result: any;
  onComplete: () => void;
  t: any;
}> = ({ result, onComplete, t }) => (
  <Card className="h-full flex flex-col">
    <CardHeader>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
          <CheckCircle className="w-6 h-6 text-green-400" />
        </div>
        <div>
          <CardTitle className="text-green-400">{t('workflow.verified')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('workflow.verifiedDesc')}</p>
        </div>
      </div>
    </CardHeader>
    <CardContent className="flex-1 flex flex-col space-y-6">
      <DeploymentStatus result={result} t={t} />

      <div className="space-y-3">
        <h4 className="font-medium">{t('workflow.nextSteps')}</h4>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            {t('workflow.nextSteps.viewSite')}
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            {t('workflow.nextSteps.monitor')}
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            {t('workflow.nextSteps.handoff')}
          </li>
        </ul>
      </div>
    </CardContent>
    <CardFooter className="justify-end">
      <Button onClick={onComplete} variant="primary" size="lg">
        {t('workflow.done')}
        <Check className="w-4 h-4 ml-2" />
      </Button>
    </CardFooter>
  </Card>
);

export default WorkflowWizard;