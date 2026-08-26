/**
 * PHASE 12 — SLIDE DECK GENERATOR (Marp / Reveal.js)
 *
 * Generates presentation projects from natural language prompts.
 * Supports Marp (Markdown-based, VS Code native) and Reveal.js (HTML-based, interactive).
 * $0 budget: pure code generation.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ArtifactConfig,
  ArtifactScaffoldResult,
  ArtifactBuildResult,
  ArtifactDeployResult,
  ArtifactPreviewInfo,
  ArtifactTypeDefinition,
  SlideDeckSettings,
} from "../artifact-types";

/**
 * Slide Deck Generator
 */
export class SlideDeckGenerator {
  private typeDef: ArtifactTypeDefinition;

  constructor(typeDef: ArtifactTypeDefinition) {
    this.typeDef = typeDef;
  }

  /**
   * Generate a slide deck from config
   */
  async generate(config: ArtifactConfig): Promise<ArtifactScaffoldResult> {
    const settings = config.settings as SlideDeckSettings;
    const files: ArtifactScaffoldResult["files"] = [];

    if (config.framework === "marp") {
      files.push(...this.generateMarpFiles(config, settings));
    } else if (config.framework === "reveal") {
      files.push(...this.generateRevealFiles(config, settings));
    }

    return {
      config,
      files,
      entryPoints: config.framework === "marp" ? ["slides.md"] : ["index.html"],
      installCommands: this.getInstallCommands(config.framework),
      devCommands: this.getDevCommands(config.framework),
      buildCommands: this.getBuildCommands(config.framework),
      previewCommands: this.getPreviewCommands(config.framework),
      deployCommands: this.getDeployCommands(config.framework),
    };
  }

