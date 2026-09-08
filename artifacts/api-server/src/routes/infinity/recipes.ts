import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { recipes, recipeVersions, recipeExecutions, recipeRatings } from "@workspace/db/schema/recipes.js";
import { eq, and, desc, ilike, or, inArray, sql } from "drizzle-orm";
import { recipeEngine, RecipeSchema, Recipe, RecipeExecution, RecipeRating } from "../../lib/recipe-engine";

const router = Router();

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateRecipeBody(body: unknown): Recipe {
  return RecipeSchema.parse(body);
}

// ============================================================================
// RECIPE CRUD
// ============================================================================

/**
 * GET /infinity/recipes
 * List recipes with optional filtering
 * Query params: type, tag, author, isPublic, isBuiltIn, search, limit, offset
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      type,
      tag,
      author,
      isPublic,
      isBuiltIn,
      search,
      limit = "50",
      offset = "0",
    } = req.query;

    let query = db.select().from(recipes);

    const conditions = [];

    if (type) {
      conditions.push(eq(recipes.type, type as "standard" | "deep-research"));
    }
    if (author) {
      conditions.push(eq(recipes.author, author as string));
    }
    if (isPublic !== undefined) {
      conditions.push(eq(recipes.isPublic, isPublic === "true"));
    }
    if (isBuiltIn !== undefined) {
      conditions.push(eq(recipes.isBuiltIn, isBuiltIn === "true"));
    }
    if (search) {
      conditions.push(
        or(
          ilike(recipes.name, `%${search}%`),
          ilike(recipes.description || "", `%${search}%`)
        )
      );
    }
    if (tag) {
      conditions.push(sql`${tag} = ANY(${recipes.tags})`);
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query
      .orderBy(desc(recipes.updatedAt))
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    // Add rating info
    const recipesWithRatings = await Promise.all(
      results.map(async (r) => {
        const avgRating = recipeEngine.getAverageRating(r.id);
        const ratingCount = recipeEngine.getRatings(r.id).length;
        return { ...r, avgRating, ratingCount };
      })
    );

    res.json({
      recipes: recipesWithRatings,
      total: results.length,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error) {
    console.error("Error listing recipes:", error);
    res.status(500).json({ error: "Failed to list recipes" });
  }
});

/**
 * GET /infinity/recipes/built-in
 * List all built-in recipes
 */
router.get("/built-in", async (req: Request, res: Response) => {
  try {
    const builtInRecipes = recipeEngine.listRecipes().filter(r => r.isBuiltIn);
    res.json({ recipes: builtInRecipes });
  } catch (error) {
    console.error("Error listing built-in recipes:", error);
    res.status(500).json({ error: "Failed to list built-in recipes" });
  }
});

/**
 * GET /infinity/recipes/categories
 * List all recipe categories/tags
 */
router.get("/categories", async (req: Request, res: Response) => {
  try {
    const allRecipes = recipeEngine.listRecipes();
    const tags = new Set<string>();
    allRecipes.forEach(r => r.tags.forEach(t => tags.add(t)));
    res.json({ categories: Array.from(tags).sort() });
  } catch (error) {
    console.error("Error listing categories:", error);
    res.status(500).json({ error: "Failed to list categories" });
  }
});

