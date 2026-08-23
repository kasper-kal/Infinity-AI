import { Router } from "express";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  conversations,
  messages,
  pins,
  projectChats,
  projectFiles,
  projectInstructions,
  projectMemories,
  projectTasks,
  projects,
  shareLinks,
} from "@workspace/db";
import { filesDb, files } from "@workspace/db";
import { logActivity } from "./project-activity";

const router = Router();

type ProjectSort = "updated" | "created" | "name" | "recently-used";

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hasBodyField(body: unknown, field: string): boolean {
  return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, field);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseArchived(value: unknown): boolean | "all" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "all") return "all";
  return raw === "true" || raw === "1";
}

function parseSort(value: unknown): ProjectSort {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  if (raw === "created") return "created";
  if (raw === "name") return "name";
  if (raw === "recent" || raw === "recently-used" || raw === "recentlyused" || raw === "last-opened") {
    return "recently-used";
  }
  return "updated";
}

async function findProject(id: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  return project;
}

async function findConversation(id: string) {
  const [conversation] = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(eq(conversations.id, id));
  return conversation;
}

async function moveConversation(conversationId: string, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const previousLinks = await tx
      .select({ projectId: projectChats.projectId })
      .from(projectChats)
      .where(eq(projectChats.conversationId, conversationId));

    await tx
      .delete(projectChats)
      .where(eq(projectChats.conversationId, conversationId));

    await tx.insert(projectChats).values({ projectId, conversationId });

    const now = new Date();
    await tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId));
    for (const previousProjectId of new Set(previousLinks.map((link) => link.projectId))) {
      if (previousProjectId !== projectId) {
        await tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, previousProjectId));
      }
    }
  });

  // Log activity for conversation moved to project
  await logActivity(projectId, "conversation_started", `Conversation moved to project`);
}

async function removeConversationLinks(conversationId: string, projectId?: string): Promise<number> {
  return db.transaction(async (tx) => {
    const condition = projectId
      ? and(eq(projectChats.conversationId, conversationId), eq(projectChats.projectId, projectId))
      : eq(projectChats.conversationId, conversationId);
    const existing = await tx
      .select({ projectId: projectChats.projectId })
      .from(projectChats)
      .where(condition);

    if (existing.length === 0) return 0;

    await tx.delete(projectChats).where(condition);
    const now = new Date();
    for (const affectedProjectId of new Set(existing.map((link) => link.projectId))) {
      await tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, affectedProjectId));
    }
    return existing.length;
  });
}

