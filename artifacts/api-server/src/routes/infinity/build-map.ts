/**
 * Build Map API Routes
 * REST API + SSE for the Visual Build Map (AI-Managed Roadmap)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  buildMapNodes,
  buildMapEdges,
  buildMapVersions,
  buildMapMetadata,
  buildMapSuggestions,
  BuildMapNode,
  BuildMapEdge,
  BuildMapVersion,
  BuildMapMetadataRow,
  BuildMapSuggestion,
} from "../../../lib/db/schema/build-map.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, requireScope, AuthenticatedRequest } from "../../middleware/auth-middleware.js";
import { getBuildMapManager, getBuildMapAgent, BuildMapGraph, BuildMapNodeType, BuildMapNodeStatus, BuildMapEdgeType, BuildMapAssignee, BuildMapLayoutAlgorithm, BuildMapAnalysis } from "../../lib/build-map.js";
import { BuildMapManager } from "../../lib/build-map.js";

const router = Router();

// All routes require authentication and build:read scope
router.use(requireAuth);
router.use(requireScope("build:read"));

/**
 * Helper: Get project ID from request
 */
function getProjectId(req: Request): string {
  return (req as AuthenticatedRequest).projectId || req.params.projectId || req.query.projectId as string;
}

/**
 * Helper: Convert DB node to graph node
 */
function dbNodeToGraphNode(dbNode: BuildMapNode): any {
  return {
    id: dbNode.id,
    type: dbNode.type,
    title: dbNode.title,
    description: dbNode.description || undefined,
    status: dbNode.status,
    priority: dbNode.priority,
    assignee: dbNode.assignee,
    files: dbNode.files,
    tags: dbNode.tags,
    estimate: dbNode.estimate || undefined,
    actualTime: dbNode.actualTime || undefined,
    dependencies: dbNode.dependencies,
    dependents: dbNode.dependents,
    position: (dbNode.positionX !== null && dbNode.positionY !== null) ? { x: dbNode.positionX, y: dbNode.positionY } : undefined,
    metadata: dbNode.metadata,
    createdAt: dbNode.createdAt.toISOString(),
    updatedAt: dbNode.updatedAt.toISOString(),
    createdBy: dbNode.createdBy,
    updatedBy: dbNode.updatedBy,
  };
}

/**
 * Helper: Convert DB edge to graph edge
 */
function dbEdgeToGraphEdge(dbEdge: BuildMapEdge): any {
  return {
    id: dbEdge.id,
    source: dbEdge.sourceId,
    target: dbEdge.targetId,
    type: dbEdge.type,
    label: dbEdge.label || undefined,
    description: dbEdge.description || undefined,
    metadata: dbEdge.metadata,
    createdAt: dbEdge.createdAt.toISOString(),
    createdBy: dbEdge.createdBy,
  };
}

/**
 * GET /api/infinity/build-map/:projectId
 * Get the full build map graph for a project
 */
