/**
 * Visual Build Map — AI-Managed Roadmap Graph Data Model
 *
 * Independent from PHASES.md, this maintains a living visual roadmap as a node-based graph:
 * - Nodes = features, components, pages, APIs, integrations, tests, docs, database, models, config, deployments
 * - Edges = dependencies, data flow, user flows, architectural relationships
 * - AI updates autonomously as it works
 */

import { z } from "zod";

/**
 * Node Types in the Build Map
 */
export const BuildMapNodeType = z.enum([
  "feature",       // User-facing feature (e.g., "User Authentication", "Dashboard")
  "component",     // UI Component (e.g., "Button", "DataTable", "Header")
  "page",          // Page/Route (e.g., "/dashboard", "/settings", "/login")
  "api",           // API endpoint (e.g., "POST /api/auth/login", "GET /api/users")
  "integration",   // External integration (e.g., "Stripe", "GitHub OAuth", "Linear")
  "test",          // Test file/suite (e.g., "auth.test.ts", "e2e: checkout flow")
  "doc",           // Documentation (e.g., "README.md", "API docs", "Architecture Decision")
  "database",      // Database schema/table (e.g., "users table", "migrations")
  "model",         // AI/LLM model config (e.g., "Claude 3.5 Sonnet", "local embedding")
  "config",        // Configuration (e.g., "tsconfig.json", "vite.config.ts", "tailwind.config")
  "deployment",    // Deployment target (e.g., "Vercel", "Docker", "Kubernetes")
]);

export type BuildMapNodeType = z.infer<typeof BuildMapNodeType>;

/**
 * Node Status
 */
export const BuildMapNodeStatus = z.enum([
  "planned",       // Planned but not started
  "in-progress",   // Currently being worked on
  "review",        // In code review / QA
  "done",          // Completed and merged
  "blocked",       // Blocked by dependency or issue
  "archived",      // No longer relevant
]);

export type BuildMapNodeStatus = z.infer<typeof BuildMapNodeStatus>;

/**
 * Edge Types (relationships between nodes)
 */
export const BuildMapEdgeType = z.enum([
  "depends-on",       // Source depends on target (target must complete first)
  "data-flow",        // Data flows from source to target
  "user-flow",        // User navigates from source to target
  "parent-child",     // Hierarchical relationship (feature → component)
  "related-to",       // General relationship (loose coupling)
  "blocks",           // Source blocks target (circular if both ways)
]);

export type BuildMapEdgeType = z.infer<typeof BuildMapEdgeType>;

/**
 * Node Assignee
 */
export const BuildMapAssignee = z.enum([
  "human",
  "agent",
  "unassigned",
]);

export type BuildMapAssignee = z.infer<typeof BuildMapAssignee>;

/**
 * Individual Node in the Build Map
 */
export const BuildMapNode = z.object({
  id: z.string(),                    // Unique identifier (UUID or slug)
  type: BuildMapNodeType,            // Node type
  title: z.string(),                 // Human-readable title
  description: z.string().optional(), // Detailed description
  status: BuildMapNodeStatus,        // Current status
  priority: z.number().int().min(1).max(10).default(5), // 1=low, 10=critical
  assignee: BuildMapAssignee,        // Who's working on this
  files: z.array(z.string()).default([]), // Related file paths
  tags: z.array(z.string()).default([]),  // Searchable tags
  estimate: z.number().optional(),   // Estimated hours
  actualTime: z.number().optional(), // Actual hours spent
  dependencies: z.array(z.string()).default([]), // Node IDs this depends on
  dependents: z.array(z.string()).default([]),   // Node IDs that depend on this
  position: z.object({               // Visual position (for manual layout)
    x: z.number(),
    y: z.number(),
  }).optional(),
  metadata: z.record(z.unknown()).default({}), // Extensible metadata
  createdAt: z.string().datetime(),  // ISO timestamp
  updatedAt: z.string().datetime(),  // ISO timestamp
  createdBy: z.string(),             // "agent" or user ID
  updatedBy: z.string(),             // "agent" or user ID
});

