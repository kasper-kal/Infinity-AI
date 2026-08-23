import { Router } from "express";
import { db, timers, type Timer } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { scheduleTimer, cancelScheduledTimer, startTimerScheduler } from "../../lib/timer-scheduler";

const router = Router();

// Resume any timers that were mid-flight before a server restart (fire-and-forget).
startTimerScheduler().catch(() => {});

const MAX_TIMER_SECONDS = 24 * 60 * 60; // 24h cap, a "timer" beyond this is a scheduled job

/** Wall-clock remaining time (ms) for a row, regardless of status. */
function remainingMsOf(t: Timer): number {
  if (t.status === "active" && t.fireAt) return Math.max(0, new Date(t.fireAt).getTime() - Date.now());
  if (t.status === "paused") return (t.remainingSeconds ?? 0) * 1000;
  return 0;
}

function serialize(t: Timer) {
  return { ...t, remainingMs: remainingMsOf(t) };
}

/** List timers the frontend should still show: active + paused, newest first. */
router.get("/timers", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(timers)
      .where(inArray(timers.status, ["active", "paused"]))
      .orderBy(desc(timers.createdAt));
    res.json(rows.map(serialize));
  } catch (err) {
    req.log.error({ err }, "Failed to list timers");
    res.status(500).json({ error: "Failed to list timers" });
  }
});

/** Create a timer. fireAt = now + durationSeconds, scheduled server-side. */
router.post("/timers", async (req, res) => {
  try {
    const { durationSeconds, label, conversationId } = req.body as {
      durationSeconds?: number;
      label?: string;
      conversationId?: string;
    };
    const seconds = Math.floor(Number(durationSeconds));
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMER_SECONDS) {
      res.status(400).json({ error: `durationSeconds must be between 1 and ${MAX_TIMER_SECONDS}` });
      return;
    }
    const [row] = await db
      .insert(timers)
      .values({
        durationSeconds: seconds,
        fireAt: new Date(Date.now() + seconds * 1000),
        label: label?.trim().slice(0, 100) || null,
        conversationId: conversationId || null,
        status: "active",
      })
      .returning();
    scheduleTimer(row);
    req.log.info({ timerId: row.id, durationSeconds: seconds, label: row.label ?? undefined }, "Timer set");
    res.json(serialize(row));
  } catch (err) {
    req.log.error({ err }, "Failed to create timer");
    res.status(500).json({ error: "Failed to create timer" });
  }
});

/** Extend the current timer by `addSeconds` (matches the chat widget's "add" action). */
router.post("/timers/:id/extend", async (req, res) => {
  try {
    const addSeconds = Math.floor(Number(req.body?.addSeconds));
    if (!Number.isFinite(addSeconds) || addSeconds <= 0) {
      res.status(400).json({ error: "addSeconds must be a positive number" });
      return;
    }
    const [row] = await db.select().from(timers).where(eq(timers.id, req.params.id));
    if (!row) {
      res.status(404).json({ error: "Timer not found" });
      return;
    }
    const currentRemainingSec = Math.max(1, Math.ceil(remainingMsOf(row) / 1000));
    const newRemainingSec = currentRemainingSec + addSeconds;
    cancelScheduledTimer(row.id);
    const [updated] = await db
      .update(timers)
      .set({
        status: "active",
        fireAt: new Date(Date.now() + newRemainingSec * 1000),
        remainingSeconds: null,
        durationSeconds: newRemainingSec, // progress bar restarts from full
      })
      .where(eq(timers.id, row.id))
      .returning();
    scheduleTimer(updated);
    res.json(serialize(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to extend timer");
    res.status(500).json({ error: "Failed to extend timer" });
  }
});

/** Pause a running timer, captures the remaining time, clears the setTimeout. */
router.post("/timers/:id/pause", async (req, res) => {
  try {
    const [row] = await db.select().from(timers).where(eq(timers.id, req.params.id));
    if (!row) {
      res.status(404).json({ error: "Timer not found" });
      return;
    }
    if (row.status !== "active") {
      res.json(serialize(row));
      return;
    }
    const remainingSeconds = Math.max(1, Math.ceil(remainingMsOf(row) / 1000));
    cancelScheduledTimer(row.id);
    const [updated] = await db
      .update(timers)
      .set({ status: "paused", fireAt: null, remainingSeconds })
      .where(eq(timers.id, row.id))
      .returning();
    res.json(serialize(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to pause timer");
    res.status(500).json({ error: "Failed to pause timer" });
  }
});

/** Resume a paused timer, schedules a new fireAt from the saved remaining time. */
router.post("/timers/:id/resume", async (req, res) => {
  try {
    const [row] = await db.select().from(timers).where(eq(timers.id, req.params.id));
    if (!row) {
      res.status(404).json({ error: "Timer not found" });
      return;
    }
    if (row.status !== "paused") {
      res.json(serialize(row));
      return;
    }
    const remainingSeconds = Math.max(1, row.remainingSeconds ?? row.durationSeconds);
    cancelScheduledTimer(row.id);
    const [updated] = await db
      .update(timers)
      .set({ status: "active", fireAt: new Date(Date.now() + remainingSeconds * 1000), remainingSeconds: null })
      .where(eq(timers.id, row.id))
      .returning();
    scheduleTimer(updated);
    res.json(serialize(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to resume timer");
    res.status(500).json({ error: "Failed to resume timer" });
  }
});

/** Cancel a timer, removes the scheduled fire. */
router.post("/timers/:id/cancel", async (req, res) => {
  try {
    const [row] = await db.select().from(timers).where(eq(timers.id, req.params.id));
    if (!row) {
      res.status(404).json({ error: "Timer not found" });
      return;
    }
    cancelScheduledTimer(row.id);
    const [updated] = await db
      .update(timers)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(timers.id, row.id))
      .returning();
    res.json(serialize(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to cancel timer");
    res.status(500).json({ error: "Failed to cancel timer" });
  }
});

export default router;