  /**
   * Generate Marp-based slide deck
   */
  private generateMarpFiles(config: ArtifactConfig, settings: SlideDeckSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    // Main slides file (Marp Markdown)
    const marpContent = this.generateMarpContent(config, settings);
    files.push({
      path: "slides.md",
      content: marpContent,
      purpose: "Main presentation content in Marp Markdown format",
      isTemplate: true,
    });

    // Marp configuration
    files.push({
      path: "marp.config.js",
      content: this.generateMarpConfig(config, settings),
      purpose: "Marp CLI configuration",
      isTemplate: true,
    });

    // Package.json for Marp tooling
    files.push({
      path: "package.json",
      content: JSON.stringify(this.generateMarpPackageJson(config), null, 2),
      purpose: "NPM package configuration with Marp CLI",
      isTemplate: true,
    });

    // VS Code settings for Marp preview
    files.push({
      path: ".vscode/settings.json",
      content: JSON.stringify({
        "marp.enable": true,
        "marp.previewTheme": "default",
        "markdown.preview.breaks": true,
      }, null, 2),
      purpose: "VS Code Marp extension settings",
      isTemplate: true,
    });

    // Theme customization
    if (settings.customCss) {
      files.push({
        path: "theme.css",
        content: settings.customCss,
        purpose: "Custom CSS theme for slides",
        isTemplate: true,
      });
    }

    // README with instructions
    files.push({
      path: "README.md",
      content: this.generateMarpReadme(config, settings),
      purpose: "Project documentation and usage instructions",
      isTemplate: true,
    });

    // Git ignore
    files.push({
      path: ".gitignore",
      content: this.generateGitIgnore(),
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    return files;
  }

  /**
   * Generate Reveal.js-based slide deck
   */
  private generateRevealFiles(config: ArtifactConfig, settings: SlideDeckSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    // Main HTML file
    files.push({
      path: "index.html",
      content: this.generateRevealHtml(config, settings),
      purpose: "Main Reveal.js presentation HTML",
      isTemplate: true,
    });

    // Custom theme CSS
    files.push({
      path: "css/theme/custom.css",
      content: this.generateRevealTheme(config, settings),
      purpose: "Custom Reveal.js theme",
      isTemplate: true,
    });

    // Package.json for Reveal.js
    files.push({
      path: "package.json",
      content: JSON.stringify(this.generateRevealPackageJson(config), null, 2),
      purpose: "NPM package configuration with Reveal.js",
      isTemplate: true,
    });

    // Vite config for dev server
    files.push({
      path: "vite.config.js",
      content: this.generateViteConfig(config),
      purpose: "Vite development server configuration",
      isTemplate: true,
    });

    // README
    files.push({
      path: "README.md",
      content: this.generateRevealReadme(config, settings),
      purpose: "Project documentation and usage instructions",
      isTemplate: true,
    });

    // Git ignore
    files.push({
      path: ".gitignore",
      content: this.generateGitIgnore(),
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    return files;
  }

  /**
   * Generate Marp Markdown content
   */
  private generateMarpContent(config: ArtifactConfig, settings: SlideDeckSettings): string {
    const theme = settings.theme === "default" ? "" : settings.theme;
    const aspectRatio = settings.aspectRatio;
    const transition = settings.transition === "slide" ? "" : settings.transition;
    const autoSlide = settings.autoSlide > 0 ? settings.autoSlide : "";
    const loop = settings.loop ? "true" : "";
    const mouseWheel = settings.mouseWheel ? "true" : "";

    let frontmatter = `---
marp: true
theme: ${theme || "default"}
paginate: true
`;

    if (aspectRatio) frontmatter += `size: ${aspectRatio}\n`;
    if (transition) frontmatter += `transition: ${transition}\n`;
    if (autoSlide) frontmatter += `auto-scaling: true\n`;
    if (autoSlide) frontmatter += `auto-slide: ${autoSlide}\n`;
    if (loop) frontmatter += `loop: ${loop}\n`;
    if (mouseWheel) frontmatter += `mouse-wheel: ${mouseWheel}\n`;
    if (settings.enableChalkboard) frontmatter += `chalkboard: true\n`;
    if (!settings.enableMenu) frontmatter += `header: ""\n`;
    if (!settings.enableOverview) frontmatter += `footer: ""\n`;

    frontmatter += `---
`;

    const slides = [
      this.generateTitleSlide(config, settings),
      this.generateAgendaSlide(config),
      ...this.generateContentSlides(config),
      this.generateClosingSlide(config),
    ];

    return frontmatter + slides.join("\n\n---\n\n");
  }

  private generateTitleSlide(config: ArtifactConfig, settings: SlideDeckSettings): string {
    return `# ${settings.title || config.name}

${settings.author ? `**${settings.author}**` : ""}

${settings.description || config.description}

---

*Generated with Infinity AI*`;
  }

  private generateAgendaSlide(config: ArtifactConfig): string {
    return `## Agenda

1. Introduction
2. Problem Statement
3. Solution Overview
4. Key Features
5. Architecture
6. Demo
7. Next Steps
8. Q&A`;
  }

  private generateContentSlides(config: ArtifactConfig): string[] {
    // This would be enhanced with AI-generated content based on the prompt
    return [
      `## Introduction

- Overview of ${config.name}
- ${config.description}
- Why this matters now`,

      `## Problem Statement

- Current challenges
- Pain points
- Opportunity`,

      `## Solution Overview

- Our approach
- Key differentiators
- Value proposition`,

      `## Key Features

- Feature 1: Description
- Feature 2: Description
- Feature 3: Description`,

      `## Architecture

\`\`\`mermaid
graph TD
    A[Client] --> B[API Gateway]
    B --> C[Service 1]
    B --> D[Service 2]
    C --> E[Database]
    D --> E
\`\`\``,

      `## Demo

- Live demonstration
- Key workflows
- Performance metrics`,

      `## Next Steps

- Immediate actions
- Short-term goals
- Long-term vision`,
    ];
  }

  private generateClosingSlide(config: ArtifactConfig): string {
    return `# Thank You!

## ${config.name}

Questions & Discussion

---

**Contact:** ${config.settings.author || "team@example.com"}
**Repository:** github.com/yourorg/${config.slug || config.name.toLowerCase().replace(/\s+/g, "-")}
**Slides:** [Link to deployed slides]`;
  }

  /**
   * Generate Marp configuration
   */
  private generateMarpConfig(config: ArtifactConfig, settings: SlideDeckSettings): string {
    return `module.exports = {
  // Marp CLI options
  html: true,
  pdf: true,
  pptx: true,
  images: true,
  allowLocalFiles: true,

  // Input/output
  inputDir: ".",
  outputDir: "dist",

  // Theme
  themeSet: "default",

  // Engine
  engine: "marpit",

  // Watch mode
  watch: true,

  // Server
  server: true,
  port: 8080,

  // Custom CSS
  ${settings.customCss ? `css: ["./theme.css"],` : ""}

  // PDF options
  pdfOptions: {
    format: "A4",
    printBackground: true,
    margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
  },

  // PPTX options
  pptxOptions: {
    layout: "LAYOUT_16x9",
  },
};`;
  }

  /**
   * Generate Marp package.json
   */
  private generateMarpPackageJson(config: ArtifactConfig): Record<string, unknown> {
    return {
      name: config.slug || config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: config.description,
      private: true,
      scripts: {
        dev: "marp --watch --server slides.md",
        build: "marp --html --pdf --pptx slides.md -o dist/",
        preview: "marp --html slides.md -o dist/index.html && npx serve dist",
        "preview:pdf": "marp --pdf slides.md -o dist/slides.pdf && npx serve dist",
        "preview:pptx": "marp --pptx slides.md -o dist/slides.pptx",
      },
      devDependencies: {
        "@marp-team/marp-cli": "^4.0.0",
        "serve": "^14.2.0",
      },
      engines: {
        node: ">=18.0.0",
      },
    };
  }

  /**
   * Generate Reveal.js HTML
   */
  private generateRevealHtml(config: ArtifactConfig, settings: SlideDeckSettings): string {
    const theme = settings.theme === "default" ? "white" : settings.theme;
    const transition = settings.transition;
    const autoSlide = settings.autoSlide > 0 ? settings.autoSlide : 0;
    const loop = settings.loop;
    const mouseWheel = settings.mouseWheel;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settings.title || config.name}</title>
    <meta name="description" content="${settings.description || config.description}">
    <meta name="author" content="${settings.author || ""}">

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/dist/reveal.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/dist/theme/${theme}.css">
    <link rel="stylesheet" href="css/theme/custom.css">

    <style>
      .reveal .slides section { text-align: left; }
      .reveal pre code { max-height: 400px; }
    </style>
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        ${this.generateRevealSlides(config, settings).join("")}
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/dist/reveal.js"></script>
    <script>
      Reveal.initialize({
        hash: true,
        transition: "${transition}",
        autoSlide: ${autoSlide},
        loop: ${loop},
        mouseWheel: ${mouseWheel},
        chalkboard: ${settings.enableChalkboard},
        menu: ${settings.enableMenu},
        overview: ${settings.enableOverview},
        plugins: [ RevealMarkdown, RevealHighlight, RevealNotes, RevealMath.KaTeX ],
      });
    </script>

    <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/plugin/markdown/markdown.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/plugin/highlight/highlight.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/plugin/notes/notes.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/plugin/math/math.js"></script>
  </body>
</html>`;
  }

  /**
   * Generate Reveal.js slides
   */
  private generateRevealSlides(config: ArtifactConfig, settings: SlideDeckSettings): string[] {
    const slides = [
      this.generateRevealSlide("title", `
        <h1>${settings.title || config.name}</h1>
        ${settings.author ? `<p><strong>${settings.author}</strong></p>` : ""}
        <p>${settings.description || config.description}</p>
        <p><em>Generated with Infinity AI</em></p>
      `),
      this.generateRevealSlide("agenda", `
        <h2>Agenda</h2>
        <ol>
          <li>Introduction</li>
          <li>Problem Statement</li>
          <li>Solution Overview</li>
          <li>Key Features</li>
          <li>Architecture</li>
          <li>Demo</li>
          <li>Next Steps</li>
          <li>Q&A</li>
        </ol>
      `),
      this.generateRevealSlide("intro", `
        <h2>Introduction</h2>
        <ul>
          <li>Overview of ${config.name}</li>
          <li>${config.description}</li>
          <li>Why this matters now</li>
        </ul>
      `),
      this.generateRevealSlide("problem", `
        <h2>Problem Statement</h2>
        <ul>
          <li>Current challenges</li>
          <li>Pain points</li>
          <li>Opportunity</li>
        </ul>
      `),
      this.generateRevealSlide("solution", `
        <h2>Solution Overview</h2>
        <ul>
          <li>Our approach</li>
          <li>Key differentiators</li>
          <li>Value proposition</li>
        </ul>
      `),
      this.generateRevealSlide("features", `
        <h2>Key Features</h2>
        <ul>
          <li>Feature 1: Description</li>
          <li>Feature 2: Description</li>
          <li>Feature 3: Description</li>
        </ul>
      `),
      this.generateRevealSlide("architecture", `
        <h2>Architecture</h2>
        <pre><code class="language-mermaid">
graph TD
    A[Client] --> B[API Gateway]
    B --> C[Service 1]
    B --> D[Service 2]
    C --> E[Database]
    D --> E
        </code></pre>
      `),
      this.generateRevealSlide("demo", `
        <h2>Demo</h2>
        <ul>
          <li>Live demonstration</li>
          <li>Key workflows</li>
          <li>Performance metrics</li>
        </ul>
      `),
      this.generateRevealSlide("next", `
        <h2>Next Steps</h2>
        <ul>
          <li>Immediate actions</li>
          <li>Short-term goals</li>
          <li>Long-term vision</li>
        </ul>
      `),
      this.generateRevealSlide("closing", `
        <h1>Thank You!</h1>
        <h2>${config.name}</h2>
        <p>Questions & Discussion</p>
        <p><strong>Contact:</strong> ${config.settings.author || "team@example.com"}</p>
        <p><strong>Repository:</strong> github.com/yourorg/${config.slug || config.name.toLowerCase().replace(/\s+/g, "-")}</p>
      `),
    ];

    return slides;
  }

  private generateRevealSlide(type: string, content: string): string {
    return `<section data-markdown data-background-transition="slide">
  <textarea data-template>
${content}
  </textarea>
</section>`;
  }

  /**
   * Generate Reveal.js theme
   */
  private generateRevealTheme(config: ArtifactConfig, settings: SlideDeckSettings): string {
    return `@import "https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/dist/theme/template/mixins.scss";
@import "https://cdn.jsdelivr.net/npm/reveal.js@5.0.0/dist/theme/template/settings.scss";

:root {
  --r-main-color: #1a1a2e;
  --r-main-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --r-heading-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --r-heading-color: #0f172a;
  --r-link-color: #3b82f6;
  --r-selection-background-color: rgba(59, 130, 246, 0.2);
  --r-background-color: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --r-main-color: #f1f5f9;
    --r-heading-color: #f8fafc;
    --r-link-color: #60a5fa;
    --r-background-color: #0f172a;
  }
}

.reveal {
  font-family: var(--r-main-font);
  color: var(--r-main-color);
}

.reveal h1, .reveal h2, .reveal h3, .reveal h4, .reveal h5, .reveal h6 {
  font-family: var(--r-heading-font);
  color: var(--r-heading-color);
}

.reveal a {
  color: var(--r-link-color);
}

.reveal ::selection {
  background-color: var(--r-selection-background-color);
}

/* Custom styles for ${config.name} */
.reveal .slides section {
  padding: 2rem;
}

.reveal pre {
  background: #1e293b;
  border-radius: 8px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.reveal code {
  font-family: "JetBrains Mono", "Fira Code", monospace;
}`;
  }

  /**
   * Generate Reveal.js package.json
   */
  private generateRevealPackageJson(config: ArtifactConfig): Record<string, unknown> {
    return {
      name: config.slug || config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: config.description,
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
        deploy: "vite build && npx serve dist",
      },
      devDependencies: {
        "reveal.js": "^5.0.0",
        "vite": "^5.0.0",
        "serve": "^14.2.0",
      },
      engines: {
        node: ">=18.0.0",
      },
    };
  }

  /**
   * Generate Vite config for Reveal.js
   */
  private generateViteConfig(config: ArtifactConfig): string {
    return `import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
  server: {
    port: 8080,
    open: true,
    host: true,
  },
  preview: {
    port: 8080,
    open: true,
  },
});`;
  }

  /**
   * Generate Marp README
   */
  private generateMarpReadme(config: ArtifactConfig, settings: SlideDeckSettings): string {
    return `# ${config.name}

${config.description}

## 🚀 Quick Start

### Development (Live Preview)
\`\`\`bash
npm install
npm run dev
\`\`\`
Opens http://localhost:8080 with live reload.

### Build All Formats
\`\`\`bash
npm run build
\`\`\`
Generates:
- \`dist/slides.html\` — HTML presentation
- \`dist/slides.pdf\` — PDF export
- \`dist/slides.pptx\` — PowerPoint export

### Preview Builds
\`\`\`bash
npm run preview        # HTML preview
npm run preview:pdf    # PDF preview
npm run preview:pptx   # PPTX preview
\`\`\`

## 📝 Writing Slides

Edit \`slides.md\` using Marp Markdown syntax:

- \`---\` — New slide
- \`<!-- _class: lead -->\` — Title slide styling
- \`<!-- _paginate: false -->\` — Hide page numbers
- \`![bg](image.png)\` — Background image
- \`\`\`mermaid\` — Mermaid diagrams

See [Marp Documentation](https://marp.app/) for full syntax.

## 🎨 Customization

- **Theme:** Edit \`marp.config.js\` or create \`theme.css\`
- **Settings:** Modify frontmatter in \`slides.md\`
- **Aspect Ratio:** Change \`size: 16:9\` in frontmatter (or 4:3, 3:2, 1:1)

## 🚀 Deployment

### GitHub Pages
1. Push to GitHub
2. Enable GitHub Pages in repository settings
3. Select \`dist\` folder as source

### Vercel
\`\`\`bash
npx vercel --prod dist
\`\`\`

### Netlify
\`\`\`bash
npx netlify deploy --prod --dir=dist
\`\`\`

## 📦 Project Structure

\`\`\`
.
├── slides.md           # Main presentation (edit this)
├── marp.config.js      # Marp CLI configuration
├── theme.css           # Custom theme (optional)
├── package.json        # NPM scripts & dependencies
├── .vscode/settings.json # VS Code Marp settings
└── dist/               # Build output (generated)
\`\`\`

## 🔧 Requirements

- Node.js 18+
- VS Code with [Marp Extension](https://marketplace.visualstudio.com/items?itemName=marp-team.marp-vscode) for best editing experience

---

*Generated by Infinity AI — Multi-Artifact Support (Phase 12)*`;
  }

  /**
   * Generate Reveal.js README
   */
  private generateRevealReadme(config: ArtifactConfig, settings: SlideDeckSettings): string {
    return `# ${config.name}

${config.description}

## 🚀 Quick Start

### Development
\`\`\`bash
npm install
npm run dev
\`\`\`
Opens http://localhost:8080 with live reload.

### Build for Production
\`\`\`bash
npm run build
\`\`\`
Outputs to \`dist/\` folder.

### Preview Production Build
\`\`\`bash
npm run preview
\`\`\`

## 📝 Writing Slides

Edit \`index.html\` and modify the \`<section>\` elements inside \`.slides\`.

Each slide is a \`<section data-markdown>\` with a \`<textarea data-template>\` containing Markdown content.

### Slide Attributes
- \`data-background="#color"\` — Solid background
- \`data-background-image="url"\` — Image background
- \`data-transition="slide|fade|convex|concave|zoom|none"\` — Per-slide transition
- \`data-auto-animate\` — Enable auto-animate between slides

See [Reveal.js Documentation](https://revealjs.com/) for full features.

## 🎨 Customization

- **Theme:** Edit \`css/theme/custom.css\`
- **Settings:** Modify \`Reveal.initialize()\` in \`index.html\`
- **Plugins:** Add/remove plugins in the initialization

## 🚀 Deployment

### Vercel (Recommended)
\`\`\`bash
npm run build
npx vercel --prod dist
\`\`\`

### Netlify
\`\`\`bash
npm run build
npx netlify deploy --prod --dir=dist
\`\`\`

### GitHub Pages
1. Build: \`npm run build\`
2. Push \`dist/\` contents to \`gh-pages\` branch
3. Enable GitHub Pages in settings

### Self-hosted
Serve the \`dist/\` folder with any static file server.

## 📦 Project Structure

\`\`\`
.
├── index.html          # Main presentation (edit this)
├── css/theme/custom.css # Custom theme
├── vite.config.js      # Vite configuration
├── package.json        # NPM scripts & dependencies
└── dist/               # Build output (generated)
\`\`\`

## 🔧 Requirements

- Node.js 18+

---

*Generated by Infinity AI — Multi-Artifact Support (Phase 12)*`;
  }

  /**
   * Generate .gitignore
   */
  private generateGitIgnore(): string {
    return `# Dependencies
node_modules/

# Build output
dist/
build/
*.pdf
*.pptx

# IDE
.vscode/*
!.vscode/settings.json
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env
.env.local
.env.*.local

# Cache
.cache/
.eslintcache
`;
  }

  /**
   * Get install commands for framework
   */
  private getInstallCommands(framework: string): string[] {
    return ["npm install"];
  }

  /**
   * Get dev commands for framework
   */
  private getDevCommands(framework: string): string[] {
    if (framework === "marp") {
      return ["npm run dev"];
    }
    return ["npm run dev"];
  }

  /**
   * Get build commands for framework
   */
  private getBuildCommands(framework: string): string[] {
    if (framework === "marp") {
      return ["npm run build"];
    }
    return ["npm run build"];
  }

  /**
   * Get preview commands for framework
   */
  private getPreviewCommands(framework: string): string[] {
    if (framework === "marp") {
      return ["npm run preview", "npm run preview:pdf", "npm run preview:pptx"];
    }
    return ["npm run preview"];
  }

  /**
   * Get deploy commands for framework
   */
  private getDeployCommands(framework: string): Record<string, string> {
    return {
      vercel: "npx vercel --prod dist",
      netlify: "npx netlify deploy --prod --dir=dist",
      "github-pages": "git subtree push --prefix dist origin gh-pages",
      "self-hosted": "serve dist -p 3000",
    };
  }

  /**
   * Build the artifact
   */
  async build(artifactId: string, projectDir: string): Promise<ArtifactBuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Building slide deck: ${artifactId}`);

      // Run build command
      const { execSync } = await import("node:child_process");
      const output = execSync("npm run build", {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 120000,
      });
      logs.push(output);

      // Collect assets
      const assets = await this.collectAssets(projectDir, "dist");

      return {
        artifactId,
        success: true,
        outputDir: path.join(projectDir, "dist"),
        assets,
        logs,
        errors: [],
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(errorMsg);
      logs.push(`Build failed: ${errorMsg}`);

      return {
        artifactId,
        success: false,
        outputDir: "",
        assets: [],
        logs,
        errors,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Deploy the artifact
   */
  async deploy(artifactId: string, projectDir: string, target: string): Promise<ArtifactDeployResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Deploying slide deck to ${target}: ${artifactId}`);

