/**
 * PHASE 12 — WEBSITE GENERATOR (Astro / Next / Vite)
 *
 * Generates modern websites from natural language prompts.
 * $0 budget: pure code generation.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactConfig,
  ArtifactScaffoldResult,
  ArtifactBuildResult,
  ArtifactDeployResult,
  ArtifactPreviewInfo,
  ArtifactTypeDefinition,
  WebsiteSettings,
} from "../artifact-types";

export class WebsiteGenerator {
  private typeDef: ArtifactTypeDefinition;

  constructor(typeDef: ArtifactTypeDefinition) {
    this.typeDef = typeDef;
  }

  async generate(config: ArtifactConfig): Promise<ArtifactScaffoldResult> {
    const settings = config.settings as WebsiteSettings;
    const files: ArtifactScaffoldResult["files"] = [];

    if (config.framework === "astro") {
      files.push(...this.generateAstroFiles(config, settings));
    } else if (config.framework === "next") {
      files.push(...this.generateNextFiles(config, settings));
    }

    return {
      config,
      files,
      entryPoints: config.framework === "astro" ? ["src/pages/index.astro"] : ["app/page.tsx"],
      installCommands: this.getInstallCommands(config.framework),
      devCommands: this.getDevCommands(config.framework),
      buildCommands: this.getBuildCommands(config.framework),
      previewCommands: this.getPreviewCommands(config.framework),
      deployCommands: this.getDeployCommands(config.framework),
    };
  }

  private generateAstroFiles(config: ArtifactConfig, settings: WebsiteSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    files.push({
      path: "package.json",
      content: JSON.stringify(this.generateAstroPackageJson(config, settings), null, 2),
      purpose: "NPM package configuration for Astro",
      isTemplate: true,
    });

    files.push({
      path: "astro.config.mjs",
      content: this.generateAstroConfig(config, settings),
      purpose: "Astro configuration",
      isTemplate: true,
    });

    files.push({
      path: "tailwind.config.mjs",
      content: this.generateTailwindConfig(),
      purpose: "Tailwind CSS configuration",
      isTemplate: true,
    });

    files.push({
      path: "src/layouts/Layout.astro",
      content: this.generateAstroLayout(config, settings),
      purpose: "Main page layout",
      isTemplate: true,
    });

    files.push({
      path: "src/pages/index.astro",
      content: this.generateAstroIndex(config, settings),
      purpose: "Main homepage",
      isTemplate: true,
    });

    files.push({
      path: "src/styles/global.css",
      content: this.generateGlobalCss(),
      purpose: "Global styles",
      isTemplate: true,
    });

    files.push({
      path: "tsconfig.json",
      content: JSON.stringify({
        extends: "astro/tsconfigs/strict",
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      }, null, 2),
      purpose: "TypeScript configuration",
      isTemplate: true,
    });

    files.push({
      path: "README.md",
      content: this.generateReadme(config, settings),
      purpose: "Project documentation",
      isTemplate: true,
    });

    files.push({
      path: ".gitignore",
      content: "node_modules/\ndist/\n.astro/\n*.log\n.env\n",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    return files;
  }

  private generateNextFiles(config: ArtifactConfig, settings: WebsiteSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    files.push({
      path: "package.json",
      content: JSON.stringify(this.generateNextPackageJson(config, settings), null, 2),
      purpose: "NPM package configuration for Next.js",
      isTemplate: true,
    });

    files.push({
      path: "next.config.js",
      content: this.generateNextConfig(settings),
      purpose: "Next.js configuration",
      isTemplate: true,
    });

    files.push({
      path: "tailwind.config.ts",
      content: this.generateTailwindConfigTs(),
      purpose: "Tailwind CSS configuration",
      isTemplate: true,
    });

    files.push({
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          target: "es5",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      }, null, 2),
      purpose: "TypeScript configuration",
      isTemplate: true,
    });

    files.push({
      path: "src/app/layout.tsx",
      content: this.generateNextLayout(config, settings),
      purpose: "Root layout",
      isTemplate: true,
    });

    files.push({
      path: "src/app/page.tsx",
      content: this.generateNextPage(config, settings),
      purpose: "Main homepage",
      isTemplate: true,
    });

    files.push({
      path: "src/app/globals.css",
      content: this.generateGlobalCss(),
      purpose: "Global styles",
      isTemplate: true,
    });

    files.push({
      path: "postcss.config.mjs",
      content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`,
      purpose: "PostCSS configuration",
      isTemplate: true,
    });

    files.push({
      path: "README.md",
      content: this.generateReadme(config, settings),
      purpose: "Project documentation",
      isTemplate: true,
    });

    files.push({
      path: ".gitignore",
      content: "node_modules/\n.next/\nout/\n*.log\n.env\n.env.local\n",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    return files;
  }

  private generateAstroPackageJson(config: ArtifactConfig, settings: WebsiteSettings): Record<string, unknown> {
    return {
      name: config.slug || config.name.toLowerCase().replace(/\s+/g, "-"),
      type: "module",
      version: "1.0.0",
      description: config.description,
      scripts: {
        dev: "astro dev",
        build: "astro build",
        preview: "astro preview",
        deploy: "astro build",
      },
      dependencies: {
        "astro": "^4.0.0",
        "@astrojs/tailwind": "^5.0.0",
        "tailwindcss": "^3.4.0",
      },
    };
  }

  private generateAstroConfig(config: ArtifactConfig, settings: WebsiteSettings): string {
    return `import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: '${settings.customDomain || "https://example.com"}',
  integrations: [tailwind()],
  ${settings.ssr ? `output: 'server',` : `output: 'static',`}
  ${settings.sitemap ? `sitemap: true,` : ""}
});`;
  }

  private generateTailwindConfig(): string {
    return `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx,vue}'],
  theme: {
    extend: {},
  },
  plugins: [],
};`;
  }

  private generateAstroLayout(config: ArtifactConfig, settings: WebsiteSettings): string {
    const title = config.name;
    const description = config.description;
    const fonts = settings.i18n ? "" : "";

    return `---
interface Props {
  title: string;
  description?: string;
}

const { title, description = "${description}" } = Astro.props;
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <meta name="generator" content={Astro.generator} />
    ${settings.seo ? `<meta property="og:title" content={title} />` : ""}
    ${settings.seo ? `<meta property="og:description" content={description} />` : ""}
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>

<style is:global>
  :root {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
</style>`;
  }

  private generateAstroIndex(config: ArtifactConfig, settings: WebsiteSettings): string {
    return `---
import Layout from '../layouts/Layout.astro';
---

<Layout title="${config.name}">
  <main class="min-h-screen flex items-center justify-center">
    <div class="text-center space-y-4">
      <h1 class="text-5xl font-bold">${config.name}</h1>
      <p class="text-xl text-gray-600">${config.description}</p>
      <button class="bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary-dark transition-colors">
        Get Started
      </button>
    </div>
  </main>
</Layout>`;
  }

  private generateGlobalCss(): string {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --primary: #6366F1;
  --primary-dark: #4F46E5;
}

@layer base {
  body {
    @apply antialiased;
  }
}`;
  }

  private generateNextPackageJson(config: ArtifactConfig, settings: WebsiteSettings): Record<string, unknown> {
    return {
      name: config.slug || config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: config.description,
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "next lint",
      },
      dependencies: {
        "next": "^14.0.0",
        "react": "^18.0.0",
        "react-dom": "^18.0.0",
        "tailwindcss": "^3.4.0",
        "postcss": "^8.0.0",
        "autoprefixer": "^10.0.0",
      },
    };
  }

  private generateNextConfig(settings: WebsiteSettings): string {
    return `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ${settings.i18n ? `i18n: { locales: ['en', 'nl'], defaultLocale: 'en' },` : ""}
};

module.exports = nextConfig;`;
  }

  private generateTailwindConfigTs(): string {
    return `import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;`;
  }

  private generateNextLayout(config: ArtifactConfig, settings: WebsiteSettings): string {
    return `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '${config.name}',
  description: '${config.description}',
  ${settings.seo ? `openGraph: { title: '${config.name}', description: '${config.description}' },` : ""}
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`;
  }

  private generateNextPage(config: ArtifactConfig, settings: WebsiteSettings): string {
    return `export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold">${config.name}</h1>
        <p className="text-xl text-gray-600">${config.description}</p>
        <button className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors">
          Get Started
        </button>
      </div>
    </main>
  );
}`;
  }

  private generateReadme(config: ArtifactConfig, settings: WebsiteSettings): string {
    const framework = config.framework;
    return `# ${config.name}

${config.description}

## 🚀 Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:3000

## 📦 Build

\`\`\`bash
npm run build
\`\`\`

## 🚀 Deploy

${settings.customDomain ? `**Custom Domain:** ${settings.customDomain}` : ""}

- Vercel: \`npx vercel --prod\`
- Netlify: \`npx netlify deploy --prod --dir=dist\`
- GitHub Pages: Enable in repository settings

---

*Generated by Infinity AI — Multi-Artifact Support (Phase 12)*`;
  }

  private getInstallCommands(framework: string): string[] {
    return ["npm install"];
  }

  private getDevCommands(framework: string): string[] {
    return ["npm run dev"];
  }

  private getBuildCommands(framework: string): string[] {
    return ["npm run build"];
  }

  private getPreviewCommands(framework: string): string[] {
    return ["npm run preview"];
  }

  private getDeployCommands(framework: string): Record<string, string> {
    return {
      vercel: "npx vercel --prod",
      netlify: "npx netlify deploy --prod --dir=dist",
      "github-pages": "npx gh-pages -d dist",
      "self-hosted": "npx serve dist",
    };
  }

  async build(artifactId: string, projectDir: string): Promise<ArtifactBuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Building website: ${artifactId}`);
      const { execSync } = await import("node:child_process");
      const output = execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 120000 });
      logs.push(output);

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

  async deploy(artifactId: string, projectDir: string, target: string): Promise<ArtifactDeployResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Deploying website to ${target}: ${artifactId}`);
      const deployCmd = this.getDeployCommands(this.typeDef.defaultFramework)[target];
      if (!deployCmd) throw new Error(`Unknown deploy target: ${target}`);

      const { execSync } = await import("node:child_process");
      const output = execSync(deployCmd, { cwd: projectDir, encoding: "utf-8", timeout: 180000 });
      logs.push(output);

      return {
        artifactId,
        target: target as any,
        success: true,
        url: this.extractDeployUrl(output, target),
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

  async preview(artifactId: string, projectDir: string): Promise<ArtifactPreviewInfo> {
    return {
      artifactId,
      type: "local",
      url: "http://localhost:3000",
    };
  }

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

  private extractDeployUrl(output: string, target: string): string | undefined {
    const urlMatch = output.match(/https?:\/\/[^\s]+/);
    return urlMatch ? urlMatch[0] : undefined;
  }
}

export function createWebsiteGenerator(typeDef: ArtifactTypeDefinition): WebsiteGenerator {
  return new WebsiteGenerator(typeDef);
}
