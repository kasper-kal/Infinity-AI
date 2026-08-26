/**
 * PHASE 12 — ARTIFACT TYPE SYSTEM
 *
 * Multi-artifact support: slide-deck, website, web-app, mobile-app, api, cli-tool, chrome-extension
 * Each artifact type defines: scaffold, build, deploy, preview capabilities.
 * Parallel artifact builds from single prompt.
 */

import { z } from "zod";

/**
 * Artifact type identifiers
 */
export type ArtifactTypeId =
  | "slide-deck"
  | "website"
  | "web-app"
  | "mobile-app"
  | "api"
  | "cli-tool"
  | "chrome-extension";

/**
 * Artifact category for grouping
 */
export type ArtifactCategory = "presentation" | "web" | "mobile" | "backend" | "tool" | "extension";

/**
 * Supported frameworks per artifact type
 */
export type Framework =
  | "marp"
  | "reveal"
  | "astro"
  | "next"
  | "vite"
  | "expo"
  | "fastify"
  | "express"
  | "hono"
  | "elysia"
  | "cli"
  | "commander"
  | "cac"
  | "yargs"
  | "oclif"
  | "manifest-v3";

/**
 * Deployment targets per artifact type
 */
export type DeployTarget =
  | "vercel"
  | "netlify"
  | "cloudflare"
  | "github-pages"
  | "expo"
  | "eas"
  | "npm"
  | "docker"
  | "chrome-web-store"
  | "self-hosted";

/**
 * Artifact generation config - input for scaffolding
 */