      const deployCmd = this.getDeployCommands(this.typeDef.defaultFramework)[target];
      if (!deployCmd) {
        throw new Error(`Unknown deploy target: ${target}`);
      }

      const { execSync } = await import("node:child_process");
      const output = execSync(deployCmd, {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 180000,
      });
      logs.push(output);

      // Extract URL from output (simplified)
      const url = this.extractDeployUrl(output, target);

      return {
        artifactId,
        target: target as any,
        success: true,
        url,
        logs,
        errors: [],
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(errorMsg);
      logs.push(`Deploy failed: ${errorMsg}`);

      return {
        artifactId,
        target: target as any,
        success: false,
        logs,
        errors,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Preview the artifact
   */
  async preview(artifactId: string, projectDir: string): Promise<ArtifactPreviewInfo> {
    // For slide decks, preview is just the local dev server
    return {
      artifactId,
      type: "local",
      url: "http://localhost:8080",
    };
  }

  /**
   * Collect built assets
   */
  private async collectAssets(projectDir: string, outputDir: string): Promise<string[]> {
    const fullPath = path.join(projectDir, outputDir);
    const assets: string[] = [];

    try {
      const entries = await fs.readdir(fullPath, { recursive: true });
      for (const entry of entries) {
        if (typeof entry === "string") {
          assets.push(path.join(outputDir, entry));
        }
      }
    } catch {
      // Directory might not exist
    }

    return assets;
  }

  /**
   * Extract deploy URL from output
   */
  private extractDeployUrl(output: string, target: string): string | undefined {
    // Simplified URL extraction
    const urlMatch = output.match(/https?:\/\/[^\s]+/);
    return urlMatch ? urlMatch[0] : undefined;
  }
}

/**
 * Factory function to create slide deck generator
 */
export function createSlideDeckGenerator(typeDef: ArtifactTypeDefinition): SlideDeckGenerator {
  return new SlideDeckGenerator(typeDef);
}