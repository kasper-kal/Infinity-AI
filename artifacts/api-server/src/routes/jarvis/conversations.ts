import { Router } from "express";
import { db, conversations, messages, projectChats, projects } from "@workspace/db";
import { eq, desc, asc, ilike, and, inArray, notInArray } from "drizzle-orm";
import { logActivity } from "./project-activity";

const router = Router();

function cleanProjectId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

async function findProject(projectId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project;
}

/**
 * GET /api/jarvis/conversations/search?q=...
 * Episodic memory search, matches conversation titles AND message content,
 * returning matching conversations with a snippet of the first hit.
 * Add projectId to keep the search strictly inside one project.
 */
router.get("/conversations/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const projectId = cleanProjectId(req.query.projectId);
  if (!q) {
    res.json([]);
    return;
  }
  try {
    let projectConversationIds: string[] | null = null;
    let excludedProjectConversationIds: string[] = [];
    if (projectId) {
      const project = await findProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const links = await db
        .select({ conversationId: projectChats.conversationId })
        .from(projectChats)
        .where(eq(projectChats.projectId, projectId));
      projectConversationIds = links.map((link) => link.conversationId);
      if (projectConversationIds.length === 0) {
        res.json([]);
        return;
      }
    } else {
      const projectLinks = await db
        .select({ conversationId: projectChats.conversationId })
        .from(projectChats);
      excludedProjectConversationIds = projectLinks.map((link) => link.conversationId);
    }

    const escapedQuery = q.replace(/[%_]/g, (match) => String.fromCharCode(92) + match);
    const pattern = "%" + escapedQuery + "%";
    const titleCondition = projectConversationIds
      ? and(ilike(conversations.title, pattern), inArray(conversations.id, projectConversationIds))
      : excludedProjectConversationIds.length > 0
        ? and(ilike(conversations.title, pattern), notInArray(conversations.id, excludedProjectConversationIds))
        : ilike(conversations.title, pattern);

    // Conversations whose title matches.
    const titleMatches = await db
      .select()
      .from(conversations)
      .where(titleCondition)
      .orderBy(desc(conversations.updatedAt));

    // Message content matches (join back to their conversations).
    const messageCondition = projectConversationIds
      ? and(ilike(messages.content, pattern), inArray(messages.conversationId, projectConversationIds))
      : excludedProjectConversationIds.length > 0
        ? and(ilike(messages.content, pattern), notInArray(messages.conversationId, excludedProjectConversationIds))
        : ilike(messages.content, pattern);
    const msgRows = await db
      .select({
        conversationId: messages.conversationId,
        content: messages.content,
      })
      .from(messages)
      .where(messageCondition)
      .orderBy(desc(messages.createdAt))
      .limit(40);

    const convIds = [...new Set(msgRows.map((m) => m.conversationId))];
    const convMap = new Map<string, { id: string; title: string; createdAt: string; updatedAt: string }>();
    if (convIds.length > 0) {
      const matched = await db
        .select()
        .from(conversations)
        .where(inArray(conversations.id, convIds));
      for (const c of matched) convMap.set(c.id, c as any);
    }

    const snippetFor = new Map<string, string>();
    for (const m of msgRows) {
      if (!snippetFor.has(m.conversationId)) {
        const idx = (m.content ?? "").toLowerCase().indexOf(q.toLowerCase());
        const start = Math.max(0, idx - 60);
        snippetFor.set(
          m.conversationId,
          (m.content ?? "").slice(start, start + 180).replace(/\s+/g, " "),
        );
      }
    }

    const seen = new Set<string>();
    const results: { id: string; title: string; createdAt: string; updatedAt: string; snippet?: string }[] = [];
    for (const c of titleMatches) {
      seen.add(c.id);
      results.push({ ...(c as any), snippet: `Title matches: ${c.title}` });
    }
    for (const c of convMap.values()) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      results.push({ ...c, snippet: snippetFor.get(c.id) });
    }
    res.json(results.slice(0, 30));
  } catch (err) {
    req.log.error({ err }, "Failed to search conversations");
    res.status(500).json({ error: "Failed to search conversations" });
  }
});

/** List all conversations, newest first. Add projectId for a scoped list. */
router.get("/conversations", async (req, res) => {
  const projectId = cleanProjectId(req.query.projectId);
  try {
    if (!projectId) {
      const projectLinks = await db
        .select({ conversationId: projectChats.conversationId })
        .from(projectChats);
      const projectConversationIds = projectLinks.map((link) => link.conversationId);
      const rows = projectConversationIds.length > 0
        ? await db
          .select()
          .from(conversations)
          .where(notInArray(conversations.id, projectConversationIds))
          .orderBy(desc(conversations.updatedAt))
        : await db
          .select()
          .from(conversations)
          .orderBy(desc(conversations.updatedAt));
      res.json(rows);
      return;
    }

    const project = await findProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        kind: conversations.kind,
        systemPrompt: conversations.systemPrompt,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(projectChats)
      .innerJoin(conversations, eq(projectChats.conversationId, conversations.id))
      .where(eq(projectChats.projectId, projectId))
      .orderBy(desc(conversations.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list conversations");
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

/** Create a new empty conversation, optionally inside a project. */
router.post("/conversations", async (req, res) => {
  const projectId = cleanProjectId(req.body?.projectId);
  try {
    if (projectId && !(await findProject(projectId))) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(conversations)
        .values({ title: "New Conversation" })
        .returning();
      if (projectId) {
        await tx.insert(projectChats).values({
          projectId,
          conversationId: created.id,
        });
        await tx
          .update(projects)
          .set({ updatedAt: new Date() })
          .where(eq(projects.id, projectId));
      }
      return created;
    });

    if (projectId) {
      await logActivity(projectId, "conversation_started", `Conversation "${row.title}" created`);
    }
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

/**
 * POST /conversations/expert
 * Create a user-defined expert, a conversation with kind "gem" (DB legacy value,
 * kept for backward compatibility) and a custom system prompt. The chat route
 * already prefers systemPrompt when set, so chatting in this conversation makes
 * Jarvis behave as the crafted expert.
 */
router.post("/conversations/expert", async (req, res) => {
  try {
    const { title, systemPrompt } = req.body as {
      title?: string;
      systemPrompt?: string;
    };
    const cleanTitle = (title ?? "").trim().slice(0, 120);
    const cleanPrompt = (systemPrompt ?? "").trim();
    if (!cleanPrompt) {
      res.status(400).json({ error: "systemPrompt is required" });
      return;
    }
    if (cleanPrompt.length > 12000) {
      res.status(400).json({ error: "systemPrompt is too long (max 12000 chars)" });
      return;
    }
    const [row] = await db
      .insert(conversations)
      .values({
        title: cleanTitle || "New expert",
        kind: "gem",
        systemPrompt: cleanPrompt,
      })
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create expert");
    res.status(500).json({ error: "Failed to create expert" });
  }
});

/** Get a single conversation with its messages */
router.get("/conversations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    res.json({ ...conv, messages: msgs });
  } catch (err) {
    req.log.error({ err }, "Failed to get conversation");
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

/** Delete a conversation (messages cascade) */
router.delete("/conversations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.delete(conversations).where(eq(conversations.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete conversation");
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

/** Delete all conversations (messages cascade) */
router.delete("/conversations", async (req, res) => {
  try {
    // Delete all messages first, then all conversations
    await db.delete(messages);
    await db.delete(conversations);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete all conversations");
    res.status(500).json({ error: "Failed to delete all conversations" });
  }
});

export default router;
