import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Check, FileText, Loader2, Sparkles, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import '@/lib/build-ui-theme.css';

interface PlanStep {
  id: string;
  title: string;
  description?: string;
  files?: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped';
  duration?: number;
}

interface BuildPlanViewProps {
  plan: {
    title: string;
    summary: string;
    steps: PlanStep[];
    files?: string[];
    risks?: string[];
  } | null;
  onStepClick?: (stepId: string) => void;
  onClose?: () => void;
  activeStepId?: string | null;
}

export function BuildPlanView({ plan, onStepClick, onClose, activeStepId }: BuildPlanViewProps) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  if (!plan) return null;

  const steps = plan.steps;
  const completedCount = steps.filter(s => s.status === 'completed').length;
  const totalSteps = steps.length;

  // Scroll detection for arrows
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkScroll = () => {
      setShowLeftArrow(container.scrollLeft > 8);
      setShowRightArrow(container.scrollLeft < container.scrollWidth - container.clientWidth - 8);
    };

    checkScroll();
    container.addEventListener('scroll', checkScroll, { passive: true });
    return () => container.removeEventListener('scroll', checkScroll);
  }, []);

  const scrollToStep = (index: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cards = container.querySelectorAll('[data-step-card]');
    const card = cards[index] as HTMLElement;
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  // Auto-scroll to active step on mount
  useEffect(() => {
    if (activeStepId) {
      const index = steps.findIndex(s => s.id === activeStepId);
      if (index >= 0) {
        setTimeout(() => scrollToStep(index), 100);
      }
    }
  }, [activeStepId]);

  const getStatusIcon = (status: PlanStep['status']) => {
    switch (status) {
      case 'completed': return <Check className="h-4 w-4 text-emerald-400" />;
      case 'in_progress': return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'error': return <X className="h-4 w-4 text-rose-400" />;
      case 'skipped': return <X className="h-4 w-4 text-muted-foreground" />;
      default: return <Sparkles className="h-4 w-4 text-muted-foreground/50" />;
    }
  };

  const getStatusColor = (status: PlanStep['status']) => {
    switch (status) {
      case 'completed': return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300';
      case 'in_progress': return 'border-primary/40 bg-primary/10 text-primary';
      case 'error': return 'border-rose-400/40 bg-rose-400/10 text-rose-300';
      case 'skipped': return 'border-muted-foreground/20 bg-muted/50 text-muted-foreground';
      default: return 'border-border bg-secondary text-muted-foreground';
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m ${sec % 60}s`;
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{plan.title}</h3>
            <p className="text-[11px] text-muted-foreground truncate">{plan.summary}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            {completedCount}/{totalSteps}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label={t('studio.build.progressClose')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Progress Bar */}
      <div className="flex-shrink-0 border-b border-border px-4 py-2">
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground text-right">
          {t('studio.build.progressWorking')} — {completedCount} {t('studio.build.actions') || 'steps'} {t('studio.build.of') || 'of'} {totalSteps}
        </p>
      </div>

      {/* Steps - Horizontal Scroll on Mobile, Vertical List on Desktop */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          ref={containerRef}
          className="flex min-h-0 flex-col md:flex-row md:flex-wrap gap-3 p-3 pb-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden scrollbar-hide"
          role="list"
          aria-label={t('studio.build.planSteps') || 'Plan steps'}
        >
          {/* Left scroll arrow (mobile) */}
          {showLeftArrow && (
            <button
              type="button"
              onClick={() => containerRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
              className="flex-shrink-0 flex items-center justify-center w-10 h-full bg-gradient-to-r from-card to-transparent border-r border-border z-10"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-5 w-5 text-muted-foreground" />
            </button>
          )}

          {steps.map((step, index) => (
            <article
              key={step.id}
              data-step-card={step.id}
              onClick={() => onStepClick?.(step.id)}
              className={`flex-shrink-0 flex flex-col gap-2 rounded-xl border p-3 transition-all duration-200 ${
                getStatusColor(step.status)
              } ${activeStepId === step.id ? 'ring-2 ring-primary/50' : 'hover:shadow-md'}
                ${showAll ? 'min-w-[280px] w-[280px] md:w-full' : 'min-w-[280px] w-[280px] md:w-full'}
              `}
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStepClick?.(step.id); } }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-current/10">
                  {getStatusIcon(step.status)}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-medium text-current truncate">{step.title}</h4>
                  {step.description && (
                    <p className="mt-1 text-[11px] leading-relaxed text-current/80 line-clamp-2">{step.description}</p>
                  )}
                  {step.files && step.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {step.files.slice(0, 3).map((file, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded bg-current/10 px-1.5 py-0.5 text-[10px] font-mono text-current/90">
                          <FileText className="h-2.5 w-2.5" />
                          {file.length > 25 ? file.slice(0, 22) + '…' : file}
                        </span>
                      ))}
                      {step.files.length > 3 && (
                        <span className="inline-flex items-center gap-1 rounded bg-current/10 px-1.5 py-0.5 text-[10px] text-current/70">
                          +{step.files.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                  {step.duration && (
                    <p className="mt-1 text-[10px] font-mono text-current/60">{formatDuration(step.duration)}</p>
                  )}
                </div>
              </div>

              {/* Expandable details on click/tap */}
              {activeStepId === step.id && (
                <div className="mt-2 pt-2 border-t border-current/20 animate-fade-in">
                  <div className="flex items-center gap-2 text-[11px] text-current/70">
                    <span className="font-medium">Status:</span>
                    <span className="capitalize">{step.status.replace('_', ' ')}</span>
                  </div>
                  {step.files && step.files.length > 3 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] font-medium text-current/80">All files:</p>
                      <ul className="space-y-0.5">
                        {step.files.map((file, i) => (
                          <li key={i} className="text-[10px] font-mono text-current/60 truncate">{file}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}

          {/* Right scroll arrow (mobile) */}
          {showRightArrow && (
            <button
              type="button"
              onClick={() => containerRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
              className="flex-shrink-0 flex items-center justify-center w-10 h-full bg-gradient-to-l from-card to-transparent border-l border-border z-10"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Risks/Notes section */}
        {plan.risks && plan.risks.length > 0 && (
          <section className="border-t border-border p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
              {t('studio.build.planRisks') || 'Notes'}
            </p>
            <ul className="space-y-1">
              {plan.risks.map((risk, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-amber-200/80">
                  <span className="mt-0.5 shrink-0 h-1.5 w-1.5 rounded-full bg-amber-400" />
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Desktop: always vertical list, Mobile: horizontal cards */}
      <style jsx>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        @media (max-width: 768px) {
          .md\\:flex-row { flex-direction: row; }
          .md\\:flex-wrap { flex-wrap: nowrap; }
          .md\\:overflow-y-auto { overflow-y: hidden; }
          .md\\:overflow-x-hidden { overflow-x: auto; }
          .md\\:w-full { width: 280px; }
        }
      `}</style>
    </div>
  );
}