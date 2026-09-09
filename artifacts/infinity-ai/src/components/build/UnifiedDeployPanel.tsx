/**
 * Unified Deploy Panel — Phase 12: Multi-Artifact Support
 *
 * Deploys ALL of a project's artifacts (web + mobile + slides + api + cli +
 * extension) as a single orchestrated action, showing one aggregated status
 * per artifact. Backed by /api/infinity/unified-deploy.
 */

import React, { useState, useCallback, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Rocket, Globe, RefreshCw, CheckCircle2, XCircle, Clock, Wrench } from "lucide-react";

export interface UnifiedArtifact {
  artifactId: string;
  type: string;
  name: string;
  target: string;
  targetOptions?: string[];
  status: "queued" | "deploying" | "succeeded" | "failed" | "manual" | "skipped";
  url?: string;
  error?: string;
  message?: string;
  logs?: string[];
}

interface UnifiedDeploymentState {
  id?: string;
  status: "idle" | "deploying" | "succeeded" | "partial" | "failed";
  artifacts: UnifiedArtifact[];
  pollMs: number;
}

const STATUS_STYLE: Record<UnifiedArtifact["status"], string> = {
  queued: "bg-gray-500/15 text-gray-400",
  deploying: "bg-brand-500/15 text-brand-400",
  succeeded: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
  manual: "bg-amber-500/15 text-amber-400",
  skipped: "bg-gray-500/15 text-gray-400",
};

const STATUS_ICON: Record<UnifiedArtifact["status"], React.ReactNode> = {
  queued: <Clock className="w-3.5 h-3.5" />,
  deploying: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
  succeeded: <CheckCircle2 className="w-3.5 h-3.5" />,
  failed: <XCircle className="w-3.5 h-3.5" />,
  manual: <Wrench className="w-3.5 h-3.5" />,
  skipped: <Clock className="w-3.5 h-3.5" />,
};

export const UnifiedDeployPanel: React.FC<{ projectId: string; projectPath?: string }> = ({ projectId, projectPath }) => {
  const { t } = useI18n();
  const [deploy, setDeploy] = useState<UnifiedDeploymentState>({
    status: "idle",
    artifacts: [],
    pollMs: 0,
  });
  const [artifactTypes, setArtifactTypes] = useState<Array<{ id: string; name: string; icon: string; deployTargets: string[]; defaultDeployTarget: string }>>([]);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Load artifact types on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/api/infinity/unified-deploy/artifact-types")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.artifactTypes) {
          setArtifactTypes(data.artifactTypes);
          const defaults: Record<string, string> = {};
          for (const at of data.artifactTypes) defaults[at.id] = at.defaultDeployTarget || at.deployTargets[0];
          setSelectedTargets(defaults);
        }
      })
      .catch(() => { /* server may be offline — show nothing */ });
    return () => { cancelled = true; };
  }, []);

  const pollDeployment = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/infinity/unified-deploy/${id}`);
      const data = await res.json();
      if (!data?.deployment) return;
      const record = data.deployment;
      const artifacts: UnifiedArtifact[] = record.artifacts;
      const overall = record.status as UnifiedDeploymentState["status"];
      const anyActive = artifacts.some((a) => a.status === "queued" || a.status === "deploying");
      const nextStatus = anyActive ? "deploying" : overall;
      setDeploy((prev) => ({ ...prev, status: nextStatus, artifacts, pollMs: anyActive ? 1500 : 0 }));
    } catch {
      setDeploy((prev) => ({ ...prev, pollMs: 0 }));
    }
  }, []);

  // Poll while a deployment is running
  useEffect(() => {
    if (!deploy.id || deploy.pollMs === 0) return;
    const handle = setTimeout(() => pollDeployment(deploy.id!), deploy.pollMs);
    return () => clearTimeout(handle);
  }, [deploy.pollMs, deploy.id, pollDeployment]);

  const deployAll = async () => {
    setError(null);
    setDeploy((prev) => ({ ...prev, status: "deploying", artifacts: [], pollMs: 0 }));
    try {
      const res = await fetch("/api/infinity/unified-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectPath: projectPath || (projectId === "default" ? process.cwd() : `/workspaces/${projectId}`),
          artifacts: artifactTypes.map((at) => ({ type: at.id, name: at.name, target: selectedTargets[at.id] || at.defaultDeployTarget })),
        }),
      });
      const data = await res.json();
      if (!data?.deployment) {
        setError(data?.error || "Failed to start unified deployment");
        setDeploy((prev) => ({ ...prev, status: "idle" }));
        return;
      }
      setDeploy({
        id: data.deployment.id,
        status: "deploying",
        artifacts: data.deployment.artifacts,
        pollMs: 1500,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to start unified deployment");
      setDeploy((prev) => ({ ...prev, status: "idle" }));
    }
  };

  const running = deploy.status === "deploying";
  const done = deploy.status === "succeeded" || deploy.status === "partial" || deploy.status === "failed";

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4" />
          {t("unifiedDeploy.title")}
        </CardTitle>
        {running && (
          <Badge className="bg-brand-500/15 text-brand-400 gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {t("unifiedDeploy.deploying")}
          </Badge>
        )}
        {done && (
          <Badge className={deploy.status === "succeeded" ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}>
            {deploy.status === "succeeded" ? t("unifiedDeploy.succeeded") : t("unifiedDeploy.partial")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("unifiedDeploy.description")}</p>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</div>
        )}

        {/* Artifact type + target selection */}
        {artifactTypes.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {artifactTypes.map((at) => (
              <div key={at.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <span className="text-sm flex items-center gap-2 min-w-0">
                  <span>{at.icon}</span>
                  <span className="truncate">{at.name}</span>
                </span>
                <select
                  value={selectedTargets[at.id] || at.defaultDeployTarget}
                  onChange={(e) => setSelectedTargets((prev) => ({ ...prev, [at.id]: e.target.value }))}
                  className="bg-background text-xs border border-border rounded px-1.5 py-1 text-foreground"
                >
                  {at.deployTargets.map((target) => (
                    <option key={target} value={target}>{target}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {/* Deployment results */}
        {deploy.artifacts.length > 0 && (
          <ScrollArea className="h-64 rounded-md border border-border/60">
            <div className="divide-y divide-border/60">
              {deploy.artifacts.map((a) => (
                <div key={a.artifactId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="text-xs text-muted-foreground">{a.type}</span>
                    </div>
                    {a.status === "manual" && a.message && (
                      <p className="text-xs text-amber-400/80 mt-0.5 line-clamp-2">{a.message}</p>
                    )}
                    {a.status === "failed" && a.error && (
                      <p className="text-xs text-red-400/80 mt-0.5">{a.error}</p>
                    )}
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-brand-400 hover:underline mt-0.5 inline-flex items-center gap-1">
                        <Globe className="w-3 h-3" /> {a.url}
                      </a>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge className={`gap-1 ${STATUS_STYLE[a.status]}`}>
                      {STATUS_ICON[a.status]}
                      {a.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{a.target}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {deploy.artifacts.length === 0 && !running && artifactTypes.length > 0 && (
          <div className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-md">
            {t("unifiedDeploy.empty")}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={deployAll} disabled={running} className="w-full gap-2">
          <Rocket className="w-4 h-4" />
          {running ? t("unifiedDeploy.deploying") : t("unifiedDeploy.deployAll")}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default UnifiedDeployPanel;