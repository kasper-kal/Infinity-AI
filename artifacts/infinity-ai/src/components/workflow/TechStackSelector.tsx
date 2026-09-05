/**
 * TechStackSelector — Interactive tech stack selection with algorithmic scoring
 *
 * Displays recommended tech stacks with scores, allows user to pick or customize.
 * Integrates with backend tech-stack-selector API.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle, ArrowRight, Server, Database, Shield, Globe, Zap, Layers, Cpu } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface TechStackSelectorProps {
  workflowId: string;
  prd: string;
  techStack: any;
  onSelect: (stack: any) => void;
  onPrdApprove: () => void;
  isLoading: boolean;
  t: any;
}

interface TechStackOption {
  id: string;
  name: string;
  framework: string;
  language: string;
  database: string;
  orm: string;
  auth: string;
  hosting: string;
  ui: string;
  testing: string;
  ci: string;
  score: number;
  reasoning: string;
  pros: string[];
  cons: string[];
  estimatedCost: string;
  estimatedTime: string;
}

interface TechStackResponse {
  stacks: TechStackOption[];
  recommended: string;
  prd: string;
}

export const TechStackSelector: React.FC<TechStackSelectorProps> = ({
  workflowId,
  prd,
  techStack,
  onSelect,
  onPrdApprove,
  isLoading,
  t,
}) => {
  const [response, setResponse] = useState<TechStackResponse | null>(null);
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [showPrd, setShowPrd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch tech stack recommendations
  useEffect(() => {
    fetchRecommendations();
  }, [workflowId]);

  const fetchRecommendations = useCallback(async () => {
    try {
      const res = await fetch(`/api/infinity/workflow/${workflowId}/tech-stack`);
      if (res.ok) {
        const data = await res.json();
        setResponse(data);
        if (data.recommended) {
          setSelectedStackId(data.recommended);
        }
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to load tech stack recommendations');
      }
    } catch (err) {
      setError('Failed to connect to tech stack service');
    }
  }, [workflowId]);

  const handleSelect = useCallback((stack: TechStackOption) => {
    setSelectedStackId(stack.id);
    onSelect(stack);
  }, [onSelect]);

  const handleApprovePrd = useCallback(() => {
    onPrdApprove();
  }, [onPrdApprove]);

  if (!response) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
              <Layers className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <CardTitle>{t('workflow.steps.techstack')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('workflow.techStackSubtitle')}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
        </CardContent>
      </Card>
    );
  }

  const selectedStack = response.stacks.find(s => s.id === selectedStackId) || response.stacks[0];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Layers className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <CardTitle>{t('workflow.steps.techstack')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('workflow.techStackSubtitle')}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden">
        {/* PRD Preview Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPrd(!showPrd)}
          className="mb-4 text-left"
        >
          {showPrd ? t('workflow.hidePrd') : t('workflow.showPrd')}
          <ArrowRight className={`w-4 h-4 ml-2 ${showPrd ? 'rotate-180' : ''}`} />
        </Button>

        {showPrd && (
          <div className="mb-4 p-4 bg-muted rounded-lg max-h-64 overflow-y-auto font-mono text-sm">
            {prd || response.prd}
          </div>
        )}

        {/* Stack Options */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {response.stacks.map(stack => (
              <StackCard
                key={stack.id}
                stack={stack}
                isSelected={selectedStackId === stack.id}
                isRecommended={stack.id === response.recommended}
                onSelect={() => handleSelect(stack)}
                t={t}
              />
            ))}
          </div>
        </div>

        {/* Selected Stack Details */}
        {selectedStack && (
          <div className="mt-4 p-4 bg-brand-500/5 border border-brand-400/20 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="font-medium">{t('workflow.selectedStack')}</span>
              <Badge variant="success" className="ml-auto">
                {t('workflow.readyToGenerate')}
              </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <StackDetail label={t('workflow.framework')} value={selectedStack.framework} icon={<Layers className="w-4 h-4" />} />
              <StackDetail label={t('workflow.database')} value={selectedStack.database} icon={<Database className="w-4 h-4" />} />
              <StackDetail label={t('workflow.auth')} value={selectedStack.auth} icon={<Shield className="w-4 h-4" />} />
              <StackDetail label={t('workflow.hosting')} value={selectedStack.hosting} icon={<Globe className="w-4 h-4" />} />
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              {selectedStack.reasoning}
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="w-4 h-4" />
            <AlertTitle>{t('workflow.error')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        {techStack ? (
          <Button
            variant="primary"
            size="lg"
            onClick={handleApprovePrd}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? t('common.running') : t('workflow.approveAndGenerate')}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={() => handleSelect(selectedStack!)}
            disabled={!selectedStackId || isLoading}
            className="w-full"
          >
            {isLoading ? t('common.running') : t('workflow.selectAndGenerate')}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

interface StackCardProps {
  stack: TechStackOption;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  t: any;
}

const StackCard: React.FC<StackCardProps> = ({ stack, isSelected, isRecommended, onSelect, t }) => {
  return (
    <Button
      variant={isSelected ? 'primary' : 'outline'}
      className={`w-full h-full flex flex-col items-start p-4 gap-3 ${
        isSelected ? 'border-brand-400 bg-brand-500/5' : 'hover:border-brand-400/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Layers className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h4 className="font-semibold">{stack.name}</h4>
            <p className="text-sm text-muted-foreground">{stack.framework} · {stack.language}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRecommended && (
            <Badge variant="success" className="text-xs">
              {t('workflow.recommended')}
            </Badge>
          )}
          <div className="flex items-center gap-1 text-sm font-mono">
            <Zap className="w-3 h-3" />
            <span>{Math.round(stack.score * 100)}%</span>
          </div>
        </div>
      </div>

      <Progress value={stack.score * 100} className="w-full h-1.5" />

      <div className="grid grid-cols-4 gap-2 text-xs w-full">
        <StackTag label={t('workflow.database')} value={stack.database} />
        <StackTag label={t('workflow.auth')} value={stack.auth} />
        <StackTag label={t('workflow.hosting')} value={stack.hosting} />
        <StackTag label={t('workflow.ui')} value={stack.ui} />
      </div>

      <div className="text-xs text-muted-foreground w-full">
        {stack.reasoning}
      </div>

      <div className="flex flex-wrap gap-1 mt-2 w-full">
        {stack.pros.slice(0, 2).map(pro => (
          <Badge key={pro} variant="secondary" className="text-xs">
            + {pro}
          </Badge>
        ))}
        {stack.cons.slice(0, 1).map(con => (
          <Badge key={con} variant="outline" className="text-xs text-destructive/80">
            - {con}
          </Badge>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground w-full mt-2">
        <span><Cpu className="w-3 h-3 inline mr-1" /> {stack.estimatedTime}</span>
        <span><Server className="w-3 h-3 inline mr-1" /> {stack.estimatedCost}</span>
      </div>
    </Button>
  );
};

const StackTag: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono text-xs">{value}</span>
  </div>
);

const StackDetail: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-center gap-2">
    <span className="text-brand-400">{icon}</span>
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  </div>
);

import { AlertCircle } from "lucide-react";

export default TechStackSelector;