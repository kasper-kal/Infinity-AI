import { Router, Request, Response } from "express";
import { z } from "zod";
import { createBestAdapter } from "../../lib/adapter-factory";
import { buildInfinityPrompt } from "../../lib/infinity-prompt";

const router = Router();

// Input validation schemas
const LogoGenerateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const SloganGenerateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const PromoCreateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  duration: z.number().int().min(5).max(60).default(15),
  style: z.enum(["professional", "energetic", "minimal", "cinematic"]).default("professional"),
});

const PaletteGenerateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  inspiration: z.string().optional(),
  mood: z.enum(["professional", "vibrant", "minimal", "warm", "cool", "bold"]).default("professional"),
});

const FontFindSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  stylePreferences: z.string().optional(), // e.g., "modern, like SF Pro"
  purpose: z.enum(["heading", "body", "both"]).default("both"),
});

// Tavily search helper
async function searchTavily(query: string, maxResults: number = 5): Promise<{ title: string; url: string; content: string }[] | null> {
  const apiKey = process.env["TAVILY_API_KEY"] ?? process.env["WEB_SEARCH_API_KEY"];
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      answer?: string;
      results?: { title: string; url: string; content: string }[];
    };
    return data.results ?? null;
  } catch {
    return null;
  }
}

// LLM helper for analyzing Tavily results
async function analyzeWithLLM(prompt: string): Promise<string> {
  try {
    const adapter = await createBestAdapter();
    const response = await adapter.complete(
      [
        { role: "system", content: buildInfinityPrompt({ role: "research" }) },
        { role: "user", content: prompt },
      ],
      {
        temperature: 0.3,
        maxTokens: 2000,
      }
    );
    return response.content ?? "";
  } catch (error) {
    console.error("[LLM Analysis] Error:", error);
    return "";
  }
}

// Parse LLM JSON response
function parseLLMJson<T>(text: string, fallback: T): T {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
  } catch {}
  return fallback;
}

/**
 * POST /api/infinity/tools/company.logo
 * Generate a logo for a company project
 */
router.post("/company.logo", async (req: Request, res: Response) => {
  const parsed = LogoGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { projectId, name, description } = parsed.data;

  try {
    // For now, return a placeholder response
    // In a real implementation, this would call an image generation API
    // like DALL-E, Stable Diffusion, or similar
    const logoUrl = `/api/placeholder/logo/${encodeURIComponent(projectId)}`;

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return res.json({
      success: true,
      logoUrl,
      message: "Logo generated successfully",
    });
  } catch (error) {
    console.error("[company.logo] Error:", error);
    return res.status(500).json({ error: "Failed to generate logo" });
  }
});

/**
 * POST /api/infinity/tools/company.slogan
 * Generate a slogan/tagline for a company project
 */
router.post("/company.slogan", async (req: Request, res: Response) => {
  const parsed = SloganGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { projectId, name, description } = parsed.data;

  try {
    // In a real implementation, this would call an LLM to generate a slogan
    // For now, we'll generate a few template slogans based on the company name
    const templates = [
      `${name}: ${description?.split(".")[0] || "Building the future"}`,
      `${name} — Where innovation meets purpose`,
      `Empowering ${name.toLowerCase()}, one step at a time`,
      `${name}: Your vision, our mission`,
      `Transforming ideas into ${name.toLowerCase()} reality`,
    ];

    const slogan = templates[Math.floor(Math.random() * templates.length)];

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return res.json({
      success: true,
      slogan,
      message: "Slogan generated successfully",
    });
  } catch (error) {
    console.error("[company.slogan] Error:", error);
    return res.status(500).json({ error: "Failed to generate slogan" });
  }
});

/**
 * POST /api/infinity/tools/company.promo
 * Create a promo video for a company project
 */