/**
 * GET /infinity/recipes/:id
 * Get a single recipe by ID
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // First check in-memory engine
    const inMemoryRecipe = recipeEngine.getRecipe(id);
    if (inMemoryRecipe) {
      const avgRating = recipeEngine.getAverageRating(id);
      const ratingCount = recipeEngine.getRatings(id).length;
      const versions = recipeEngine.getVersions(id);
      return res.json({ recipe: inMemoryRecipe, avgRating, ratingCount, versions });
    }

    // Then check database
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const avgRating = recipeEngine.getAverageRating(id);
    const ratingCount = recipeEngine.getRatings(id).length;
    const versions = await db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, id)).orderBy(desc(recipeVersions.createdAt));

    res.json({ recipe, avgRating, ratingCount, versions });
  } catch (error) {
    console.error("Error getting recipe:", error);
    res.status(500).json({ error: "Failed to get recipe" });
  }
});

/**
 * POST /infinity/recipes
 * Create a new recipe
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const recipeData = validateRecipeBody(req.body);

    // Generate ID if not provided
    if (!recipeData.id) {
      recipeData.id = crypto.randomUUID();
    }

    // Register in engine
    const registered = recipeEngine.registerRecipe(recipeData);

    // Also persist to database
    await db.insert(recipes).values({
      id: registered.id,
      name: registered.name,
      description: registered.description,
      version: registered.version,
      type: registered.type,
      parameters: registered.parameters,
      steps: registered.steps,
      outputSchema: registered.outputSchema,
      tags: registered.tags,
      author: registered.author,
      isPublic: registered.isPublic,
      isBuiltIn: registered.isBuiltIn,
      deepResearchConfig: registered.deepResearchConfig,
    });

    // Create initial version
    recipeEngine.createVersion(registered.id, registered.version, "Initial version");

    await db.insert(recipeVersions).values({
      recipeId: registered.id,
      version: registered.version,
      changelog: "Initial version",
      snapshot: registered,
    });

    res.status(201).json({ recipe: registered });
  } catch (error) {
    console.error("Error creating recipe:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return res.status(400).json({ error: "Invalid recipe data", details: error.message });
    }
    res.status(500).json({ error: "Failed to create recipe" });
  }
});

/**
 * PUT /infinity/recipes/:id
 * Update a recipe
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if recipe exists
    const existing = recipeEngine.getRecipe(id);
    if (!existing) {
      const [dbRecipe] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
      if (!dbRecipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }
    }

    // Update in engine
    const updated = recipeEngine.updateRecipe(id, updates);
    if (!updated) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Update in database
    await db.update(recipes)
      .set({
        name: updated.name,
        description: updated.description,
        version: updated.version,
        type: updated.type,
        parameters: updated.parameters,
        steps: updated.steps,
        outputSchema: updated.outputSchema,
        tags: updated.tags,
        author: updated.author,
        isPublic: updated.isPublic,
        isBuiltIn: updated.isBuiltIn,
        deepResearchConfig: updated.deepResearchConfig,
        updatedAt: new Date(),
      })
      .where(eq(recipes.id, id));

    res.json({ recipe: updated });
  } catch (error) {
    console.error("Error updating recipe:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return res.status(400).json({ error: "Invalid recipe data", details: error.message });
    }
    res.status(500).json({ error: "Failed to update recipe" });
  }
});

/**
 * DELETE /infinity/recipes/:id
 * Delete a recipe
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = recipeEngine.deleteRecipe(id);
    if (!deleted) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    await db.delete(recipes).where(eq(recipes.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting recipe:", error);
    res.status(500).json({ error: "Failed to delete recipe" });
  }
});

/**
 * POST /infinity/recipes/:id/fork
 * Fork a recipe
 */
router.post("/:id/fork", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "New recipe name is required" });
    }

    const forked = recipeEngine.forkRecipe(id, name);
    if (!forked) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Persist forked recipe
    await db.insert(recipes).values({
      id: forked.id,
      name: forked.name,
      description: forked.description,
      version: forked.version,
      type: forked.type,
      parameters: forked.parameters,
      steps: forked.steps,
      outputSchema: forked.outputSchema,
      tags: forked.tags,
      author: forked.author,
      isPublic: forked.isPublic,
      isBuiltIn: forked.isBuiltIn,
      deepResearchConfig: forked.deepResearchConfig,
    });

    recipeEngine.createVersion(forked.id, forked.version, "Forked version");

    await db.insert(recipeVersions).values({
      recipeId: forked.id,
      version: forked.version,
      changelog: "Forked version",
      snapshot: forked,
    });

    res.status(201).json({ recipe: forked });
  } catch (error) {
    console.error("Error forking recipe:", error);
    res.status(500).json({ error: "Failed to fork recipe" });
  }
});

// ============================================================================
// VERSION MANAGEMENT
// ============================================================================

/**
 * GET /infinity/recipes/:id/versions
 * List all versions of a recipe
 */
router.get("/:id/versions", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const versions = recipeEngine.getVersions(id);
    res.json({ versions });
  } catch (error) {
    console.error("Error listing versions:", error);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

/**
 * POST /infinity/recipes/:id/versions
 * Create a new version
 */
router.post("/:id/versions", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version, changelog } = req.body;

    if (!version) {
      return res.status(400).json({ error: "Version is required" });
    }

    const recipeVersion = recipeEngine.createVersion(id, version, changelog);
    if (!recipeVersion) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    await db.insert(recipeVersions).values({
      recipeId: id,
      version,
      changelog,
      snapshot: recipeVersion.snapshot,
    });

    // Also update the recipe's version
    const recipe = recipeEngine.getRecipe(id);
    if (recipe) {
      recipeEngine.updateRecipe(id, { version });
      await db.update(recipes).set({ version, updatedAt: new Date() }).where(eq(recipes.id, id));
    }

    res.status(201).json({ version: recipeVersion });
  } catch (error) {
    console.error("Error creating version:", error);
    res.status(500).json({ error: "Failed to create version" });
  }
});

/**
 * POST /infinity/recipes/:id/rollback
 * Rollback to a specific version
 */