export interface ArtifactConfig {
  id: string;
  projectId: string;
  type: ArtifactTypeId;
  name: string;
  slug: string; // URL-safe identifier
  description: string;
  framework: Framework;
  deployTarget: DeployTarget[];
  // Type-specific configuration
  settings: Record<string, unknown>;
  // Shared foundation references
  sharedFoundation?: {
    designSystemId?: string;
    componentLibraryId?: string;
    apiClientId?: string;
    configId?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Generated file in an artifact project
 */
export interface GeneratedArtifactFile {
  path: string;
  content: string;
  purpose: string;
  isTemplate: boolean; // true = template file (user modifies), false = generated/build artifact
}

/**
 * Artifact scaffold result
 */
export interface ArtifactScaffoldResult {
  config: ArtifactConfig;
  files: GeneratedArtifactFile[];
  entryPoints: string[]; // main entry files (e.g., "src/index.ts", "app/page.tsx")
  installCommands: string[];
  devCommands: string[];
  buildCommands: string[];
  previewCommands: string[];
  deployCommands: Record<DeployTarget, string>;
}

/**
 * Build result for an artifact
 */
export interface ArtifactBuildResult {
  artifactId: string;
  success: boolean;
  outputDir: string;
  assets: string[]; // built assets ready for deploy
  logs: string[];
  errors: string[];
  durationMs: number;
}

/**
 * Deploy result for an artifact
 */
export interface ArtifactDeployResult {
  artifactId: string;
  target: DeployTarget;
  success: boolean;
  url?: string;
  logs: string[];
  errors: string[];
  durationMs: number;
}

/**
 * Preview info for an artifact
 */
export interface ArtifactPreviewInfo {
  artifactId: string;
  type: "local" | "tunnel" | "deployed";
  url: string;
  qrCode?: string; // for mobile
  expiresAt?: string;
}

/**
 * Artifact type definition - the core registry entry
 */
export interface ArtifactTypeDefinition {
  id: ArtifactTypeId;
  name: string;
  icon: string;
  description: string;
  category: ArtifactCategory;
  // Supported frameworks for this type
  frameworks: Framework[];
  // Default framework
  defaultFramework: Framework;
  // Supported deployment targets
  deployTargets: DeployTarget[];
  // Default deployment target
  defaultDeployTarget: DeployTarget;
  // Required/optional settings schema
  settingsSchema: z.ZodObject<any>;
  // Default settings
  defaultSettings: Record<string, unknown>;
  // Generator function name (in artifact-generators/)
  generator: string;
  // Builder function name (in artifact-builders/)
  builder: string;
  // Deployer function name (in artifact-deployers/)
  deployer: string;
  // Preview provider function name
  previewer: string;
  // Shared foundation keys this artifact uses
  sharedFoundationKeys: string[];
  // Tags for categorization
  tags: string[];
  // Color theme
  color: string;
}

/**
 * Registry of all artifact types
 */
export interface ArtifactTypeRegistry {
  types: ArtifactTypeDefinition[];
  defaultType: ArtifactTypeId;
}

// ============================================================================
// BUILT-IN ARTIFACT TYPE DEFINITIONS
// ============================================================================

// --- SLIDE DECK ---
const slideDeckSettingsSchema = z.object({
  theme: z.enum(["default", "github", "night", "serif", "simple", "sky", "solarized", "blood", "moon", "dracula"]).default("default"),
  aspectRatio: z.enum(["16:9", "4:3", "3:2", "1:1"]).default("16:9"),
  transition: z.enum(["slide", "convex", "concave", "zoom", "fade", "none"]).default("slide"),
  autoSlide: z.number().default(0),
  loop: z.boolean().default(false),
  mouseWheel: z.boolean().default(false),
  title: z.string().default("Untitled Presentation"),
  author: z.string().default(""),
  description: z.string().default(""),
  enableChalkboard: z.boolean().default(false),
  enableMenu: z.boolean().default(true),
  enableOverview: z.boolean().default(true),
  customCss: z.string().default(""),
});

export type SlideDeckSettings = z.infer<typeof slideDeckSettingsSchema>;

// --- WEBSITE ---
const websiteSettingsSchema = z.object({
  framework: z.enum(["astro", "next", "vite"]).default("astro"),
  styling: z.enum(["tailwind", "css-modules", "styled-components", "nativewind"]).default("tailwind"),
  ssr: z.boolean().default(true),
  i18n: z.boolean().default(false),
  contentSource: z.enum(["markdown", "mdx", "cms", "headless"]).default("markdown"),
  seo: z.boolean().default(true),
  sitemap: z.boolean().default(true),
  rss: z.boolean().default(false),
  analytics: z.enum(["none", "plausible", "ga", "umami", "custom"]).default("none"),
  customDomain: z.string().default(""),
});

export type WebsiteSettings = z.infer<typeof websiteSettingsSchema>;

// --- WEB APP ---
const webAppSettingsSchema = z.object({
  framework: z.enum(["next", "vite", "astro"]).default("next"),
  styling: z.enum(["tailwind", "css-modules", "styled-components", "nativewind"]).default("tailwind"),
  routing: z.enum(["file-based", "react-router", "tanstack-router"]).default("file-based"),
  auth: z.enum(["none", "nextauth", "clerk", "supabase", "custom"]).default("none"),
  database: z.enum(["none", "prisma", "drizzle", "supabase", "firebase"]).default("none"),
  stateManagement: z.enum(["none", "zustand", "redux", "jotai", "context"]).default("none"),
  apiLayer: z.enum(["route-handlers", "trpc", "graphql", "rest"]).default("route-handlers"),
  testing: z.array(z.enum(["vitest", "jest", "playwright", "cypress"])).default(["vitest"]),
  pwa: z.boolean().default(false),
});

export type WebAppSettings = z.infer<typeof webAppSettingsSchema>;

// --- MOBILE APP ---
const mobileAppSettingsSchema = z.object({
  platform: z.enum(["ios", "android", "both"]).default("both"),
  template: z.enum(["blank", "tabs", "stack", "drawer", "auth", "social", "ecommerce", "content", "dashboard"]).default("tabs"),
  features: z.array(z.enum(["camera", "location", "push", "biometrics", "haptics", "contacts", "media-library", "motion"])).default([]),
  navigation: z.enum(["expo-router", "react-navigation", "native-stack"]).default("expo-router"),
  styling: z.enum(["nativewind", "styled-components", "emotion", "plain"]).default("nativewind"),
  backend: z.object({
    sharedDb: z.boolean().default(true),
    sharedAuth: z.boolean().default(true),
    apiUrl: z.string().nullable().default(null),
  }).default({ sharedDb: true, sharedAuth: true, apiUrl: null }),
});

export type MobileAppSettings = z.infer<typeof mobileAppSettingsSchema>;

// --- API ---
const apiSettingsSchema = z.object({
  framework: z.enum(["fastify", "express", "hono", "elysia"]).default("hono"),
  validation: z.enum(["zod", "joi", "valibot", "arktype"]).default("zod"),
  orm: z.enum(["none", "prisma", "drizzle", "kysely", "sql"]).default("drizzle"),
  auth: z.enum(["none", "jwt", "session", "oauth", "custom"]).default("jwt"),
  docs: z.enum(["none", "swagger", "scalar", "redoc"]).default("scalar"),
  rateLimiting: z.boolean().default(true),
  cors: z.boolean().default(true),
  logging: z.enum(["pino", "winston", "console"]).default("pino"),
  testing: z.array(z.enum(["vitest", "jest", "supertest"])).default(["vitest"]),
});

export type ApiSettings = z.infer<typeof apiSettingsSchema>;

// --- CLI TOOL ---
const cliToolSettingsSchema = z.object({
  framework: z.enum(["commander", "yargs", "oclif", "cac"]).default("commander"),
  language: z.enum(["typescript", "javascript"]).default("typescript"),
  packaging: z.enum(["pkg", "esbuild", "tsup", "rollup"]).default("tsup"),
  installMethod: z.enum(["npm", "brew", "scoop", "aur", "binary"]).default("npm"),
  autoComplete: z.boolean().default(true),
  configFile: z.boolean().default(true),
  plugins: z.boolean().default(false),
});

export type CliToolSettings = z.infer<typeof cliToolSettingsSchema>;

// --- CHROME EXTENSION ---
const chromeExtensionSettingsSchema = z.object({
  manifestVersion: z.literal(3).default(3),
  type: z.enum(["popup", "sidebar", "content-script", "background", "devtools", "new-tab", "offscreen"]).default("popup"),
  permissions: z.array(z.string()).default(["activeTab", "storage", "scripting"]),
  hostPermissions: z.array(z.string()).default([]),
  contentScripts: z.array(z.object({
    matches: z.array(z.string()),
    js: z.array(z.string()),
    css: z.array(z.string()).optional(),
    runAt: z.enum(["document_start", "document_end", "document_idle"]).default("document_idle"),
  })).default([]),
  background: z.object({
    serviceWorker: z.string(),
    type: z.enum(["module", "classic"]).default("module"),
  }).optional(),
  devtools: z.boolean().default(false),
  optionsPage: z.boolean().default(false),
});

export type ChromeExtensionSettings = z.infer<typeof chromeExtensionSettingsSchema>;

// ============================================================================
// ARTIFACT TYPE DEFINITIONS
// ============================================================================

export const BUILTIN_ARTIFACT_TYPES: ArtifactTypeDefinition[] = [
  // SLIDE DECK
  {
    id: "slide-deck",
    name: "Slide Deck",
    icon: "📊",
    description: "Create beautiful presentations with Marp or Reveal.js — Markdown-based, version controlled, deployable anywhere.",
    category: "presentation",
    frameworks: ["marp", "reveal"],
    defaultFramework: "marp",
    deployTargets: ["vercel", "netlify", "github-pages", "self-hosted"],
    defaultDeployTarget: "github-pages",
    settingsSchema: slideDeckSettingsSchema,
    defaultSettings: {
      theme: "default",
      aspectRatio: "16:9",
      transition: "slide",
      autoSlide: 0,
      loop: false,
      mouseWheel: false,
      title: "Untitled Presentation",
      author: "",
      description: "",
      enableChalkboard: false,
      enableMenu: true,
      enableOverview: true,
      customCss: "",
    },
    generator: "generateSlideDeck",
    builder: "buildSlideDeck",
    deployer: "deploySlideDeck",
    previewer: "previewSlideDeck",
    sharedFoundationKeys: ["designSystem", "componentLibrary"],
    tags: ["presentation", "markdown", "slides", "marp", "reveal"],
    color: "#8b5cf6",
  },

  // WEBSITE
  {
    id: "website",
    name: "Website",
    icon: "🌐",
    description: "Build and deploy modern websites with Astro, Next.js, or Vite — content-first, performant, SEO-ready.",
    category: "web",
    frameworks: ["astro", "next", "vite"],
    defaultFramework: "astro",
    deployTargets: ["vercel", "netlify", "cloudflare", "github-pages", "self-hosted"],
    defaultDeployTarget: "vercel",
    settingsSchema: websiteSettingsSchema,
    defaultSettings: {
      framework: "astro",
      styling: "tailwind",
      ssr: true,
      i18n: false,
      contentSource: "markdown",
      seo: true,
      sitemap: true,
      rss: false,
      analytics: "none",
      customDomain: "",
    },
    generator: "generateWebsite",
    builder: "buildWebsite",
    deployer: "deployWebsite",
    previewer: "previewWebsite",
    sharedFoundationKeys: ["designSystem", "componentLibrary", "apiClient", "config"],
    tags: ["website", "static-site", "ssr", "seo", "content"],
    color: "#0891b2",
  },

  // WEB APP
  {
    id: "web-app",
    name: "Web App",
    icon: "💻",
    description: "Build full-stack web applications with Next.js or Vite — auth, database, API, real-time, PWA ready.",
    category: "web",
    frameworks: ["next", "vite", "astro"],
    defaultFramework: "next",
    deployTargets: ["vercel", "netlify", "cloudflare", "docker", "self-hosted"],
    defaultDeployTarget: "vercel",
    settingsSchema: webAppSettingsSchema,
    defaultSettings: {
      framework: "next",
      styling: "tailwind",
      routing: "file-based",
      auth: "none",
      database: "none",
      stateManagement: "none",
      apiLayer: "route-handlers",
      testing: ["vitest"],
      pwa: false,
    },
    generator: "generateWebApp",
    builder: "buildWebApp",
    deployer: "deployWebApp",
    previewer: "previewWebApp",
    sharedFoundationKeys: ["designSystem", "componentLibrary", "apiClient", "config"],
    tags: ["web-app", "fullstack", "auth", "database", "api", "pwa"],
    color: "#3b82f6",
  },

  // MOBILE APP
  {
    id: "mobile-app",
    name: "Mobile App",
    icon: "📱",
    description: "Build native iOS/Android apps with React Native + Expo — shared backend, store deployment, device features.",
    category: "mobile",
    frameworks: ["expo"],
    defaultFramework: "expo",
    deployTargets: ["expo", "eas", "self-hosted"],
    defaultDeployTarget: "eas",
    settingsSchema: mobileAppSettingsSchema,
    defaultSettings: {
      platform: "both",
      template: "tabs",
      features: [],
      navigation: "expo-router",
      styling: "nativewind",
      backend: { sharedDb: true, sharedAuth: true, apiUrl: null },
    },
    generator: "generateMobileApp",
    builder: "buildMobileApp",
    deployer: "deployMobileApp",
    previewer: "previewMobileApp",
    sharedFoundationKeys: ["designSystem", "componentLibrary", "apiClient", "config"],
    tags: ["mobile", "react-native", "expo", "ios", "android", "native"],
    color: "#db2777",
  },

  // API
  {
    id: "api",
    name: "API",
    icon: "🔌",
    description: "Build REST/GraphQL APIs with Hono, Fastify, or Express — typed, validated, documented, deployable anywhere.",
    category: "backend",
    frameworks: ["fastify", "express", "hono", "elysia"],
    defaultFramework: "hono",
    deployTargets: ["vercel", "cloudflare", "docker", "self-hosted"],
    defaultDeployTarget: "cloudflare",
    settingsSchema: apiSettingsSchema,
    defaultSettings: {
      framework: "hono",
      validation: "zod",
      orm: "drizzle",
      auth: "jwt",
      docs: "scalar",
      rateLimiting: true,
      cors: true,
      logging: "pino",
      testing: ["vitest"],
    },
    generator: "generateApi",
    builder: "buildApi",
    deployer: "deployApi",
    previewer: "previewApi",
    sharedFoundationKeys: ["apiClient", "config"],
    tags: ["api", "backend", "rest", "graphql", "microservice"],
    color: "#059669",
  },

  // CLI TOOL
  {
    id: "cli-tool",
    name: "CLI Tool",
    icon: "⌨️",
    description: "Build command-line tools with Commander.js or CAC — typed, auto-complete, cross-platform, publishable to npm.",
    category: "tool",
    frameworks: ["commander", "cac", "yargs", "oclif"],
    defaultFramework: "commander",
    deployTargets: ["npm", "github-pages", "docker", "self-hosted"],
    defaultDeployTarget: "npm",
    settingsSchema: cliToolSettingsSchema,
    defaultSettings: {
      framework: "commander",
      language: "typescript",
      packaging: "tsup",
      installMethod: "npm",
      autoComplete: true,
      configFile: true,
      plugins: false,
    },
    generator: "generateCliTool",
    builder: "buildCliTool",
    deployer: "deployCliTool",
    previewer: "previewCliTool",
    sharedFoundationKeys: ["config"],
    tags: ["cli", "command-line", "tool", "npm", "automation"],
    color: "#6b7280",
  },

  // CHROME EXTENSION
  {
    id: "chrome-extension",
    name: "Chrome Extension",
    icon: "🧩",
    description: "Build Manifest V3 Chrome extensions — popup, sidebar, content scripts, devtools, new tab page.",
    category: "extension",
    frameworks: ["manifest-v3"],
    defaultFramework: "manifest-v3",
    deployTargets: ["chrome-web-store", "github-pages", "self-hosted"],
    defaultDeployTarget: "chrome-web-store",
    settingsSchema: chromeExtensionSettingsSchema,
    defaultSettings: {
      manifestVersion: 3,
      type: "popup",
      permissions: ["activeTab", "storage", "scripting"],
      hostPermissions: [],
      contentScripts: [],
      background: undefined,
      devtools: false,
      optionsPage: false,
    },
    generator: "generateChromeExtension",
    builder: "buildChromeExtension",
    deployer: "deployChromeExtension",
    previewer: "previewChromeExtension",
    sharedFoundationKeys: ["designSystem", "componentLibrary", "apiClient", "config"],
    tags: ["extension", "chrome", "manifest-v3", "browser", "web-store"],
    color: "#f59e0b",
  },
];

// ============================================================================
// REGISTRY FUNCTIONS
// ============================================================================

export function getArtifactTypeRegistry(): ArtifactTypeRegistry {
  return {
    types: BUILTIN_ARTIFACT_TYPES,
    defaultType: "web-app",
  };
}

export function getArtifactType(id: ArtifactTypeId): ArtifactTypeDefinition | undefined {
  return BUILTIN_ARTIFACT_TYPES.find((t) => t.id === id);
}

export function getArtifactTypesByCategory(category: ArtifactCategory): ArtifactTypeDefinition[] {
  return BUILTIN_ARTIFACT_TYPES.filter((t) => t.category === category);
}

export function getAllArtifactTypes(): ArtifactTypeDefinition[] {
  return BUILTIN_ARTIFACT_TYPES;
}

export function validateArtifactType(id: string): id is ArtifactTypeId {
  return BUILTIN_ARTIFACT_TYPES.some((t) => t.id === id);
}

export function getArtifactTypeByFramework(framework: Framework): ArtifactTypeDefinition[] {
  return BUILTIN_ARTIFACT_TYPES.filter((t) => t.frameworks.includes(framework));
}

export function getArtifactTypeByDeployTarget(target: DeployTarget): ArtifactTypeDefinition[] {
  return BUILTIN_ARTIFACT_TYPES.filter((t) => t.deployTargets.includes(target));
}

export function getSharedFoundationKeys(typeId: ArtifactTypeId): string[] {
  const type = getArtifactType(typeId);
  return type?.sharedFoundationKeys ?? [];
}

// ============================================================================
// SHARED FOUNDATION TYPES
// ============================================================================

export interface SharedFoundation {
  designSystem?: DesignSystemFoundation;
  componentLibrary?: ComponentLibraryFoundation;
  apiClient?: ApiClientFoundation;
  config?: ConfigFoundation;
}

export interface DesignSystemFoundation {
  id: string;
  name: string;
  colors: Record<string, string>;
  typography: Record<string, unknown>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  motion: Record<string, string>;
  breakpoints: Record<string, string>;
  darkMode: boolean;
  cssVariables: boolean;
}

export interface ComponentLibraryFoundation {
  id: string;
  name: string;
  components: ComponentDefinition[];
  exports: string[];
  dependencies: string[];
  peerDependencies: string[];
}

export interface ComponentDefinition {
  name: string;
  path: string;
  props: Record<string, unknown>;
  variants?: string[];
  sizes?: string[];
  description: string;
}

export interface ApiClientFoundation {
  id: string;
  name: string;
  baseUrl: string;
  endpoints: ApiEndpointDefinition[];
  auth: AuthConfig;
  types: string; // TypeScript types export path
}

export interface ApiEndpointDefinition {
  method: string;
  path: string;
  name: string;
  params?: Record<string, unknown>;
  response?: Record<string, unknown>;
  description: string;
}

export interface AuthConfig {
  type: "none" | "bearer" | "cookie" | "oauth" | "custom";
  tokenUrl?: string;
  refreshUrl?: string;
  scopes?: string[];
}

export interface ConfigFoundation {
  id: string;
  name: string;
  env: Record<string, string>;
  runtime: Record<string, unknown>;
  build: Record<string, unknown>;
  deploy: Record<string, unknown>;
}

// ============================================================================
// PARALLEL ARTIFACT BUILD TYPES
// ============================================================================

export interface ParallelArtifactBuild {
  id: string;
  projectId: string;
  prompt: string;
  artifacts: ArtifactBuildTask[];
  status: "planning" | "running" | "completed" | "failed" | "cancelled";
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  globalProgress: number;
  sharedFoundation?: SharedFoundation;
  results: Map<ArtifactTypeId, ArtifactBuildResult>;
}

export interface ArtifactBuildTask {
  artifactId: string;
  type: ArtifactTypeId;
  config: ArtifactConfig;
  dependencies: string[]; // other artifactIds that must complete first
  status: "pending" | "generating" | "building" | "deploying" | "completed" | "failed";
  progress: number;
  result?: ArtifactBuildResult;
  error?: string;
}

export interface ParallelArtifactDeploy {
  id: string;
  projectId: string;
  artifactIds: string[];
  targets: Map<string, DeployTarget[]>; // artifactId -> targets[]
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  results: Map<string, ArtifactDeployResult[]>; // artifactId -> results[]
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface UnifiedDeployDashboard {
  projectId: string;
  artifacts: ArtifactConfig[];
  deployments: Map<string, ArtifactDeployResult[]>; // artifactId -> results[]
  lastDeployedAt?: Date;
  nextDeployAt?: Date;
  autoDeploy: boolean;
}