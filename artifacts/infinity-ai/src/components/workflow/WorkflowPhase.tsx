/**
 * WorkflowPhase — Real-time phase progress display with SSE updates
 *
 * Shows live progress of workflow phases (generate, deploy, verify)
 */

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, AlertCircle, Terminal, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface WorkflowPhaseProps {
  workflowId: string;
  phase: 'generate' | 'deploy' | 'verify';
  t: any;
}

export const WorkflowPhase: React.FC<WorkflowPhaseProps> = ({
  workflowId,
  phase,
  t,
}) => {
  const [steps, setSteps] = useState<PhaseStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial phase steps
  useEffect(() => {
    fetchPhaseSteps();
  }, [workflowId, phase]);

  const fetchPhaseSteps = useCallback(async () => {
    try {
      const response = await fetch(`/api/infinity/workflow/${workflowId}/phase/${phase}`);
      if (response.ok) {
        const data = await response.json();
        setSteps(data.steps || []);
        if (data.currentStep) {
          setCurrentStep(data.currentStep);
        }
        if (data.status === 'complete') {
          setIsComplete(true);
        }
      }
    } catch (err) {
      console.error('Failed to fetch phase steps:', err);
    }
  }, [workflowId, phase]);

  // Connect to SSE for real-time updates
  useEffect(() => {
    if (isComplete) return;

    const es = new EventSource(`/api/infinity/workflow/${workflowId}/stream`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.phase === phase) {
          if (data.steps) {
            setSteps(data.steps);
          }
          if (data.currentStep) {
            setCurrentStep(data.currentStep);
          }
          if (data.status === 'complete') {
            setIsComplete(true);
            es.close();
          } else if (data.status === 'error') {
            setError(data.error);
            es.close();
          }
        }
      } catch (e) {
        console.error('Failed to parse SSE message:', e);
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [workflowId, phase, isComplete]);

  const phaseLabels: Record<string, string> = {
    generate: t('workflow.steps.generate'),
    deploy: t('workflow.steps.deploy'),
    verify: t('workflow.steps.verify'),
  };

  const phaseIcons: Record<string, React.ReactNode> = {
    generate: <Server className="w-4 h-4" />,
    deploy: <Rocket className="w-4 h-4" />,
    verify: <CheckCircle className="w-4 h-4" />,
  };

  const completedSteps = steps.filter(s => s.status === 'complete').length;
  const totalSteps = steps.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-500/10 flex items-center justify-center">
              {phaseIcons[phase]}
            </div>
            <CardTitle className="text-lg">{phaseLabels[phase]}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isComplete ? 'success' : error ? 'destructive' : 'secondary'}>
              {isComplete ? t('common.complete') : error ? t('common.error') : t('common.running')}
            </Badge>
            {progress > 0 && progress < 100 && (
              <span className="text-sm text-muted-foreground font-mono">
                {Math.round(progress)}%
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {progress > 0 && (
          <Progress value={progress} className="h-2" />
        )}

        {steps.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {steps.map((step) => (
              <PhaseStepItem
                key={step.id}
                step={step}
                isCurrent={step.id === currentStep}
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            {t('workflow.loadingPhase')}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchPhaseSteps}
              className="ml-auto"
            >
              <RotateCcw className="w-4 h-4" />
              {t('common.retry')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

interface PhaseStep {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  agent?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  logs?: string[];
}

const PhaseStepItem: React.FC<{
  step: PhaseStep;
  isCurrent: boolean;
  t: any;
}> = ({ step, isCurrent, t }) => {
  const [showLogs, setShowLogs] = useState(false);

  const statusIcons = {
    pending: <div className="w-5 h-5 rounded-full border-2 border-border-primary flex-shrink-0" />,
    running: <Loader2 className="w-5 h-5 text-brand-400 animate-spin flex-shrink-0" />,
    complete: <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />,
  };

  const statusLabels = {
    pending: t('workflow.stepStatus.pending'),
    running: t('workflow.stepStatus.running'),
    complete: t('workflow.stepStatus.complete'),
    error: t('workflow.stepStatus.error'),
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
        isCurrent ? 'bg-brand-500/5 border border-brand-500/20' : 'bg-muted/30'
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {statusIcons[step.status]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{step.name}</span>
          <Badge variant="outline" className="text-xs">
            {statusLabels[step.status]}
          </Badge>
          {step.agent && (
            <Badge variant="secondary" className="text-xs">
              {step.agent}
            </Badge>
          )}
        </div>
        {step.description && (
          <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
        )}
        {(step.logs && step.logs.length > 0) && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLogs(!showLogs)}
              className="text-xs h-auto px-2 py-1"
            >
              {showLogs ? t('workflow.hideLogs') : t('workflow.showLogs')}
              <Terminal className={`w-3 h-3 ml-1 ${showLogs ? 'rotate-180' : ''}`} />
            </Button>
            {showLogs && (
              <div className="mt-2 p-3 bg-muted rounded font-mono text-xs overflow-x-auto max-h-40 overflow-y-auto">
                {step.logs.map((log, i) => (
                  <div key={i} className="text-muted-foreground">{log}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {step.error && (
          <div className="mt-2 p-2 bg-destructive/10 rounded text-destructive text-sm">
            {step.error}
          </div>
        )}
      </div>
      {(step.startedAt || step.completedAt) && (
        <div className="flex-shrink-0 text-xs text-muted-foreground whitespace-nowrap">
          {step.startedAt && (
            <div>{t('workflow.started')}: {new Date(step.startedAt).toLocaleTimeString()}</div>
          )}
          {step.completedAt && (
            <div>{t('workflow.completed')}: {new Date(step.completedAt).toLocaleTimeString()}</div>
          )}
        </div>
      )}
    </div>
  );
};

import { Server, Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default WorkflowPhase;