router.post("/:id/rollback", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version } = req.body;

    if (!version) {
      return res.status(400).json({ error: "Version is required" });
    }

    const restored = recipeEngine.rollbackToVersion(id, version);
    if (!restored) {
      return res.status(404).json({ error: "Recipe or version not found" });
    }

    await db.update(recipes)
      .set({
        name: restored.name,
        description: restored.description,
        version: restored.version,
        type: restored.type,
        parameters: restored.parameters,
        steps: restored.steps,
        outputSchema: restored.outputSchema,
        tags: restored.tags,
        deepResearchConfig: restored.deepResearchConfig,
        updatedAt: new Date(),
      })
      .where(eq(recipes.id, id));

    res.json({ recipe: restored });
  } catch (error) {
    console.error("Error rolling back:", error);
    res.status(500).json({ error: "Failed to rollback" });
  }
});

// ============================================================================
// EXECUTION
// ============================================================================

/**
 * POST /infinity/recipes/:id/execute
 * Execute a recipe
 */
router.post("/:id/execute", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { parameters, projectId, accountId } = req.body;

    if (!parameters || typeof parameters !== "object") {
      return res.status(400).json({ error: "Parameters object is required" });
    }

    // Check recipe exists
    const recipe = recipeEngine.getRecipe(id);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Validate parameters
    const validation = recipeEngine["validateParameters"](recipe.parameters, parameters);
    if (!validation.valid) {
      return res.status(400).json({ error: "Parameter validation failed", details: validation.errors });
    }

    // Execute
    const execution = await recipeEngine.executeRecipe(id, parameters, {
      projectId,
      accountId,
      onProgress: (progress) => {
        // Could emit via WebSocket here
        console.log(`Recipe ${id} progress:`, progress);
      },
    });

    // Persist execution
    await db.insert(recipeExecutions).values({
      id: execution.id,
      recipeId: execution.recipeId,
      recipeVersion: execution.recipeVersion,
      parameters: execution.parameters,
      result: execution.result,
      status: execution.status,
      error: execution.error,
      projectId: execution.projectId,
      accountId: execution.accountId,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    });

    res.json({ execution });
  } catch (error) {
    console.error("Error executing recipe:", error);
    if (error instanceof Error && error.message.includes("validation")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to execute recipe" });
  }
});

/**
 * GET /infinity/recipes/:id/executions
 * List executions for a recipe
 */
router.get("/:id/executions", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = "20", offset = "0", status } = req.query;

    const executions = recipeEngine.listExecutions(id);

    let filtered = executions;
    if (status) {
      filtered = filtered.filter(e => e.status === status);
    }

    filtered = filtered
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string));

    res.json({ executions: filtered, total: executions.length });
  } catch (error) {
    console.error("Error listing executions:", error);
    res.status(500).json({ error: "Failed to list executions" });
  }
});

/**
 * GET /infinity/recipes/executions/:executionId
 * Get execution details
 */
router.get("/executions/:executionId", async (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    const execution = recipeEngine.getExecution(executionId);

    if (!execution) {
      return res.status(404).json({ error: "Execution not found" });
    }

    res.json({ execution });
  } catch (error) {
    console.error("Error getting execution:", error);
    res.status(500).json({ error: "Failed to get execution" });
  }
});

/**
 * POST /infinity/recipes/executions/:executionId/cancel
 * Cancel a running execution
 */
router.post("/executions/:executionId/cancel", async (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    const cancelled = recipeEngine.cancelExecution(executionId);

    if (!cancelled) {
      return res.status(404).json({ error: "Execution not found or not running" });
    }

    await db.update(recipeExecutions)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(recipeExecutions.id, executionId));

    res.json({ success: true });
  } catch (error) {
    console.error("Error cancelling execution:", error);
    res.status(500).json({ error: "Failed to cancel execution" });
  }
});

// ============================================================================
// RATINGS
// ============================================================================

/**
 * POST /infinity/recipes/:id/rate
 * Rate a recipe
 */
router.post("/:id/rate", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rating, review, accountId } = req.body;

    if (!accountId) {
      return res.status(400).json({ error: "accountId is required" });
    }
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    // Check recipe exists
    const recipe = recipeEngine.getRecipe(id);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const newRating = recipeEngine.addRating({
      id: crypto.randomUUID(),
      recipeId: id,
      accountId,
      rating,
      review,
      createdAt: new Date(),
    });

    await db.insert(recipeRatings).values({
      id: newRating.id,
      recipeId: id,
      accountId,
      rating,
      review,
    }).onConflictDoUpdate({
      target: [recipeRatings.recipeId, recipeRatings.accountId],
      set: { rating, review, createdAt: new Date() },
    });

    const avgRating = recipeEngine.getAverageRating(id);
    const ratingCount = recipeEngine.getRatings(id).length;

    res.json({ rating: newRating, avgRating, ratingCount });
  } catch (error) {
    console.error("Error rating recipe:", error);
    res.status(500).json({ error: "Failed to rate recipe" });
  }
});

/**
 * GET /infinity/recipes/:id/ratings
 * Get ratings for a recipe
 */
