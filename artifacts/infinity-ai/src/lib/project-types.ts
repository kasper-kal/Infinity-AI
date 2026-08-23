/**
 * Frontend Project Types Registry — mirrors the backend registry.
 * Used for project creation modal, type-specific UI rendering, etc.
 */

export interface ProjectType {
  id: string;
  name: string;
  icon: string;
  description: string;
  components: string[];
  tools: string[];
  defaultViews: string[];
  settingsSchema?: Record<string, unknown>;
  extends?: string;
  color: string;
  tags: string[];
}

export interface ProjectTypeRegistry {
  types: ProjectType[];
  defaultType: string;
}

export const BUILTIN_PROJECT_TYPES: ProjectType[] = [
  {
    id: "general",
    name: "General Project",
    icon: "📁",
    description: "A flexible project for any kind of work. No special tooling.",
    components: [],
    tools: [],
    defaultViews: ["overview", "chats", "files", "memory", "instructions", "activity"],
    color: "#0ea5e9",
    tags: ["general", "flexible"],
  },
  {
    id: "book",
    name: "Book",
    icon: "📖",
    description: "Write and publish books — manuscript editor, chapter outline, cover designer, A5 PDF export.",
    components: ["ManuscriptEditor", "ChapterOutline", "CoverDesigner", "PDFExporter", "PublishChecklist"],
    tools: ["book.chapter", "book.cover", "book.export", "book.publish"],
    defaultViews: ["manuscript", "outline", "cover", "export", "chats", "files", "memory", "instructions", "activity"],
    color: "#7c3aed",
    tags: ["writing", "publishing", "creative"],
    extends: "general",
  },
  {
    id: "website",
    name: "Website",
    icon: "🌐",
    description: "Build and deploy websites — Build Mode integration, GitHub sync, Figma import, live preview.",
    components: ["BuildPanel", "GitHubConnect", "FigmaImport", "DeployStatus", "LivePreview"],
    tools: ["website.build", "website.github", "website.figma", "website.deploy", "website.preview"],
    defaultViews: ["build", "github", "figma", "deploy", "preview", "chats", "files", "memory", "instructions", "activity"],
    color: "#0891b2",
    tags: ["web", "development", "deployment"],
    extends: "general",
  },
  {
    id: "company",
    name: "Company",
    icon: "🏢",
    description: "Run a business — logo/slogan generator, promo video creator, brand kit, website builder.",
    components: ["LogoGenerator", "SloganGenerator", "PromoVideoLauncher", "BrandKit", "WebsiteBuilder"],
    tools: ["company.logo", "company.slogan", "company.promo", "company.brand", "company.website"],
    defaultViews: ["brand", "promo", "website", "chats", "files", "memory", "instructions", "activity"],
    color: "#ea580c",
    tags: ["business", "branding", "marketing"],
    extends: "general",
  },
  {
    id: "app",
    name: "App",
    icon: "📱",
    description: "Build mobile/desktop apps — scaffolding, store assets, crash reporting, analytics.",
    components: ["AppScaffold", "StoreAssets", "CrashReporting", "AnalyticsDashboard"],
    tools: ["app.scaffold", "app.store", "app.crash", "app.analytics"],
    defaultViews: ["scaffold", "store", "crash", "analytics", "chats", "files", "memory", "instructions", "activity"],
    color: "#db2777",
    tags: ["mobile", "desktop", "development"],
    extends: "general",
  },
  {
    id: "research",
    name: "Research",
    icon: "🔬",
    description: "Academic research — literature manager, citation graph, experiment tracker, paper draft.",
    components: ["LiteratureManager", "CitationGraph", "ExperimentTracker", "PaperDraft"],
    tools: ["research.literature", "research.citations", "research.experiments", "research.paper"],
    defaultViews: ["literature", "citations", "experiments", "paper", "chats", "files", "memory", "instructions", "activity"],
    color: "#059669",
    tags: ["academic", "science", "publishing"],
    extends: "general",
  },
  {
    id: "course",
    name: "Course",
    icon: "🎓",
    description: "Create educational content — lesson builder, video hosting, quiz engine, student progress.",
    components: ["LessonBuilder", "VideoHosting", "QuizEngine", "StudentProgress"],
    tools: ["course.lesson", "course.video", "course.quiz", "course.students"],
    defaultViews: ["lessons", "videos", "quizzes", "students", "chats", "files", "memory", "instructions", "activity"],
    color: "#65a30d",
    tags: ["education", "teaching", "content"],
    extends: "general",
  },
];

export function getProjectTypeRegistry(): ProjectTypeRegistry {
  return {
    types: BUILTIN_PROJECT_TYPES,
    defaultType: "general",
  };
}

export function getProjectType(id: string): ProjectType | undefined {
  return BUILTIN_PROJECT_TYPES.find((t) => t.id === id);
}

export function getAllProjectTypes(): ProjectType[] {
  return BUILTIN_PROJECT_TYPES;
}

