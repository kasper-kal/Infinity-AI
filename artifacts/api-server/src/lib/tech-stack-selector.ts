/**
 * Tech Stack Selector — Automated Architecture Decisions
 *
 * Scores and recommends optimal technology combinations based on project requirements.
 * Considers: developer experience, ecosystem, scaling, cost ($0 budget), team familiarity.
 */

import { z } from "zod";
import { LLMAdapter, getLLMAdapter } from "./llm-adapter.js";
import { FrameworkRegistry } from "./framework-generators/index.js";

// ============================================
// Types & Schemas
// ============================================

export const TechStackOptionSchema = z.object({
  framework: z.enum(["nextjs", "astro", "remix", "vite-react", "sveltekit", "nuxt", "solidstart"]),
  database: z.enum(["postgresql", "sqlite", "mongodb", "firebase", "supabase", "neon", "planetscale", "turso", "none"]),
  auth: z.enum(["clerk", "authjs", "supabase-auth", "custom-jwt", "firebase-auth", "none"]),
  payments: z.enum(["stripe", "lemonsqueezy", "paddle", "none"]).optional(),
  hosting: z.enum(["vercel", "netlify", "cloudflare-pages", "railway", "flyio", "render", "none"]),
  score: z.number().min(0).max(100),
  rationale: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  estimatedMonthlyCost: z.number().default(0),
  freeTierCompatible: z.boolean().default(true),
  learningCurve: z.enum(["low", "medium", "high"]).default("medium"),
});

export const SelectionCriteriaSchema = z.object({
  projectType: z.enum(["saas", "dashboard", "landing", "blog", "docs", "mobile", "api", "tool", "other"]),
  teamSize: z.enum(["solo", "small", "medium", "large"]),
  techExperience: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  scale: z.enum(["tiny", "small", "medium", "large", "enterprise"]),
  realtime: z.boolean().default(false),
  seoCritical: z.boolean().default(false),
  authComplexity: z.enum(["none", "simple", "standard", "complex"]),
  paymentNeeded: z.boolean().default(false),
  budget: z.enum(["zero", "low", "medium", "high"]).default("zero"),
  timeline: z.enum(["asap", "weeks", "months", "flexible"]),
  preferences: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
});

export type TechStackOption = z.infer<typeof TechStackOptionSchema>;
export type SelectionCriteria = z.infer<typeof SelectionCriteriaSchema>;

// ============================================
// Framework Metadata
// ============================================

const FRAMEWORK_METADATA = {
  nextjs: {
    name: "Next.js",
    category: "fullstack",
    strengths: ["SEO", "Full-stack", "Vercel native", "Huge ecosystem", "App Router", "Server Components"],
    weaknesses: ["Complexity", "Bundle size", "Learning curve"],
    bestFor: ["saas", "dashboard", "blog", "ecommerce", "seo-critical"],
    learningCurve: "medium",
    freeTier: true,
  },
  astro: {
    name: "Astro",
    category: "content",
    strengths: ["Performance", "Islands architecture", "Multi-framework", "Content collections", "Static-first"],
    weaknesses: ["Limited SSR", "Smaller ecosystem", "Less full-stack"],
    bestFor: ["blog", "docs", "landing", "marketing", "content-heavy"],
    learningCurve: "low",
    freeTier: true,
  },
  remix: {
    name: "Remix",
    category: "fullstack",
    strengths: ["Web standards", "Nested routing", "Progressive enhancement", "Great DX", "Shopify backing"],
    weaknesses: ["Smaller ecosystem", "Learning curve", "Less deployment options"],
    bestFor: ["saas", "dashboard", "web-app", "forms-heavy"],
    learningCurve: "medium",
    freeTier: true,
  },
  "vite-react": {
    name: "Vite + React",
    category: "spa",
    strengths: ["Fast dev", "Simple", "Huge ecosystem", "Flexible", "SPA optimized"],
    weaknesses: ["No SSR", "SEO challenges", "Manual routing", "No built-in backend"],
    bestFor: ["dashboard", "tool", "internal-app", "spa", "prototype"],
    learningCurve: "low",
    freeTier: true,
  },
  sveltekit: {
    name: "SvelteKit",
    category: "fullstack",
    strengths: ["Performance", "Simple syntax", "File-based routing", "Adapters everywhere", "Great DX"],
    weaknesses: ["Smaller ecosystem", "Less job market", "Maturity"],
    bestFor: ["saas", "dashboard", "web-app", "performance-critical"],
    learningCurve: "low",
    freeTier: true,
  },
  nuxt: {
    name: "Nuxt (Vue)",
    category: "fullstack",
    strengths: ["Vue ecosystem", "Auto-imports", "Modules system", "Nitro engine", "Great DX"],
    weaknesses: ["Vue-specific", "Migration v2->v3", "Bundle size"],
    bestFor: ["saas", "dashboard", "blog", "vue-teams"],
    learningCurve: "medium",
    freeTier: true,
  },
  solidstart: {
    name: "SolidStart",
    category: "fullstack",
    strengths: ["Performance", "Fine-grained reactivity", "No virtual DOM", "Small bundle", "Web standards"],
    weaknesses: ["Very new", "Tiny ecosystem", "Experimental", "Breaking changes"],
    bestFor: ["performance-critical", "experimental", "small-teams"],
    learningCurve: "high",
    freeTier: true,
  },
} as const;