router.get("/:id/ratings", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const ratings = recipeEngine.getRatings(id);
    const avgRating = recipeEngine.getAverageRating(id);

    res.json({ ratings, avgRating, count: ratings.length });
  } catch (error) {
    console.error("Error getting ratings:", error);
    res.status(500).json({ error: "Failed to get ratings" });
  }
});

// ============================================================================
// IMPORT/EXPORT
// ============================================================================

/**
 * GET /infinity/recipes/:id/export
 * Export a recipe as JSON
 */
router.get("/:id/export", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const json = recipeEngine.exportRecipe(id);

    if (!json) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="recipe-${id}.json"`);
    res.send(json);
  } catch (error) {
    console.error("Error exporting recipe:", error);
    res.status(500).json({ error: "Failed to export recipe" });
  }
});

/**
 * POST /infinity/recipes/import
 * Import a recipe from JSON
 */
router.post("/import", async (req: Request, res: Response) => {
  try {
    const { json } = req.body;

    if (!json) {
      return res.status(400).json({ error: "JSON is required" });
    }

    const recipe = recipeEngine.importRecipe(json);

    // Persist to database
    await db.insert(recipes).values({
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      version: recipe.version,
      type: recipe.type,
      parameters: recipe.parameters,
      steps: recipe.steps,
      outputSchema: recipe.outputSchema,
      tags: recipe.tags,
      author: recipe.author,
      isPublic: recipe.isPublic,
      isBuiltIn: false, // Imported recipes are never built-in
      deepResearchConfig: recipe.deepResearchConfig,
    });

    recipeEngine.createVersion(recipe.id, recipe.version, "Imported version");

    await db.insert(recipeVersions).values({
      recipeId: recipe.id,
      version: recipe.version,
      changelog: "Imported version",
      snapshot: recipe,
    });

    res.status(201).json({ recipe });
  } catch (error) {
    console.error("Error importing recipe:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return res.status(400).json({ error: "Invalid recipe JSON", details: error.message });
    }
    res.status(500).json({ error: "Failed to import recipe" });
  }
});

// ============================================================================
// MARKETPLACE
// ============================================================================

/**
 * GET /infinity/recipes/marketplace
 * Browse public recipes (marketplace)
 */
router.get("/marketplace", async (req: Request, res: Response) => {
  try {
    const { tag, search, sort = "popular", limit = "20", offset = "0" } = req.query;

    // Get public recipes from engine
    let allRecipes = recipeEngine.listRecipes().filter(r => r.isPublic);

    if (tag) {
      allRecipes = allRecipes.filter(r => r.tags.includes(tag as string));
    }
    if (search) {
      const searchLower = (search as string).toLowerCase();
      allRecipes = allRecipes.filter(r =>
        r.name.toLowerCase().includes(searchLower) ||
        r.description?.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    switch (sort) {
      case "popular":
        allRecipes.sort((a, b) => recipeEngine.getAverageRating(b.id) - recipeEngine.getAverageRating(a.id));
        break;
      case "newest":
        allRecipes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "name":
        allRecipes.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "rating":
        allRecipes.sort((a, b) => recipeEngine.getAverageRating(b.id) - recipeEngine.getAverageRating(a.id));
        break;
    }

    const paginated = allRecipes.slice(
      parseInt(offset as string),
      parseInt(offset as string) + parseInt(limit as string)
    );

    const recipesWithMeta = paginated.map(r => ({
      ...r,
      avgRating: recipeEngine.getAverageRating(r.id),
      ratingCount: recipeEngine.getRatings(r.id).length,
    }));

    res.json({
      recipes: recipesWithMeta,
      total: allRecipes.length,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error) {
    console.error("Error browsing marketplace:", error);
    res.status(500).json({ error: "Failed to browse marketplace" });
  }
});

/**
 * POST /infinity/recipes/:id/publish
 * Publish a recipe to marketplace
 */
router.post("/:id/publish", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updated = recipeEngine.updateRecipe(id, { isPublic: true });
    if (!updated) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    await db.update(recipes).set({ isPublic: true, updatedAt: new Date() }).where(eq(recipes.id, id));

    res.json({ recipe: updated });
  } catch (error) {
    console.error("Error publishing recipe:", error);
    res.status(500).json({ error: "Failed to publish recipe" });
  }
});

/**
 * POST /infinity/recipes/:id/unpublish
 * Unpublish a recipe from marketplace
 */
router.post("/:id/unpublish", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updated = recipeEngine.updateRecipe(id, { isPublic: false });
    if (!updated) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    await db.update(recipes).set({ isPublic: false, updatedAt: new Date() }).where(eq(recipes.id, id));

    res.json({ recipe: updated });
  } catch (error) {
    console.error("Error unpublishing recipe:", error);
    res.status(500).json({ error: "Failed to unpublish recipe" });
  }
});

export default router;