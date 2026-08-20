/**
 * Phase 22: Universal Tool Layer — Memory Capability Integration
 *
 * Registers project memory and global memory tools.
 * Wraps existing implementations from project-memories.ts and memories.ts.
 */

import { registerTool } from "../tool-registry";
import { db, projectMemories, userMemories } from "@workspace/db";
import { eq, desc, ilike, and, or } from "drizzle-orm";
import { logger } from "../logger";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";
import { canonicalProjectMemoryKey } from "../project-memory";

export function registerMemoryTools(): void {
  const projectMemoryList: UniversalToolDefinition = {
    name: "memory.list",
    description: "List project-scoped memories, optionally filtered by query. Returns memories with content, category, and metadata.",
    category: "memory",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID (required for project memories)" },
        query: { type: "string", description: "Search query for content/key/category" },
        limit: { type: "number", description: "Max results (default: 100)" },
      },
      required: ["projectId"],
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      if (!projectId) return { success: false, error: "projectId is required" };
      try {
        const query = String(args["query"] ?? "").trim();
        const limit = Math.min(500, Math.max(1, Number(args["limit"] ?? 100)));

        const rows = await db
          .select()
          .from(projectMemories)
          .where(query
            ? and(
                eq(projectMemories.projectId, projectId),
                or(
                  ilike(projectMemories.content, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
                  ilike(projectMemories.key, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
                  ilike(projectMemories.category, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
                ),
              )
            : eq(projectMemories.projectId, projectId))
          .orderBy(desc(projectMemories.pinned), desc(projectMemories.updatedAt))
          .limit(limit);

        return {
          success: true,
          data: { memories: rows, count: rows.length },
          summary: `Found ${rows.length} project memories`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "List failed" };
      }
    },
  };

  const projectMemoryRead: UniversalToolDefinition = {
    name: "memory.read",
    description: "Read a specific project memory by ID.",
    category: "memory",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        memoryId: { type: "string", description: "Memory ID" },
      },
      required: ["projectId", "memoryId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const memoryId = String(args["memoryId"] ?? "").trim();
      if (!projectId || !memoryId) return { success: false, error: "projectId and memoryId are required" };
      try {
        const [memory] = await db
          .select()
          .from(projectMemories)
          .where(and(eq(projectMemories.id, memoryId), eq(projectMemories.projectId, projectId)));
        if (!memory) return { success: false, error: "Memory not found" };
        return { success: true, data: memory, summary: `Memory: ${memory.content.slice(0, 80)}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Read failed" };
      }
    },
  };

  const projectMemoryWrite: UniversalToolDefinition = {
    name: "memory.write",
    description: "Add or update a project memory (upserts by canonical key). Use for facts, decisions, and context to persist across sessions.",
    category: "memory",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        content: { type: "string", description: "Memory content (max 4000 chars)" },
        key: { type: "string", description: "Optional custom key (default: auto-generated from content)" },
        category: { type: "string", description: "Category/topic (default: 'about')" },
        pinned: { type: "boolean", description: "Pin to top of lists (default: false)" },
        sourceRef: { type: "string", description: "Optional source reference (URL, file, etc.)" },
      },
      required: ["projectId", "content"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const content = String(args["content"] ?? "").trim();
      if (!projectId) return { success: false, error: "projectId is required" };
      if (!content) return { success: false, error: "content is required" };
      try {
        const key = canonicalProjectMemoryKey(String(args["key"] ?? "").trim() || content);
        if (!key) return { success: false, error: "A non-empty key or content is required" };

        const category = String(args["category"] ?? "about").toLowerCase().replace(/\s+/g, "_").slice(0, 60) || "about";
        const pinned = args["pinned"] === true;
        const sourceRef = String(args["sourceRef"] ?? "").trim().slice(0, 500);

        const [row] = await db
          .insert(projectMemories)
          .values({
            projectId,
            category,
            content: content.slice(0, 4000),
            key,
            sourceType: "manual",
            sourceRef: sourceRef || "",
            pinned,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [projectMemories.projectId, projectMemories.key],
            set: {
              category,
              content: content.slice(0, 4000),
              sourceType: "manual",
              sourceRef: sourceRef || "",
              pinned,
              updatedAt: new Date(),
            },
          })
          .returning();

        return { success: true, data: row, summary: `Memory saved: ${key}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Write failed" };
      }
    },
  };

  const projectMemoryUpdate: UniversalToolDefinition = {
    name: "memory.update",
    description: "Update fields of an existing project memory by ID.",
    category: "memory",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        memoryId: { type: "string", description: "Memory ID" },
        content: { type: "string", description: "New content (max 4000 chars)" },
        category: { type: "string", description: "New category" },
        pinned: { type: "boolean", description: "Pin/unpin" },
        sourceRef: { type: "string", description: "New source reference" },
      },
      required: ["projectId", "memoryId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const memoryId = String(args["memoryId"] ?? "").trim();
      if (!projectId || !memoryId) return { success: false, error: "projectId and memoryId are required" };
      try {
        const hasContent = "content" in args;
        const hasCategory = "category" in args;
        const hasPinned = "pinned" in args;
        const hasSourceRef = "sourceRef" in args;
        if (!hasContent && !hasCategory && !hasPinned && !hasSourceRef) {
          return { success: false, error: "No memory fields to update" };
        }

        const content = hasContent ? String(args["content"] ?? "").trim().slice(0, 4000) : undefined;
        if (hasContent && !content) return { success: false, error: "content cannot be empty" };

        const category = hasCategory
          ? String(args["category"] ?? "about").toLowerCase().replace(/\s+/g, "_").slice(0, 60) || "about"
          : undefined;
        const pinned = hasPinned ? Boolean(args["pinned"]) : undefined;
        const sourceRef = hasSourceRef ? String(args["sourceRef"] ?? "").trim().slice(0, 500) : undefined;

        const [updated] = await db
          .update(projectMemories)
          .set({
            ...(hasContent ? { content } : {}),
            ...(hasCategory ? { category } : {}),
            ...(hasPinned ? { pinned } : {}),
            ...(hasSourceRef ? { sourceRef } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(projectMemories.id, memoryId), eq(projectMemories.projectId, projectId)))
          .returning();

        if (!updated) return { success: false, error: "Memory not found" };
        return { success: true, data: updated, summary: `Memory updated: ${updated.content.slice(0, 80)}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Update failed" };
      }
    },
  };

  const projectMemoryDelete: UniversalToolDefinition = {
    name: "memory.delete",
    description: "Delete a project memory by ID.",
    category: "memory",
    risk: "DESTRUCTIVE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        memoryId: { type: "string", description: "Memory ID" },
      },
      required: ["projectId", "memoryId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const memoryId = String(args["memoryId"] ?? "").trim();
      if (!projectId || !memoryId) return { success: false, error: "projectId and memoryId are required" };
      try {
        const [deleted] = await db
          .delete(projectMemories)
          .where(and(eq(projectMemories.id, memoryId), eq(projectMemories.projectId, projectId)))
          .returning({ id: projectMemories.id });
        if (!deleted) return { success: false, error: "Memory not found" };
        return { success: true, data: { ok: true, id: deleted.id }, summary: `Memory deleted: ${memoryId}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Delete failed" };
      }
    },
  };

  const projectMemoryPin: UniversalToolDefinition = {
    name: "memory.pin",
    description: "Pin or unpin a project memory to keep it at the top of lists.",
    category: "memory",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        memoryId: { type: "string", description: "Memory ID" },
        pinned: { type: "boolean", description: "Whether to pin (default: true)" },
      },
      required: ["projectId", "memoryId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const memoryId = String(args["memoryId"] ?? "").trim();
      if (!projectId || !memoryId) return { success: false, error: "projectId and memoryId are required" };
      const pinned = args["pinned"] !== false;
      try {
        const [updated] = await db
          .update(projectMemories)
          .set({ pinned, updatedAt: new Date() })
          .where(and(eq(projectMemories.id, memoryId), eq(projectMemories.projectId, projectId)))
          .returning();
        if (!updated) return { success: false, error: "Memory not found" };
        return { success: true, data: updated, summary: `Memory ${pinned ? "pinned" : "unpinned"}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Pin failed" };
      }
    },
  };

  // Global user memories (non-project-scoped)
  const globalMemoryList: UniversalToolDefinition = {
    name: "memory.global_list",
    description: "List global user memories (not project-scoped).",
    category: "memory",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default: 100)" },
      },
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      try {
        const limit = Math.min(500, Math.max(1, Number(args["limit"] ?? 100)));
        const rows = await db.select().from(userMemories).orderBy(desc(userMemories.updatedAt)).limit(limit);
        return { success: true, data: { memories: rows, count: rows.length }, summary: `Found ${rows.length} global memories` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Global list failed" };
      }
    },
  };

  const globalMemoryWrite: UniversalToolDefinition = {
    name: "memory.global_write",
    description: "Add or update a global user memory by topic.",
    category: "memory",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Memory topic/key" },
        value: { type: "string", description: "Memory value (max 500 chars)" },
      },
      required: ["topic", "value"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const topic = String(args["topic"] ?? "").trim();
      const value = String(args["value"] ?? "").trim().slice(0, 500);
      if (!topic || !value) return { success: false, error: "topic and value are required" };
      try {
        await db
          .insert(userMemories)
          .values({ topic, value, updatedAt: new Date() })
          .onConflictDoUpdate({ target: userMemories.topic, set: { value, updatedAt: new Date() } });
        return { success: true, data: { topic, value }, summary: `Global memory saved: ${topic}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Global write failed" };
      }
    },
  };

  const globalMemoryDelete: UniversalToolDefinition = {
    name: "memory.global_delete",
    description: "Delete a global user memory by topic.",
    category: "memory",
    risk: "DESTRUCTIVE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: { topic: { type: "string", description: "Memory topic/key" } },
      required: ["topic"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const topic = String(args["topic"] ?? "").trim();
      if (!topic) return { success: false, error: "topic is required" };
      try {
        await db.delete(userMemories).where(eq(userMemories.topic, topic));
        return { success: true, data: { ok: true }, summary: `Global memory deleted: ${topic}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Global delete failed" };
      }
    },
  };

  registerTool(projectMemoryList);
  registerTool(projectMemoryRead);
  registerTool(projectMemoryWrite);
  registerTool(projectMemoryUpdate);
  registerTool(projectMemoryDelete);
  registerTool(projectMemoryPin);
  registerTool(globalMemoryList);
  registerTool(globalMemoryWrite);
  registerTool(globalMemoryDelete);
  logger.info("[tools/memory] Registered 9 memory tools (6 project, 3 global)");
}