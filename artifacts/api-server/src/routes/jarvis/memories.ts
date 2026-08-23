import { Router } from "express";
import { db, userMemories } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

/** GET /api/infinity/memories, list all remembered facts */
router.get("/memories", async (_req, res) => {
  try {
    const rows = await db.select().from(userMemories).orderBy(userMemories.updatedAt);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load memories" });
  }
});

/** PATCH /api/infinity/memories/:topic, edit the value of a remembered fact */
router.patch("/memories/:topic", async (req, res) => {
  const topic = req.params["topic"];
  const { value } = req.body as { value?: string };
  if (!topic || !value || typeof value !== "string") {
    res.status(400).json({ error: "topic and value are required" });
    return;
  }
  try {
    await db
      .update(userMemories)
      .set({ value: value.trim().slice(0, 500), updatedAt: new Date() })
      .where(eq(userMemories.topic, topic));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update memory" });
  }
});

/** DELETE /api/infinity/memories/:topic, forget a specific fact */
router.delete("/memories/:topic", async (req, res) => {
  const topic = req.params["topic"];
  if (!topic) {
    res.status(400).json({ error: "topic is required" });
    return;
  }
  try {
    await db.delete(userMemories).where(eq(userMemories.topic, topic));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

export default router;