export function validateProjectType(id: string): boolean {
  return BUILTIN_PROJECT_TYPES.some((t) => t.id === id);
}

export function getProjectTypesByTag(tag: string): ProjectType[] {
  return BUILTIN_PROJECT_TYPES.filter((t) => t.tags.includes(tag));
}

// Type-specific tool namespaces for Universal Tool Layer (Phase 22)
export const TYPE_TOOL_NAMESPACES: Record<string, string[]> = {
  general: [],
  book: ["book.chapter", "book.cover", "book.export", "book.publish"],
  website: ["website.build", "website.github", "website.figma", "website.deploy", "website.preview"],
  company: ["company.logo", "company.slogan", "company.promo", "company.brand", "company.website"],
  app: ["app.scaffold", "app.store", "app.crash", "app.analytics"],
  research: ["research.literature", "research.citations", "research.experiments", "research.paper"],
  course: ["course.lesson", "course.video", "course.quiz", "course.students"],
};

export function getToolsForProjectType(typeId: string): string[] {
  return TYPE_TOOL_NAMESPACES[typeId] ?? [];
}

export function getDefaultViewsForProjectType(typeId: string): string[] {
  const type = getProjectType(typeId);
  return type?.defaultViews ?? BUILTIN_PROJECT_TYPES[0].defaultViews;
}

export function getComponentsForProjectType(typeId: string): string[] {
  const type = getProjectType(typeId);
  return type?.components ?? [];
}

// Helper to get project type color
export function getProjectTypeColor(typeId: string): string {
  const type = getProjectType(typeId);
  return type?.color ?? "#0ea5e9";
}

// Helper to get project type icon
export function getProjectTypeIcon(typeId: string): string {
  const type = getProjectType(typeId);
  return type?.icon ?? "📁";
}

/**
 * Plugin system for custom project types (frontend mirror)
 * Note: Full plugin loading happens on the backend; frontend fetches from API
 */

export interface CustomProjectTypePlugin {
  id: string;
  name: string;
  icon: string;
  description: string;
  components: string[];
  tools: string[];
  defaultViews: string[];
  color: string;
  tags: string[];
  version: string;
  author?: string;
}

// Cache for custom plugins loaded from API
let customPluginsCache: CustomProjectTypePlugin[] = [];
let customPluginsLoaded = false;

/**
 * Load custom plugins from the backend API
 */
export async function loadCustomPluginsFromAPI(): Promise<CustomProjectTypePlugin[]> {
  try {
    const response = await fetch("/api/jarvis/project-types/plugins");
    if (!response.ok) throw new Error("Failed to fetch plugins");
    const data = await response.json();
    customPluginsCache = data.plugins || [];
    customPluginsLoaded = true;
    return customPluginsCache;
  } catch (error) {
    console.warn("[Project Types] Failed to load custom plugins:", error);
    return [];
  }
}

/**
 * Get all project types including custom plugins
 */
export async function getAllProjectTypesWithPlugins(): Promise<ProjectType[]> {
  if (!customPluginsLoaded) {
    await loadCustomPluginsFromAPI();
  }

  const builtin = BUILTIN_PROJECT_TYPES;
  const custom = customPluginsCache.map(p => ({
    ...p,
    settingsSchema: undefined,
    extends: undefined,
  })) as ProjectType[];

  return [...builtin, ...custom];
}

/**
 * Get project type by ID including plugins
 */
export async function getProjectTypeWithPlugins(id: string): Promise<ProjectType | undefined> {
  // Check built-in first
  const builtin = getProjectType(id);
  if (builtin) return builtin;

  // Check custom plugins
  if (!customPluginsLoaded) {
    await loadCustomPluginsFromAPI();
  }

  return customPluginsCache.find(p => p.id === id);
}

/**
 * Validate project type ID including plugins
 */
export async function validateProjectTypeWithPlugins(id: string): Promise<boolean> {
  if (validateProjectType(id)) return true;
  if (!customPluginsLoaded) {
    await loadCustomPluginsFromAPI();
  }
  return customPluginsCache.some(p => p.id === id);
}

/**
 * Reload custom plugins from API
 */
export async function reloadCustomPlugins(): Promise<CustomProjectTypePlugin[]> {
  customPluginsLoaded = false;
  return loadCustomPluginsFromAPI();
}

/**
 * Create a new plugin template via API
 */
export async function createPluginTemplate(id: string, name: string): Promise<{ success: boolean; filePath?: string; message?: string; error?: string }> {
  try {
    const response = await fetch("/api/jarvis/project-types/plugins/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
    return await response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a custom plugin via API
 */
export async function deleteCustomPlugin(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const response = await fetch(`/api/jarvis/project-types/plugins/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error };
    }
    customPluginsCache = customPluginsCache.filter(p => p.id !== id);
    return { success: true, message: `Plugin "${id}" deleted` };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}