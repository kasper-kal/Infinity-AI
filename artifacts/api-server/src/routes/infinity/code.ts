import { Router } from "express";
import {
  REPO_ROOT,
  listSourceFiles,
  readSourceFile,
} from "../../lib/source-code";

const router = Router();

/**
 * GET /api/infinity/code            → list the repository tree (relative paths)
 * GET /api/infinity/code?path=X     → read a single file (text, capped)
 *
 * Read-only. Jarvis uses this to inspect the code that built him; he can never
 * modify anything through this endpoint.
 */
router.get("/code", async (req, res) => {
  const rel = (req.query.path as string | undefined) ?? "";

  try {
    if (!rel) {
      // ── Tree listing ──────────────────────────────────────────────
      const files = await listSourceFiles();
      res.json({ root: REPO_ROOT, files });
      return;
    }

    // ── Single file ─────────────────────────────────────────────────
    const result = await readSourceFile(rel, 60_000);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      path: result.path,
      size: result.size,
      content: result.content,
      truncated: result.truncated,
    });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
  }
});

export default router;