export type BuildMapNode = z.infer<typeof BuildMapNode>;

/**
 * Individual Edge in the Build Map
 */
export const BuildMapEdge = z.object({
  id: z.string(),                    // Unique identifier
  source: z.string(),                // Source node ID
  target: z.string(),                // Target node ID
  type: BuildMapEdgeType,            // Relationship type
  label: z.string().optional(),      // Optional label for the edge
  description: z.string().optional(), // Detailed description
  metadata: z.record(z.unknown()).default({}), // Extensible metadata
  createdAt: z.string().datetime(),
  createdBy: z.string(),
});

export type BuildMapEdge = z.infer<typeof BuildMapEdge>;

/**
 * Graph Layout Algorithms
 */
export const BuildMapLayoutAlgorithm = z.enum([
  "hierarchical",    // Top-down tree (good for feature → component → file)
  "force-directed",  // Physics-based (good for organic exploration)
  "circular",        // Circular (good for cyclic dependencies)
  "manual",          // User-defined positions
]);

export type BuildMapLayoutAlgorithm = z.infer<typeof BuildMapLayoutAlgorithm>;

/**
 * Graph Metadata
 */
export const BuildMapMetadata = z.object({
  version: z.number().int().default(1),
  lastUpdatedBy: z.string(),         // "agent" or user ID
  lastUpdatedAt: z.string().datetime(),
  projectId: z.string(),
  layout: BuildMapLayoutAlgorithm,
  layoutOptions: z.record(z.unknown()).default({}), // Algorithm-specific options
  viewport: z.object({               // Last known viewport
    x: z.number().default(0),
    y: z.number().default(0),
    zoom: z.number().default(1),
  }).optional(),
  stats: z.object({                  // Computed statistics
    totalNodes: z.number().default(0),
    totalEdges: z.number().default(0),
    byStatus: z.record(z.number()).default({}),
    byType: z.record(z.number()).default({}),
    byAssignee: z.record(z.number()).default({}),
  }).default({}),
});

export type BuildMapMetadata = z.infer<typeof BuildMapMetadata>;

/**
 * Complete Build Map Graph
 */
export const BuildMapGraph = z.object({
  id: z.string(),                    // Graph ID (typically projectId)
  nodes: z.array(BuildMapNode),
  edges: z.array(BuildMapEdge),
  metadata: BuildMapMetadata,
});

export type BuildMapGraph = z.infer<typeof BuildMapGraph>;

/**
 * AI Operations on the Build Map
 */
export const BuildMapAIUpdate = z.object({
  nodes: z.array(BuildMapNode.partial().extend({ id: z.string() })).optional(),
  edges: z.array(BuildMapEdge.partial().extend({ id: z.string() })).optional(),
  operations: z.array(z.enum([
    "add-node",
    "update-node",
    "delete-node",
    "add-edge",
    "update-edge",
    "delete-edge",
    "reorganize",
    "layout",
  ])).optional(),
});

export type BuildMapAIUpdate = z.infer<typeof BuildMapAIUpdate>;

/**
 * AI Analysis Result
 */
export const BuildMapAnalysis = z.object({
  suggestions: z.array(z.object({
    type: z.enum([
      "add-node",
      "update-status",
      "add-edge",
      "reorganize",
      "priority-change",
      "missing-test",
      "missing-docs",
      "circular-dependency",
      "orphan-node",
      "bottleneck",
    ]),
    nodeId: z.string().optional(),
    targetNodeId: z.string().optional(),
    title: z.string(),
    description: z.string(),
    confidence: z.number().min(0).max(1),
    priority: z.number().int().min(1).max(10),
    autoApply: z.boolean().default(false), // If true, can be applied without confirmation
  })),
  summary: z.string(),
  analyzedAt: z.string().datetime(),
});

export type BuildMapAnalysis = z.infer<typeof BuildMapAnalysis>;

/**
 * Build Map Manager — Core operations
 */
export class BuildMapManager {
  private graph: BuildMapGraph;
  private listeners: Set<(graph: BuildMapGraph) => void> = new Set();
  private projectId: string;

