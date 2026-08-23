import { Router } from "express";
import {
  createWorkspaceDirectory,
  deleteWorkspacePath,
  ensureWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  renameWorkspacePath,
  WORKSPACE_ROOT,
  writeWorkspaceFile,
} from "../../lib/workspace";

const router = Router();

function workspaceId(req: { query: Record<string, unknown>; body?: unknown }): string {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  return String(req.query.workspaceId ?? body.workspaceId ?? "default");
}

router.get("/workspace", async (req, res) => {
  const id = workspaceId(req);
  const rel = typeof req.query.path === "string" ? req.query.path : "";
  try {
    if (!rel) {
      const files = await listWorkspaceFiles(id);
      res.json({ workspaceId: id, root: id === "default" ? WORKSPACE_ROOT : undefined, files });
      return;
    }
    const result = await readWorkspaceFile(rel, 100_000, id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ workspaceId: id, path: rel, content: result.content });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Workspace failed" });
  }
});

router.post("/workspace", async (req, res) => {
  const id = workspaceId(req);
  const rel = req.body?.path;
  const content = req.body?.content;
  if (typeof rel !== "string" || !rel) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  const result = await writeWorkspaceFile(rel, typeof content === "string" ? content : "", id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ...result, workspaceId: id });
});

router.post("/workspace/mkdir", async (req, res) => {
  const id = workspaceId(req);
  const rel = req.body?.path;
  if (typeof rel !== "string" || !rel.trim()) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  try {
    res.status(201).json({ ...(await createWorkspaceDirectory(rel, id)), workspaceId: id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not create directory" });
  }
});

router.patch("/workspace", async (req, res) => {
  const id = workspaceId(req);
  const from = req.body?.from;
  const to = req.body?.to;
  if (typeof from !== "string" || typeof to !== "string" || !from || !to) {
    res.status(400).json({ error: "from and to are required" });
    return;
  }
  try {
    res.json({ ...(await renameWorkspacePath(from, to, id)), workspaceId: id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not rename path" });
  }
});

router.delete("/workspace", async (req, res) => {
  const id = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";
  const rel = typeof req.query.path === "string" ? req.query.path : "";
  if (!rel) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  try {
    res.json({ ...(await deleteWorkspacePath(rel, id)), workspaceId: id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not delete path" });
  }
});

export default router;
