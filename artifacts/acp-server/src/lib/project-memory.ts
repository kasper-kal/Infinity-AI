// ACP-specific project memory read/write helpers.
// The api-server lib only has buildRelevantProjectMemoryContext/compactMemory,
// but ACP tools need simple key-value read/write. Implement locally here.
import { db, projectMemories, type ProjectMemory } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export async function readProjectMemory(
  projectId: string,
  key?: string,
): Promise<ProjectMemory[] | ProjectMemory | null> {
  if (key) {
    const [row] = await db
      .select()
      .from(projectMemories)
      .where(
        and(
          eq(projectMemories.projectId, projectId),
          eq(projectMemories.key, key),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  return db
    .select()
    .from(projectMemories)
    .where(eq(projectMemories.projectId, projectId));
}

export async function writeProjectMemory(
  projectId: string,
  key: string,
  value: string,
): Promise<ProjectMemory> {
  const existing = await db
    .select()
    .from(projectMemories)
    .where(
      and(
        eq(projectMemories.projectId, projectId),
        eq(projectMemories.key, key),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(projectMemories)
      .set({ content: value, updatedAt: new Date() })
      .where(eq(projectMemories.id, existing[0].id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(projectMemories)
    .values({ projectId, key, content: value, category: "general" })
    .returning();
  return inserted;
}
