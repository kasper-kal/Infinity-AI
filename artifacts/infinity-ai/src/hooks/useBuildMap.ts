/**
 * useBuildMap Hook
 * React hook for interacting with the Visual Build Map API
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/lib/i18n";

export type BuildMapNodeType =
  | "feature"
  | "component"
  | "page"
  | "api"
  | "integration"
  | "test"
  | "doc"
  | "database"
  | "model"
  | "config"
  | "deployment";

export type BuildMapNodeStatus =
  | "planned"
  | "in-progress"
  | "review"
  | "done"
  | "blocked"
  | "archived";

export type BuildMapEdgeType =
  | "depends-on"
  | "data-flow"
  | "user-flow"
  | "parent-child"
  | "related-to"
  | "blocks";

export type BuildMapAssignee = "human" | "agent" | "unassigned";

export type BuildMapLayoutAlgorithm =
  | "hierarchical"
  | "force-directed"
  | "circular"
  | "manual";

export interface BuildMapPosition {
  x: number;
  y: number;
}

export interface BuildMapNode {
  id: string;
  type: BuildMapNodeType;
  title: string;
  description?: string;
  status: BuildMapNodeStatus;
  priority: number;
  assignee: BuildMapAssignee;
  files: string[];
  tags: string[];
  estimate?: number;
  actualTime?: number;
  dependencies: string[];
  dependents: string[];
  position?: BuildMapPosition;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface BuildMapEdge {
  id: string;
  source: string;
  target: string;
  type: BuildMapEdgeType;
  label?: string;
  description?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
}

export interface BuildMapViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BuildMapMetadata {
  version: number;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  projectId: string;
  layout: BuildMapLayoutAlgorithm;
  layoutOptions: Record<string, unknown>;
  viewport?: BuildMapViewport;
  stats: Record<string, unknown>;
}

export interface BuildMapGraph {
  id: string;
  nodes: BuildMapNode[];
  edges: BuildMapEdge[];
  metadata: BuildMapMetadata;
}

export interface BuildMapSuggestion {
  id: string;
  projectId: string;
  nodeId?: string;
  targetNodeId?: string;
  type: string;
  title: string;
  description: string;
  confidence: number;
  priority: number;
  autoApply: boolean;
  status: "pending" | "accepted" | "rejected" | "applied";
  appliedAt?: string;
  appliedBy?: string;
  createdAt: string;
}

export interface BuildMapAnalysis {
  summary: string;
  missingTests: string[];
  missingDocs: string[];
  circularDependencies: string[][];
  orphanNodes: string[];
  bottlenecks: string[];
  suggestions: BuildMapSuggestion[];
  analyzedAt: string;
}

export interface UseBuildMapOptions {
  projectId: string;
  autoConnect?: boolean;
  onGraphUpdate?: (graph: BuildMapGraph) => void;
  onSuggestionsUpdate?: (suggestions: BuildMapSuggestion[]) => void;
}

export interface UseBuildMapReturn {
  graph: BuildMapGraph | null;
  suggestions: BuildMapSuggestion[];
  analysis: BuildMapAnalysis | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  // Actions
  fetchGraph: () => Promise<void>;
  createNode: (node: Partial<BuildMapNode>) => Promise<BuildMapNode | null>;
  updateNode: (nodeId: string, updates: Partial<BuildMapNode>) => Promise<BuildMapNode | null>;
  deleteNode: (nodeId: string) => Promise<boolean>;
  createEdge: (edge: Partial<BuildMapEdge>) => Promise<BuildMapEdge | null>;
  deleteEdge: (edgeId: string) => Promise<boolean>;
  runAnalysis: () => Promise<BuildMapAnalysis | null>;
  applyLayout: (algorithm: BuildMapLayoutAlgorithm) => Promise<void>;
  acceptSuggestion: (suggestionId: string) => Promise<boolean>;
  rejectSuggestion: (suggestionId: string) => Promise<boolean>;
  // SSE
  connectSSE: () => void;
  disconnectSSE: () => void;
}

const API_BASE = "/api/infinity/build-map";

export function useBuildMap(options: UseBuildMapOptions): UseBuildMapReturn {
  const { projectId, autoConnect = true, onGraphUpdate, onSuggestionsUpdate } = options;
  const { t } = useI18n();

  const [graph, setGraph] = useState<BuildMapGraph | null>(null);
  const [suggestions, setSuggestions] = useState<BuildMapSuggestion[]>([]);
  const [analysis, setAnalysis] = useState<BuildMapAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const handleError = useCallback((err: unknown, defaultMsg: string) => {
    const message = err instanceof Error ? err.message : defaultMsg;
    setError(message);
    console.error(defaultMsg, err);
    return message;
  }, []);

  // Fetch full graph
  const fetchGraph = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/${projectId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const data = await response.json();
      setGraph(data);
      onGraphUpdate?.(data);
    } catch (err) {
      handleError(err, t("buildMap.errors.fetchGraph"));
    } finally {
      setLoading(false);
    }
  }, [projectId, handleError, onGraphUpdate, t]);

  // Create node
  const createNode = useCallback(async (nodeData: Partial<BuildMapNode>): Promise<BuildMapNode | null> => {
    if (!projectId) return null;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nodeData),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const newNode = await response.json();
      setGraph(prev => prev ? {
        ...prev,
        nodes: [...prev.nodes, newNode],
      } : null);
      return newNode;
    } catch (err) {
      handleError(err, t("buildMap.errors.createNode"));
      return null;
    }
  }, [projectId, handleError, t]);

  // Update node
  const updateNode = useCallback(async (nodeId: string, updates: Partial<BuildMapNode>): Promise<BuildMapNode | null> => {
    if (!projectId) return null;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const updatedNode = await response.json();
      setGraph(prev => prev ? {
        ...prev,
        nodes: prev.nodes.map(n => n.id === nodeId ? updatedNode : n),
      } : null);
      return updatedNode;
    } catch (err) {
      handleError(err, t("buildMap.errors.updateNode"));
      return null;
    }
  }, [projectId, handleError, t]);

  // Delete node
  const deleteNode = useCallback(async (nodeId: string): Promise<boolean> => {
    if (!projectId) return false;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/nodes/${nodeId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      setGraph(prev => prev ? {
        ...prev,
        nodes: prev.nodes.filter(n => n.id !== nodeId),
        edges: prev.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      } : null);
      return true;
    } catch (err) {
      handleError(err, t("buildMap.errors.deleteNode"));
      return false;
    }
  }, [projectId, handleError, t]);

  // Create edge
  const createEdge = useCallback(async (edgeData: Partial<BuildMapEdge>): Promise<BuildMapEdge | null> => {
    if (!projectId) return null;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edgeData),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const newEdge = await response.json();
      setGraph(prev => prev ? {
        ...prev,
        edges: [...prev.edges, newEdge],
      } : null);
      return newEdge;
    } catch (err) {
      handleError(err, t("buildMap.errors.createEdge"));
      return null;
    }
  }, [projectId, handleError, t]);

  // Delete edge
  const deleteEdge = useCallback(async (edgeId: string): Promise<boolean> => {
    if (!projectId) return false;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/edges/${edgeId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      setGraph(prev => prev ? {
        ...prev,
        edges: prev.edges.filter(e => e.id !== edgeId),
      } : null);
      return true;
    } catch (err) {
      handleError(err, t("buildMap.errors.deleteEdge"));
      return false;
    }
  }, [projectId, handleError, t]);

  // Run AI analysis
  const runAnalysis = useCallback(async (): Promise<BuildMapAnalysis | null> => {
    if (!projectId) return null;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/analyze`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const result = await response.json();
      setAnalysis(result);

      // Update suggestions
      if (result.suggestions) {
        setSuggestions(result.suggestions);
        onSuggestionsUpdate?.(result.suggestions);
      }
      return result;
    } catch (err) {
      handleError(err, t("buildMap.errors.runAnalysis"));
      return null;
    }
  }, [projectId, handleError, onSuggestionsUpdate, t]);

  // Apply layout
  const applyLayout = useCallback(async (algorithm: BuildMapLayoutAlgorithm): Promise<void> => {
    if (!projectId) return;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ algorithm }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      // Refetch graph to get new positions
      await fetchGraph();
    } catch (err) {
      handleError(err, t("buildMap.errors.applyLayout"));
    }
  }, [projectId, handleError, fetchGraph, t]);

  // Accept suggestion
  const acceptSuggestion = useCallback(async (suggestionId: string): Promise<boolean> => {
    if (!projectId) return false;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/suggestions/${suggestionId}/accept`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      setSuggestions(prev => prev.map(s =>
        s.id === suggestionId ? { ...s, status: "accepted" as const, appliedAt: new Date().toISOString() } : s
      ));
      return true;
    } catch (err) {
      handleError(err, t("buildMap.errors.acceptSuggestion"));
      return false;
    }
  }, [projectId, handleError, t]);

  // Reject suggestion
  const rejectSuggestion = useCallback(async (suggestionId: string): Promise<boolean> => {
    if (!projectId) return false;

    try {
      const response = await fetch(`${API_BASE}/${projectId}/suggestions/${suggestionId}/reject`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      setSuggestions(prev => prev.map(s =>
        s.id === suggestionId ? { ...s, status: "rejected" as const, appliedAt: new Date().toISOString() } : s
      ));
      return true;
    } catch (err) {
      handleError(err, t("buildMap.errors.rejectSuggestion"));
      return false;
    }
  }, [projectId, handleError, t]);

  // SSE Connection
  const connectSSE = useCallback(() => {
    if (!projectId || eventSourceRef.current) return;

    const eventSource = new EventSource(`${API_BASE}/${projectId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
      reconnectAttempts.current = 0;
    };

    eventSource.addEventListener("graph", (event) => {
      const data = JSON.parse(event.data);
      setGraph(data);
      onGraphUpdate?.(data);
    });

    eventSource.addEventListener("graph:update", (event) => {
      const data = JSON.parse(event.data);
      setGraph(data);
      onGraphUpdate?.(data);
    });

    eventSource.onerror = () => {
      setConnected(false);
      eventSource.close();
      eventSourceRef.current = null;

      // Reconnect with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimeoutRef.current = setTimeout(connectSSE, delay);
      }
    };
  }, [projectId, onGraphUpdate]);

  const disconnectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setConnected(false);
  }, []);

  // Initial fetch and auto-connect
  useEffect(() => {
    fetchGraph();
    if (autoConnect) {
      connectSSE();
    }
    return () => {
      disconnectSSE();
    };
  }, [projectId, fetchGraph, autoConnect, connectSSE, disconnectSSE]);

  return {
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
    connectSSE,
    disconnectSSE,
  };
}