// ============================================
// Database Metadata
// ============================================

const DATABASE_METADATA = {
  postgresql: { name: "PostgreSQL", type: "relational", freeTier: true, providers: ["Neon", "Supabase", "Railway", "Render"], bestFor: ["saas", "dashboard", "complex-data"] },
  sqlite: { name: "SQLite (Turso/libSQL)", type: "embedded", freeTier: true, providers: ["Turso", "Local"], bestFor: ["small", "edge", "embedded", "prototypes"] },
  mongodb: { name: "MongoDB", type: "document", freeTier: true, providers: ["MongoDB Atlas"], bestFor: ["flexible-schema", "rapid-proto"] },
  firebase: { name: "Firebase", type: "baas", freeTier: true, providers: ["Firebase"], bestFor: ["realtime", "mobile", "offline-first", "baas"] },
  supabase: { name: "Supabase (PostgreSQL)", type: "baas", freeTier: true, providers: ["Supabase"], bestFor: ["baas", "realtime", "auth-included", "postgres"] },
  neon: { name: "Neon (PostgreSQL)", type: "serverless", freeTier: true, providers: ["Neon"], bestFor: ["serverless", "branching", "postgres"] },
  planetscale: { name: "PlanetScale (MySQL)", type: "serverless", freeTier: true, providers: ["PlanetScale"], bestFor: ["serverless", "branching", "mysql", "scale"] },
  turso: { name: "Turso (libSQL)", type: "edge", freeTier: true, providers: ["Turso"], bestFor: ["edge", "embedded", "sqlite", "global"] },
  none: { name: "None", type: "none", freeTier: true, providers: [], bestFor: ["static", "no-backend"] },
};

// ============================================
// Auth Metadata
// ============================================

const AUTH_METADATA = {
  clerk: { name: "Clerk", type: "managed", freeTier: true, bestFor: ["saas", "b2b", "teams", "organizations"], features: ["organizations", "saml", "mfa", "user-management"] },
  authjs: { name: "Auth.js (NextAuth)", type: "self-hosted", freeTier: true, bestFor: ["custom", "flexible", "open-source", "full-control"], features: ["oauth", "email", "credentials", "adapters"] },
  "supabase-auth": { name: "Supabase Auth", type: "baas", freeTier: true, bestFor: ["supabase-users", "realtime", "row-level-security"], features: ["rls", "realtime", "magic-link", "mfa"] },
  "custom-jwt": { name: "Custom JWT", type: "self-hosted", freeTier: true, bestFor: ["full-control", "existing-auth", "microservices"], features: ["custom", "stateless", "microservices"] },
  "firebase-auth": { name: "Firebase Auth", type: "baas", freeTier: true, bestFor: ["firebase-users", "mobile", "social-login"], features: ["social", "phone", "anonymous", "custom-claims"] },
  none: { name: "None (Public)", type: "none", freeTier: true, bestFor: ["public", "no-auth", "landing"], features: [] },
};

// ============================================
// Hosting Metadata
// ============================================

