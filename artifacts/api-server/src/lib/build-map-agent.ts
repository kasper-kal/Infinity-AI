/**
 * AI Roadmap Agent — Maintains the Visual Build Map autonomously
 *
 * This specialized agent runs after build steps, analyzes changes,
 * and updates the build map graph with new nodes, edges, and suggestions.
 */

import { z } from "zod";
import {
  BuildMapManager,
  getBuildMapManager,
  BuildMapGraph,
  BuildMapNode,
  BuildMapEdge,
  BuildMapNodeType,
  BuildMapNodeStatus,
  BuildMapEdgeType,
  BuildMapAssignee,
  BuildMapAnalysis,
  BuildMapAIUpdate,
} from "./build-map.js";

/**
 * Git diff analysis result
 */
export const GitDiffAnalysis = z.object({
  addedFiles: z.array(z.string()),
  modifiedFiles: z.array(z.string()),
  deletedFiles: z.array(z.string()),
  addedLines: z.number(),
  deletedLines: z.number(),
  fileTypes: z.record(z.number()), // extension -> count
  symbols: z.array(z.object({
    file: z.string(),
    name: z.string(),
    type: z.enum(["function", "class", "interface", "type", "component", "hook", "api"]),
    exported: z.boolean(),
  })),
});

export type GitDiffAnalysis = z.infer<typeof GitDiffAnalysis>;

/**
 * Build step context for the agent
 */
export const BuildStepContext = z.object({
  projectId: z.string(),
  stepId: z.string(),
  stepName: z.string(),
  goal: z.string(),
  filesChanged: z.array(z.string()),
  diffSummary: z.string(),
  timestamp: z.string().datetime(),
});

export type BuildStepContext = z.infer<typeof BuildStepContext>;

/**
 * AI Roadmap Agent Class
 */
export class BuildMapAgent {
  private projectId: string;
  private manager: BuildMapManager;
  private llmAdapter: any; // Will be injected

  constructor(projectId: string, llmAdapter?: any) {
    this.projectId = projectId;
    this.manager = getBuildMapManager(projectId);
    this.llmAdapter = llmAdapter;
  }

  setLLMAdapter(adapter: any) {
    this.llmAdapter = adapter;
  }

  /**
   * Main entry point: analyze build step and update map
   */
  async onBuildStepComplete(context: BuildStepContext): Promise<{
    updates: BuildMapAIUpdate;
    analysis: BuildMapAnalysis;
  }> {
    const graph = this.manager.getGraph();

    // 1. Analyze the changes
    const diffAnalysis = await this.analyzeChanges(context);

    // 2. Infer node updates from changes
    const inferredUpdates = this.inferUpdatesFromDiff(graph, diffAnalysis, context);

    // 3. Run full graph analysis for suggestions
    const analysis = this.manager.analyze();

    // 4. Apply auto-applicable suggestions
    const autoApplicable = analysis.suggestions.filter(s => s.autoApply);
    for (const suggestion of autoApplicable) {
      await this.applySuggestion(suggestion);
    }

    // 5. If LLM available, run deeper analysis
    let llmSuggestions: BuildMapAnalysis["suggestions"] = [];
    if (this.llmAdapter) {
      llmSuggestions = await this.runLLMAnalysis(graph, context, diffAnalysis);
    }

    return {
      updates: inferredUpdates,
      analysis: {
        ...analysis,
        suggestions: [...analysis.suggestions, ...llmSuggestions],
      },
    };
  }

  /**
   * Analyze git diff to extract meaningful information
   */
  private async analyzeChanges(context: BuildStepContext): Promise<GitDiffAnalysis> {
    // In production, this would call git diff and parse results
    // For now, infer from file paths and context

    const fileTypes: Record<string, number> = {};
    for (const file of context.filesChanged) {
      const ext = file.split(".").pop() || "unknown";
      fileTypes[ext] = (fileTypes[ext] || 0) + 1;
    }

    // Extract potential symbols from file paths
    const symbols = this.extractSymbolsFromPaths(context.filesChanged);

    return {
      addedFiles: context.filesChanged.filter(f => f.startsWith("new:")).map(f => f.slice(4)),
      modifiedFiles: context.filesChanged.filter(f => f.startsWith("mod:")).map(f => f.slice(4)),
      deletedFiles: context.filesChanged.filter(f => f.startsWith("del:")).map(f => f.slice(4)),
      addedLines: 0, // Would be filled by actual diff
      deletedLines: 0,
      fileTypes,
      symbols,
    };
  }