router.get("/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;

    // Fetch nodes
    const nodes = await db
      .select()
      .from(buildMapNodes)
      .where(eq(buildMapNodes.projectId, projectId));

    // Fetch edges
    const edges = await db
      .select()
      .from(buildMapEdges)
      .where(eq(buildMapEdges.projectId, projectId));

    // Fetch metadata
    const metadata = await db
      .select()
      .from(buildMapMetadata)
      .where(eq(buildMapMetadata.projectId, projectId))
      .limit(1);

    // Build graph
    const graph: BuildMapGraph = {
      id: projectId,
      nodes: nodes.map(dbNodeToGraphNode),
      edges: edges.map(dbEdgeToGraphEdge),
      metadata: {
        version: 1,
        lastUpdatedBy: metadata[0]?.lastUpdatedBy || "system",
        lastUpdatedAt: metadata[0]?.lastUpdatedAt?.toISOString() || new Date().toISOString(),
        projectId,
        layout: metadata[0]?.layout || "hierarchical",
        layoutOptions: metadata[0]?.layoutOptions || {},
        viewport: metadata[0] ? {
          x: metadata[0].viewportX || 0,
          y: metadata[0].viewportY || 0,
          zoom: (metadata[0].viewportZoom || 100) / 100,
        } : undefined,
        stats: metadata[0]?.stats || {},
      },
    };

    // Initialize/sync manager
    const manager = getBuildMapManager(projectId);
    // Note: In production, you'd want to sync the manager with DB state

    res.json(graph);
  } catch (error) {
    console.error("Error fetching build map:", error);
    res.status(500).json({ error: "Failed to fetch build map" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId
 * Create or update the build map (full graph replace)
 */
router.post("/:projectId", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const accountId = (req as AuthenticatedRequest).accountId!;
    const graph = req.body as BuildMapGraph;

    // Validate graph structure
    if (!graph.nodes || !graph.edges) {
      return res.status(400).json({ error: "Invalid graph: missing nodes or edges" });
    }

    // Upsert nodes
    for (const node of graph.nodes) {
      await db
        .insert(buildMapNodes)
        .values({
          id: node.id,
          projectId,
          type: node.type,
          title: node.title,
          description: node.description,
          status: node.status,
          priority: node.priority,
          assignee: node.assignee,
          files: node.files,
          tags: node.tags,
          estimate: node.estimate,
          actualTime: node.actualTime,
          dependencies: node.dependencies,
          dependents: node.dependents,
          positionX: node.position?.x,
          positionY: node.position?.y,
          metadata: node.metadata,
          createdBy: node.createdBy,
          updatedBy: accountId,
        })
        .onConflictDoUpdate({
          target: buildMapNodes.id,
          set: {
            type: node.type,
            title: node.title,
            description: node.description,
            status: node.status,
            priority: node.priority,
            assignee: node.assignee,
            files: node.files,
            tags: node.tags,
            estimate: node.estimate,
            actualTime: node.actualTime,
            dependencies: node.dependencies,
            dependents: node.dependents,
            positionX: node.position?.x,
            positionY: node.position?.y,
            metadata: node.metadata,
            updatedBy: accountId,
            updatedAt: new Date(),
          },
        });
    }

    // Upsert edges
    for (const edge of graph.edges) {
      await db
        .insert(buildMapEdges)
        .values({
          id: edge.id,
          projectId,
          sourceId: edge.source,
          targetId: edge.target,
          type: edge.type,
          label: edge.label,
          description: edge.description,
          metadata: edge.metadata,
          createdBy: edge.createdBy,
        })
        .onConflictDoUpdate({
          target: buildMapEdges.id,
          set: {
            sourceId: edge.source,
            targetId: edge.target,
            type: edge.type,
            label: edge.label,
            description: edge.description,
            metadata: edge.metadata,
          },
        });
    }

    // Update metadata
    if (graph.metadata) {
      await db
        .insert(buildMapMetadata)
        .values({
          projectId,
          layout: graph.metadata.layout,
          layoutOptions: graph.metadata.layoutOptions,
          viewportX: graph.metadata.viewport?.x || 0,
          viewportY: graph.metadata.viewport?.y || 0,
          viewportZoom: Math.round((graph.metadata.viewport?.zoom || 1) * 100),
          stats: graph.metadata.stats,
          lastUpdatedBy: accountId,
          lastUpdatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: buildMapMetadata.projectId,
          set: {
            layout: graph.metadata.layout,
            layoutOptions: graph.metadata.layoutOptions,
            viewportX: graph.metadata.viewport?.x || 0,
            viewportY: graph.metadata.viewport?.y || 0,
            viewportZoom: Math.round((graph.metadata.viewport?.zoom || 1) * 100),
            stats: graph.metadata.stats,
            lastUpdatedBy: accountId,
            lastUpdatedAt: new Date(),
          },
        });
    }

    // Create version snapshot
    const latestVersion = await db
      .select({ version: buildMapVersions.version })
      .from(buildMapVersions)
      .where(eq(buildMapVersions.projectId, projectId))
      .orderBy(desc(buildMapVersions.version))
      .limit(1);

    const nextVersion = (latestVersion[0]?.version || 0) + 1;

    await db.insert(buildMapVersions).values({
      projectId,
      version: nextVersion,
      graphSnapshot: graph,
      changedBy: accountId,
      changeSummary: `Graph updated via API (${graph.nodes.length} nodes, ${graph.edges.length} edges)`,
    });

    res.json({ success: true, version: nextVersion });
  } catch (error) {
    console.error("Error saving build map:", error);
    res.status(500).json({ error: "Failed to save build map" });
  }
});

/**
 * GET /api/infinity/build-map/:projectId/nodes
 * Get all nodes for a project (paginated)
 */
router.get("/:projectId/nodes", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const type = req.query.type as BuildMapNodeType | undefined;
    const status = req.query.status as BuildMapNodeStatus | undefined;
    const assignee = req.query.assignee as BuildMapAssignee | undefined;

    let query = db
      .select()
      .from(buildMapNodes)
      .where(eq(buildMapNodes.projectId, projectId))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(buildMapNodes.updatedAt));

    if (type) {
      query = query.where(eq(buildMapNodes.type, type));
    }
    if (status) {
      query = query.where(eq(buildMapNodes.status, status));
    }
    if (assignee) {
      query = query.where(eq(buildMapNodes.assignee, assignee));
    }

    const nodes = await query;

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(buildMapNodes)
      .where(eq(buildMapNodes.projectId, projectId));

    res.json({
      nodes: nodes.map(dbNodeToGraphNode),
      pagination: { limit, offset, total: total[0]?.count || 0 },
    });
  } catch (error) {
    console.error("Error fetching nodes:", error);
    res.status(500).json({ error: "Failed to fetch nodes" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/nodes
 * Create a new node
 */
router.post("/:projectId/nodes", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const accountId = (req as AuthenticatedRequest).accountId!;
    const now = new Date();

    const nodeSchema = z.object({
      id: z.string().uuid().optional(),
      type: BuildMapNodeType,
      title: z.string().min(1).max(500),
      description: z.string().optional(),
      status: BuildMapNodeStatus.default("planned"),
      priority: z.number().int().min(1).max(10).default(5),
      assignee: BuildMapAssignee.default("unassigned"),
      files: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      estimate: z.number().int().positive().optional(),
      actualTime: z.number().int().positive().optional(),
      dependencies: z.array(z.string()).default([]),
      dependents: z.array(z.string()).default([]),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      metadata: z.record(z.unknown()).default({}),
    });

    const data = nodeSchema.parse(req.body);
    const nodeId = data.id || crypto.randomUUID();

    await db.insert(buildMapNodes).values({
      id: nodeId,
      projectId,
      type: data.type,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      files: data.files,
      tags: data.tags,
      estimate: data.estimate,
      actualTime: data.actualTime,
      dependencies: data.dependencies,
      dependents: data.dependents,
      positionX: data.position?.x,
      positionY: data.position?.y,
      metadata: data.metadata,
      createdBy: "user",
      updatedBy: accountId,
      createdAt: now,
      updatedAt: now,
    });

    // Update dependents
    for (const depId of data.dependencies) {
      await db
        .update(buildMapNodes)
        .set({
          dependents: sql`array_append(${buildMapNodes.dependents}, ${nodeId})`,
          updatedAt: now,
        })
        .where(and(eq(buildMapNodes.id, depId), eq(buildMapNodes.projectId, projectId)));
    }

    const [node] = await db
      .select()
      .from(buildMapNodes)
      .where(and(eq(buildMapNodes.id, nodeId), eq(buildMapNodes.projectId, projectId)))
      .limit(1);

    res.status(201).json(dbNodeToGraphNode(node));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid node data", details: error.errors });
    }
    console.error("Error creating node:", error);
    res.status(500).json({ error: "Failed to create node" });
  }
});