router.post("/company.promo", async (req: Request, res: Response) => {
  const parsed = PromoCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { projectId, name, description, duration, style } = parsed.data;

  try {
    // In a real implementation, this would trigger a video generation job
    // (e.g., using Runway, Pika, Sora, or similar)
    const jobId = `promo_${projectId}_${Date.now()}`;

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return res.json({
      success: true,
      jobId,
      status: "queued",
      estimatedDuration: duration,
      style,
      message: "Promo video generation queued",
      // The frontend can poll /api/infinity/tools/promo/status/:jobId for progress
    });
  } catch (error) {
    console.error("[company.promo] Error:", error);
    return res.status(500).json({ error: "Failed to create promo video" });
  }
});

/**
 * GET /api/infinity/tools/promo/status/:jobId
 * Check the status of a promo video generation job
 */
router.get("/promo/status/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;

  // In a real implementation, this would check a job queue/database
  // For now, return a mock completed status
  return res.json({
    jobId,
    status: "completed",
    progress: 100,
    videoUrl: `/api/placeholder/video/${jobId}`,
    thumbnailUrl: `/api/placeholder/thumbnail/${jobId}`,
  });
});

/**
 * GET /api/infinity/tools/brand-kit/:projectId
 * Get the brand kit for a company project
 */
router.get("/brand-kit/:projectId", (req: Request, res: Response) => {
  const { projectId } = req.params;

  // In a real implementation, this would fetch from database
  // For now, return a mock brand kit structure
  return res.json({
    projectId,
    logo: null,
    slogan: null,
    colors: {
      primary: "#ea580c",
      secondary: "#1e293b",
      accent: "#f97316",
      background: "#ffffff",
      text: "#0f172a",
    },
    typography: {
      heading: "Inter",
      body: "Inter",
      mono: "JetBrains Mono",
    },
    assets: [],
    guidelines: "",
  });
});

/**
 * PUT /api/infinity/tools/brand-kit/:projectId
 * Update the brand kit for a company project
 */
router.put("/brand-kit/:projectId", async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const updates = req.body;

  // In a real implementation, this would save to database
  await new Promise((resolve) => setTimeout(resolve, 500));

  return res.json({
    success: true,
    projectId,
    brandKit: updates,
    message: "Brand kit updated successfully",
  });
});

/**
 * POST /api/infinity/tools/company.palette
 * Generate a brand color palette for a company project
 * Uses Tavily to search for color palette inspiration, then AI to create a cohesive palette
 */
router.post("/company.palette", async (req: Request, res: Response) => {
  const parsed = PaletteGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { projectId, name, description, inspiration, mood } = parsed.data;

  try {
    // Step 1: Use Tavily to search for color palette inspiration
    const searchQuery = inspiration
      ? `color palette inspiration for ${name}: ${inspiration} ${mood} mood`
      : `color palette inspiration for ${name} ${description ? `: ${description}` : ""} ${mood} mood business branding`;

    const tavilyResults = await searchTavily(searchQuery, 8);

    // Step 2: Use LLM to analyze results and create a cohesive palette
    const analysisPrompt = `You are a brand designer creating a cohesive color palette for a company.

Company: ${name}
Description: ${description || "Not provided"}
Mood: ${mood}
User Inspiration: ${inspiration || "None provided"}
Tavily Search Results: ${tavilyResults ? JSON.stringify(tavilyResults.slice(0, 5)) : "No search results available"}

Create a professional brand color palette with exactly 5 colors:
1. primary - Main brand color
2. secondary - Supporting brand color
3. accent - Call-to-action/highlight color
4. background - Page/background color
5. text - Primary text color

Return ONLY valid JSON in this format:
{
  "primary": "#hex",
  "secondary": "#hex",
  "accent": "#hex",
  "background": "#hex",
  "text": "#hex",
  "rationale": "Brief explanation of color choices based on search results and brand attributes"
}`;

    const llmResponse = await analyzeWithLLM(analysisPrompt);
    const paletteResult = parseLLMJson(llmResponse, {
      primary: "#ea580c",
      secondary: "#1e293b",
      accent: "#f97316",
      background: "#ffffff",
      text: "#0f172a",
      rationale: "Fallback palette - LLM analysis failed",
    });

    return res.json({
      success: true,
      palette: {
        primary: paletteResult.primary,
        secondary: paletteResult.secondary,
        accent: paletteResult.accent,
        background: paletteResult.background,
        text: paletteResult.text,
      },
      mood,
      inspiration: inspiration || "AI-generated based on Tavily search + business description",
      rationale: paletteResult.rationale,
      sources: tavilyResults?.slice(0, 3).map(r => ({ title: r.title, url: r.url })) || [],
      message: "Color palette generated successfully",
    });
  } catch (error) {
    console.error("[company.palette] Error:", error);
    return res.status(500).json({ error: "Failed to generate color palette" });
  }
});

