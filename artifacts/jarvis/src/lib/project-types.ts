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