/**
 * PATCH /api/infinity/build-map/:projectId/nodes/:nodeId
 * Update a node
 */
router.patch("/:projectId/nodes/:nodeId", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const nodeId = req.params.nodeId;
    const accountId = (req as AuthenticatedRequest).accountId!;
    const now = new Date();

    const updateSchema = z.object({
      type: BuildMapNodeType.optional(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().optional().nullable(),
      status: BuildMapNodeStatus.optional(),
      priority: z.number().int().min(1).max(10).optional(),
      assignee: BuildMapAssignee.optional(),
      files: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      estimate: z.number().int().positive().optional().nullable(),
      actualTime: z.number().int().positive().optional().nullable(),
      dependencies: z.array(z.string()).optional(),
      dependents: z.array(z.string()).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional().nullable(),
      metadata: z.record(z.unknown()).optional(),
    });

    const data = updateSchema.parse(req.body);

    const updateData: any = {
      updatedBy: accountId,
      updatedAt: now,
    };

    if (data.type !== undefined) updateData.type = data.type;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assignee !== undefined) updateData.assignee = data.assignee;
    if (data.files !== undefined) updateData.files = data.files;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.estimate !== undefined) updateData.estimate = data.estimate;
    if (data.actualTime !== undefined) updateData.actualTime = data.actualTime;
    if (data.dependencies !== undefined) updateData.dependencies = data.dependencies;
    if (data.dependents !== undefined) updateData.dependents = data.dependents;
    if (data.position !== undefined) {
      updateData.positionX = data.position?.x;
      updateData.positionY = data.position?.y;
    } else if (data.position === null) {
      updateData.positionX = null;
      updateData.positionY = null;
    }
    if (data.metadata !== undefined) updateData.metadata = data.metadata;

    await db
      .update(buildMapNodes)
      .set(updateData)
      .where(and(eq(buildMapNodes.id, nodeId), eq(buildMapNodes.projectId, projectId)));

    // Handle dependency changes
    if (data.dependencies !== undefined) {
      // Get current node to find old dependencies
      const [current] = await db
        .select()
        .from(buildMapNodes)
        .where(and(eq(buildMapNodes.id, nodeId), eq(buildMapNodes.projectId, projectId)))
        .limit(1);

      if (current) {
        const oldDeps = current.dependencies || [];
        const newDeps = data.dependencies;

        // Remove from old dependents
        for (const depId of oldDeps) {
          if (!newDeps.includes(depId)) {
            await db
              .update(buildMapNodes)
              .set({
                dependents: sql`(SELECT jsonb_agg(elem) FROM jsonb_array_elements(${buildMapNodes.dependents}) elem WHERE elem != ${depId})`,
                updatedAt: now,
              })
              .where(and(eq(buildMapNodes.id, depId), eq(buildMapNodes.projectId, projectId)));
          }
        }

        // Add to new dependents
        for (const depId of newDeps) {
          if (!oldDeps.includes(depId)) {
            await db
              .update(buildMapNodes)
              .set({
                dependents: sql`array_append(${buildMapNodes.dependents}, ${nodeId})`,
                updatedAt: now,
              })
              .where(and(eq(buildMapNodes.id, depId), eq(buildMapNodes.projectId, projectId)));
          }
        }
      }
    }

    const [node] = await db
      .select()
      .from(buildMapNodes)
      .where(and(eq(buildMapNodes.id, nodeId), eq(buildMapNodes.projectId, projectId)))
      .limit(1);

    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    res.json(dbNodeToGraphNode(node));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid node data", details: error.errors });
    }
    console.error("Error updating node:", error);
    res.status(500).json({ error: "Failed to update node" });
  }
});

