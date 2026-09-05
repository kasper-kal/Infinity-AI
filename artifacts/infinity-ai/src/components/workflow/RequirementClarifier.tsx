/**
 * RequirementClarifier — Interactive clarification question flow
 *
 * Presents dynamically generated questions to clarify user intent,
 * collects answers, and submits them to synthesize a PRD.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowRight, Brain, HelpCircle, CheckCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface RequirementClarifierProps {
  workflowId: string;
  onComplete: (answers: any) => void;
  isLoading: boolean;
  t: any;
}

interface ClarificationQuestion {
  id: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'multiselect';
  question: string;
  description?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  dependsOn?: { questionId: string; value: string }[];
}

interface ClarificationResponse {
  questions: ClarificationQuestion[];
  sessionId: string;
}

export const RequirementClarifier: React.FC<RequirementClarifierProps> = ({
  workflowId,
  onComplete,
  isLoading,
  t,
}) => {
  const [response, setResponse] = useState<ClarificationResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Fetch clarification questions
  useEffect(() => {
    fetchQuestions();
  }, [workflowId]);

  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/infinity/workflow/${workflowId}/clarify`);
      if (res.ok) {
        const data = await res.json();
        setResponse(data);
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to load clarification questions');
      }
    } catch (err) {
      setError('Failed to connect to clarification service');
    }
  }, [workflowId]);

  // Filter questions based on dependencies
  const visibleQuestions = response?.questions.filter(q => {
    if (!q.dependsOn || q.dependsOn.length === 0) return true;
    return q.dependsOn.every(dep => answers[dep.questionId] === dep.value);
  }) || [];

  const currentQuestion = visibleQuestions[currentQuestionIndex];
  const answeredCount = Object.keys(answers).length;
  const requiredQuestions = visibleQuestions.filter(q => q.required);
  const requiredAnswered = requiredQuestions.filter(q => answers[q.id] !== undefined && answers[q.id] !== '').length;
  const progress = requiredQuestions.length > 0 ? (requiredAnswered / requiredQuestions.length) * 100 : 0;

  const handleAnswerChange = useCallback((questionId: string, value: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  }, []);

  const handleNext = useCallback(() => {
    if (currentQuestion && currentQuestion.required && (!answers[currentQuestion.id] || answers[currentQuestion.id] === '')) {
      return;
    }
    if (currentQuestionIndex < visibleQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  }, [currentQuestion, currentQuestionIndex, visibleQuestions.length, answers]);

  const handlePrev = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  }, [currentQuestionIndex]);

  const handleSubmit = useCallback(async () => {
    // Validate all required questions
    const missingRequired = requiredQuestions.filter(q => !answers[q.id] || answers[q.id] === '');
    if (missingRequired.length > 0) {
      // Jump to first missing required question
      const firstMissingIndex = visibleQuestions.findIndex(q => q.id === missingRequired[0].id);
      if (firstMissingIndex >= 0) {
        setCurrentQuestionIndex(firstMissingIndex);
      }
      return;
    }

    setSubmitted(true);
    try {
      const res = await fetch(`/api/infinity/workflow/${workflowId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit answers');
      }

      const data = await res.json();
      onComplete(answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit clarification');
      setSubmitted(false);
    }
  }, [workflowId, answers, onComplete, requiredQuestions, visibleQuestions]);

  if (!response) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader>
          <CardTitle>{t('workflow.steps.clarify')}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
        </CardContent>
      </Card>
    );
  }

  if (visibleQuestions.length === 0) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <CardTitle className="text-green-400">{t('workflow.noClarificationNeeded')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('workflow.noClarificationNeededDesc')}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <Button onClick={() => onComplete({})} variant="primary" size="lg">
            {t('workflow.continue')}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <CardTitle>{t('workflow.clarifyTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('workflow.clarifySubtitle')}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {/* Progress */}
        <div className="space-y-2 mb-6">
          <div className="flex items-center justify-between text-sm">
            <span>{t('workflow.questionProgress', { current: currentQuestionIndex + 1, total: visibleQuestions.length })}</span>
            <span className="font-mono">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Question Cards */}
        <div className="flex-1 overflow-y-auto">
          {visibleQuestions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              answer={answers[question.id]}
              onChange={(value) => handleAnswerChange(question.id, value)}
              isActive={index === currentQuestionIndex}
              isAnswered={answers[question.id] !== undefined && answers[question.id] !== ''}
              required={question.required}
              t={t}
            />
          ))}
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="w-4 h-4" />
            <AlertTitle>{t('workflow.error')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <div className="flex items-center justify-between w-full">
          <Button
            variant="ghost"
            onClick={handlePrev}
            disabled={currentQuestionIndex === 0 || submitted}
          >
            <ArrowRight className="w-4 h-4 mr-2 rotate-180" />
            {t('common.back')}
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {visibleQuestions.map((q, i) => (
              <button
                key={q.id}
                onClick={() => setCurrentQuestionIndex(i)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === currentQuestionIndex
                    ? 'bg-brand-400'
                    : answers[q.id] !== undefined && answers[q.id] !== ''
                    ? 'bg-green-400'
                    : 'bg-border-primary'
                }`}
                aria-label={`${t('workflow.question')} ${i + 1}`}
              />
            ))}
          </div>
          <Button
            variant="primary"
            onClick={currentQuestionIndex === visibleQuestions.length - 1 ? handleSubmit : handleNext}
            disabled={submitted}
            className="ml-auto"
          >
            {submitted ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                {t('common.running')}
              </>
            ) : currentQuestionIndex === visibleQuestions.length - 1 ? (
              <>
                {t('workflow.submit')}
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            ) : (
              <>
                {t('common.next')}
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

interface QuestionCardProps {
  question: ClarificationQuestion;
  answer: any;
  onChange: (value: any) => void;
  isActive: boolean;
  isAnswered: boolean;
  required: boolean;
  t: any;
}

const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  answer,
  onChange,
  isActive,
  isAnswered,
  required,
  t,
}) => {
  const renderInput = () => {
    const commonProps = {
      value: answer || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        onChange(e.target.value),
      disabled: false,
      required,
      className: 'w-full',
    };

    switch (question.type) {
      case 'textarea':
        return (
          <Textarea
            {...commonProps}
            placeholder={question.description || t('workflow.enterAnswer')}
            rows={3}
          />
        );
      case 'select':
        return (
          <Select value={answer || ''} onValueChange={onChange}>
            <SelectTrigger {...commonProps}>
              <SelectValue placeholder={t('workflow.selectOption')} />
            </SelectTrigger>
            <SelectContent>
              {question.options?.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'radio':
        return (
          <RadioGroup value={answer || ''} onValueChange={onChange} className="space-y-2">
            {question.options?.map(opt => (
              <div key={opt.value} className="flex items-center gap-2">
                <RadioGroupItem value={opt.value} className="translate-y-0.5" />
                <label className="cursor-pointer">{opt.label}</label>
              </div>
            ))}
          </RadioGroup>
        );
      case 'checkbox':
        return (
          <div className="space-y-2">
            {question.options?.map(opt => (
              <div key={opt.value} className="flex items-center gap-2">
                <Checkbox
                  checked={Array.isArray(answer) && answer.includes(opt.value)}
                  onCheckedChange={checked => {
                    const newValue = Array.isArray(answer) ? [...answer] : [];
                    const idx = newValue.indexOf(opt.value);
                    if (checked && idx === -1) newValue.push(opt.value);
                    else if (!checked && idx >= 0) newValue.splice(idx, 1);
                    onChange(newValue);
                  }}
                />
                <label className="cursor-pointer">{opt.label}</label>
              </div>
            ))}
          </div>
        );
      case 'multiselect':
        return (
          <Select value={Array.isArray(answer) ? answer : []} onValueChange={onChange} multiple>
            <SelectTrigger {...commonProps}>
              <SelectValue placeholder={t('workflow.selectOptions')} />
            </SelectTrigger>
            <SelectContent>
              {question.options?.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return <Input {...commonProps} placeholder={question.description || t('workflow.enterAnswer')} />;
    }
  };

  return (
    <div
      className={`p-4 rounded-lg border transition-all ${
        isActive
          ? 'border-brand-400 bg-brand-500/5 ring-1 ring-brand-400/20'
          : isAnswered
          ? 'border-green-400/30 bg-green-500/5'
          : 'border-border-primary bg-muted/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
          ${isActive ? 'bg-brand-400 text-brand-950' : isAnswered ? 'bg-green-400 text-green-950' : 'bg-muted text-muted-foreground'}
        ">
          {isAnswered ? <CheckCircle className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium">{question.question}</span>
            {required && <Badge variant="outline" className="text-xs">{t('workflow.required')}</Badge>}
          </div>
          {question.description && (
            <p className="text-sm text-muted-foreground mb-3">{question.description}</p>
          )}
          {renderInput()}
        </div>
      </div>
    </div>
  );
};

import { AlertCircle } from "lucide-react";

export default RequirementClarifier;