/**
 * BuildMapSidePanel Component
 * Side panel for node/edge details, suggestions, and analysis
 */

import React, { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { Button, IconButton, Tabs, Tab, Input, Select, SelectOption, Textarea, Checkbox, Label, ScrollArea } from "@/components/ui";
import {
  type BuildMapNode,
  type BuildMapEdge,
  type BuildMapSuggestion,
  type BuildMapAnalysis,
  type BuildMapNodeType,
  type BuildMapNodeStatus,
  type BuildMapAssignee,
  type BuildMapEdgeType,
} from "@/hooks/useBuildMap";

interface BuildMapSidePanelProps {
  selectedNode: BuildMapNode | null;
  selectedEdge: BuildMapEdge | null;
  suggestions: BuildMapSuggestion[];
  analysis: BuildMapAnalysis | null;
  onNodeUpdate: (nodeId: string, updates: Partial<BuildMapNode>) => void;
  onNodeDelete: (nodeId: string) => void;
  onEdgeUpdate: (edgeId: string, updates: Partial<BuildMapEdge>) => void;
  onEdgeDelete: (edgeId: string) => void;
  onSuggestionAccept: (suggestionId: string) => void;
  onSuggestionReject: (suggestionId: string) => void;
  onClose: () => void;
  className?: string;
}

const NODE_TYPES: { value: BuildMapNodeType; label: string }[] = [
  { value: "feature", label: "Feature" },
  { value: "component", label: "Component" },
  { value: "page", label: "Page" },
  { value: "api", label: "API" },
  { value: "integration", label: "Integration" },
  { value: "test", label: "Test" },
  { value: "doc", label: "Doc" },
  { value: "database", label: "Database" },
  { value: "model", label: "Model" },
  { value: "config", label: "Config" },
  { value: "deployment", label: "Deployment" },
];

const NODE_STATUSES: { value: BuildMapNodeStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "in-progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
  { value: "archived", label: "Archived" },
];

const ASSIGNEES: { value: BuildMapAssignee; label: string }[] = [
  { value: "human", label: "Human" },
  { value: "agent", label: "Agent" },
  { value: "unassigned", label: "Unassigned" },
];

const EDGE_TYPES: { value: BuildMapEdgeType; label: string }[] = [
  { value: "depends-on", label: "Depends On" },
  { value: "data-flow", label: "Data Flow" },
  { value: "user-flow", label: "User Flow" },
  { value: "parent-child", label: "Parent-Child" },
  { value: "related-to", label: "Related To" },
  { value: "blocks", label: "Blocks" },
];

function StatusBadge({ status }: { status: BuildMapNodeStatus }) {
  const colors: Record<BuildMapNodeStatus, string> = {
    planned: "bg-gray-500/20 text-gray-400",
    "in-progress": "bg-brand-500/20 text-brand-400",
    review: "bg-yellow-500/20 text-yellow-400",
    done: "bg-green-500/20 text-green-400",
    blocked: "bg-red-500/20 text-red-400",
    archived: "bg-gray-500/10 text-gray-500",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", colors[status])}>
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const color = priority >= 8 ? "bg-red-500/20 text-red-400" :
                priority >= 5 ? "bg-yellow-500/20 text-yellow-400" :
                "bg-green-500/20 text-green-400";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-mono font-medium", color)}>
      P{priority}
    </span>
  );
}

function AssigneeBadge({ assignee }: { assignee: BuildMapAssignee }) {
  const colors: Record<BuildMapAssignee, string> = {
    human: "bg-blue-500/20 text-blue-400",
    agent: "bg-purple-500/20 text-purple-400",
    unassigned: "bg-gray-500/20 text-gray-400",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", colors[assignee])}>
      {assignee}
    </span>
  );
}

export const BuildMapSidePanel: React.FC<BuildMapSidePanelProps> = ({
  selectedNode,
  selectedEdge,
  suggestions,
  analysis,
  onNodeUpdate,
  onNodeDelete,
  onEdgeUpdate,
  onEdgeDelete,
  onSuggestionAccept,
  onSuggestionReject,
  onClose,
  className,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"details" | "suggestions" | "analysis">("details");
  const [editing, setEditing] = useState(false);

  // Node details tab
  const renderNodeDetails = () => {
    if (!selectedNode) return null;

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg font-semibold truncate">{selectedNode.title}</span>
              <PriorityBadge priority={selectedNode.priority} />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status={selectedNode.status} />
              <AssigneeBadge assignee={selectedNode.assignee} />
              <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                {selectedNode.type}
              </span>
            </div>
          </div>
          <IconButton onClick={onClose} aria-label={t("common.close")} variant="ghost" size="sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </IconButton>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t("buildMap.description")}
          </label>
          {editing ? (
            <Textarea
              value={selectedNode.description || ""}
              onChange={(e) => onNodeUpdate(selectedNode.id, { description: e.target.value })}
              rows={3}
              className="w-full"
              placeholder={t("buildMap.descriptionPlaceholder")}
            />
          ) : (
            <div className="p-3 bg-bg-elevated rounded-lg border border-border-primary min-h-[60px]">
              {selectedNode.description || (
                <span className="text-muted-foreground italic">{t("buildMap.noDescription")}</span>
              )}
            </div>
          )}
        </div>

        {/* Files */}
        {selectedNode.files.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("buildMap.files")} ({selectedNode.files.length})
            </label>
            <div className="space-y-1 max-h-40 overflow-auto">
              {selectedNode.files.map((file, i) => (
                <div key={i} className="text-xs font-mono text-muted-foreground bg-bg-elevated/50 px-2 py-1 rounded truncate">
                  {file}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t("buildMap.tags")}
          </label>
          <div className="flex flex-wrap gap-1">
            {selectedNode.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
            {selectedNode.tags.length === 0 && (
              <span className="text-xs text-muted-foreground italic">{t("buildMap.noTags")}</span>
            )}
          </div>
        </div>

        {/* Estimate */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("buildMap.estimate")}
            </label>
            {editing ? (
              <Input
                type="number"
                value={selectedNode.estimate || ""}
                onChange={(e) => onNodeUpdate(selectedNode.id, { estimate: parseInt(e.target.value) || undefined })}
                min={0}
                className="w-full"
                placeholder={t("buildMap.estimatePlaceholder")}
              />
            ) : (
              <div className="p-2 bg-bg-elevated rounded-lg border border-border-primary text-sm">
                {selectedNode.estimate ? `${selectedNode.estimate}h` : t("buildMap.notSet")}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("buildMap.actualTime")}
            </label>
            {editing ? (
              <Input
                type="number"
                value={selectedNode.actualTime || ""}
                onChange={(e) => onNodeUpdate(selectedNode.id, { actualTime: parseInt(e.target.value) || undefined })}
                min={0}
                className="w-full"
                placeholder={t("buildMap.actualTimePlaceholder")}
              />
            ) : (
              <div className="p-2 bg-bg-elevated rounded-lg border border-border-primary text-sm">
                {selectedNode.actualTime ? `${selectedNode.actualTime}h` : t("buildMap.notSet")}
              </div>
            )}
          </div>
        </div>

        {/* Dependencies */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t("buildMap.dependencies")} ({selectedNode.dependencies.length})
          </label>
          <div className="space-y-1 max-h-32 overflow-auto">
            {selectedNode.dependencies.map((depId, i) => (
              <div key={i} className="text-xs font-mono text-muted-foreground bg-bg-elevated/50 px-2 py-1 rounded truncate">
                {depId}
              </div>
            ))}
            {selectedNode.dependencies.length === 0 && (
              <span className="text-xs text-muted-foreground italic">{t("buildMap.noDependencies")}</span>
            )}
          </div>
        </div>

        {/* Dependents */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t("buildMap.dependents")} ({selectedNode.dependents.length})
          </label>
          <div className="space-y-1 max-h-32 overflow-auto">
            {selectedNode.dependents.map((depId, i) => (
              <div key={i} className="text-xs font-mono text-muted-foreground bg-bg-elevated/50 px-2 py-1 rounded truncate">
                {depId}
              </div>
            ))}
            {selectedNode.dependents.length === 0 && (
              <span className="text-xs text-muted-foreground italic">{t("buildMap.noDependents")}</span>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t("buildMap.metadata")}
          </label>
          <div className="p-2 bg-bg-elevated rounded-lg border border-border-primary text-xs font-mono max-h-32 overflow-auto">
            <pre>{JSON.stringify(selectedNode.metadata, null, 2)}</pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-border-primary">
          <Button
            onClick={() => setEditing(!editing)}
            variant={editing ? "secondary" : "outline"}
            size="sm"
            className="flex-1"
          >
            {editing ? t("common.save") : t("common.edit")}
          </Button>
          <Button
            onClick={() => onNodeDelete(selectedNode.id)}
            variant="destructive"
            size="sm"
            className="flex-1"
          >
            {t("common.delete")}
          </Button>
        </div>
      </div>
    );
  };

  // Edge details tab
  const renderEdgeDetails = () => {
    if (!selectedEdge) return null;

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold">{selectedEdge.label || selectedEdge.type}</h4>
            <p className="text-sm text-muted-foreground">{selectedEdge.type}</p>
          </div>
          <IconButton onClick={onClose} aria-label={t("common.close")} variant="ghost" size="sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </IconButton>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("buildMap.description")}</label>
          {editing ? (
            <Textarea
              value={selectedEdge.description || ""}
              onChange={(e) => onEdgeUpdate(selectedEdge.id, { description: e.target.value })}
              rows={3}
              className="w-full"
            />
          ) : (
            <div className="p-3 bg-bg-elevated rounded-lg border border-border-primary min-h-[60px]">
              {selectedEdge.description || <span className="text-muted-foreground italic">{t("buildMap.noDescription")}</span>}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("buildMap.edgeType")}</label>
          <Select
            value={selectedEdge.type}
            onValueChange={(value) => onEdgeUpdate(selectedEdge.id, { type: value as BuildMapEdgeType })}
            disabled={!editing}
          >
            {EDGE_TYPES.map(type => (
              <SelectOption key={type.value} value={type.value}>{type.label}</SelectOption>
            ))}
          </Select>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border-primary">
          <Button
            onClick={() => setEditing(!editing)}
            variant={editing ? "secondary" : "outline"}
            size="sm"
            className="flex-1"
          >
            {editing ? t("common.save") : t("common.edit")}
          </Button>
          <Button
            onClick={() => onEdgeDelete(selectedEdge.id)}
            variant="destructive"
            size="sm"
            className="flex-1"
          >
            {t("common.delete")}
          </Button>
        </div>
      </div>
    );
  };

  // Suggestions tab
  const renderSuggestions = () => {
    if (suggestions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4 opacity-50">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/>
          </svg>
          <p className="text-center">{t("buildMap.noSuggestions")}</p>
        </div>
      );
    }

    return (
      <ScrollArea className="h-full">
        <div className="space-y-3">
          {suggestions.map(suggestion => (
            <div
              key={suggestion.id}
              className={cn(
                "p-3 rounded-lg border transition-colors",
                suggestion.status === "accepted" && "border-green-500/30 bg-green-500/10",
                suggestion.status === "rejected" && "border-red-500/30 bg-red-500/10 opacity-60",
                suggestion.status === "pending" && "border-brand-500/30 bg-brand-500/10",
                suggestion.status === "applied" && "border-blue-500/30 bg-blue-500/10"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h5 className="font-medium">{suggestion.title}</h5>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                      {suggestion.type}
                    </span>
                    <PriorityBadge priority={suggestion.priority} />
                    {suggestion.autoApply && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                        {t("buildMap.autoApply")}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{suggestion.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{t("buildMap.confidence")}: {suggestion.confidence}%</span>
                    <span>{t("buildMap.status")}: {suggestion.status}</span>
                  </div>
                </div>
                {suggestion.status === "pending" && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      onClick={() => onSuggestionAccept(suggestion.id)}
                      variant="primary"
                      size="sm"
                      className="h-8 px-3"
                    >
                      {t("buildMap.accept")}
                    </Button>
                    <Button
                      onClick={() => onSuggestionReject(suggestion.id)}
                      variant="outline"
                      size="sm"
                      className="h-8 px-3"
                    >
                      {t("buildMap.reject")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  };

  // Analysis tab
  const renderAnalysis = () => {
    if (!analysis) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <Button onClick={() => { /* trigger analysis */ }} variant="primary" size="sm">
            {t("buildMap.runAnalysis")}
          </Button>
        </div>
      );
    }

    return (
      <ScrollArea className="h-full">
        <div className="space-y-4">
          <div>
            <h5 className="font-medium mb-2">{t("buildMap.analysisSummary")}</h5>
            <p className="text-sm text-muted-foreground">{analysis.summary}</p>
          </div>

          {analysis.missingTests.length > 0 && (
            <div>
              <h5 className="font-medium mb-2 text-orange-400">{t("buildMap.missingTests")} ({analysis.missingTests.length})</h5>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {analysis.missingTests.map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.missingDocs.length > 0 && (
            <div>
              <h5 className="font-medium mb-2 text-yellow-400">{t("buildMap.missingDocs")} ({analysis.missingDocs.length})</h5>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {analysis.missingDocs.map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.circularDependencies.length > 0 && (
            <div>
              <h5 className="font-medium mb-2 text-red-400">{t("buildMap.circularDependencies")} ({analysis.circularDependencies.length})</h5>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {analysis.circularDependencies.map((cycle, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9 9 9 0 0 1 9 9z"/>
                      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9 9 9 0 0 1 9 9z"/>
                    </svg>
                    {cycle.join(" → ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.orphanNodes.length > 0 && (
            <div>
              <h5 className="font-medium mb-2 text-gray-400">{t("buildMap.orphanNodes")} ({analysis.orphanNodes.length})</h5>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {analysis.orphanNodes.map((node, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                    </svg>
                    {node}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.bottlenecks.length > 0 && (
            <div>
              <h5 className="font-medium mb-2 text-red-400">{t("buildMap.bottlenecks")} ({analysis.bottlenecks.length})</h5>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {analysis.bottlenecks.map((node, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    {node}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ScrollArea>
    );
  };

  const tabs = [
    { id: "details", label: t("buildMap.details"), icon: <DetailsIcon /> },
    { id: "suggestions", label: `${t("buildMap.suggestions")} (${suggestions.filter(s => s.status === "pending").length})`, icon: <SuggestionsIcon /> },
    { id: "analysis", label: t("buildMap.analysis"), icon: <AnalysisIcon /> },
  ];

  return (
    <div className={cn("flex flex-col h-full glass-strong border-l border-border-primary", className)}>
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
        variant="pills"
        className="p-3 border-b border-border-primary"
      />

      <div className="flex-1 overflow-hidden">
        {activeTab === "details" && (selectedNode ? renderNodeDetails() : selectedEdge ? renderEdgeDetails() : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4 opacity-50">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M9 9h6v6H9z"/>
            </svg>
            <p className="text-center">{t("buildMap.selectNodeOrEdge")}</p>
          </div>
        ))}
        {activeTab === "suggestions" && renderSuggestions()}
        {activeTab === "analysis" && renderAnalysis()}
      </div>
    </div>
  );
};

function DetailsIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>; }
function SuggestionsIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/></svg>; }
function AnalysisIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>; }

export default BuildMapSidePanel;