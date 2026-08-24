import { Router, type Request, type Response } from "express";
import { DesignCanvasEngine } from "../../lib/design-canvas";
import { createAmbientIntelligence, AmbientIntelligence } from "../../lib/ambient-intelligence";
import { requireAuth, AuthenticatedRequest } from "../../middleware/auth-middleware";
import { getDesignModels } from "../../lib/adapter-factory";

function getProjectId(req: AuthenticatedRequest): string {
  return Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
}

function getLayerId(req: AuthenticatedRequest): string {
  return Array.isArray(req.params.layerId) ? req.params.layerId[0] : req.params.layerId;
}

function getArtifactId(req: AuthenticatedRequest): string {
  return Array.isArray(req.params.artifactId) ? req.params.artifactId[0] : req.params.artifactId;
}

function getSuggestionId(req: AuthenticatedRequest): string {
  return Array.isArray(req.params.suggestionId) ? req.params.suggestionId[0] : req.params.suggestionId;
}

const router = Router();

// Singleton instances per project
const canvasEngines = new Map<string, DesignCanvasEngine>();
const ambientEngines = new Map<string, AmbientIntelligence>();

function getCanvasEngine(projectId: string): DesignCanvasEngine {
  if (!canvasEngines.has(projectId)) {
    canvasEngines.set(projectId, new DesignCanvasEngine());
  }
  return canvasEngines.get(projectId)!;
}

function getAmbientEngine(projectId: string): AmbientIntelligence {
  if (!ambientEngines.has(projectId)) {
    const canvas = getCanvasEngine(projectId);
    ambientEngines.set(projectId, createAmbientIntelligence(canvas));
  }
  return ambientEngines.get(projectId)!;
}

// ============================================================================
// Canvas State Endpoints
// ============================================================================

/** Get full canvas state for a project */
router.get("/design-canvas/:projectId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);

    // Check project ownership
    // TODO: Add project ownership check

    const layers = engine.getLayers();
    const selection = engine.getSelectedLayers();
    const viewport = engine.getViewport();
    const designSystem = engine.getDesignSystem();
    const artifacts = engine.getAllArtifacts();

    return res.json({
      ok: true,
      layers,
      selection: Array.from(selection),
      viewport,
      designSystem,
      artifacts,
      breakpoints: engine.getBreakpoints(),
      currentBreakpoint: engine.getCurrentBreakpoint(),
    });
  } catch (error) {
    console.error('Design canvas get error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get canvas state" });
  }
});

/** Get layers for a project */
router.get("/design-canvas/:projectId/layers", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    const layers = engine.getLayers();
    return res.json({ ok: true, layers });
  } catch (error) {
    console.error('Get layers error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get layers" });
  }
});

/** Create a new layer */
router.post("/design-canvas/:projectId/layers", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    const layer = engine.createLayer(req.body);
    return res.json({ ok: true, layer });
  } catch (error) {
    console.error('Create layer error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to create layer" });
  }
});

/** Update a layer */
router.patch("/design-canvas/:projectId/layers/:layerId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const layerId = getLayerId(req);
    const engine = getCanvasEngine(projectId);
    const layer = engine.updateLayer(layerId, req.body);
    if (!layer) return res.status(404).json({ ok: false, error: "Layer not found" });
    return res.json({ ok: true, layer });
  } catch (error) {
    console.error('Update layer error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to update layer" });
  }
});

/** Delete a layer */
router.delete("/design-canvas/:projectId/layers/:layerId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const layerId = getLayerId(req);
    const engine = getCanvasEngine(projectId);
    const success = engine.deleteLayer(layerId);
    if (!success) return res.status(404).json({ ok: false, error: "Layer not found" });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Delete layer error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to delete layer" });
  }
});

/** Move a layer */
router.post("/design-canvas/:projectId/layers/:layerId/move", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const layerId = getLayerId(req);
    const { delta } = req.body;
    const engine = getCanvasEngine(projectId);
    const layer = engine.moveLayer(layerId, delta);
    if (!layer) return res.status(404).json({ ok: false, error: "Layer not found" });
    return res.json({ ok: true, layer });
  } catch (error) {
    console.error('Move layer error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to move layer" });
  }
});