async function listProjectConversations(req: Request, res: Response): Promise<void> {
  const projectId = cleanText(req.params.id, 80);
  try {
    const project = await findProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(projectChats)
      .innerJoin(conversations, eq(projectChats.conversationId, conversations.id))
      .where(eq(projectChats.projectId, projectId))
      .orderBy(desc(conversations.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to load project conversations");
    res.status(500).json({ error: "Failed to load project conversations" });
  }
}

router.get("/projects", async (req, res) => {
  const query = cleanText(req.query.q, 120);
  const archived = parseArchived(req.query.archived);
  const sort = parseSort(req.query.sort);

  try {
    const filters = [];
    if (archived !== "all") filters.push(eq(projects.archived, archived));
    if (query) {
      const search = or(
        ilike(projects.name, `%${escapeLike(query)}%`),
        ilike(projects.description, `%${escapeLike(query)}%`),
      );
      if (search) filters.push(search);
    }

    const filter = filters.length > 1 ? and(...filters) : filters[0];
    const queryBuilder = db.select().from(projects);
    const filteredQuery = filter ? queryBuilder.where(filter) : queryBuilder;

    const rows = sort === "created"
      ? await filteredQuery.orderBy(desc(projects.pinned), desc(projects.createdAt))
      : sort === "name"
        ? await filteredQuery.orderBy(desc(projects.pinned), asc(projects.name), desc(projects.updatedAt))
        : sort === "recently-used"
          ? await filteredQuery.orderBy(
            desc(projects.pinned),
            sql`${projects.lastOpenedAt} DESC NULLS LAST`,
            desc(projects.updatedAt),
          )
          : await filteredQuery.orderBy(desc(projects.pinned), desc(projects.updatedAt));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to load projects");
    res.status(500).json({ error: "Failed to load projects" });
  }
});

router.get("/projects/:id", async (req, res) => {
  try {
    const project = await findProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  } catch (err) {
    req.log.error({ err }, "Failed to load project");
    res.status(500).json({ error: "Failed to load project" });
  }
});

router.get("/projects/:id/home", async (req, res) => {
  try {
    const project = await findProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [
      conversationCountRows,
      conversationLatest,
      fileCountRows,
      fileRows,
      memoryCountRows,
      memoryLatest,
      taskCountRows,
      taskRows,
    ] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(projectChats)
        .where(eq(projectChats.projectId, project.id)),
      db
        .select({
          id: conversations.id,
          title: conversations.title,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt,
        })
        .from(projectChats)
        .innerJoin(conversations, eq(projectChats.conversationId, conversations.id))
        .where(eq(projectChats.projectId, project.id))
        .orderBy(desc(conversations.updatedAt))
        .limit(5),
      db
        .select({ count: sql<number>`count(*)` })
        .from(projectFiles)
        .where(eq(projectFiles.projectId, project.id)),
      db
        .select({
          id: projectFiles.id,
          projectId: projectFiles.projectId,
          fileId: projectFiles.fileId,
          name: projectFiles.name,
          createdAt: projectFiles.createdAt,
        })
        .from(projectFiles)
        .where(eq(projectFiles.projectId, project.id))
        .orderBy(desc(projectFiles.createdAt))
        .limit(5),
      db
        .select({ count: sql<number>`count(*)` })
        .from(projectMemories)
        .where(eq(projectMemories.projectId, project.id)),
      db
        .select({
          id: projectMemories.id,
          category: projectMemories.category,
          content: projectMemories.content,
          pinned: projectMemories.pinned,
          createdAt: projectMemories.createdAt,
          updatedAt: projectMemories.updatedAt,
        })
        .from(projectMemories)
        .where(eq(projectMemories.projectId, project.id))
        .orderBy(desc(projectMemories.pinned), desc(projectMemories.updatedAt))
        .limit(5),
      db
        .select({ count: sql<number>`count(*)` })
        .from(projectTasks)
        .where(eq(projectTasks.projectId, project.id)),
      db
        .select({
          id: projectTasks.id,
          title: projectTasks.title,
          status: projectTasks.status,
          dueAt: projectTasks.dueAt,
          createdAt: projectTasks.createdAt,
        })
        .from(projectTasks)
        .where(eq(projectTasks.projectId, project.id))
        .orderBy(desc(projectTasks.createdAt))
        .limit(5),
    ]);

    const fileIds = fileRows.map((r) => r.fileId);
    const fileMetadata = fileIds.length > 0
      ? await filesDb
          .select()
          .from(files)
          .where(sql`${files.id} = ANY(${fileIds})`)
      : [];
    const metadataById = new Map(fileMetadata.map((f) => [f.id, f]));

    const fileLatest = fileRows.map((r) => {
      const meta = metadataById.get(r.fileId);
      return {
        id: r.fileId,
        projectFileId: r.id,
        name: r.name || meta?.name || "file",
        kind: meta?.kind,
        mime: meta?.mime,
        size: meta?.size,
        owner: meta?.owner,
        bucket: meta?.bucket,
        createdAt: r.createdAt || meta?.createdAt,
        url: meta ? `/api/files/${encodeURIComponent(meta.storageKey)}` : null,
      };
    });

    const taskLatest = taskRows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      dueAt: r.dueAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    // Phase I/M will add first-class research, task, and activity tables. Until
    // those phases land, derive a useful activity feed from the
    // project and the relationships that already exist.
    const recentActivity = [
      {
        type: "project_created",
        description: project.name,
        createdAt: project.createdAt,
      },
      ...conversationLatest.map((conversation) => ({
        type: "conversation",
        description: conversation.title,
        createdAt: conversation.updatedAt,
      })),
      ...fileLatest.map((file) => ({
        type: "file",
        description: file.name,
        createdAt: file.createdAt,
      })),
      ...memoryLatest.map((memory) => ({
        type: "memory",
        description: memory.content,
        createdAt: memory.updatedAt,
      })),
      ...taskLatest.map((task) => ({
        type: "task",
        description: task.title,
        createdAt: task.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    res.json({
      project,
      counts: {
        conversations: Number(conversationCountRows[0]?.count ?? 0),
        files: Number(fileCountRows[0]?.count ?? 0),
        research: 0,
        tasks: Number(taskCountRows[0]?.count ?? 0),
        memory: Number(memoryCountRows[0]?.count ?? 0),
      },
      latest: {
        conversations: conversationLatest,
        files: fileLatest,
        research: [],
        tasks: [],
        memory: memoryLatest,
      },
      recentActivity,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load project home");
    res.status(500).json({ error: "Failed to load project home" });
  }
});

router.post("/projects", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const fromConversationId = cleanText(body?.fromConversationId, 80);
  let sourceConversation: { id: string; title: string } | undefined;

  if (fromConversationId) {
    try {
      const [conversation] = await db
        .select({ id: conversations.id, title: conversations.title })
        .from(conversations)
        .where(eq(conversations.id, fromConversationId));
      if (!conversation) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      sourceConversation = conversation;
    } catch (err) {
      req.log.error({ err }, "Failed to load source conversation");
      res.status(500).json({ error: "Failed to create project from conversation" });
      return;
    }
  }

  const name = cleanText(body?.name, 80) || cleanText(sourceConversation?.title, 80);
  if (!name) {
    res.status(400).json({ error: "Project name is required" });
    return;
  }

  const description = hasBodyField(body, "description") ? cleanText(body?.description, 4000) : "";
  const color = cleanText(body?.color, 32) || "#0ea5e9";
  const instructions = hasBodyField(body, "instructions")
    ? cleanText(body?.instructions, 4000) || null
    : null;

  try {
    if (!sourceConversation) {
      const [row] = await db.insert(projects).values({
        name,
        description,
        color,
        instructions,
      }).returning();
      await logActivity(row.id, "project_created", row.name);
      res.status(201).json(row);
      return;
    }

    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(projects).values({
        name,
        description,
        color,
        instructions,
      }).returning();
      await tx
        .delete(projectChats)
        .where(eq(projectChats.conversationId, sourceConversation.id));
      await tx.insert(projectChats).values({
        projectId: created.id,
        conversationId: sourceConversation.id,
      });
      return created;
    });

    await logActivity(row.id, "project_created", row.name);
    res.status(201).json({ ...row, fromConversationId: sourceConversation.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.patch("/projects/:id", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const hasName = hasBodyField(body, "name");
  const hasDescription = hasBodyField(body, "description");
  const hasColor = hasBodyField(body, "color");
  const hasInstructions = hasBodyField(body, "instructions");
  const hasArchived = hasBodyField(body, "archived");
  const name = cleanText(body?.name, 80);
  const description = cleanText(body?.description, 4000);
  const color = cleanText(body?.color, 32);
  const instructions = cleanText(body?.instructions, 4000);

  if (hasName && !name) {
    res.status(400).json({ error: "Project name cannot be empty" });
    return;
  }
  if (hasColor && !color) {
    res.status(400).json({ error: "Project color cannot be empty" });
    return;
  }
  if (hasArchived && typeof body?.archived !== "boolean") {
    res.status(400).json({ error: "archived must be a boolean" });
    return;
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(projects).set({
        ...(hasName ? { name } : {}),
        ...(hasDescription ? { description } : {}),
        ...(hasColor ? { color } : {}),
        ...(hasInstructions ? { instructions: instructions || null } : {}),
        ...(hasArchived ? { archived: body?.archived as boolean } : {}),
        updatedAt: new Date(),
      }).where(eq(projects.id, req.params.id)).returning();

      // Keep the legacy PATCH contract two-way compatible with the dedicated
      // ordered table: an old client sending one instruction block replaces
      // the dedicated rules for that project as one rule.
      if (updated && hasInstructions) {
        await tx.delete(projectInstructions).where(eq(projectInstructions.projectId, updated.id));
        if (instructions) {
          await tx.insert(projectInstructions).values({
            projectId: updated.id,
            text: instructions,
            sortOrder: 0,
          });
        }
      }
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.delete("/projects/:id", async (req, res) => {
  try {
    const [existing] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await db.delete(projects).where(eq(projects.id, req.params.id));
    await logActivity(existing.id, "project_created", `Project "${existing.name}" deleted`);
    res.json({ ok: true, id: existing.id });
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

router.post("/projects/:id/open", async (req, res) => {
  try {
    const [row] = await db.update(projects).set({
      lastOpenedAt: new Date(),
    }).where(eq(projects.id, req.params.id)).returning();
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to mark project as opened");
    res.status(500).json({ error: "Failed to open project" });
  }
});

router.post("/projects/:id/pin", async (req, res) => {
  try {
    const [row] = await db.update(projects).set({
      pinned: true,
      updatedAt: new Date(),
    }).where(eq(projects.id, req.params.id)).returning();
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to pin project");
    res.status(500).json({ error: "Failed to pin project" });
  }
});

router.delete("/projects/:id/pin", async (req, res) => {
  try {
    const [row] = await db.update(projects).set({
      pinned: false,
      updatedAt: new Date(),
    }).where(eq(projects.id, req.params.id)).returning();
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to unpin project");
    res.status(500).json({ error: "Failed to unpin project" });
  }
});

router.get("/projects/:id/files", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  try {
    const project = await findProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const rows = await db
      .select({
        id: projectFiles.id,
        projectId: projectFiles.projectId,
        fileId: projectFiles.fileId,
        name: projectFiles.name,
        createdAt: projectFiles.createdAt,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, project.id))
      .orderBy(desc(projectFiles.createdAt));

    const fileIds = rows.map((r) => r.fileId);
    const fileMetadata = fileIds.length > 0
      ? await filesDb
          .select()
          .from(files)
          .where(sql`${files.id} = ANY(${fileIds})`)
      : [];

    const metadataById = new Map(fileMetadata.map((f) => [f.id, f]));

    res.json({
      files: rows.map((r) => {
        const meta = metadataById.get(r.fileId);
        return {
          id: r.fileId,
          projectFileId: r.id,
          name: r.name || meta?.name || "file",
          kind: meta?.kind,
          mime: meta?.mime,
          size: meta?.size,
          owner: meta?.owner,
          bucket: meta?.bucket,
          createdAt: r.createdAt || meta?.createdAt,
          url: meta ? `/api/files/${encodeURIComponent(meta.storageKey)}` : null,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load project files");
    res.status(500).json({ error: "Failed to load project files" });
  }
});

router.get(["/projects/:id/chats", "/projects/:id/conversations"], listProjectConversations);

router.post("/projects/:id/chats", async (req, res) => {
  const conversationId = cleanText(req.body?.conversationId, 80);
  if (!conversationId) {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }

  try {
    const [project, conversation] = await Promise.all([
      findProject(req.params.id),
      findConversation(conversationId),
    ]);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    await moveConversation(conversationId, project.id);
    const [membership] = await db
      .select()
      .from(projectChats)
      .where(and(
        eq(projectChats.projectId, project.id),
        eq(projectChats.conversationId, conversation.id),
      ));
    await logActivity(project.id, "conversation_started", `Conversation "${conversation.title}" added to project`);
    res.status(201).json(membership);
  } catch (err) {
    req.log.error({ err }, "Failed to move chat to project");
    res.status(500).json({ error: "Failed to add chat to project" });
  }
});

router.delete("/projects/:id/chats/:conversationId", async (req, res) => {
  try {
    const project = await findProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const conversation = await findConversation(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const removed = await removeConversationLinks(req.params.conversationId, req.params.id);
    await logActivity(project.id, "conversation_started", `Conversation "${conversation.title}" removed from project`);
    res.json({ ok: true, removed });
  } catch (err) {
    req.log.error({ err }, "Failed to remove chat from project");
    res.status(500).json({ error: "Failed to remove chat from project" });
  }
});

router.post("/conversations/:id/project", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 80);
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  try {
    const [project, conversation] = await Promise.all([
      findProject(projectId),
      findConversation(req.params.id),
    ]);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    await moveConversation(conversation.id, project.id);
    await logActivity(project.id, "conversation_started", `Conversation "${conversation.title}" moved to project`);
    res.json({ conversationId: conversation.id, project });
  } catch (err) {
    req.log.error({ err }, "Failed to move conversation to project");
    res.status(500).json({ error: "Failed to move conversation to project" });
  }
});

router.delete("/conversations/:id/project", async (req, res) => {
  try {
    const conversation = await findConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const removed = await removeConversationLinks(conversation.id);
    // Note: We don't know which project(s) it was removed from in this endpoint,
    // but the removeConversationLinks already updates project updatedAt timestamps
    res.json({ ok: true, removed });
  } catch (err) {
    req.log.error({ err }, "Failed to remove conversation from project");
    res.status(500).json({ error: "Failed to remove conversation from project" });
  }
});

router.post("/conversations/:id/pin", async (req, res) => {
  try {
    const [existing] = await db.select().from(pins).where(eq(pins.conversationId, req.params.id));
    if (existing) {
      await db.delete(pins).where(eq(pins.conversationId, req.params.id));
      res.json({ pinned: false });
    } else {
      await db.insert(pins).values({ conversationId: req.params.id });
      res.json({ pinned: true });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle pin" });
  }
});

router.get("/conversations/:id/pin", async (req, res) => {
  try {
    const [row] = await db.select().from(pins).where(eq(pins.conversationId, req.params.id));
    res.json({ pinned: Boolean(row) });
  } catch (err) {
    res.status(500).json({ error: "Failed to read pin" });
  }
});

router.post("/conversations/:id/share", async (req, res) => {
  try {
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, req.params.id));
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const token = randomBytes(18).toString("base64url");
    const [row] = await db.insert(shareLinks).values({ conversationId: req.params.id, token }).returning();
    res.status(201).json({ token: row.token, url: `/api/infinity/share/${row.token}` });
  } catch (err) {
    res.status(500).json({ error: "Failed to create share link" });
  }
});

router.get("/share/:token", async (req, res) => {
  try {
    const [link] = await db.select().from(shareLinks).where(eq(shareLinks.token, req.params.token));
    if (!link || (link.expiresAt && link.expiresAt < new Date())) {
      res.status(404).json({ error: "Share link not found or expired" });
      return;
    }
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, link.conversationId));
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const rows = await db.select().from(messages).where(eq(messages.conversationId, link.conversationId)).orderBy(asc(messages.createdAt));
    res.json({ ...conversation, messages: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to load shared conversation" });
  }
});

export default router;
