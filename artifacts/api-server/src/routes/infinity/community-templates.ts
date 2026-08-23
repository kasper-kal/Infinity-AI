import { Router, Request, Response } from "express";

interface CommunityTemplate {
  id: string;
  name: string;
  description: string;
  owner: string;
  repository: string;
  url: string;
  stars: number;
  language: string;
  tags: string[];
  lastUpdated: string;
}

const router = Router();

/**
 * Get trending templates from GitHub
 * GET /community-templates/trending
 * Query: { language?: string, sort?: "stars" | "updated", limit?: number }
 */
router.get("/community-templates/trending", async (req: Request, res: Response) => {
  const language = String(req.query.language || "").trim();
  const sort = String(req.query.sort || "stars") as "stars" | "updated";
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    // This would typically call the GitHub API
    // For now, returning curated popular templates
    const trendingTemplates: CommunityTemplate[] = [
      {
        id: "create-react-app",
        name: "Create React App",
        description: "Zero configuration React application setup",
        owner: "facebook",
        repository: "create-react-app",
        url: "https://github.com/facebook/create-react-app",
        stars: 102000,
        language: "TypeScript",
        tags: ["react", "starter", "popular"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "next-js-13",
        name: "Next.js Examples",
        description: "Comprehensive Next.js starter templates and examples",
        owner: "vercel",
        repository: "next.js",
        url: "https://github.com/vercel/next.js",
        stars: 124000,
        language: "TypeScript",
        tags: ["nextjs", "react", "fullstack"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "vue-cli",
        name: "Vue CLI",
        description: "Standard tooling for Vue.js development",
        owner: "vuejs",
        repository: "vue-cli",
        url: "https://github.com/vuejs/vue-cli",
        stars: 29000,
        language: "JavaScript",
        tags: ["vue", "cli", "frontend"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "django-rest-framework",
        name: "Django REST Framework",
        description: "Powerful REST API framework for Django",
        owner: "encode",
        repository: "django-rest-framework",
        url: "https://github.com/encode/django-rest-framework",
        stars: 28000,
        language: "Python",
        tags: ["django", "api", "rest"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "rust-cli",
        name: "Rust CLI Template",
        description: "Template for building CLI tools in Rust",
        owner: "rust-cli",
        repository: "rust-cli-template",
        url: "https://github.com/rust-cli/rust-cli-template",
        stars: 5200,
        language: "Rust",
        tags: ["rust", "cli", "template"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "flutter-starter",
        name: "Flutter Starter Kit",
        description: "Complete Flutter starter kit for mobile apps",
        owner: "flutter",
        repository: "samples",
        url: "https://github.com/flutter/samples",
        stars: 16000,
        language: "Dart",
        tags: ["flutter", "mobile", "starter"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "go-starter",
        name: "Go REST API",
        description: "RESTful API starter template in Go",
        owner: "golang",
        repository: "example",
        url: "https://github.com/golang-examples/rest-api",
        stars: 4500,
        language: "Go",
        tags: ["go", "api", "rest"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "rails-template",
        name: "Rails API Template",
        description: "Modern Rails 7 API template with best practices",
        owner: "rails",
        repository: "rails",
        url: "https://github.com/rails/rails",
        stars: 55000,
        language: "Ruby",
        tags: ["rails", "api", "ruby"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "threejs-starter",
        name: "Three.js Journey",
        description: "Complete course and starter for Three.js 3D graphics",
        owner: "brunosimon",
        repository: "threejs-journey",
        url: "https://github.com/brunosimon/threejs-journey",
        stars: 6000,
        language: "JavaScript",
        tags: ["threejs", "3d", "graphics"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "electron-template",
        name: "Electron React Template",
        description: "React + Electron template for desktop apps",
        owner: "electron-react-boilerplate",
        repository: "electron-react-boilerplate",
        url: "https://github.com/electron-react-boilerplate/electron-react-boilerplate",
        stars: 23000,
        language: "TypeScript",
        tags: ["electron", "react", "desktop"],
        lastUpdated: new Date().toISOString(),
      },
    ];

    let filtered = trendingTemplates;

    if (language) {
      filtered = filtered.filter((t) => t.language.toLowerCase().includes(language.toLowerCase()));
    }

    if (sort === "stars") {
      filtered.sort((a, b) => b.stars - a.stars);
    } else if (sort === "updated") {
      filtered.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
    }

    return res.json({
      ok: true,
      templates: filtered.slice(0, limit),
      total: filtered.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trending templates");
    return res.status(500).json({ error: "Failed to fetch trending templates" });
  }
});

/**
 * Search community templates
 * GET /community-templates/search
 * Query: { q: string, language?: string, sort?: "stars" | "updated", limit?: number }
 */
router.get("/community-templates/search", async (req: Request, res: Response) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const language = String(req.query.language || "").trim();
  const sort = String(req.query.sort || "stars") as "stars" | "updated";
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    // In production, this would search GitHub API or a template registry
    // For now, we'll implement a simple search over curated templates
    const allTemplates: CommunityTemplate[] = [
      {
        id: "mern-stack",
        name: "MERN Stack",
        description: "MongoDB, Express, React, Node.js full-stack template",
        owner: "devahmedshendy",
        repository: "mern-stack",
        url: "https://github.com/devahmedshendy/mern-stack",
        stars: 3200,
        language: "JavaScript",
        tags: ["mern", "fullstack", "mongodb"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "fastapi-sqlalchemy",
        name: "FastAPI + SQLAlchemy",
        description: "FastAPI with SQLAlchemy ORM starter",
        owner: "tiangolo",
        repository: "full-stack-fastapi-postgresql",
        url: "https://github.com/tiangolo/full-stack-fastapi-postgresql",
        stars: 25000,
        language: "Python",
        tags: ["fastapi", "sqlalchemy", "postgresql"],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: "spring-boot-api",
        name: "Spring Boot REST API",
        description: "Production-ready Spring Boot REST API template",
        owner: "in28minutes",
        repository: "spring-boot-master-class",
        url: "https://github.com/in28minutes/spring-boot-master-class",
        stars: 8000,
        language: "Java",
        tags: ["springboot", "rest", "api"],
        lastUpdated: new Date().toISOString(),
      },
    ];

    let filtered = allTemplates;

    // Simple text search
    filtered = filtered.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.tags.some((tag) => tag.toLowerCase().includes(query)),
    );

    if (language) {
      filtered = filtered.filter((t) => t.language.toLowerCase().includes(language.toLowerCase()));
    }

    if (sort === "stars") {
      filtered.sort((a, b) => b.stars - a.stars);
    } else if (sort === "updated") {
      filtered.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
    }

    return res.json({
      ok: true,
      query,
      results: filtered.slice(0, limit),
      total: filtered.length,
    });
  } catch (err) {
    req.log.error({ err }, "Search failed");
    return res.status(500).json({ error: "Search failed" });
  }
});

/**
 * Get template by ID from community
 * GET /community-templates/:id
 */
router.get("/community-templates/:id", async (req: Request, res: Response) => {
  const templateId = String(req.params.id).toLowerCase();

  try {
    // Simulate fetching template details from GitHub
    // In production, this would fetch from GitHub API or a cache
    const template: CommunityTemplate = {
      id: templateId,
      name: `Template ${templateId}`,
      description: "Community template from GitHub",
      owner: "unknown",
      repository: templateId,
      url: `https://github.com/unknown/${templateId}`,
      stars: 0,
      language: "JavaScript",
      tags: ["template"],
      lastUpdated: new Date().toISOString(),
    };

    res.json({
      ok: true,
      template,
      cloneCommand: `git clone https://github.com/${template.owner}/${template.repository}.git`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch template");
    res.status(500).json({ error: "Failed to fetch template" });
  }
});

/**
 * Clone a community template to workspace
 * POST /community-templates/clone
 * Body: { templateId, projectName, workspaceId }
 */
router.post("/community-templates/clone", async (req: Request, res: Response) => {
  const templateId = String(req.body?.templateId || "").toLowerCase();
  const projectName = String(req.body?.projectName || "my-project").slice(0, 128);
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);

  if (!templateId) {
    return res.status(400).json({ error: "templateId is required" });
  }

  try {
    // In production, this would clone the GitHub repository
    // For now, we simulate the process
    return res.json({
      ok: true,
      status: "cloning",
      projectName,
      workspaceId,
      templateId,
      message: `Starting clone of ${templateId} to ${projectName}`,
      cloneCommand: `git clone https://github.com/unknown/${templateId}.git ${projectName}`,
      estimatedTime: "5-10 seconds",
    });
  } catch (err) {
    req.log.error({ err }, "Clone failed");
    return res.status(500).json({ error: "Failed to clone template" });
  }
});

/**
 * Get popular languages for templates
 * GET /community-templates/languages
 */
router.get("/community-templates/languages", (req: Request, res: Response) => {
  const languages = [
    { language: "JavaScript", count: 42000 },
    { language: "Python", count: 28000 },
    { language: "TypeScript", count: 24000 },
    { language: "Go", count: 18000 },
    { language: "Rust", count: 15000 },
    { language: "Java", count: 12000 },
    { language: "Ruby", count: 8000 },
    { language: "Dart", count: 6500 },
    { language: "C#", count: 5800 },
    { language: "PHP", count: 4200 },
  ];

  res.json({
    ok: true,
    languages: languages.sort((a, b) => b.count - a.count),
  });
});

export default router;