  /**
   * Extract potential code symbols from file paths
   */
  private extractSymbolsFromPaths(files: string[]): GitDiffAnalysis["symbols"] {
    const symbols: GitDiffAnalysis["symbols"] = [];

    for (const file of files) {
      const baseName = file.split("/").pop()?.replace(/\.(ts|tsx|js|jsx|py|go|rs)$/, "") || "";

      // Heuristics based on file path and name
      if (file.includes("/components/") || file.includes("/ui/")) {
        symbols.push({
          file,
          name: baseName,
          type: "component",
          exported: true,
        });
      } else if (file.includes("/hooks/") || file.includes("/lib/") || file.includes("/utils/")) {
        if (baseName.startsWith("use")) {
          symbols.push({
            file,
            name: baseName,
            type: "hook",
            exported: true,
          });
        } else {
          symbols.push({
            file,
            name: baseName,
            type: "function",
            exported: true,
          });
        }
      } else if (file.includes("/api/") || file.includes("/routes/")) {
        symbols.push({
          file,
          name: baseName,
          type: "api",
          exported: true,
        });
      } else if (file.includes("/types/") || file.includes("/schemas/")) {
        symbols.push({
          file,
          name: baseName,
          type: "type",
          exported: true,
        });
      } else if (file.includes("/test/") || file.includes(".test.") || file.includes(".spec.")) {
        symbols.push({
          file,
          name: baseName,
          type: "function",
          exported: false,
        });
      }
    }

    return symbols;
  }

  /**
   * Infer graph updates from diff analysis
   */
  private inferUpdatesFromDiff(
    graph: BuildMapGraph,
    diff: GitDiffAnalysis,
    context: BuildStepContext
  ): BuildMapAIUpdate {
    const nodeUpdates: BuildMapAIUpdate["nodes"] = [];
    const edgeUpdates: BuildMapAIUpdate["edges"] = [];
    const now = new Date().toISOString();

    // Process each changed file
    for (const symbol of diff.symbols) {
      const nodeId = this.generateNodeId(symbol.file, symbol.name);

      // Determine node type from symbol type
      let nodeType: BuildMapNodeType = "component";
      switch (symbol.type) {
        case "component": nodeType = "component"; break;
        case "hook": nodeType = "component"; break;
        case "api": nodeType = "api"; break;
        case "type": nodeType = "config"; break; // types as config-like
        case "function": nodeType = "component"; break; // generic
        case "class": nodeType = "component"; break;
        case "interface": nodeType = "config"; break;
      }

      // Check if node exists
      const existingNode = graph.nodes.find(n => n.id === nodeId);

      if (existingNode) {
        // Update existing node
        const newStatus: BuildMapNodeStatus = context.stepName.includes("test")
          ? "review"
          : "in-progress";

        nodeUpdates.push({
          id: nodeId,
          status: newStatus,
          files: [...new Set([...existingNode.files, symbol.file])],
          updatedAt: now,
          updatedBy: "agent",
        });
      } else {
        // Create new node
        const title = this.formatTitle(symbol.name, symbol.type);
        const description = this.generateDescription(symbol, context);

        nodeUpdates.push({
          id: nodeId,
          type: nodeType,
          title,
          description,
          status: "in-progress",
          priority: 5,
          assignee: "agent",
          files: [symbol.file],
          tags: this.generateTags(symbol, context),
          estimate: 1,
          metadata: {
            symbolType: symbol.type,
            exported: symbol.exported,
            firstSeenInStep: context.stepId,
          },
          createdAt: now,
          updatedAt: now,
          createdBy: "agent",
          updatedBy: "agent",
        });

        // Create edges based on file structure
        const parentFeatureId = this.findParentFeature(graph, symbol.file);
        if (parentFeatureId) {
          edgeUpdates.push({
            id: `${parentFeatureId}-${nodeId}`,
            source: parentFeatureId,
            target: nodeId,
            type: "parent-child",
            createdAt: now,
            createdBy: "agent",
          });
        }

        // Create depends-on edges for imports (simplified)
        const importedNodes = this.findImportedNodes(graph, symbol.file);
        for (const importedId of importedNodes) {
          edgeUpdates.push({
            id: `${nodeId}-${importedId}`,
            source: nodeId,
            target: importedId,
            type: "depends-on",
            createdAt: now,
            createdBy: "agent",
          });
        }
      }
    }

    // If this step completes a feature, mark related nodes as done
    if (context.stepName.includes("complete") || context.stepName.includes("deploy")) {
      const featureNodes = graph.nodes.filter(n =>
        n.type === "feature" &&
        n.status === "in-progress" &&
        n.files.some(f => context.filesChanged.includes(f))
      );

      for (const feature of featureNodes) {
        nodeUpdates.push({
          id: feature.id,
          status: "done",
          updatedAt: now,
          updatedBy: "agent",
        });
      }
    }

    return { nodes: nodeUpdates, edges: edgeUpdates };
  }