const HOSTING_METADATA = {
  vercel: { name: "Vercel", freeTier: true, bestFor: ["nextjs", "remix", "sveltekit", "nuxt", "astro"], features: ["edge", "preview", "analytics", "cron"] },
  netlify: { name: "Netlify", freeTier: true, bestFor: ["astro", "vite-react", "sveltekit", "nuxt", "static"], features: ["edge", "forms", "functions", "identity"] },
  "cloudflare-pages": { name: "Cloudflare Pages", freeTier: true, bestFor: ["astro", "vite-react", "sveltekit", "remix", "edge"], features: ["edge", "kv", "d1", "workers", "unlimited-bandwidth"] },
  railway: { name: "Railway", freeTier: false, bestFor: ["fullstack", "database", "background-jobs", "docker"], features: ["postgres", "redis", "docker", "cron"] },
  flyio: { name: "Fly.io", freeTier: false, bestFor: ["docker", "global", "fullstack", "postgres"], features: ["docker", "global", "postgres", "vm"] },
  render: { name: "Render", freeTier: true, bestFor: ["web-services", "static", "postgres", "redis"], features: ["postgres", "redis", "cron", "docker"] },
  none: { name: "Self-hosted", freeTier: true, bestFor: ["vps", "kubernetes", "custom-infra"], features: [] },
};

// ============================================
// Tech Stack Selector Class
// ============================================

export class TechStackSelector {
  private adapter: LLMAdapter;

  constructor(adapter?: LLMAdapter) {
    this.adapter = adapter || getLLMAdapter();
  }

  // ============================================
  // Score a single stack combination
  // ============================================