  constructor(projectId: string, initialGraph?: Partial<BuildMapGraph>) {
    this.projectId = projectId;
    this.graph = this.createEmptyGraph(projectId);
    if (initialGraph) {
      this.graph = this.mergeGraph(this.graph, initialGraph as BuildMapGraph);
    }
  }

  private createEmptyGraph(projectId: string): BuildMapGraph {
    return {
      id: projectId,
      nodes: [],
      edges: [],
      metadata: {
        version: 1,
        lastUpdatedBy: "system",
        lastUpdatedAt: new Date().toISOString(),
        projectId,
        layout: "hierarchical",
        layoutOptions: {},
        stats: {
          totalNodes: 0,
          totalEdges: 0,
          byStatus: {},
          byType: {},
          byAssignee: {},
        },
      },
    };
  }

  private mergeGraph(base: BuildMapGraph, incoming: BuildMapGraph): BuildMapGraph {
    const nodeMap = new Map(base.nodes.map(n => [n.id, n]));
    const edgeMap = new Map(base.edges.map(e => [e.id, e]));

    for (const node of incoming.nodes) {
      nodeMap.set(node.id, { ...nodeMap.get(node.id), ...node, updatedAt: new Date().toISOString() });
    }
    for (const edge of incoming.edges) {
      edgeMap.set(edge.id, { ...edgeMap.get(edge.id), ...edge });
    }

    return {
      ...base,
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
      metadata: {
        ...base.metadata,
        ...incoming.metadata,
        version: base.metadata.version + 1,
        lastUpdatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get the full graph
   */
  getGraph(): BuildMapGraph {
    return this.graph;
  }

  /**
   * Subscribe to graph changes
   */
  subscribe(listener: (graph: BuildMapGraph) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.recomputeStats();
    for (const listener of this.listeners) {
      listener(this.graph);
    }
  }

  private recomputeStats() {
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byAssignee: Record<string, number> = {};

    for (const node of this.graph.nodes) {
      byStatus[node.status] = (byStatus[node.status] || 0) + 1;
      byType[node.type] = (byType[node.type] || 0) + 1;
      byAssignee[node.assignee] = (byAssignee[node.assignee] || 0) + 1;
    }

    this.graph.metadata.stats = {
      totalNodes: this.graph.nodes.length,
      totalEdges: this.graph.edges.length,
      byStatus,
      byType,
      byAssignee,
    };
  }

  // ============================================
  // Node Operations
  // ============================================

  addNode(node: Omit<BuildMapNode, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"> & { id?: string }): BuildMapNode {
    const now = new Date().toISOString();
    const newNode: BuildMapNode = {
      ...node,
      id: node.id || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      createdBy: "agent",
      updatedBy: "agent",
    } as BuildMapNode;

    this.graph.nodes.push(newNode);
    this.updateDependents(newNode.id, newNode.dependencies);
    this.notify();
    return newNode;
  }

  updateNode(id: string, updates: Partial<Omit<BuildMapNode, "id" | "createdAt" | "createdBy">>): BuildMapNode | null {
    const index = this.graph.nodes.findIndex(n => n.id === id);
    if (index === -1) return null;

    const updated = {
      ...this.graph.nodes[index],
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: "agent",
    } as BuildMapNode;

    this.graph.nodes[index] = updated;

    // Update dependency references
    if (updates.dependencies) {
      this.updateDependents(id, updates.dependencies);
    }

    this.notify();
    return updated;
  }

  deleteNode(id: string): boolean {
    const index = this.graph.nodes.findIndex(n => n.id === id);
    if (index === -1) return false;

    // Remove edges connected to this node
    this.graph.edges = this.graph.edges.filter(e => e.source !== id && e.target !== id);

    // Remove from other nodes' dependencies/dependents
    for (const node of this.graph.nodes) {
      node.dependencies = node.dependencies.filter(d => d !== id);
      node.dependents = node.dependents.filter(d => d !== id);
    }

    this.graph.nodes.splice(index, 1);
    this.notify();
    return true;
  }

  getNode(id: string): BuildMapNode | undefined {
    return this.graph.nodes.find(n => n.id === id);
  }

  getNodesByType(type: BuildMapNodeType): BuildMapNode[] {
    return this.graph.nodes.filter(n => n.type === type);
  }

  getNodesByStatus(status: BuildMapNodeStatus): BuildMapNode[] {
    return this.graph.nodes.filter(n => n.status === status);
  }

  // ============================================
  // Edge Operations
  // ============================================

  addEdge(edge: Omit<BuildMapEdge, "id" | "createdAt" | "createdBy"> & { id?: string }): BuildMapEdge {
    const now = new Date().toISOString();
    const newEdge: BuildMapEdge = {
      ...edge,
      id: edge.id || crypto.randomUUID(),
      createdAt: now,
      createdBy: "agent",
    } as BuildMapEdge;

    this.graph.edges.push(newEdge);
    this.notify();
    return newEdge;
  }

  updateEdge(id: string, updates: Partial<Omit<BuildMapEdge, "id" | "createdAt" | "createdBy">>): BuildMapEdge | null {
    const index = this.graph.edges.findIndex(e => e.id === id);
    if (index === -1) return null;

    const updated = {
      ...this.graph.edges[index],
      ...updates,
    } as BuildMapEdge;

    this.graph.edges[index] = updated;
    this.notify();
    return updated;
  }

  deleteEdge(id: string): boolean {
    const index = this.graph.edges.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.graph.edges.splice(index, 1);
    this.notify();
    return true;
  }

  getEdgesForNode(nodeId: string): BuildMapEdge[] {
    return this.graph.edges.filter(e => e.source === nodeId || e.target === nodeId);
  }

  getOutgoingEdges(nodeId: string): BuildMapEdge[] {
    return this.graph.edges.filter(e => e.source === nodeId);
  }

  getIncomingEdges(nodeId: string): BuildMapEdge[] {
    return this.graph.edges.filter(e => e.target === nodeId);
  }

  // ============================================
  // Dependency Management
  // ============================================

  private updateDependents(nodeId: string, dependencies: string[]) {
    // Clear old dependents
    for (const node of this.graph.nodes) {
      node.dependents = node.dependents.filter(d => d !== nodeId);
    }

    // Set new dependents
    for (const depId of dependencies) {
      const depNode = this.graph.nodes.find(n => n.id === depId);
      if (depNode) {
        if (!depNode.dependents.includes(nodeId)) {
          depNode.dependents.push(nodeId);
        }
      }
    }
  }

  getDependencies(nodeId: string): BuildMapNode[] {
    const node = this.getNode(nodeId);
    if (!node) return [];
    return node.dependencies.map(id => this.getNode(id)).filter(Boolean) as BuildMapNode[];
  }

  getDependents(nodeId: string): BuildMapNode[] {
    const node = this.getNode(nodeId);
    if (!node) return [];
    return node.dependents.map(id => this.getNode(id)).filter(Boolean) as BuildMapNode[];
  }

  // ============================================
  // AI Operations
  // ============================================

  /**
   * Apply a batch of AI-proposed updates
   */
  applyAIUpdate(update: BuildMapAIUpdate, actor: string = "agent"): { nodes: BuildMapNode[], edges: BuildMapEdge[] } {
    const addedNodes: BuildMapNode[] = [];
    const updatedNodes: BuildMapNode[] = [];
    const addedEdges: BuildMapEdge[] = [];
    const updatedEdges: BuildMapEdge[] = [];

    if (update.nodes) {
      for (const nodeUpdate of update.nodes) {
        const existing = this.getNode(nodeUpdate.id);
        if (existing) {
          const updated = this.updateNode(nodeUpdate.id, { ...nodeUpdate, updatedBy: actor });
          if (updated) updatedNodes.push(updated);
        } else {
          const added = this.addNode({ ...nodeUpdate, updatedBy: actor } as any);
          addedNodes.push(added);
        }
      }
    }

    if (update.edges) {
      for (const edgeUpdate of update.edges) {
        const existing = this.graph.edges.find(e => e.id === edgeUpdate.id);
        if (existing) {
          const updated = this.updateEdge(edgeUpdate.id, { ...edgeUpdate });
          if (updated) updatedEdges.push(updated);
        } else {
          const added = this.addEdge({ ...edgeUpdate } as any);
          addedEdges.push(added);
        }
      }
    }

    return { nodes: [...addedNodes, ...updatedNodes], edges: [...addedEdges, ...updatedEdges] };
  }

  /**
   * Analyze the graph and generate AI suggestions
   */
  analyze(): BuildMapAnalysis {
    const suggestions: BuildMapAnalysis["suggestions"] = [];
    const now = new Date().toISOString();

    // Check for missing tests
    for (const node of this.graph.nodes) {
      if ((node.type === "feature" || node.type === "component" || node.type === "api") &&
          node.status === "done") {
        const hasTest = this.graph.nodes.some(n =>
          n.type === "test" &&
          (n.dependencies.includes(node.id) || n.title.toLowerCase().includes(node.title.toLowerCase()))
        );
        if (!hasTest) {
          suggestions.push({
            type: "missing-test",
            nodeId: node.id,
            title: `Missing test for ${node.title}`,
            description: `Feature/component "${node.title}" is marked done but has no associated test node`,
            confidence: 0.8,
            priority: 7,
            autoApply: false,
          });
        }
      }
    }

    // Check for missing documentation
    for (const node of this.graph.nodes) {
      if ((node.type === "feature" || node.type === "api" || node.type === "integration") &&
          node.status === "done") {
        const hasDoc = this.graph.nodes.some(n =>
          n.type === "doc" &&
          (n.dependencies.includes(node.id) || n.title.toLowerCase().includes(node.title.toLowerCase()))
        );
        if (!hasDoc) {
          suggestions.push({
            type: "missing-docs",
            nodeId: node.id,
            title: `Missing documentation for ${node.title}`,
            description: `"${node.title}" is complete but lacks documentation`,
            confidence: 0.7,
            priority: 5,
            autoApply: false,
          });
        }
      }
    }

    // Check for circular dependencies
    const cycles = this.findCycles();
    for (const cycle of cycles) {
      suggestions.push({
        type: "circular-dependency",
        nodeId: cycle[0],
        title: `Circular dependency detected`,
        description: `Cycle: ${cycle.join(" → ")} → ${cycle[0]}`,
        confidence: 1.0,
        priority: 9,
        autoApply: false,
      });
    }

    // Check for orphan nodes (no edges at all)
    for (const node of this.graph.nodes) {
      const edges = this.getEdgesForNode(node.id);
      if (edges.length === 0 && this.graph.nodes.length > 1) {
        suggestions.push({
          type: "orphan-node",
          nodeId: node.id,
          title: `Orphan node: ${node.title}`,
          description: `Node "${node.title}" has no connections to other nodes`,
          confidence: 0.6,
          priority: 3,
          autoApply: false,
        });
      }
    }

    // Check for bottlenecks (nodes with many dependents but not done)
    for (const node of this.graph.nodes) {
      if (node.dependents.length >= 3 && node.status !== "done") {
        suggestions.push({
          type: "bottleneck",
          nodeId: node.id,
          title: `Bottleneck: ${node.title}`,
          description: `"${node.title}" has ${node.dependents.length} dependents but is not complete`,
          confidence: 0.9,
          priority: 8,
          autoApply: false,
        });
      }
    }

    // Suggest priority changes for blocked nodes
    for (const node of this.graph.nodes) {
      if (node.status === "blocked" && node.priority < 8) {
        suggestions.push({
          type: "priority-change",
          nodeId: node.id,
          title: `Increase priority for blocked node: ${node.title}`,
          description: `Blocked nodes should have high priority to unblock dependents`,
          confidence: 0.85,
          priority: 6,
          autoApply: true,
        });
      }
    }

    return {
      suggestions,
      summary: `Analyzed ${this.graph.nodes.length} nodes, ${this.graph.edges.length} edges. Found ${suggestions.length} suggestions.`,
      analyzedAt: now,
    };
  }

  /**
   * Find circular dependencies using DFS
   */
  private findCycles(): string[][] {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[][] = [];
    const path: string[] = [];

    const dfs = (nodeId: string) => {
      visited.add(nodeId);
      recStack.add(nodeId);
      path.push(nodeId);

      const outgoing = this.getOutgoingEdges(nodeId)
        .filter(e => e.type === "depends-on")
        .map(e => e.target);

      for (const neighbor of outgoing) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor);
          cycles.push(path.slice(cycleStart));
        }
      }

      recStack.delete(nodeId);
      path.pop();
    };

    for (const node of this.graph.nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id);
      }
    }

    return cycles;
  }

  /**
   * Auto-layout the graph using a layout algorithm
   */
  layout(algorithm: BuildMapLayoutAlgorithm = "hierarchical"): void {
    this.graph.metadata.layout = algorithm;
    this.graph.metadata.lastUpdatedAt = new Date().toISOString();

    switch (algorithm) {
      case "hierarchical":
        this.layoutHierarchical();
        break;
      case "force-directed":
        this.layoutForceDirected();
        break;
      case "circular":
        this.layoutCircular();
        break;
    }

    this.notify();
  }

  private layoutHierarchical() {
    // Simple topological layout based on depends-on edges
    const levels = new Map<string, number>();
    const visited = new Set<string>();

    const computeLevel = (nodeId: string): number => {
      if (levels.has(nodeId)) return levels.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // Cycle protection

      visited.add(nodeId);
      const deps = this.getDependencies(nodeId)
        .filter(n => n.status !== "done"); // Only count active dependencies

      let maxLevel = 0;
      for (const dep of deps) {
        maxLevel = Math.max(maxLevel, computeLevel(dep.id) + 1);
      }

      levels.set(nodeId, maxLevel);
      visited.delete(nodeId);
      return maxLevel;
    };

    for (const node of this.graph.nodes) {
      computeLevel(node.id);
    }

    // Position nodes by level
    const levelGroups = new Map<number, BuildMapNode[]>();
    for (const node of this.graph.nodes) {
      const level = levels.get(node.id) || 0;
      if (!levelGroups.has(level)) levelGroups.set(level, []);
      levelGroups.get(level)!.push(node);
    }

    const levelHeight = 200;
    const nodeWidth = 180;
    const nodeSpacing = 40;

    for (const [level, nodes] of levelGroups) {
      const startX = -(nodes.length - 1) * (nodeWidth + nodeSpacing) / 2;
      nodes.forEach((node, i) => {
        node.position = {
          x: startX + i * (nodeWidth + nodeSpacing),
          y: level * levelHeight,
        };
      });
    }
  }

  private layoutForceDirected() {
    // Simple force-directed layout (placeholder - would use d3-force or similar in production)
    const width = 1200;
    const height = 800;
    const centerX = width / 2;
    const centerY = height / 2;

    this.graph.nodes.forEach((node, i) => {
      const angle = (i / this.graph.nodes.length) * Math.PI * 2;
      const radius = Math.min(width, height) / 3;
      node.position = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });
  }

  private layoutCircular() {
    const width = 1000;
    const height = 800;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2.5;

    this.graph.nodes.forEach((node, i) => {
      const angle = (i / this.graph.nodes.length) * Math.PI * 2;
      node.position = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });
  }

  // ============================================
  // Persistence
  // ============================================

  toJSON(): string {
    return JSON.stringify(this.graph, null, 2);
  }

  static fromJSON(json: string): BuildMapGraph {
    return JSON.parse(json);
  }
}

/**
 * Singleton manager per project
 */
const projectManagers = new Map<string, BuildMapManager>();

export function getBuildMapManager(projectId: string): BuildMapManager {
  if (!projectManagers.has(projectId)) {
    projectManagers.set(projectId, new BuildMapManager(projectId));
  }
  return projectManagers.get(projectId)!;
}

export function createBuildMapManager(projectId: string, initialGraph?: Partial<BuildMapGraph>): BuildMapManager {
  const manager = new BuildMapManager(projectId, initialGraph);
  projectManagers.set(projectId, manager);
  return manager;
}