/**
 * DELETE /api/infinity/build-map/:projectId/nodes/:nodeId
 * Delete a node
 */
router.delete("/:projectId/nodes/:nodeId", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const nodeId = req.params.nodeId;

    // Get node first to update dependents
    const [node] = await db
      .select()
      .from(buildMapNodes)
      .where(and(eq(buildMapNodes.id, nodeId), eq(buildMapNodes.projectId, projectId)))
      .limit(1);

    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    // Remove from dependents' dependencies
    for (const depId of node.dependents || []) {
      await db
        .update(buildMapNodes)
        .set({
          dependencies: sql`(SELECT jsonb_agg(elem) FROM jsonb_array_elements(${buildMapNodes.dependencies}) elem WHERE elem != ${nodeId})`,
          updatedAt: new Date(),
        })
        .where(and(eq(buildMapNodes.id, depId), eq(buildMapNodes.projectId, projectId)));
    }

    // Remove from dependencies' dependents
    for (const depId of node.dependencies || []) {
      await db
        .update(buildMapNodes)
        .set({
          dependents: sql`(SELECT jsonb_agg(elem) FROM jsonb_array_elements(${buildMapNodes.dependents}) elem WHERE elem != ${nodeId})`,
          updatedAt: new Date(),
        })
        .where(and(eq(buildMapNodes.id, depId), eq(buildMapNodes.projectId, projectId)));
    }

    // Delete edges connected to this node
    await db
      .delete(buildMapEdges)
      .where(
        and(
          eq(buildMapEdges.projectId, projectId),
          sql`(${buildMapEdges.sourceId} = ${nodeId} OR ${buildMapEdges.targetId} = ${nodeId})`
        )
      );

    // Delete the node
    await db
      .delete(buildMapNodes)
      .where(and(eq(buildMapNodes.id, nodeId), eq(buildMapNodes.projectId, projectId)));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting node:", error);
    res.status(500).json({ error: "Failed to delete node" });
  }
});

