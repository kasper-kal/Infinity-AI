/**
 * Phase L — AI Context Pipeline.
 *
 * Assembles the full scoped `PROJECT CONTEXT` block for a project conversation
 * from six sources: identity, instructions, memory, files, history, research.
 * Every sub-source is strictly filtered by projectId so context never leaks
 * across projects or into global chats.
 */
import { db, filesDb, files, projectChats, projectFiles, projectResearch, projectInstructions, projects, researchJobs, messages, conversations } from "@workspace/db";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import { getStorage } from "./storage";
import { buildRelevantProjectMemoryContext } from "./project-memory";

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "an", "and", "are", "as", "at", "be", "been",
  "but", "by", "can", "do", "for", "from", "how", "i", "if", "in", "into",
  "is", "it", "its", "me", "my", "of", "on", "or", "our", "please", "that",
  "the", "their", "this", "to", "us", "was", "we", "what", "when", "where",
  "which", "who", "why", "with", "you", "your",
]);

function tokenize(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function scoreText(text: string, queryTerms: Set<string>): number {
  const terms = new Set(tokenize(text));
  let score = 0;
  for (const term of queryTerms) {
    if (terms.has(term)) score += 1;
  }
  return score;
}

/** Extract a short excerpt of a text-like file's content for context. */
async function readFileExcerpt(storageKey: string, maxBytes = 4000): Promise<string | null> {
  try {
    const storage = getStorage();
    const blob = await storage.get(storageKey);
    if (!blob) return null;
    const text = blob.data.subarray(0, maxBytes).toString("utf-8");
    return text.replace(/\s+/g, " ").trim().slice(0, 1200) || null;
  } catch {
    return null;
  }
}

/** Source 4 — relevant project files, keyword-scored. */
async function buildProjectFilesContext(projectId: string, userMessage: string): Promise<string | null> {
  const rows = await db
    .select({ fileId: projectFiles.fileId, name: projectFiles.name })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(desc(projectFiles.createdAt))
    .limit(50);

  if (rows.length === 0) return null;

  const fileIds = rows.map((r) => r.fileId);
  const metadata = fileIds.length > 0
    ? await filesDb.select().from(files).where(sql`${files.id} = ANY(${fileIds})`)
    : [];
  const metaById = new Map(metadata.map((f) => [f.id, f]));

  const queryTerms = new Set(tokenize(userMessage));
  const scored = rows
    .map((row) => {
      const meta = metaById.get(row.fileId);
      const text = `${row.name} ${meta?.kind ?? ""} ${meta?.mime ?? ""}`;
      return { row, meta, score: scoreText(text, queryTerms) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const selected = scored.length > 0 ? scored : rows.slice(0, 6).map((row) => ({ row, meta: metaById.get(row.fileId), score: 0 }));

  const lines = await Promise.all(
    selected.map(async ({ row, meta }) => {
      const url = meta ? `/api/files/${encodeURIComponent(meta.storageKey)}` : null;
      const isText = meta?.mime?.startsWith("text/") || meta?.mime === "application/json" || meta?.kind === "code" || meta?.kind === "document";
      let excerpt = "";
      if (isText && meta?.storageKey) {
        const content = await readFileExcerpt(meta.storageKey);
        if (content) excerpt = `\n    Excerpt: ${content}`;
      }
      return `- ${row.name}${meta?.kind ? ` (${meta.kind})` : ""}${url ? ` — ${url}` : ""}${excerpt}`;
    }),
  );

  if (lines.length === 0) return null;
  return [
    "## PROJECT FILES",
    "Reference material available in this project:",
    ...lines,
  ].join("\n");
}

/** Source 5 — relevant project conversation history (other conversations). */
async function buildProjectHistoryContext(projectId: string, currentConversationId: string, userMessage: string): Promise<string | null> {
  const otherChats = await db
    .select({ conversationId: projectChats.conversationId })
    .from(projectChats)
    .where(and(eq(projectChats.projectId, projectId), sql`${projectChats.conversationId} != ${currentConversationId}`))
    .limit(20);

  if (otherChats.length === 0) return null;

  const queryTerms = new Set(tokenize(userMessage));
  const excerpts: string[] = [];

  for (const chat of otherChats) {
    const msgs = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, chat.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(20);

    for (const msg of msgs) {
      if (msg.role !== "user" || !msg.content) continue;
      if (scoreText(msg.content, queryTerms) > 0) {
        excerpts.push(msg.content.replace(/\s+/g, " ").trim().slice(0, 400));
      }
    }
    if (excerpts.length >= 10) break;
  }

  if (excerpts.length === 0) return null;
  return [
    "## RELATED PROJECT HISTORY",
    "Context from earlier conversations in this project:",
    ...excerpts.slice(0, 6).map((e) => `- ${e}`),
  ].join("\n");
}

/** Source 6 — relevant research runs (keyword-scored). */
async function buildProjectResearchContext(projectId: string, userMessage: string): Promise<string | null> {
  const joins = await db
    .select({ researchJobId: projectResearch.researchJobId })
    .from(projectResearch)
    .where(eq(projectResearch.projectId, projectId))
    .limit(20);

  if (joins.length === 0) return null;

  const jobIds = joins.map((j) => j.researchJobId);
  const jobs = await db
    .select()
    .from(researchJobs)
    .where(sql`${researchJobs.id} = ANY(${jobIds})`);

  if (jobs.length === 0) return null;

  const queryTerms = new Set(tokenize(userMessage));
  const scored = jobs
    .map((job) => ({
      job,
      score: scoreText(`${job.title} ${job.prompt} ${job.report} ${job.notes}`, queryTerms),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const selected = scored.length > 0 ? scored : jobs.slice(0, 3).map((job) => ({ job, score: 0 }));

  const lines = selected.map(({ job }) => {
    const reportExcerpt = job.report?.replace(/\s+/g, " ").trim().slice(0, 500) ||
      job.notes?.replace(/\s+/g, " ").trim().slice(0, 500) || "";
    const statusLabel = job.status === "completed" ? "completed" : job.status;
    return `- **${job.title}** (${statusLabel}): ${reportExcerpt || job.prompt?.slice(0, 200)}`;
  });

  if (lines.length === 0) return null;
  return [
    "## PROJECT RESEARCH",
    "Relevant research runs attached to this project:",
    ...lines,
  ].join("\n");
}

export interface BuiltProjectContext {
  projectId: string;
  projectName: string;
  conversationTitle: string;
  prompt: string;
}

/**
 * Build the full six-source PROJECT CONTEXT block for one conversation.
 * Returns null when the conversation is not project-scoped.
 */
export async function buildFullProjectContext(
  conversationId: string,
  userMessage: string,
): Promise<BuiltProjectContext | null> {
  const [project] = await db
    .select({
      projectId: projects.id,
      name: projects.name,
      description: projects.description,
      instructions: projects.instructions,
      conversationTitle: conversations.title,
    })
    .from(projectChats)
    .innerJoin(projects, eq(projectChats.projectId, projects.id))
    .innerJoin(conversations, eq(projectChats.conversationId, conversations.id))
    .where(eq(projectChats.conversationId, conversationId))
    .limit(1);

  if (!project) return null;

  const newline = String.fromCharCode(10);
  let instructions = project.instructions?.trim() ?? "";
  try {
    const instructionRows = await db
      .select({ text: projectInstructions.text })
      .from(projectInstructions)
      .where(eq(projectInstructions.projectId, project.projectId))
      .orderBy(asc(projectInstructions.sortOrder), asc(projectInstructions.createdAt));
    const dedicatedInstructions = instructionRows.map((row) => row.text.trim()).filter(Boolean);
    if (dedicatedInstructions.length > 0) instructions = dedicatedInstructions.join(newline);
  } catch {
    // Keep legacy project instructions available if the new table is not ready.
  }

  const identity = project.description?.trim()
    ? `You are working inside the Infinity project '${project.name}'. Project description: ${project.description.trim()}`
    : `You are working inside the Infinity project '${project.name}'.`;

  const parts = ['## PROJECT CONTEXT' + newline + identity];

  if (instructions) {
    parts.push(
      '## PROJECT INSTRUCTIONS' + newline +
        'These are explicit rules for this project. Follow them whenever they apply:' + newline +
        instructions,
    );
  }

  // Source 3 — relevant project memory (Phase E engine).
  try {
    const memoryContext = await buildRelevantProjectMemoryContext(project.projectId, userMessage);
    if (memoryContext) parts.push(memoryContext);
  } catch (err) {
    console.warn({ err, projectId: project.projectId }, "Project memory retrieval failed; continuing without it");
  }

  // Source 4 — relevant project files.
  try {
    const filesContext = await buildProjectFilesContext(project.projectId, userMessage);
    if (filesContext) parts.push(filesContext);
  } catch (err) {
    console.warn({ err, projectId: project.projectId }, "Project files retrieval failed; continuing without it");
  }

  // Source 5 — relevant project conversation history (other conversations).
  try {
    const historyContext = await buildProjectHistoryContext(project.projectId, conversationId, userMessage);
    if (historyContext) parts.push(historyContext);
  } catch (err) {
    console.warn({ err, projectId: project.projectId }, "Project history retrieval failed; continuing without it");
  }

  // Source 6 — relevant research runs.
  try {
    const researchContext = await buildProjectResearchContext(project.projectId, userMessage);
    if (researchContext) parts.push(researchContext);
  } catch (err) {
    console.warn({ err, projectId: project.projectId }, "Project research retrieval failed; continuing without it");
  }

  return {
    projectId: project.projectId,
    projectName: project.name,
    conversationTitle: project.conversationTitle,
    prompt: parts.join(newline + newline),
  };
}
