import { Router, Request, Response } from "express";

interface Template {
  id: string;
  name: string;
  description: string;
  category: "frontend" | "backend" | "fullstack" | "mobile" | "3d" | "ai" | "data" | "cli";
  language: string;
  framework?: string;
  runtime: string;
  files: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  tags: string[];
}

const router = Router();

const BUILT_IN_TEMPLATES: Template[] = [
  // Frontend
  {
    id: "react-vite",
    name: "React + Vite",
    description: "Lightning-fast React development with Vite bundler",
    category: "frontend",
    language: "JavaScript/TypeScript",
    framework: "React",
    runtime: "Node.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: "react-vite-app",
          type: "module",
          scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
          dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
          devDependencies: { "@vitejs/plugin-react": "^4.0.0", vite: "^5.0.0" },
        },
        null,
        2,
      ),
      "vite.config.js": `import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };`,
      "index.html": `<!DOCTYPE html>\n<html>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>\n</body>\n</html>`,
      "src/main.jsx": `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
      "src/App.jsx":
        `export default function App() { return <div>Hello React + Vite!</div>; }`,
    },
    tags: ["react", "vite", "frontend", "fast"],
  },
  {
    id: "next-app",
    name: "Next.js 16 (App Router)",
    description: "Full-stack React with Next.js, built-in API routes & SSR",
    category: "fullstack",
    language: "TypeScript",
    framework: "Next.js",
    runtime: "Node.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: "nextjs-app",
          scripts: { dev: "next dev", build: "next build", start: "next start" },
          dependencies: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
      "next.config.mjs": `export default {};`,
      "app/layout.tsx": `export const metadata = { title: 'Next.js App' };\nexport default function RootLayout({ children }) { return <html><body>{children}</body></html>; }`,
      "app/page.tsx": `export default function Home() { return <main><h1>Welcome to Next.js</h1></main>; }`,
      "app/api/hello/route.ts": `export async function GET() { return Response.json({ message: 'Hello from API' }); }`,
    },
    tags: ["nextjs", "react", "fullstack", "typescript"],
  },
  {
    id: "vue-vite",
    name: "Vue 3 + Vite",
    description: "Progressive Vue framework with Vite for fast development",
    category: "frontend",
    language: "JavaScript/TypeScript",
    framework: "Vue",
    runtime: "Node.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: "vue-vite-app",
          type: "module",
          scripts: { dev: "vite", build: "vite build" },
          dependencies: { vue: "^3.0.0" },
          devDependencies: { "@vitejs/plugin-vue": "^5.0.0", vite: "^5.0.0" },
        },
        null,
        2,
      ),
      "vite.config.js": `import vue from '@vitejs/plugin-vue';\nexport default { plugins: [vue()] };`,
      "index.html": `<div id="app"></div>\n<script type="module" src="/src/main.js"></script>`,
      "src/main.js": `import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');`,
      "src/App.vue": `<template>\n<div><h1>Hello Vue!</h1></div>\n</template>`,
    },
    tags: ["vue", "vite", "frontend", "reactive"],
  },
  {
    id: "fastapi",
    name: "FastAPI",
    description: "Modern async Python web API framework with automatic docs",
    category: "backend",
    language: "Python",
    framework: "FastAPI",
    runtime: "Python",
    files: {
      "requirements.txt": "fastapi==0.104.0\nuvicorn==0.24.0",
      "main.py": `from fastapi import FastAPI\nfrom fastapi.responses import JSONResponse\n\napp = FastAPI()\n\n@app.get("/")\ndef read_root():\n    return JSONResponse({"message": "Hello FastAPI"})\n\n@app.get("/api/items/{item_id}")\ndef read_item(item_id: int):\n    return {"item_id": item_id}`,
    },
    tags: ["fastapi", "python", "backend", "async"],
  },
  {
    id: "django",
    name: "Django",
    description: "Full-featured Python web framework with ORM and admin",
    category: "backend",
    language: "Python",
    framework: "Django",
    runtime: "Python",
    files: {
      "requirements.txt": "django==4.2.0",
      "manage.py": `#!/usr/bin/env python\nimport os\nimport sys\n\nif __name__ == "__main__":\n    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")\n    from django.core.management import execute_from_command_line\n    execute_from_command_line(sys.argv)`,
      "settings.py": `INSTALLED_APPS = ["django.contrib.admin", "django.contrib.auth"]\nDATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": "db.sqlite3"}}`,
      "urls.py": `from django.urls import path\nurlpatterns = []`,
      "views.py": `from django.http import JsonResponse\n\ndef hello(request):\n    return JsonResponse({"message": "Hello Django"})`,
    },
    tags: ["django", "python", "backend", "orm"],
  },
  {
    id: "rails",
    name: "Ruby on Rails",
    description: "Convention-over-configuration web framework with built-in ORM",
    category: "fullstack",
    language: "Ruby",
    framework: "Rails",
    runtime: "Ruby",
    files: {
      "Gemfile": `source "https://rubygems.org"\ngem "rails", "~> 7.0"`,
      "config/routes.rb": `Rails.application.routes.draw do\n  root "pages#home"\nend`,
      "app/controllers/pages_controller.rb": `class PagesController < ApplicationController\n  def home\n    render json: { message: "Hello Rails" }\n  end\nend`,
    },
    tags: ["rails", "ruby", "fullstack", "convention"],
  },
  {
    id: "flutter-app",
    name: "Flutter",
    description: "Cross-platform mobile and desktop app framework",
    category: "mobile",
    language: "Dart",
    framework: "Flutter",
    runtime: "Dart",
    files: {
      "pubspec.yaml": `name: hello_flutter\nversion: 1.0.0\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"`,
      "lib/main.dart": `import 'package:flutter/material.dart';\n\nvoid main() {\n  runApp(const MyApp());\n}\n\nclass MyApp extends StatelessWidget {\n  const MyApp({Key? key}) : super(key: key);\n\n  @override\n  Widget build(BuildContext context) {\n    return MaterialApp(\n      home: Scaffold(body: Center(child: Text('Hello Flutter'))),\n    );\n  }\n}`,
    },
    tags: ["flutter", "dart", "mobile", "cross-platform"],
  },
  {
    id: "react-native",
    name: "React Native (Expo)",
    description: "Build native mobile apps with JavaScript and React",
    category: "mobile",
    language: "JavaScript/TypeScript",
    framework: "React Native",
    runtime: "Node.js",
    files: {
      "app.json": JSON.stringify(
        {
          expo: {
            name: "hello-react-native",
            slug: "hello-react-native",
            version: "1.0.0",
            platforms: ["ios", "android", "web"],
          },
        },
        null,
        2,
      ),
      "App.tsx": `import React from 'react';\nimport { Text, View } from 'react-native';\n\nexport default function App() {\n  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text>Hello React Native</Text></View>;\n}`,
      "package.json": JSON.stringify(
        { expo: "latest", react: "latest", "react-native": "latest" },
        null,
        2,
      ),
    },
    tags: ["react-native", "mobile", "expo", "javascript"],
  },
  {
    id: "three-js",
    name: "Three.js 3D",
    description: "Create stunning 3D graphics with WebGL and Three.js",
    category: "3d",
    language: "JavaScript/TypeScript",
    framework: "Three.js",
    runtime: "Node.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: "threejs-app",
          scripts: { dev: "vite", build: "vite build" },
          dependencies: { three: "latest" },
          devDependencies: { vite: "latest" },
        },
        null,
        2,
      ),
      "index.html": `<!DOCTYPE html>\n<canvas id="canvas"></canvas>\n<script type="module" src="/src/main.js"></script>`,
      "src/main.js": `import * as THREE from 'three';\nconst scene = new THREE.Scene();\nconst camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);\nconst renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas') });\nrenderer.setSize(window.innerWidth, window.innerHeight);\nconst geometry = new THREE.BoxGeometry();\nconst material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });\nconst cube = new THREE.Mesh(geometry, material);\nscene.add(cube);\ncamera.position.z = 5;\nfunction animate() {\n  requestAnimationFrame(animate);\n  cube.rotation.x += 0.01;\n  cube.rotation.y += 0.01;\n  renderer.render(scene, camera);\n}\nanimate();`,
    },
    tags: ["threejs", "3d", "webgl", "graphics"],
  },
  {
    id: "p5-sketch",
    name: "p5.js",
    description: "Creative coding with JavaScript for visual art and interaction",
    category: "3d",
    language: "JavaScript",
    framework: "p5.js",
    runtime: "Node.js",
    files: {
      "index.html": `<!DOCTYPE html>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js"></script>\n<script src="sketch.js"></script>`,
      "sketch.js": `function setup() {\n  createCanvas(400, 400);\n}\n\nfunction draw() {\n  background(220);\n  fill(0, 200, 100);\n  circle(mouseX, mouseY, 50);\n}`,
    },
    tags: ["p5js", "creative", "javascript", "art"],
  },
  {
    id: "electron-app",
    name: "Electron",
    description: "Build desktop applications with JavaScript and Chromium",
    category: "frontend",
    language: "JavaScript/TypeScript",
    framework: "Electron",
    runtime: "Node.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: "electron-app",
          main: "main.js",
          scripts: { start: "electron ." },
          dependencies: { electron: "latest" },
        },
        null,
        2,
      ),
      "main.js": `const { app, BrowserWindow } = require('electron');\n\napp.on('ready', () => {\n  const win = new BrowserWindow({ width: 800, height: 600 });\n  win.loadFile('index.html');\n});`,
      "index.html": `<!DOCTYPE html>\n<body>\n<h1>Hello Electron</h1>\n</body>`,
    },
    tags: ["electron", "desktop", "nodejs", "chromium"],
  },
  {
    id: "rust-web",
    name: "Rust + Actix-web",
    description: "High-performance async web framework in Rust",
    category: "backend",
    language: "Rust",
    framework: "Actix-web",
    runtime: "Rust",
    files: {
      "Cargo.toml": `[package]\nname = "hello-actix"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nactix-web = "4.0"\ntokio = { version = "1", features = ["full"] }`,
      "src/main.rs": `use actix_web::{web, App, HttpServer, HttpResponse};\n\n#[actix_web::main]\nasync fn main() -> std::io::Result<()> {\n  HttpServer::new(|| {\n    App::new().route("/", web::get().to(|| async { HttpResponse::Ok().body("Hello Rust!") }))\n  }).bind("127.0.0.1:8080")?.run().await\n}`,
    },
    tags: ["rust", "actix", "backend", "performance"],
  },
  {
    id: "go-api",
    name: "Go + Gin",
    description: "Fast and lightweight API framework for Go",
    category: "backend",
    language: "Go",
    framework: "Gin",
    runtime: "Go",
    files: {
      "go.mod": `module hello-go\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.0`,
      "main.go": `package main\n\nimport "github.com/gin-gonic/gin"\n\nfunc main() {\n  r := gin.Default()\n  r.GET("/", func(c *gin.Context) {\n    c.JSON(200, gin.H{"message": "Hello Go"})\n  })\n  r.Run(":8080")\n}`,
    },
    tags: ["go", "gin", "backend", "api"],
  },
  {
    id: "java-spring",
    name: "Spring Boot",
    description: "Enterprise Java framework with built-in dependency injection",
    category: "backend",
    language: "Java",
    framework: "Spring Boot",
    runtime: "Java",
    files: {
      "pom.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<project><artifactId>hello-spring</artifactId><packaging>jar</packaging></project>`,
      "src/main/java/App.java": `@SpringBootApplication\npublic class App {\n  public static void main(String[] args) {\n    SpringApplication.run(App.class, args);\n  }\n}`,
      "src/main/java/HelloController.java": `@RestController\npublic class HelloController {\n  @GetMapping("/")\n  public Map<String, String> hello() {\n    return Map.of("message", "Hello Spring");\n  }\n}`,
    },
    tags: ["spring", "java", "backend", "enterprise"],
  },
  {
    id: "langchain",
    name: "LangChain AI",
    description: "Build AI-powered applications with language models and tools",
    category: "ai",
    language: "Python",
    framework: "LangChain",
    runtime: "Python",
    files: {
      "requirements.txt": "langchain==0.0.350\nopenai==1.3.0",
      "app.py": `from langchain.llms import OpenAI\nfrom langchain.prompts import PromptTemplate\n\nllm = OpenAI(temperature=0.9)\nprompt = PromptTemplate(input_variables=["topic"], template="Write a short poem about {topic}")\nchain = prompt | llm\nresult = chain.invoke({"topic": "programming"})\nprint(result)`,
    },
    tags: ["langchain", "ai", "llm", "python"],
  },
  {
    id: "astro-static",
    name: "Astro Static Site",
    description: "Fast static site generation with components and minimal JS",
    category: "frontend",
    language: "JavaScript/TypeScript",
    framework: "Astro",
    runtime: "Node.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: "astro-site",
          scripts: { dev: "astro dev", build: "astro build" },
          dependencies: { astro: "latest" },
        },
        null,
        2,
      ),
      "astro.config.mjs": `import { defineConfig } from 'astro/config';\nexport default defineConfig({});`,
      "src/pages/index.astro": `---\nconst title = 'Welcome to Astro';\n---\n<h1>{title}</h1>`,
    },
    tags: ["astro", "static", "frontend", "islands"],
  },
  {
    id: "cli-tool",
    name: "Node.js CLI Tool",
    description: "Build command-line applications with Node.js",
    category: "cli",
    language: "JavaScript/TypeScript",
    framework: "Commander.js",
    runtime: "Node.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: "hello-cli",
          bin: { hello: "./bin/cli.js" },
          dependencies: { commander: "latest" },
        },
        null,
        2,
      ),
      "bin/cli.js": `#!/usr/bin/env node\nconst { program } = require('commander');\nprogram.version('1.0.0').command('hello [name]').action((name) => {\n  console.log(\`Hello \${name || 'World'}\`);\n});\nprogram.parse(process.argv);`,
    },
    tags: ["cli", "nodejs", "commander", "tool"],
  },
];

