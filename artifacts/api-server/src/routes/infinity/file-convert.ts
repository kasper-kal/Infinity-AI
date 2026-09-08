/**
 * Phase 41 — File Format Conversion REST routes
 *
 * POST /detect     — detect format from buffer
 * POST /convert    — convert a file between formats
 * POST /batch      — batch-convert multiple files
 * POST /info       — file metadata / info
 * GET  /formats    — grouped format registry
 *
 * All endpoints accept base64-encoded file data (no multipart needed).
 * Modeled on routes/infinity/recipes.ts pattern.
 */
import { Router, Request, Response } from "express";
import {
  fileConverter,
  listFormatGroups,
  listSupportedConversions,
  UnsupportedConversionError,
  canonicalFormat,
} from "../../lib/file-converter.js";

const router = Router();

// ============================================================================
// POST /detect — detect format from buffer
// ============================================================================

router.post("/file-convert/detect", async (req: Request, res: Response) => {
  try {
    const { data, filename } = req.body as {
      data?: string; // base64
      filename?: string;
    };
    if (!data) {
      return res.status(400).json({ error: "data (base64) is required" });
    }
    const buffer = Buffer.from(data, "base64");
    const result = await fileConverter.detect(buffer, filename);
    res.json(result);
  } catch (error) {
    console.error("[file-convert/detect]", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Detect failed" });
  }
});

// ============================================================================
// POST /convert — convert a single file
// ============================================================================

router.post("/file-convert/convert", async (req: Request, res: Response) => {
  try {
    const { data, filename, from, to, options } = req.body as {
      data?: string; // base64
      filename?: string;
      from?: string;
      to?: string;
      options?: Record<string, unknown>;
    };
    if (!data) {
      return res.status(400).json({ error: "data (base64) is required" });
    }
    if (!to) {
      return res.status(400).json({ error: "to (target format) is required" });
    }
    const buffer = Buffer.from(data, "base64");
    const result = await fileConverter.convert({
      buffer,
      from,
      to,
      filename,
      options,
    });
    res.json({
      data: result.buffer.toString("base64"),
      format: result.format,
      mime: result.mime,
      ext: result.ext,
      size: result.buffer.length,
      meta: result.meta,
    });
  } catch (error) {
    if (error instanceof UnsupportedConversionError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[file-convert/convert]", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Conversion failed" });
  }
});

// ============================================================================
// POST /batch — batch-convert multiple files
// ============================================================================

router.post("/file-convert/batch", async (req: Request, res: Response) => {
  try {
    const { files, to, options } = req.body as {
      files?: Array<{ data: string; name: string }>;
      to?: string;
      options?: Record<string, unknown>;
    };
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files array is required" });
    }
    if (!to) {
      return res.status(400).json({ error: "to (target format) is required" });
    }
    const batchFiles = files.map((f) => ({
      name: f.name,
      buffer: Buffer.from(f.data, "base64"),
    }));
    const results = await fileConverter.convertBatch(batchFiles, to, options);
    res.json({ results });
  } catch (error) {
    console.error("[file-convert/batch]", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Batch conversion failed" });
  }
});

// ============================================================================
// POST /info — file metadata / info
// ============================================================================

router.post("/file-convert/info", async (req: Request, res: Response) => {
  try {
    const { data, filename } = req.body as {
      data?: string; // base64
      filename?: string;
    };
    if (!data) {
      return res.status(400).json({ error: "data (base64) is required" });
    }
    const buffer = Buffer.from(data, "base64");
    const info = await fileConverter.info(buffer, filename);
    res.json(info);
  } catch (error) {
    console.error("[file-convert/info]", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Info failed" });
  }
});

// ============================================================================
// GET /formats — grouped format registry
// ============================================================================

router.get("/file-convert/formats", (_req: Request, res: Response) => {
  try {
    const groups = listFormatGroups();
    const conversions = listSupportedConversions();
    res.json({ groups, conversions, total: conversions.length });
  } catch (error) {
    console.error("[file-convert/formats]", error);
    res.status(500).json({ error: "Failed to list formats" });
  }
});

// ============================================================================
// GET /formats/supported/:from — supported output formats for a given input
// ============================================================================

router.get("/file-convert/formats/supported/:from", (req: Request, res: Response) => {
  try {
    const from = canonicalFormat(req.params.from);
    if (!from) {
      return res.status(400).json({ error: `Unknown format: ${req.params.from}` });
    }
    const supported = fileConverter.supported(from);
    res.json({ from, supported });
  } catch (error) {
    console.error("[file-convert/formats/supported]", error);
    res.status(500).json({ error: "Failed to list supported formats" });
  }
});

export default router;
