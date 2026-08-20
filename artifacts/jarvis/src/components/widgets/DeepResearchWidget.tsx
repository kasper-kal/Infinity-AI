/**
 * DeepResearchWidget — Live progress + final report for Deep Research v2 jobs.
 * Polls /api/jarvis/deep-research-v2/:id/stream (SSE) for real-time updates.
 */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useBuildToasts } from "@/components/build-toast";
import { Widget } from "@/types/widget";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Loader2, CheckCircle, AlertCircle, Search, BookOpen, FileText, Zap, Target, XCircle, ChevronDown } from "lucide-react";

type DeepResearchWidgetData = Extract<Widget, { type: "deep_research" }> & { log?: string[] };
type DeepResearchPhase = DeepResearchWidgetData["phase"];

const PHASE_LABELS: Record<DeepResearchPhase, string> = {
  planning: "Planning",
  searching: "Searching",
  reading: "Reading",
  extracting: "Extracting",
  synthesizing: "Synthesizing",
  gap_analysis: "Gap Analysis",
  finalizing: "Finalizing",
  completed: "Completed",
  failed: "Failed",
};

const PHASE_ICONS: Record<DeepResearchPhase, React.ReactNode> = {
  planning: <Target className="w-4 h-4" />,
  searching: <Search className="w-4 h-4" />,
  reading: <BookOpen className="w-4 h-4" />,
  extracting: <Zap className="w-4 h-4" />,
  synthesizing: <FileText className="w-4 h-4" />,
  gap_analysis: <Target className="w-4 h-4" />,
  finalizing: <CheckCircle className="w-4 h-4" />,
  completed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <AlertCircle className="w-4 h-4 text-red-500" />,
};

interface DeepResearchWidgetProps {
  widget: DeepResearchWidgetData;
  onClose: () => void;
  onCreateExpert?: (conversationId: string) => void;
}