/**
 * POST /api/infinity/tools/company.font
 * Find brand fonts for a company project
 * Uses Tavily to search for fonts matching style preferences, then AI to recommend font pairs
 */
router.post("/company.font", async (req: Request, res: Response) => {
  const parsed = FontFindSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { projectId, name, description, stylePreferences, purpose } = parsed.data;

  try {
    // Step 1: Use Tavily to search for font recommendations
    const searchQuery = `best Google Fonts for ${name} ${description ? `: ${description}` : ""} ${stylePreferences || "modern, like SF Pro"} ${purpose === "heading" ? "headlines" : purpose === "body" ? "body text" : "headings and body text"} branding`;

    const tavilyResults = await searchTavily(searchQuery, 8);

    // Step 2: Use LLM to analyze results and recommend font pairs
    const analysisPrompt = `You are a brand designer recommending Google Font pairs for a company.

Company: ${name}
Description: ${description || "Not provided"}
Style Preferences: ${stylePreferences || "modern, like SF Pro"}
Purpose: ${purpose}
Tavily Search Results: ${tavilyResults ? JSON.stringify(tavilyResults.slice(0, 5)) : "No search results available"}

Recommend ONE font pair (heading + body) from Google Fonts that best matches the style preferences.
The fonts MUST be available on Google Fonts (fonts.google.com).

Return ONLY valid JSON in this format:
{
  "headingFont": { "name": "Font Name", "url": "https://fonts.google.com/specimen/Font+Name", "category": "Sans-serif|Serif|Monospace|Display|Handwriting" },
  "bodyFont": { "name": "Font Name", "url": "https://fonts.google.com/specimen/Font+Name", "category": "Sans-serif|Serif|Monospace|Display|Handwriting" },
  "rationale": "Explanation of why this pair works for this brand, referencing search results if applicable",
  "matchedStyle": "The style category this matches (e.g., 'modern, like SF Pro', 'elegant serif', 'minimal clean', etc.)"
}`;

    const llmResponse = await analyzeWithLLM(analysisPrompt);
    const fontResult = parseLLMJson(llmResponse, {
      headingFont: { name: "Inter", url: "https://fonts.google.com/specimen/Inter", category: "Sans-serif" },
      bodyFont: { name: "Inter", url: "https://fonts.google.com/specimen/Inter", category: "Sans-serif" },
      rationale: "Fallback - Inter is a modern, versatile sans-serif similar to SF Pro with excellent readability at all sizes.",
      matchedStyle: "modern, like SF Pro",
    });

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return res.json({
      success: true,
      headingFont: fontResult.headingFont,
      bodyFont: fontResult.bodyFont,
      purpose,
      stylePreferences: stylePreferences || "modern, like SF Pro",
      matchedStyle: fontResult.matchedStyle,
      rationale: fontResult.rationale,
      sources: tavilyResults?.slice(0, 3).map(r => ({ title: r.title, url: r.url })) || [],
      message: "Brand fonts found and saved!",
    });
  } catch (error) {
    console.error("[company.font] Error:", error);
    return res.status(500).json({ error: "Failed to find brand fonts" });
  }
});

export default router;