  private scoreStack(option: Partial<TechStackOption>, criteria: SelectionCriteria): number {
    let score = 50; // Base score

    const frameworkMeta = FRAMEWORK_METADATA[option.framework!];
    const dbMeta = DATABASE_METADATA[option.database!];
    const authMeta = AUTH_METADATA[option.auth!];
    const hostingMeta = HOSTING_METADATA[option.hosting!];

    // Budget scoring (critical for $0 budget)
    if (criteria.budget === "zero") {
      if (frameworkMeta.freeTier && dbMeta.freeTier && authMeta.freeTier && hostingMeta.freeTier) {
        score += 20;
      } else {
        score -= 30;
      }
    }

    // Project type fit
    if (frameworkMeta.bestFor.includes(criteria.projectType)) {
      score += 15;
    }
    if (dbMeta.bestFor.includes(criteria.projectType)) {
      score += 10;
    }

    // Scale fit
    if (criteria.scale === "tiny" || criteria.scale === "small") {
      if (["sqlite", "turso", "firebase", "supabase"].includes(option.database!)) score += 10;
      if (["vite-react", "astro"].includes(option.framework!)) score += 5;
    } else if (criteria.scale === "large" || criteria.scale === "enterprise") {
      if (["postgresql", "neon", "planetscale"].includes(option.database!)) score += 15;
      if (["nextjs", "remix", "nuxt"].includes(option.framework!)) score += 10;
    }

    // Team size & experience
    if (criteria.teamSize === "solo" && frameworkMeta.learningCurve === "low") score += 10;
    if (criteria.techExperience === "beginner" && frameworkMeta.learningCurve === "low") score += 10;
    if (criteria.techExperience === "expert" && frameworkMeta.learningCurve === "high") score += 5;

    // Real-time needs
    if (criteria.realtime) {
      if (["firebase", "supabase", "supabase-auth"].includes(option.database!) ||
          ["firebase", "supabase-auth"].includes(option.auth!)) {
        score += 15;
      }
    }

    // SEO critical
    if (criteria.seoCritical) {
      if (["nextjs", "astro", "remix", "nuxt", "solidstart"].includes(option.framework!)) {
        score += 15;
      }
      if (option.framework === "vite-react") score -= 20; // SPA bad for SEO
    }

    // Auth complexity
    if (criteria.authComplexity === "complex") {
      if (["clerk", "supabase-auth"].includes(option.auth!)) score += 10;
    } else if (criteria.authComplexity === "none") {
      if (option.auth === "none") score += 10;
    }

    // Payment needed
    if (criteria.paymentNeeded && option.payments && option.payments !== "none") score += 10;
    if (!criteria.paymentNeeded && (!option.payments || option.payments === "none")) score += 5;

    // Timeline pressure
    if (criteria.timeline === "asap" && frameworkMeta.learningCurve === "low") score += 10;

    // Preferences bonus
    if (criteria.preferences?.includes(option.framework!)) score += 15;
    if (criteria.preferences?.includes(option.database!)) score += 10;
    if (criteria.preferences?.includes(option.auth!)) score += 5;
    if (criteria.preferences?.includes(option.hosting!)) score += 5;

    // Constraints penalty
    if (criteria.constraints?.includes(option.framework!)) score -= 20;
    if (criteria.constraints?.includes(option.database!)) score -= 15;
    if (criteria.constraints?.includes(option.auth!)) score -= 10;
    if (criteria.constraints?.includes(option.hosting!)) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  // ============================================
  // Generate all valid combinations
  // ============================================

  private generateCombinations(criteria: SelectionCriteria): Partial<TechStackOption>[] {
    const frameworks = Object.keys(FRAMEWORK_METADATA) as TechStackOption["framework"][];
    const databases = Object.keys(DATABASE_METADATA) as TechStackOption["database"][];
    const auths = Object.keys(AUTH_METADATA) as TechStackOption["auth"][];
    const hostings = Object.keys(HOSTING_METADATA) as TechStackOption["hosting"][];
    const payments = ["stripe", "lemonsqueezy", "paddle", "none"] as TechStackOption["payments"][];

    const combinations: Partial<TechStackOption>[] = [];

    for (const framework of frameworks) {
      for (const database of databases) {
        for (const auth of auths) {
          for (const hosting of hostings) {
            for (const payment of payments) {
              // Skip invalid combos
              if (framework === "vite-react" && database !== "none" && !["firebase", "supabase"].includes(database)) {
                // SPA with traditional DB needs backend - possible but complex
              }
              if (framework === "astro" && database !== "none" && !["firebase", "supabase", "sqlite", "turso"].includes(database)) {
                // Astro content-focused, limited SSR
              }

              combinations.push({ framework, database, auth, hosting, payments: payment });
            }
          }
        }
      }
    }

    return combinations;
  }

  // ============================================
  // Select top stacks using LLM for final ranking
  // ============================================

  async selectTopStacks(criteria: SelectionCriteria, topN: number = 3): Promise<TechStackOption[]> {
    // Generate and score all combinations algorithmically
    const combinations = this.generateCombinations(criteria);
    const scored = combinations.map(combo => ({
      ...combo,
      score: this.scoreStack(combo, criteria),
    })).sort((a, b) => b.score - a.score);

    // Take top 10 for LLM refinement
    const topCandidates = scored.slice(0, 10);

    // Use LLM to refine and add rationale
    const prompt = `You are a senior architect reviewing tech stack options.

PROJECT CRITERIA:
${JSON.stringify(criteria, null, 2)}

TOP ALGORITHMIC CANDIDATES:
${JSON.stringify(topCandidates.map(c => ({
  framework: c.framework,
  database: c.database,
  auth: c.auth,
  hosting: c.hosting,
  payments: c.payments,
  algorithmicScore: c.score,
})), null, 2)}

For each candidate, provide:
1. Refined score (0-100) considering holistic fit
2. Rationale (2-3 sentences)
3. Pros (3-5 items)
4. Cons (2-4 items)
5. Estimated monthly cost on free tiers
6. Free tier compatible (true/false)
7. Learning curve (low/medium/high)

Return TOP ${topN} as JSON array matching TechStackOptionSchema.`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 3000,
      responseFormat: { type: "json_object" },
    });

    const result = JSON.parse(response.content);
    return Array.isArray(result) ? result : result.options || [];
  }

  // ============================================
  // Get framework adapter for scaffolding
  // ============================================

  async getFrameworkAdapter(framework: string) {
    return FrameworkRegistry.get(framework);
  }

  // ============================================
  // Explain recommendation
  // ============================================

  async explainRecommendation(option: TechStackOption, criteria: SelectionCriteria): Promise<string> {
    const prompt = `Explain why this tech stack is recommended for the given criteria in developer-friendly language.

STACK:
${JSON.stringify(option, null, 2)}

CRITERIA:
${JSON.stringify(criteria, null, 2)}

Write a concise explanation covering:
- Why this framework fits the project type
- Why this database/auth/hosting combo works
- Trade-offs to be aware of
- Migration path if needs change

Tone: Helpful, technical but accessible.`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      maxTokens: 1500,
    });

    return response.content;
  }
}

// ============================================
// Singleton Instance
// ============================================

let selectorInstance: TechStackSelector | null = null;

export function getTechStackSelector(): TechStackSelector {
  if (!selectorInstance) {
    selectorInstance = new TechStackSelector();
  }
  return selectorInstance;
}