/**
 * Get all available templates
 * GET /templates/list
 * Query: { category?: string, language?: string }
 */
router.get("/templates/list", (req: Request, res: Response) => {
  let templates = BUILT_IN_TEMPLATES;

  const category = String(req.query.category || "").toLowerCase();
  const language = String(req.query.language || "").toLowerCase();

  if (category) {
    templates = templates.filter((t) => t.category === category);
  }

  if (language) {
    templates = templates.filter((t) => t.language.toLowerCase().includes(language));
  }

  res.json({
    ok: true,
    total: templates.length,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      language: t.language,
      framework: t.framework,
      tags: t.tags,
    })),
  });
});

/**
 * Get template details
 * GET /templates/:id
 */
router.get("/templates/:id", (req: Request, res: Response) => {
  const templateId = String(req.params.id).toLowerCase();
  const template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);

  if (!template) {
    return res.status(404).json({ error: "Template not found" });
  }

  return res.json({
    ok: true,
    template,
  });
});

/**
 * Create project from template
 * POST /templates/create
 * Body: { templateId, projectName, workspaceId }
 */
router.post("/templates/create", (req: Request, res: Response) => {
  const templateId = String(req.body?.templateId || "").toLowerCase();
  const projectName = String(req.body?.projectName || "my-project").slice(0, 128);
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);

  try {
    const template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);

    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    // In a real implementation, this would write files to the workspace
    // For now, we return the template structure
    return res.json({
      ok: true,
      projectName,
      workspaceId,
      template: {
        id: template.id,
        name: template.name,
        framework: template.framework,
        runtime: template.runtime,
        fileCount: Object.keys(template.files).length,
      },
      files: template.files,
      scripts: template.scripts,
      dependencies: template.dependencies,
      devDependencies: template.devDependencies,
    });
  } catch (err) {
    req.log.error({ err }, "Template creation failed");
    return res.status(500).json({ error: "Failed to create project from template" });
  }
});

/**
 * Get template categories
 * GET /templates/categories
 */
router.get("/templates/categories", (req: Request, res: Response) => {
  const categories = [...new Set(BUILT_IN_TEMPLATES.map((t) => t.category))];

  res.json({
    ok: true,
    categories: categories.sort(),
    count: categories.length,
  });
});

export default router;