/**
 * GET /api/infinity/build-map/:projectId/edges
 * Get all edges for a project
 */
router.get("/:projectId/edges", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const sourceId = req.query.sourceId as string | undefined;
    const targetId = req.query.targetId as string | undefined;
    const type = req.query.type as BuildMapEdgeType | undefined;

    let query = db
      .select()
      .from(buildMapEdges)
      .where(eq(buildMapEdges.projectId, projectId))
      .orderBy(buildMapEdges.createdAt);

    if (sourceId) {
      query = query.where(eq(buildMapEdges.sourceId, sourceId));
    }
    if (targetId) {
      query = query.where(eq(buildMapEdges.targetId, targetId));
    }
    if (type) {
      query = query.where(eq(buildMapEdges.type, type));
    }

    const edges = await query;
    res.json({ edges: edges.map(dbEdgeToGraphEdge) });
  } catch (error) {
    console.error("Error fetching edges:", error);
    res.status(500).json({ error: "Failed to fetch edges" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/edges
 * Create a new edge
 */
router.post("/:projectId/edges", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const accountId = (req as AuthenticatedRequest).accountId!;

    const edgeSchema = z.object({
      id: z.string().uuid().optional(),
      source: z.string().uuid(),
      target: z.string().uuid(),
      type: BuildMapEdgeType,
      label: z.string().max(200).optional(),
      description: z.string().optional(),
      metadata: z.record(z.unknown()).default({}),
    });

    const data = edgeSchema.parse(req.body);
    const edgeId = data.id || crypto.randomUUID();

    // Verify both nodes exist and belong to project
    const [sourceNode] = await db
      .select()
      .from(buildMapNodes)
      .where(and(eq(buildMapNodes.id, data.source), eq(buildMapNodes.projectId, projectId)))
      .limit(1);

    const [targetNode] = await db
      .select()
      .from(buildMapNodes)
      .where(and(eq(buildMapNodes.id, data.target), eq(buildMapNodes.projectId, projectId)))
      .limit(1);

    if (!sourceNode || !targetNode) {
      return res.status(400).json({ error: "Source or target node not found in this project" });
    }

    await db.insert(buildMapEdges).values({
      id: edgeId,
      projectId,
      sourceId: data.source,
      targetId: data.target,
      type: data.type,
      label: data.label,
      description: data.description,
      metadata: data.metadata,
      createdBy: accountId,
    });

    const [edge] = await db
      .select()
      .from(buildMapEdges)
      .where(and(eq(buildMapEdges.id, edgeId), eq(buildMapEdges.projectId, projectId)))
      .limit(1);

    res.status(201).json(dbEdgeToGraphEdge(edge));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid edge data", details: error.errors });
    }
    console.error("Error creating edge:", error);
    res.status(500).json({ error: "Failed to create edge" });
  }
});

/**
 * DELETE /api/infinity/build-map/:projectId/edges/:edgeId
 * Delete an edge
 */
router.delete("/:projectId/edges/:edgeId", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const edgeId = req.params.edgeId;

    await db
      .delete(buildMapEdges)
      .where(and(eq(buildMapEdges.id, edgeId), eq(buildMapEdges.projectId, projectId)));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting edge:", error);
    res.status(500).json({ error: "Failed to delete edge" });
  }
});

/**
 * GET /api/infinity/build-map/:projectId/versions
 * Get version history
 */