  /**
   * Generate a stable node ID from file and symbol
   */
  private generateNodeId(file: string, symbol: string): string {
    // Create a deterministic ID from file path and symbol name
    const normalized = `${file}:${symbol}`.toLowerCase().replace(/[^a-z0-9:]/g, "-");
    return `node-${this.hashString(normalized).slice(0, 12)}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Format a human-readable title from symbol
   */
  private formatTitle(name: string, type: string): string {
    // Convert camelCase/PascalCase to Title Case
    const formatted = name
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, c => c.toUpperCase())
      .trim();

    const typeLabels: Record<string, string> = {
      component: "Component",
      hook: "Hook",
      api: "API",
      function: "Function",
      class: "Class",
      interface: "Interface",
      type: "Type",
    };

    return `${formatted} (${typeLabels[type] || "Item"})`;
  }

  /**
   * Generate description for new node
   */
  private generateDescription(symbol: GitDiffAnalysis["symbols"][0], context: BuildStepContext): string {
    const typeLabels: Record<string, string> = {
      component: "UI Component",
      hook: "React Hook",
      api: "API Endpoint",
      function: "Function",
      class: "Class",
      interface: "Interface",
      type: "Type Definition",
    };

    return `${typeLabels[symbol.type] || "Code Element"} "${symbol.name}" in ${symbol.file}. ` +
      `Created during step: ${context.stepName} (${context.goal})`;
  }

  /**
   * Generate searchable tags
   */
  private generateTags(symbol: GitDiffAnalysis["symbols"][0], context: BuildStepContext): string[] {
    const tags = [symbol.type, symbol.exported ? "exported" : "internal"];

    // Add path-based tags
    if (symbol.file.includes("/components/")) tags.push("ui");
    if (symbol.file.includes("/hooks/")) tags.push("hooks");
    if (symbol.file.includes("/api/")) tags.push("backend");
    if (symbol.file.includes("/test/")) tags.push("test");
    if (symbol.file.includes("/types/")) tags.push("types");

    // Add step-based tags
    if (context.stepName.includes("auth")) tags.push("auth");
    if (context.stepName.includes("database") || context.stepName.includes("db")) tags.push("database");
    if (context.stepName.includes("deploy")) tags.push("deployment");

    return [...new Set(tags)];
  }

  /**
   * Find parent feature node for a file
   */
  private findParentFeature(graph: BuildMapGraph, file: string): string | null {
    // Look for feature nodes that might contain this file
    const features = graph.nodes.filter(n => n.type === "feature");

    for (const feature of features) {
      // Check if feature's files overlap with this file's directory
      const featureDirs = feature.files.map(f => f.split("/").slice(0, -1).join("/"));
      const fileDir = file.split("/").slice(0, -1).join("/");

      if (featureDirs.some(d => fileDir.startsWith(d) || d.startsWith(fileDir))) {
        return feature.id;
      }
    }

    return null;
  }

  /**
   * Find nodes that might be imported by this file
   */
  private findImportedNodes(graph: BuildMapGraph, file: string): string[] {
    // Simplified: look for nodes in same directory or common lib directories
    const fileDir = file.split("/").slice(0, -1).join("/");
    const imported: string[] = [];

    for (const node of graph.nodes) {
      if (node.id === this.generateNodeId(file, file)) continue;

      for (const nodeFile of node.files) {
        const nodeDir = nodeFile.split("/").slice(0, -1).join("/");

        // Same directory or parent directory
        if (nodeDir === fileDir || fileDir.startsWith(nodeDir + "/")) {
          imported.push(node.id);
        }

        // Common shared directories
        if (nodeDir.includes("/lib/") || nodeDir.includes("/hooks/") || nodeDir.includes("/utils/")) {
          if (fileDir !== nodeDir) {
            imported.push(node.id);
          }
        }
      }
    }

    return [...new Set(imported)];
  }

  /**
   * Apply a suggestion from analysis
   */
  private async applySuggestion(suggestion: BuildMapAnalysis["suggestions"][0]): Promise<void> {
    switch (suggestion.type) {
      case "priority-change":
        if (suggestion.nodeId) {
          this.manager.updateNode(suggestion.nodeId, { priority: Math.max(8, suggestion.priority) });
        }
        break;
      // Other auto-applicable suggestions would be handled here
    }
  }

  /**
   * Run LLM-based deep analysis
   */
  private async runLLMAnalysis(
    graph: BuildMapGraph,
    context: BuildStepContext,
    diff: GitDiffAnalysis
  ): Promise<BuildMapAnalysis["suggestions"]> {
    if (!this.llmAdapter) return [];

    try {
      const prompt = this.buildAnalysisPrompt(graph, context, diff);
      const response = await this.llmAdapter.generate(prompt, {
        temperature: 0.3,
        maxTokens: 2000,
        responseFormat: "json",
      });

      // Parse LLM response as suggestions
      const parsed = JSON.parse(response.text || "{}");
      return parsed.suggestions || [];
    } catch (error) {
      console.warn("LLM analysis failed:", error);
      return [];
    }
  }

  /**
   * Build prompt for LLM analysis
   */
  private buildAnalysisPrompt(
    graph: BuildMapGraph,
    context: BuildStepContext,
    diff: GitDiffAnalysis
  ): string {
    const nodeSummary = graph.nodes.map(n =>
      `- ${n.id}: ${n.title} [${n.type}] status=${n.status} priority=${n.priority} files=${n.files.join(",")}`
    ).join("\n");

    const edgeSummary = graph.edges.map(e =>
      `- ${e.source} --(${e.type})--> ${e.target}`
    ).join("\n");

    return `Analyze this build map and recent changes. Return JSON with "suggestions" array.

CURRENT GRAPH (${graph.nodes.length} nodes, ${graph.edges.length} edges):
Nodes:
${nodeSummary}

Edges:
${edgeSummary}

RECENT BUILD STEP:
- Step: ${context.stepName}
- Goal: ${context.goal}
- Files changed: ${context.filesChanged.join(", ")}
- Diff summary: ${context.diffSummary}

SYMBOLS DETECTED:
${diff.symbols.map(s => `- ${s.file}: ${s.name} (${s.type}, exported=${s.exported})`).join("\n")}

SUGGESTION TYPES:
- "add-node": Propose new node
- "update-status": Change node status
- "add-edge": Propose new relationship
- "reorganize": Suggest restructuring
- "priority-change": Adjust priority
- "missing-test": Test coverage gap
- "missing-docs": Documentation gap
- "circular-dependency": Cycle detected
- "orphan-node": Isolated node
- "bottleneck": Blocking many dependents

Return JSON: {"suggestions": [{"type": "...", "nodeId": "...", "targetNodeId": "...", "title": "...", "description": "...", "confidence": 0.0-1.0, "priority": 1-10, "autoApply": false}]}`;
  }

  /**
   * Weekly reorganization analysis
   */
  async runWeeklyAnalysis(): Promise<BuildMapAnalysis> {
    const graph = this.manager.getGraph();

    // Run standard analysis
    const analysis = this.manager.analyze();

    // Add weekly-specific suggestions
    const weeklySuggestions: BuildMapAnalysis["suggestions"] = [];

    // Identify stale planned nodes
    const staleThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    for (const node of graph.nodes) {
      if (node.status === "planned" && new Date(node.updatedAt).getTime() < staleThreshold) {
        weeklySuggestions.push({
          type: "reorganize",
          nodeId: node.id,
          title: `Stale planned node: ${node.title}`,
          description: `Node has been in "planned" status for over a week. Consider reprioritizing or archiving.`,
          confidence: 0.7,
          priority: 4,
          autoApply: false,
        });
      }
    }

    // Identify high-priority blocked nodes
    for (const node of graph.nodes) {
      if (node.status === "blocked" && node.priority >= 8) {
        weeklySuggestions.push({
          type: "bottleneck",
          nodeId: node.id,
          title: `Critical bottleneck: ${node.title}`,
          description: `High-priority node is blocked. Investigate and unblock.`,
          confidence: 0.95,
          priority: 10,
          autoApply: false,
        });
      }
    }

    // Suggest next priorities based on dependency graph
    const readyNodes = graph.nodes.filter(n =>
      n.status === "planned" &&
      n.dependencies.every(depId => {
        const dep = graph.nodes.find(d => d.id === depId);
        return dep?.status === "done";
      })
    );

    for (const node of readyNodes.slice(0, 3)) {
      weeklySuggestions.push({
        type: "priority-change",
        nodeId: node.id,
        title: `Ready to start: ${node.title}`,
        description: `All dependencies complete. Consider starting this next.`,
        confidence: 0.8,
        priority: 7,
        autoApply: true,
      });
    }

    return {
      ...analysis,
      suggestions: [...analysis.suggestions, ...weeklySuggestions],
      summary: `${analysis.summary} Weekly analysis added ${weeklySuggestions.length} suggestions.`,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a new feature node from natural language description
   */
  async createFeatureFromDescription(description: string): Promise<BuildMapNode> {
    if (!this.llmAdapter) {
      throw new Error("LLM adapter required for feature creation");
    }

    const prompt = `Parse this feature description and return a JSON node spec:
"${description}"

Return: {"title": "...", "type": "feature", "description": "...", "priority": 1-10, "tags": [], "estimate": hours}`;

    const response = await this.llmAdapter.generate(prompt, {
      temperature: 0.3,
      maxTokens: 500,
      responseFormat: "json",
    });

    const spec = JSON.parse(response.text || "{}");
    const now = new Date().toISOString();

    return this.manager.addNode({
      ...spec,
      type: "feature",
      status: "planned",
      assignee: "unassigned",
      files: [],
      metadata: { source: "natural-language" },
      createdAt: now,
      updatedAt: now,
      createdBy: "agent",
      updatedBy: "agent",
    });
  }

  /**
   * Get current graph for UI
   */
  getGraph(): BuildMapGraph {
    return this.manager.getGraph();
  }

  /**
   * Subscribe to graph changes
   */
  subscribe(listener: (graph: BuildMapGraph) => void): () => void {
    return this.manager.subscribe(listener);
  }
}

/**
 * Factory function to get/create agent for a project
 */
const projectAgents = new Map<string, BuildMapAgent>();

export function getBuildMapAgent(projectId: string, llmAdapter?: any): BuildMapAgent {
  if (!projectAgents.has(projectId)) {
    projectAgents.set(projectId, new BuildMapAgent(projectId, llmAdapter));
  } else if (llmAdapter) {
    projectAgents.get(projectId)!.setLLMAdapter(llmAdapter);
  }
  return projectAgents.get(projectId)!;
}