/** Resize a layer */
router.post("/design-canvas/:projectId/layers/:layerId/resize", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const layerId = getLayerId(req);
    const { bounds } = req.body;
    const engine = getCanvasEngine(projectId);
    const layer = engine.resizeLayer(layerId, bounds);
    if (!layer) return res.status(404).json({ ok: false, error: "Layer not found" });
    return res.json({ ok: true, layer });
  } catch (error) {
    console.error('Resize layer error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to resize layer" });
  }
});

/** Reorder a layer */
router.post("/design-canvas/:projectId/layers/:layerId/reorder", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const layerId = getLayerId(req);
    const { newIndex } = req.body;
    const engine = getCanvasEngine(projectId);
    const layer = engine.reorderLayer(layerId, newIndex);
    if (!layer) return res.status(404).json({ ok: false, error: "Layer not found" });
    return res.json({ ok: true, layer });
  } catch (error) {
    console.error('Reorder layer error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to reorder layer" });
  }
});

/** Select layers */
router.post("/design-canvas/:projectId/selection", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const { layerIds, addToSelection } = req.body;
    const engine = getCanvasEngine(projectId);
    if (Array.isArray(layerIds)) {
      for (const layerId of layerIds) {
        engine.selectLayer(layerId, addToSelection);
      }
    }
    return res.json({ ok: true, selection: engine.getSelectedLayers() });
  } catch (error) {
    console.error('Select layers error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to select layers" });
  }
});

/** Clear selection */
router.delete("/design-canvas/:projectId/selection", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    engine.clearSelection();
    return res.json({ ok: true, selection: [] });
  } catch (error) {
    console.error('Clear selection error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to clear selection" });
  }
});

// ============================================================================
// Viewport Endpoints
// ============================================================================

/** Get viewport */
router.get("/design-canvas/:projectId/viewport", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    return res.json({ ok: true, viewport: engine.getViewport() });
  } catch (error) {
    console.error('Get viewport error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get viewport" });
  }
});

/** Set viewport */
router.post("/design-canvas/:projectId/viewport", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    engine.setViewport(req.body);
    return res.json({ ok: true, viewport: engine.getViewport() });
  } catch (error) {
    console.error('Set viewport error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to set viewport" });
  }
});

/** Zoom to fit */
router.post("/design-canvas/:projectId/viewport/fit", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const { layerIds } = req.body;
    const engine = getCanvasEngine(projectId);
    engine.zoomToFit(layerIds);
    return res.json({ ok: true, viewport: engine.getViewport() });
  } catch (error) {
    console.error('Zoom to fit error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to zoom to fit" });
  }
});

// ============================================================================
// Responsive Breakpoints
// ============================================================================

/** Get breakpoints */
router.get("/design-canvas/:projectId/breakpoints", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    return res.json({ ok: true, breakpoints: engine.getBreakpoints(), current: engine.getCurrentBreakpoint() });
  } catch (error) {
    console.error('Get breakpoints error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get breakpoints" });
  }
});

/** Set current breakpoint */
router.post("/design-canvas/:projectId/breakpoints/current", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const { breakpoint } = req.body;
    const engine = getCanvasEngine(projectId);
    engine.setBreakpoint(breakpoint);
    return res.json({ ok: true, currentBreakpoint: engine.getCurrentBreakpoint() });
  } catch (error) {
    console.error('Set breakpoint error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to set breakpoint" });
  }
});

/** Apply responsive override */
router.post("/design-canvas/:projectId/layers/:layerId/responsive", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const layerId = getLayerId(req);
    const { breakpoint, override } = req.body;
    const engine = getCanvasEngine(projectId);
    const layer = engine.applyResponsiveOverride(layerId, breakpoint, override);
    if (!layer) return res.status(404).json({ ok: false, error: "Layer not found" });
    return res.json({ ok: true, layer });
  } catch (error) {
    console.error('Apply responsive override error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to apply responsive override" });
  }
});

// ============================================================================
// Design System Endpoints
// ============================================================================