router.get("/:projectId/versions", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const versions = await db
      .select()
      .from(buildMapVersions)
      .where(eq(buildMapVersions.projectId, projectId))
      .orderBy(desc(buildMapVersions.version))
      .limit(limit)
      .offset(offset);

    res.json({ versions });
  } catch (error) {
    console.error("Error fetching versions:", error);
    res.status(500).json({ error: "Failed to fetch versions" });
  }
});

/**
 * GET /api/infinity/build-map/:projectId/versions/:version
 * Get a specific version snapshot
 */
router.get("/:projectId/versions/:version", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const version = parseInt(req.params.version);

    const [versionRow] = await db
      .select()
      .from(buildMapVersions)
      .where(and(eq(buildMapVersions.projectId, projectId), eq(buildMapVersions.version, version)))
      .limit(1);

    if (!versionRow) {
      return res.status(404).json({ error: "Version not found" });
    }

    res.json(versionRow.graphSnapshot);
  } catch (error) {
    console.error("Error fetching version:", error);
    res.status(500).json({ error: "Failed to fetch version" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/analyze
 * Run AI analysis on the build map
 */
router.post("/:projectId/analyze", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const accountId = (req as AuthenticatedRequest).accountId!;

    const manager = getBuildMapManager(projectId);
    const analysis = manager.analyze();

    // Save suggestions to database
    for (const suggestion of analysis.suggestions) {
      if (suggestion.nodeId || suggestion.targetNodeId) {
        await db.insert(buildMapSuggestions).values({
          projectId,
          nodeId: suggestion.nodeId,
          targetNodeId: suggestion.targetNodeId,
          type: suggestion.type,
          title: suggestion.title,
          description: suggestion.description,
          confidence: Math.round(suggestion.confidence * 100),
          priority: suggestion.priority,
          autoApply: suggestion.autoApply,
          status: suggestion.autoApply ? "applied" : "pending",
          appliedAt: suggestion.autoApply ? new Date() : null,
          appliedBy: suggestion.autoApply ? "agent" : null,
        });
      }
    }

    res.json(analysis);
  } catch (error) {
    console.error("Error running analysis:", error);
    res.status(500).json({ error: "Failed to run analysis" });
  }
});

/**
 * GET /api/infinity/build-map/:projectId/suggestions
 * Get pending AI suggestions
 */
router.get("/:projectId/suggestions", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let query = db
      .select()
      .from(buildMapSuggestions)
      .where(eq(buildMapSuggestions.projectId, projectId))
      .orderBy(desc(buildMapSuggestions.createdAt))
      .limit(limit);

    if (status) {
      query = query.where(eq(buildMapSuggestions.status, status));
    }

    const suggestions = await query;
    res.json({ suggestions });
  } catch (error) {
    console.error("Error fetching suggestions:", error);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/suggestions/:suggestionId/accept
 * Accept an AI suggestion
 */
router.post("/:projectId/suggestions/:suggestionId/accept", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const suggestionId = req.params.suggestionId;
    const accountId = (req as AuthenticatedRequest).accountId!;

    const [suggestion] = await db
      .select()
      .from(buildMapSuggestions)
      .where(and(eq(buildMapSuggestions.id, suggestionId), eq(buildMapSuggestions.projectId, projectId)))
      .limit(1);

    if (!suggestion) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    const manager = getBuildMapManager(projectId);

    // Apply the suggestion based on type
    switch (suggestion.type) {
      case "add-node":
        if (suggestion.targetNodeId) {
          // Would need more context - for now just mark accepted
        }
        break;
      case "update-status":
        if (suggestion.nodeId) {
          // Parse new status from description or title
          // For now, just mark accepted
        }
        break;
      case "priority-change":
        if (suggestion.nodeId) {
          manager.updateNode(suggestion.nodeId, { priority: suggestion.priority });
        }
        break;
    }

    // Mark suggestion as accepted
    await db
      .update(buildMapSuggestions)
      .set({
        status: "accepted",
        appliedAt: new Date(),
        appliedBy: accountId,
      })
      .where(eq(buildMapSuggestions.id, suggestionId));

    res.json({ success: true });
  } catch (error) {
    console.error("Error accepting suggestion:", error);
    res.status(500).json({ error: "Failed to accept suggestion" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/suggestions/:suggestionId/reject
 * Reject an AI suggestion
 */
router.post("/:projectId/suggestions/:suggestionId/reject", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const suggestionId = req.params.suggestionId;
    const accountId = (req as AuthenticatedRequest).accountId!;

    await db
      .update(buildMapSuggestions)
      .set({
        status: "rejected",
        appliedAt: new Date(),
        appliedBy: accountId,
      })
      .where(and(eq(buildMapSuggestions.id, suggestionId), eq(buildMapSuggestions.projectId, projectId)));

    res.json({ success: true });
  } catch (error) {
    console.error("Error rejecting suggestion:", error);
    res.status(500).json({ error: "Failed to reject suggestion" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/layout
 * Apply layout algorithm
 */
router.post("/:projectId/layout", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const { algorithm } = req.body as { algorithm: BuildMapLayoutAlgorithm };

    const manager = getBuildMapManager(projectId);
    manager.layout(algorithm || "hierarchical");

    // Persist layout positions
    const graph = manager.getGraph();
    for (const node of graph.nodes) {
      if (node.position) {
        await db
          .update(buildMapNodes)
          .set({
            positionX: node.position.x,
            positionY: node.position.y,
            updatedAt: new Date(),
          })
          .where(and(eq(buildMapNodes.id, node.id), eq(buildMapNodes.projectId, projectId)));
      }
    }

    // Update metadata
    await db
      .update(buildMapMetadata)
      .set({
        layout: algorithm,
        lastUpdatedBy: (req as AuthenticatedRequest).accountId!,
        lastUpdatedAt: new Date(),
      })
      .where(eq(buildMapMetadata.projectId, projectId));

    res.json({ success: true, layout: algorithm });
  } catch (error) {
    console.error("Error applying layout:", error);
    res.status(500).json({ error: "Failed to apply layout" });
  }
});

/**
 * GET /api/infinity/build-map/:projectId/stats
 * Get graph statistics
 */
router.get("/:projectId/stats", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;

    const manager = getBuildMapManager(projectId);
    const graph = manager.getGraph();

    res.json(graph.metadata.stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/**
 * GET /api/infinity/build-map/:projectId/stream
 * SSE stream for real-time updates
 */
router.get("/:projectId/stream", async (req: Request, res: Response) => {
  const projectId = req.params.projectId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const manager = getBuildMapManager(projectId);

  const sendEvent = (type: string, data: any) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial graph
  sendEvent("graph", manager.getGraph());

  // Subscribe to changes
  const unsubscribe = manager.subscribe((graph) => {
    sendEvent("graph:update", graph);
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * POST /api/infinity/build-map/:projectId/agent/step-complete
 * Notify agent that a build step completed (triggers map update)
 */
router.post("/:projectId/agent/step-complete", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const context = req.body as {
      stepId: string;
      stepName: string;
      goal: string;
      filesChanged: string[];
      diffSummary: string;
    };

    const agent = getBuildMapAgent(projectId);
    const result = await agent.onBuildStepComplete({
      ...context,
      projectId,
      timestamp: new Date().toISOString(),
    });

    res.json(result);
  } catch (error) {
    console.error("Error processing step complete:", error);
    res.status(500).json({ error: "Failed to process step completion" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/agent/weekly
 * Run weekly analysis
 */
router.post("/:projectId/agent/weekly", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const agent = getBuildMapAgent(projectId);
    const analysis = await agent.runWeeklyAnalysis();
    res.json(analysis);
  } catch (error) {
    console.error("Error running weekly analysis:", error);
    res.status(500).json({ error: "Failed to run weekly analysis" });
  }
});

/**
 * POST /api/infinity/build-map/:projectId/agent/create-feature
 * Create feature from natural language
 */
router.post("/:projectId/agent/create-feature", requireScope("build:write"), async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const { description } = req.body as { description: string };

    const agent = getBuildMapAgent(projectId);
    const node = await agent.createFeatureFromDescription(description);
    res.status(201).json(node);
  } catch (error) {
    console.error("Error creating feature:", error);
    res.status(500).json({ error: "Failed to create feature" });
  }
});

export default router;