async function createExpertFromResearch(jobId: string): Promise<{ expertName: string; conversationId: string } | null> {
  try {
    // Step 1: Get the expert prompt from the deep research API
    const expertRes = await fetch(`/api/jarvis/deep-research-v2/${jobId}/expert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!expertRes.ok) {
      const err = await expertRes.json();
      throw new Error(err.error || "Failed to get expert prompt");
    }
    const { expertName, systemPrompt } = await expertRes.json();

    // Step 2: Create the expert conversation
    const createRes = await fetch("/api/jarvis/conversations/expert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: expertName, systemPrompt }),
    });
    if (!createRes.ok) {
      const err = await createRes.json();
      throw new Error(err.error || "Failed to create expert");
    }
    const expert = await createRes.json();
    return { expertName: expert.title, conversationId: expert.id };
  } catch (err) {
    console.error("Failed to create expert from research:", err);
    return null;
  }
}

export function DeepResearchWidget({ widget, onClose, onCreateExpert }: DeepResearchWidgetProps) {
  const { t } = useI18n();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useBuildToasts();
  const [data, setData] = useState<DeepResearchWidgetData>(widget);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [creatingExpert, setCreatingExpert] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const handleCreateExpert = async () => {
    if (!data.report || creatingExpert) return;
    setCreatingExpert(true);
    try {
      const result = await createExpertFromResearch(widget.jobId);
      if (result) {
        toastSuccess(t("deepResearch.expertCreated", { name: result.expertName }));
        // Call the parent's onCreateExpert with the new conversation ID
        onCreateExpert?.(result.conversationId);
      } else {
        toastError(t("deepResearch.expertCreateFailed"));
      }
    } catch (err) {
      toastError(t("deepResearch.expertCreateFailed"));
    } finally {
      setCreatingExpert(false);
    }
  };

  useEffect(() => {
    // Connect to SSE stream
    const es = new EventSource(`/api/jarvis/deep-research-v2/${widget.jobId}/stream`);
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.addEventListener("phase", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      setData((d) => ({ ...d, phase: payload.phase, progress: payload.progress ?? d.progress }));
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      setData((d) => ({ ...d, progress: payload.progress }));
    });

    es.addEventListener("source", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      setData((d) => ({ ...d, sourcesFound: d.sourcesFound + 1, pagesRead: payload.source.content ? d.pagesRead + 1 : d.pagesRead }));
    });

    es.addEventListener("log", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      setData((d) => ({ ...d, log: [...(d.log ?? []).slice(-50), payload.message] }));
      // Auto-scroll log
      setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 0);
    });

    es.addEventListener("complete", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      setData((d) => ({
        ...d,
        phase: "completed",
        progress: 100,
        report: payload.report,
        sourcesFound: payload.report.sourceCount,
      }));
      setIsConnected(false);
      es.close();
      toastSuccess(t("deepResearch.complete", { topic: widget.topic }));
    });

    es.addEventListener("error", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      setData((d) => ({ ...d, phase: "failed", error: payload.error, progress: d.progress }));
      setIsConnected(false);
      es.close();
      toastError(t("deepResearch.failed", { error: payload.error }));
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setIsConnected(false);
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [widget.jobId, t, toastSuccess, toastError]);

  // Initial data from widget prop
  useEffect(() => {
    setData(widget);
  }, [widget]);

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString();

  if (data.phase === "completed" && data.report) {
    return (
      <Card className="w-full max-w-3xl mx-auto animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between p-4">
          <div>
            <CardTitle className="text-lg font-semibold">{t("deepResearch.reportTitle", { topic: widget.topic })}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("deepResearch.reportMeta", {
                sources: data.report.sourceCount,
                confidence: data.report.confidenceScore,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              <XCircle className="w-4 h-4 mr-1" />
              {t("common.close")}
            </Button>
            {onCreateExpert && (
              <Button variant="default" size="sm" onClick={handleCreateExpert} disabled={creatingExpert}>
                <Zap className="w-4 h-4 mr-1" />
                {creatingExpert ? t("deepResearch.creatingExpert") : t("deepResearch.createExpert")}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="space-y-6">
              {/* Executive Summary */}
              <section className="border-l-4 border-primary pl-4">
                <h4 className="font-medium text-sm uppercase tracking-wide text-muted-foreground mb-2">
                  {t("deepResearch.executiveSummary")}
                </h4>
                <div className="prose prose-sm max-w-none text-foreground">
                  {data.report.executiveSummary.split("\n").map((p, i) => (
                    <p key={i} className="mb-3 leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
              </section>

              {/* Sections */}
              {data.report.sections.map((section, idx) => (
                <section key={idx} className="space-y-3">
                  <h4 className="font-semibold text-base border-b pb-1">
                    {section.heading}
                  </h4>
                  <div className="prose prose-sm max-w-none text-foreground">
                    {section.content.split("\n").map((p, i) => {
                      // Split by citation markers and render inline
                      const parts = p.split(/(\[Source \d+\])/);
                      return (
                        <p key={i} className="mb-2 leading-relaxed">
                          {parts.map((part, idx) => {
                            const match = part.match(/\[Source (\d+)\]/);
                            if (match) {
                              return <sup key={idx} className="text-primary font-mono text-xs ml-0.5">[{match[1]}]</sup>;
                            }
                            return <span key={idx}>{part}</span>;
                          })}
                        </p>
                      );
                    })}
                  </div>
                  {section.citations.length > 0 && (
                    <div className="text-xs text-muted-foreground ml-2">
                      {t("deepResearch.citations", { count: section.citations.length })}
                    </div>
                  )}
                </section>
              ))}

              {/* Gaps & Limitations */}
              <section className="border-l-4 border-amber-500 pl-4 bg-amber-50/50 rounded-r">
                <h4 className="font-medium text-sm uppercase tracking-wide text-amber-700 mb-2">
                  {t("deepResearch.gapsAndLimitations")}
                </h4>
                <p className="text-sm text-amber-800">{data.report.gapsAndLimitations}</p>
              </section>

              {/* Sources list */}
              <details className="group">
                <summary className="cursor-pointer font-medium text-sm text-primary hover:underline flex items-center gap-2">
                  <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                  {t("deepResearch.sources", { count: data.report.sourceCount })}
                </summary>
                <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                  {data.report.sections.flatMap((s) => s.citations).filter((v, i, a) => a.indexOf(v) === i).map((citeId) => {
                    const src = data.report?.sections.flatMap((sec) => sec.citations).find((c) => c === citeId);
                    return null; // Sources not tracked individually in report shape; could enhance later
                  })}
                  <p className="text-sm text-muted-foreground">
                    {t("deepResearch.sourcesNote")}
                  </p>
                </div>
              </details>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  // Loading / in-progress view
  return (
    <Card className="w-full max-w-3xl mx-auto animate-fade-in">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            {PHASE_ICONS[data.phase]}
          </div>
          <div>
            <h3 className="font-semibold">{t("deepResearch.inProgress", { topic: widget.topic })}</h3>
            <p className="text-sm text-muted-foreground">{PHASE_LABELS[data.phase]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-primary">{data.progress}%</span>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 space-y-4">
        {/* Progress bar */}
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, data.progress))}%` }}
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold">{data.sourcesFound}</div>
            <div className="text-xs text-muted-foreground">{t("deepResearch.sourcesFound")}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold">{data.pagesRead}</div>
            <div className="text-xs text-muted-foreground">{t("deepResearch.pagesRead")}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold">{isConnected ? <Loader2 className="w-5 h-5 mx-auto animate-spin text-primary" /> : <AlertCircle className="w-5 h-5 mx-auto text-amber-500" />}</div>
            <div className="text-xs text-muted-foreground">{isConnected ? t("deepResearch.connected") : t("deepResearch.disconnected")}</div>
          </div>
        </div>

        {/* Current query */}
        {data.currentQuery && (
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-primary mb-1">
              <Search className="w-4 h-4" />
              <span className="font-medium">{t("deepResearch.currentQuery")}</span>
            </div>
            <p className="text-sm text-foreground font-mono">{data.currentQuery}</p>
          </div>
        )}

        {/* Log */}
        <div className="border rounded-lg bg-muted/30">
          <div className="px-3 py-2 border-b text-sm font-medium text-muted-foreground">
            {t("deepResearch.activityLog")}
          </div>
          <ScrollArea className="h-48 pr-2">
            <div ref={logRef} className="p-3 space-y-1 font-mono text-xs text-foreground">
              {(data.log ?? []).map((entry, i) => (
                <div key={i} className="text-muted-foreground/80">{entry}</div>
              ))}
              {(data.log ?? []).length === 0 && <div className="text-muted-foreground">{t("deepResearch.waiting")}</div>}
            </div>
          </ScrollArea>
        </div>

        {data.phase === "failed" && data.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            {t("deepResearch.error", { error: data.error })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DeepResearchWidget;