/** Get design system */
router.get("/design-canvas/:projectId/design-system", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    return res.json({ ok: true, designSystem: engine.getDesignSystem() });
  } catch (error) {
    console.error('Get design system error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get design system" });
  }
});

/** Update design system */
router.patch("/design-canvas/:projectId/design-system", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    engine.setDesignSystem(req.body);
    return res.json({ ok: true, designSystem: engine.getDesignSystem() });
  } catch (error) {
    console.error('Update design system error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to update design system" });
  }
});

// ============================================================================
// Artifact Endpoints
// ============================================================================

/** Create artifact */
router.post("/design-canvas/:projectId/artifacts", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    const artifact = engine.createArtifact(req.body);
    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Create artifact error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to create artifact" });
  }
});

/** Get artifacts */
router.get("/design-canvas/:projectId/artifacts", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    const artifacts = engine.getAllArtifacts();
    return res.json({ ok: true, artifacts });
  } catch (error) {
    console.error('Get artifacts error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get artifacts" });
  }
});

/** Get artifact by ID */
router.get("/design-canvas/:projectId/artifacts/:artifactId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const artifactId = getArtifactId(req);
    const engine = getCanvasEngine(projectId);
    const artifact = engine.getArtifact(artifactId);
    if (!artifact) return res.status(404).json({ ok: false, error: "Artifact not found" });
    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Get artifact error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get artifact" });
  }
});

// ============================================================================
// History (Undo/Redo) Endpoints
// ============================================================================

/** Undo */
router.post("/design-canvas/:projectId/undo", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    const success = engine.undo();
    return res.json({ ok: true, success, canUndo: engine.canUndo(), canRedo: engine.canRedo() });
  } catch (error) {
    console.error('Undo error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to undo" });
  }
});

/** Redo */
router.post("/design-canvas/:projectId/redo", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    const success = engine.redo();
    return res.json({ ok: true, success, canUndo: engine.canUndo(), canRedo: engine.canRedo() });
  } catch (error) {
    console.error('Redo error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to redo" });
  }
});

/** Get history state */
router.get("/design-canvas/:projectId/history", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    return res.json({
      ok: true,
      canUndo: engine.canUndo(),
      canRedo: engine.canRedo(),
    });
  } catch (error) {
    console.error('Get history error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get history" });
  }
});

// ============================================================================
// Serialization Endpoints
// ============================================================================

/** Serialize canvas */
router.get("/design-canvas/:projectId/serialize", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const engine = getCanvasEngine(projectId);
    const data = engine.serialize();
    return res.json({ ok: true, data });
  } catch (error) {
    console.error('Serialize error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to serialize" });
  }
});

/** Deserialize canvas */
router.post("/design-canvas/:projectId/deserialize", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const { data } = req.body;
    const engine = getCanvasEngine(projectId);
    engine.deserialize(data);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Deserialize error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to deserialize" });
  }
});

// ============================================================================
// Code Connection Endpoints
// ============================================================================

/** Connect layer to code */
router.post("/design-canvas/:projectId/layers/:layerId/code", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const layerId = getLayerId(req);
    const { codeFile, component } = req.body;
    const engine = getCanvasEngine(projectId);
    const layer = engine.connectToCode(layerId, codeFile, component);
    if (!layer) return res.status(404).json({ ok: false, error: "Layer not found" });
    return res.json({ ok: true, layer });
  } catch (error) {
    console.error('Connect to code error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to connect to code" });
  }
});

// ============================================================================
// Ambient Intelligence SSE Endpoint
// ============================================================================

