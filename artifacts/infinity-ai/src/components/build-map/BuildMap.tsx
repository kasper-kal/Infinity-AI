/**
 * BuildMap Component
 * Main visual build map component - interactive graph of the entire project
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ScrollArea, Tooltip } from "@/components/ui";
import { useBuildMap, type BuildMapGraph, type BuildMapNode, type BuildMapEdge, type BuildMapLayoutAlgorithm, type BuildMapNodeType, type BuildMapNodeStatus, type BuildMapAssignee } from "@/hooks/useBuildMap";
import { BuildMapNode } from "./BuildMapNode";
import { BuildMapEdges } from "./BuildMapEdge";
import { BuildMapToolbar } from "./BuildMapToolbar";
import { BuildMapSidePanel } from "./BuildMapSidePanel";

interface BuildMapProps {
  projectId: string;
  className?: string;
  height?: string;
  onNodeSelect?: (node: BuildMapNode) => void;
  onEdgeSelect?: (edge: BuildMapEdge) => void;
}

export const BuildMap: React.FC<BuildMapProps> = ({
  projectId,
  className,
  height = "100%",
  onNodeSelect,
  onEdgeSelect,
}) => {
  const { t } = useI18n();

  // State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [filters, setFilters] = useState({
    types: [] as BuildMapNodeType[],
    statuses: [] as BuildMapNodeStatus[],
    assignees: [] as BuildMapAssignee[],
    search: "",
  });
  const [layout, setLayout] = useState<BuildMapLayoutAlgorithm>("hierarchical");

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Use hook for data
  const {
    graph,
    suggestions,
    analysis,
    loading,
    error,
    connected,
    fetchGraph,
    createNode,
    updateNode,
    deleteNode,
    createEdge,
    deleteEdge,
    runAnalysis,
    applyLayout,
    acceptSuggestion,
    rejectSuggestion,
  } = useBuildMap({
    projectId,
    autoConnect: true,
    onGraphUpdate: (newGraph) => {
      // Graph updated via SSE
    },
    onSuggestionsUpdate: (newSuggestions) => {
      // Suggestions updated
    },
  });

  // Derived state
  const selectedNode = graph?.nodes.find(n => n.id === selectedNodeId) || null;
  const selectedEdge = graph?.edges.find(e => e.id === selectedEdgeId) || null;

  // Filter nodes and edges
  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter(node => {
      // Type filter
      if (filters.types.length > 0 && !filters.types.includes(node.type)) return false;
      // Status filter
      if (filters.statuses.length > 0 && !filters.statuses.includes(node.status)) return false;
      // Assignee filter
      if (filters.assignees.length > 0 && !filters.assignees.includes(node.assignee)) return false;
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesTitle = node.title.toLowerCase().includes(searchLower);
        const matchesDescription = node.description?.toLowerCase().includes(searchLower);
        const matchesTags = node.tags.some(tag => tag.toLowerCase().includes(searchLower));
        const matchesFiles = node.files.some(file => file.toLowerCase().includes(searchLower));
        if (!matchesTitle && !matchesDescription && !matchesTags && !matchesFiles) return false;
      }
      return true;
    });
  }, [graph, filters]);

  const filteredEdges = useMemo(() => {
    if (!graph) return [];
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    return graph.edges.filter(edge =>
      nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );
  }, [graph, filteredNodes]);

  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.max(0.25, Math.min(2, prev + delta)));
  }, []);

  // Handle pan start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1 && !(e.button === 0 && e.shiftKey)) return; // Middle click or Shift+Left
    if (e.target !== e.currentTarget) return; // Only on background

    e.preventDefault();
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.currentTarget as HTMLDivElement).style.cursor = "grabbing";
  }, [pan]);

  // Handle pan move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  }, []);

  // Handle pan end
  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    if (containerRef.current) {
      containerRef.current.style.cursor = "grab";
    }
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "=":
        case "+":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom(prev => Math.min(2, prev + 0.2));
          }
          break;
        case "-":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom(prev => Math.max(0.25, prev - 0.2));
          }
          break;
        case "0":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }
          break;
        case "f":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // Focus on selected node or center
            if (selectedNode && selectedNode.position) {
              const container = containerRef.current;
              if (container) {
                const rect = container.getBoundingClientRect();
                setPan({
                  x: rect.width / 2 - selectedNode.position.x * zoom,
                  y: rect.height / 2 - selectedNode.position.y * zoom,
                });
              }
            }
          }
          break;
        case "Escape":
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNode, zoom]);

  // Toolbar actions
  const handleLayoutChange = useCallback((newLayout: BuildMapLayoutAlgorithm) => {
    setLayout(newLayout);
    applyLayout(newLayout);
  }, [applyLayout]);

  const handleAnalyze = useCallback(async () => {
    await runAnalysis();
  }, [runAnalysis]);

  const handleCenterView = useCallback(() => {
    if (!graph || !containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    // Calculate bounds of all nodes
    const nodesWithPos = filteredNodes.filter(n => n.position);
    if (nodesWithPos.length === 0) {
      setPan({ x: rect.width / 2, y: rect.height / 2 });
      setZoom(1);
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodesWithPos.forEach(node => {
      if (node.position) {
        minX = Math.min(minX, node.position.x);
        maxX = Math.max(maxX, node.position.x + 220);
        minY = Math.min(minY, node.position.y);
        maxY = Math.max(maxY, node.position.y + 150);
      }
    });

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const padding = 100;

    const scaleX = (rect.width - padding * 2) / graphWidth;
    const scaleY = (rect.height - padding * 2) / graphHeight;
    const newZoom = Math.min(scaleX, scaleY, 1);

    setZoom(newZoom);
    setPan({
      x: rect.width / 2 - (minX + graphWidth / 2) * newZoom,
      y: rect.height / 2 - (minY + graphHeight / 2) * newZoom,
    });
  }, [graph, filteredNodes, zoom]);

  const handleExport = useCallback(() => {
    if (!graph) return;
    const dataStr = JSON.stringify(graph, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `build-map-${projectId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [graph, projectId]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const importedGraph = JSON.parse(text);
        // Would need API call to import
        console.log("Import graph:", importedGraph);
      } catch (err) {
        console.error("Import failed:", err);
      }
    };
    input.click();
  }, []);

  const handleCreateNode = useCallback(() => {
    // Open a dialog or create a default node
    const newNode = {
      type: "component" as BuildMapNodeType,
      title: t("buildMap.newNode"),
      description: "",
      status: "planned" as BuildMapNodeStatus,
      priority: 5,
      assignee: "unassigned" as BuildMapAssignee,
      files: [],
      tags: [],
      dependencies: [],
      dependents: [],
    };
    createNode(newNode);
  }, [createNode, t]);

  const handleCreateFeature = useCallback(() => {
    const newNode = {
      type: "feature" as BuildMapNodeType,
      title: t("buildMap.newFeature"),
      description: "",
      status: "planned" as BuildMapNodeStatus,
      priority: 7,
      assignee: "unassigned" as BuildMapAssignee,
      files: [],
      tags: ["feature"],
      dependencies: [],
      dependents: [],
    };
    createNode(newNode);
  }, [createNode, t]);

  const handleNodeSelect = useCallback((node: BuildMapNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setSidePanelOpen(true);
    onNodeSelect?.(node);
  }, [onNodeSelect]);

  const handleEdgeSelect = useCallback((edge: BuildMapEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setSidePanelOpen(true);
    onEdgeSelect?.(edge);
  }, [onEdgeSelect]);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const handleNodeUpdate = useCallback((nodeId: string, updates: Partial<BuildMapNode>) => {
    updateNode(nodeId, updates);
  }, [updateNode]);

  const handleNodeDelete = useCallback((nodeId: string) => {
    deleteNode(nodeId);
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  }, [deleteNode, selectedNodeId]);

  const handleEdgeUpdate = useCallback((edgeId: string, updates: Partial<BuildMapEdge>) => {
    updateEdge(edgeId, updates);
  }, []);

  const handleEdgeDelete = useCallback((edgeId: string) => {
    deleteEdge(edgeId);
    if (selectedEdgeId === edgeId) {
      setSelectedEdgeId(null);
    }
  }, [deleteEdge, selectedEdgeId]);

  // Dummy updateEdge - would need to be added to hook
  const updateEdge = useCallback(async (edgeId: string, updates: Partial<BuildMapEdge>) => {
    // For now, just log - would need API endpoint
    console.log("Update edge:", edgeId, updates);
  }, []);

  const handleSuggestionAccept = useCallback((suggestionId: string) => {
    acceptSuggestion(suggestionId);
  }, [acceptSuggestion]);

  const handleSuggestionReject = useCallback((suggestionId: string) => {
    rejectSuggestion(suggestionId);
  }, [rejectSuggestion]);

  // Transform for SVG
  const transform = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;

  if (!projectId) {
    return (
      <div className={cn("flex flex-col h-full items-center justify-center text-muted-foreground", className)}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4 opacity-50">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 9h6v6H9z"/>
        </svg>
        <p className="text-center">{t("buildMap.noProject")}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-background", className)} style={{ height }}>
      {/* Toolbar */}
      <div className="shrink-0 p-3 border-b border-border-primary bg-bg-elevated/50 backdrop-blur-sm">
        <BuildMapToolbar
          layout={layout}
          onLayoutChange={handleLayoutChange}
          onAnalyze={handleAnalyze}
          onCenterView={handleCenterView}
          onExport={handleExport}
          onImport={handleImport}
          onCreateNode={handleCreateNode}
          onCreateFeature={handleCreateFeature}
          filters={filters}
          onFiltersChange={setFilters}
          suggestionsCount={suggestions.filter(s => s.status === "pending").length}
          loading={loading}
          connected={connected}
          zoom={zoom}
          onZoomChange={setZoom}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden cursor-grab"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleBackgroundClick}
        >
          {/* Background grid */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `linear-gradient(var(--border-primary) 1px, transparent 1px), linear-gradient(90deg, var(--border-primary) 1px, transparent 1px)`,
              backgroundSize: `${40 / zoom}px ${40 / zoom}px`,
              transform,
              transformOrigin: "0 0",
            }}
          />

          {/* SVG for edges */}
          <svg
            ref={svgRef}
            className="absolute inset-0 overflow-visible"
            style={{ transform, transformOrigin: "0 0" }}
          >
            <defs>
              <linearGradient id="brand-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--brand-500)" />
                <stop offset="100%" stopColor="var(--brand-400)" />
              </linearGradient>
              {/* Arrowhead markers */}
              <marker id="arrowhead-triangle" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="var(--brand-400)" />
              </marker>
              <marker id="arrowhead-diamond" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
                <polygon points="0 4, 6 0, 12 4, 6 8" fill="var(--red-400)" />
              </marker>
            </defs>
            <BuildMapEdges
              edges={filteredEdges}
              nodes={filteredNodes}
              selectedEdgeId={selectedEdgeId}
              zoom={zoom}
              onEdgeSelect={handleEdgeSelect}
              showLabels={zoom > 0.4}
            />
          </svg>

          {/* Nodes */}
          <div
            className="absolute inset-0 overflow-visible"
            style={{ transform, transformOrigin: "0 0" }}
          >
            {filteredNodes.map(node => (
              <BuildMapNode
                key={node.id}
                node={node}
                selected={selectedNodeId === node.id}
                zoom={zoom}
                onSelect={handleNodeSelect}
                onDrag={(nodeId, deltaX, deltaY) => {
                  updateNode(nodeId, {
                    position: {
                      x: (node.position?.x || 0) + deltaX,
                      y: (node.position?.y || 0) + deltaY,
                    },
                  });
                }}
                onDragEnd={(nodeId, x, y) => {
                  // Position already updated during drag
                }}
                onDoubleClick={(node) => {
                  // Could open detail view
                }}
                showDetails={zoom > 0.6}
              />
            ))}
          </div>

          {/* Loading overlay */}
          {loading && !graph && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-muted-foreground">{t("buildMap.loading")}</p>
              </div>
            </div>
          )}

          {/* Error overlay */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
              <div className="p-6 text-center max-w-md">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 text-red-400">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p className="text-red-400 mb-2">{t("buildMap.error")}</p>
                <p className="text-sm text-muted-foreground mb-4">{error}</p>
                <Button onClick={fetchGraph} variant="primary" size="sm">
                  {t("buildMap.retry")}
                </Button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && graph && filteredNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-5">
              <div className="text-center p-8">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 opacity-50">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M9 9h6v6H9z"/>
                </svg>
                <p className="text-muted-foreground mb-2">{t("buildMap.emptyTitle")}</p>
                <p className="text-sm text-muted-foreground mb-4">{t("buildMap.emptyDescription")}</p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={handleCreateNode} variant="primary" size="sm">
                    {t("buildMap.addNode")}
                  </Button>
                  <Button onClick={handleCreateFeature} variant="secondary" size="sm">
                    {t("buildMap.addFeature")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        {sidePanelOpen && (
          <div className="w-80 shrink-0 border-l border-border-primary bg-bg-elevated/95 backdrop-blur-xl flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-border-primary">
              <h3 className="font-medium">{t("buildMap.details")}</h3>
              <IconButton
                onClick={() => setSidePanelOpen(false)}
                aria-label={t("common.close")}
                variant="ghost"
                size="sm"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </IconButton>
            </div>
            <BuildMapSidePanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              suggestions={suggestions}
              analysis={analysis}
              onNodeUpdate={handleNodeUpdate}
              onNodeDelete={handleNodeDelete}
              onEdgeUpdate={handleEdgeUpdate}
              onEdgeDelete={handleEdgeDelete}
              onSuggestionAccept={handleSuggestionAccept}
              onSuggestionReject={handleSuggestionReject}
              onClose={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setSidePanelOpen(false);
              }}
            />
          </div>
        )}

        {/* Side panel toggle when closed */}
        {!sidePanelOpen && (selectedNode || selectedEdge) && (
          <div className="absolute right-3 bottom-3 z-10">
            <Tooltip content={t("buildMap.showDetails")}>
              <Button
                onClick={() => setSidePanelOpen(true)}
                variant="primary"
                size="sm"
                className="shadow-lg"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12h16M12 4v16"/>
                </svg>
              </Button>
            </Tooltip>
          </div>
        )}

        {/* Mini-map placeholder */}
        <div className="absolute bottom-3 left-3 w-40 h-30 glass-strong border border-border-primary rounded-lg overflow-hidden opacity-60">
          <div className="w-full h-full bg-gradient-to-br from-muted to-bg-elevated" />
        </div>
      </div>
    </div>
  );
};

function IconButton({
  onClick,
  ariaLabel,
  variant = "ghost",
  size = "sm",
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  variant?: "ghost" | "primary" | "secondary" | "outline" | "destructive";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}) {
  const { t } = useI18n(); // This won't work here - IconButton needs to be from ui
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
      style={{
        width: size === "sm" ? 32 : size === "md" ? 40 : 48,
        height: size === "sm" ? 32 : size === "md" ? 40 : 48,
      }}
    >
      {children}
    </button>
  );
}

export default BuildMap;