/** SSE stream for ambient intelligence suggestions */
router.get("/design-canvas/:projectId/ambient/stream", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const projectId = getProjectId(req);

  // Check project ownership
  // TODO: Add project ownership check

  const ambient = getAmbientEngine(projectId);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', projectId })}\n\n`);

  // Send current suggestions
  const suggestions = ambient.getSuggestions();
  if (suggestions.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'suggestions:snapshot', suggestions })}\n\n`);
  }

  // Subscribe to ambient events
  const unsubscribe = ambient.onAmbientEvent((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Connection closed
    }
  });

  // Generate initial suggestions
  ambient.generateSuggestions().catch(console.error);

  // Handle client disconnect
  req.on('close', () => {
    unsubscribe();
  });
});

/** Accept ambient suggestion */
router.post("/design-canvas/:projectId/ambient/suggestions/:suggestionId/accept", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const suggestionId = getSuggestionId(req);
    const ambient = getAmbientEngine(projectId);
    const suggestion = ambient.acceptSuggestion(suggestionId);
    if (!suggestion) return res.status(404).json({ ok: false, error: "Suggestion not found" });
    return res.json({ ok: true, suggestion });
  } catch (error) {
    console.error('Accept suggestion error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to accept suggestion" });
  }
});

/** Reject ambient suggestion */
router.post("/design-canvas/:projectId/ambient/suggestions/:suggestionId/reject", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const suggestionId = getSuggestionId(req);
    const ambient = getAmbientEngine(projectId);
    const suggestion = ambient.rejectSuggestion(suggestionId);
    if (!suggestion) return res.status(404).json({ ok: false, error: "Suggestion not found" });
    return res.json({ ok: true, suggestion });
  } catch (error) {
    console.error('Reject suggestion error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to reject suggestion" });
  }
});

/** Get ambient suggestions */
router.get("/design-canvas/:projectId/ambient/suggestions", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const ambient = getAmbientEngine(projectId);
    return res.json({ ok: true, suggestions: ambient.getSuggestions() });
  } catch (error) {
    console.error('Get suggestions error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get suggestions" });
  }
});

/** Trigger ambient generation manually */
router.post("/design-canvas/:projectId/ambient/generate", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const ambient = getAmbientEngine(projectId);
    const suggestions = await ambient.generateSuggestions();
    return res.json({ ok: true, suggestions });
  } catch (error) {
    console.error('Generate suggestions error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to generate suggestions" });
  }
});

/** Get/set ambient preferences */
router.get("/design-canvas/:projectId/ambient/preferences", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const ambient = getAmbientEngine(projectId);
    return res.json({ ok: true, preferences: ambient.getPreferences() });
  } catch (error) {
    console.error('Get preferences error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get preferences" });
  }
});

router.post("/design-canvas/:projectId/ambient/preferences", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const ambient = getAmbientEngine(projectId);
    ambient.setPreferences(req.body);
    return res.json({ ok: true, preferences: ambient.getPreferences() });
  } catch (error) {
    console.error('Set preferences error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to set preferences" });
  }
});

// ============================================================================
// Ambient Intelligence Model Selection Endpoints
// ============================================================================

/** Get available design models */
router.get("/design-canvas/:projectId/ambient/models", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const models = getDesignModels();
    return res.json({ ok: true, models });
  } catch (error) {
    console.error('Get design models error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get design models" });
  }
});

/** Get currently selected model */
router.get("/design-canvas/:projectId/ambient/model", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const ambient = getAmbientEngine(projectId);
    return res.json({ ok: true, model: ambient.getDesignModel() });
  } catch (error) {
    console.error('Get selected model error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to get selected model" });
  }
});

/** Set selected model for ambient intelligence */
router.post("/design-canvas/:projectId/ambient/model", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const { model } = req.body;
    const ambient = getAmbientEngine(projectId);
    ambient.setDesignModel(model);
    return res.json({ ok: true, model: ambient.getDesignModel() });
  } catch (error) {
    console.error('Set model error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to set model" });
  }
});

// ============================================================================
// Figma Import Endpoint (uses existing figma.ts with exact value preservation)
// ============================================================================

import { fetchFigmaDesignTokens, figmaTokensToContext } from "../../lib/figma";

router.post("/design-canvas/:projectId/figma/import", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ ok: false, error: "Figma URL required" });
    }

    const result = await fetchFigmaDesignTokens(url);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    // Convert tokens to context for LLM
    const context = figmaTokensToContext(result.tokens);

    // Also return raw tokens for canvas layer creation
    const tokens = result.tokens;

    return res.json({
      ok: true,
      tokens,
      context,
      // Include raw exact values for pixel-perfect reproduction
      raw: tokens._figmaRaw
    });
  } catch (error) {
    console.error('Figma import error:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Figma import failed" });
  }
});

export default router;