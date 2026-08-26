/**
 * PHASE 12 — WEB APP GENERATOR (Next.js / Vite)
 *
 * Generates full-stack web applications from natural language prompts.
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
  WebAppSettings,
} from "../artifact-types";

export class WebAppGenerator {
  private typeDef: ArtifactTypeDefinition;
  private config: ArtifactConfig | null = null;

  constructor(typeDef: ArtifactTypeDefinition) {
    this.typeDef = typeDef;
  }

  async generate(config: ArtifactConfig): Promise<ArtifactScaffoldResult> {
    this.config = config;
    const settings = config.settings as WebAppSettings;
    const files: ArtifactScaffoldResult["files"] = [];

    if (config.framework === "next") {
      files.push(...this.generateNextFiles(config, settings));
    } else if (config.framework === "vite") {
      files.push(...this.generateViteFiles(config, settings));
    }

    return {
      config,
      files,
      entryPoints: config.framework === "next" ? ["src/app/page.tsx"] : ["src/main.tsx"],
      installCommands: this.getInstallCommands(config.framework),
      devCommands: this.getDevCommands(config.framework),
      buildCommands: this.getBuildCommands(config.framework),
      previewCommands: this.getPreviewCommands(config.framework),
      deployCommands: this.getDeployCommands(config.framework),
    };
  }

  private generateNextFiles(config: ArtifactConfig, settings: WebAppSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    // Package.json
    files.push({
      path: "package.json",
      content: JSON.stringify(this.generateNextPackageJson(config, settings), null, 2),
      purpose: "NPM package configuration for Next.js",
      isTemplate: true,
    });

    // Next.js config
    files.push({
      path: "next.config.js",
      content: this.generateNextConfig(settings),
      purpose: "Next.js configuration",
      isTemplate: true,
    });

    // Tailwind config
    files.push({
      path: "tailwind.config.ts",
      content: this.generateTailwindConfig(),
      purpose: "Tailwind CSS configuration",
      isTemplate: true,
    });

    // TypeScript config
    files.push({
      path: "tsconfig.json",
      content: JSON.stringify(this.generateTsConfig(), null, 2),
      purpose: "TypeScript configuration",
      isTemplate: true,
    });

    // PostCSS config
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

    // Root layout
    files.push({
      path: "src/app/layout.tsx",
      content: this.generateNextLayout(config, settings),
      purpose: "Root layout with providers",
      isTemplate: true,
    });

    // Main page
    files.push({
      path: "src/app/page.tsx",
      content: this.generateNextPage(config, settings),
      purpose: "Main application page",
      isTemplate: true,
    });

    // Global styles
    files.push({
      path: "src/app/globals.css",
      content: this.generateGlobalCss(),
      purpose: "Global styles",
      isTemplate: true,
    });

    // Auth provider (if enabled)
    if (settings.auth !== "none") {
      files.push({
        path: "src/lib/auth.ts",
        content: this.generateAuthConfig(settings),
        purpose: "Authentication configuration",
        isTemplate: true,
      });
    }

    // Database setup (if enabled)
    if (settings.database !== "none") {
      files.push({
        path: "src/lib/db.ts",
        content: this.generateDatabaseConfig(settings),
        purpose: "Database configuration",
        isTemplate: true,
      });
    }

    // API routes
    files.push({
      path: "src/app/api/health/route.ts",
      content: this.generateHealthRoute(),
      purpose: "Health check endpoint",
      isTemplate: true,
    });

    // Components
    files.push({
      path: "src/components/Providers.tsx",
      content: this.generateProviders(settings),
      purpose: "Client-side providers",
      isTemplate: true,
    });

    files.push({
      path: "src/components/Layout.tsx",
      content: this.generateLayoutComponent(config),
      purpose: "Main layout component",
      isTemplate: true,
    });

    // README
    files.push({
      path: "README.md",
      content: this.generateReadme(config, settings),
      purpose: "Project documentation",
      isTemplate: true,
    });

    // Git ignore
    files.push({
      path: ".gitignore",
      content: "node_modules/\n.next/\nout/\n*.log\n.env\n.env.local\n.env.*.local\n*.tsbuildinfo\n",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    return files;
  }

  private generateViteFiles(config: ArtifactConfig, settings: WebAppSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    files.push({
      path: "package.json",
      content: JSON.stringify(this.generateVitePackageJson(config, settings), null, 2),
      purpose: "NPM package configuration for Vite + React",
      isTemplate: true,
    });

    files.push({
      path: "vite.config.ts",
      content: this.generateViteConfig(),
      purpose: "Vite configuration",
      isTemplate: true,
    });

    files.push({
      path: "tailwind.config.js",
      content: this.generateTailwindConfig(),
      purpose: "Tailwind CSS configuration",
      isTemplate: true,
    });

    files.push({
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          useDefineForClassFields: true,
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          module: "ESNext",
          skipLibCheck: true,
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: "react-jsx",
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
        include: ["src"],
        references: [{ path: "./tsconfig.node.json" }],
      }, null, 2),
      purpose: "TypeScript configuration",
      isTemplate: true,
    });

    files.push({
      path: "tsconfig.node.json",
      content: JSON.stringify({
        compilerOptions: {
          composite: true,
          skipLibCheck: true,
          module: "ESNext",
          moduleResolution: "bundler",
          allowSyntheticDefaultImports: true,
        },
        include: ["vite.config.ts"],
      }, null, 2),
      purpose: "TypeScript config for Node",
      isTemplate: true,
    });

    files.push({
      path: "index.html",
      content: this.generateViteIndex(config),
      purpose: "Main HTML entry",
      isTemplate: true,
    });

    files.push({
      path: "src/main.tsx",
      content: this.generateViteMain(config, settings),
      purpose: "React entry point",
      isTemplate: true,
    });

    files.push({
      path: "src/App.tsx",
      content: this.generateViteApp(config, settings),
      purpose: "Main App component",
      isTemplate: true,
    });

    files.push({
      path: "src/index.css",
      content: this.generateGlobalCss(),
      purpose: "Global styles",
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
      content: "node_modules/\ndist/\n*.log\n.env\n.env.local\n",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    return files;
  }

  private generateNextPackageJson(config: ArtifactConfig, settings: WebAppSettings): Record<string, unknown> {
    const deps: Record<string, string> = {
      "next": "^14.0.0",
      "react": "^18.0.0",
      "react-dom": "^18.0.0",
      "tailwindcss": "^3.4.0",
      "postcss": "^8.0.0",
      "autoprefixer": "^10.0.0",
    };

    if (settings.auth === "nextauth") {
      deps["next-auth"] = "^4.24.0";
    } else if (settings.auth === "clerk") {
      deps["@clerk/nextjs"] = "^5.0.0";
    } else if (settings.auth === "supabase") {
      deps["@supabase/supabase-js"] = "^2.39.0";
      deps["@supabase/auth-helpers-nextjs"] = "^0.8.0";
    }

    if (settings.database === "prisma") {
      deps["@prisma/client"] = "^5.0.0";
    } else if (settings.database === "drizzle") {
      deps["drizzle-orm"] = "^0.29.0";
    } else if (settings.database === "supabase") {
      deps["@supabase/supabase-js"] = "^2.39.0";
    }

    if (settings.stateManagement === "zustand") {
      deps["zustand"] = "^4.4.0";
    } else if (settings.stateManagement === "redux") {
      deps["@reduxjs/toolkit"] = "^2.0.0";
      deps["react-redux"] = "^9.0.0";
    } else if (settings.stateManagement === "jotai") {
      deps["jotai"] = "^2.6.0";
    }

    if (settings.apiLayer === "trpc") {
      deps["@trpc/server"] = "^10.45.0";
      deps["@trpc/client"] = "^10.45.0";
      deps["@trpc/react-query"] = "^10.45.0";
      deps["@trpc/next"] = "^10.45.0";
      deps["@tanstack/react-query"] = "^5.0.0";
    }

    if (settings.pwa) {
      deps["next-pwa"] = "^5.6.0";
    }

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
        db: "prisma studio",
        "db:push": "prisma db push",
        "db:migrate": "prisma migrate dev",
      },
      dependencies: deps,
      devDependencies: {
        "typescript": "^5.0.0",
        "@types/node": "^20.0.0",
        "@types/react": "^18.0.0",
        "@types/react-dom": "^18.0.0",
        "eslint": "^8.0.0",
        "eslint-config-next": "^14.0.0",
      },
    };
  }

  private generateNextConfig(settings: WebAppSettings): string {
    const pwaConfig = settings.pwa ? `
  const withPWA = require('next-pwa')({
    dest: 'public',
    register: true,
    skipWaiting: true,
  });
  module.exports = withPWA(nextConfig);` : `module.exports = nextConfig;`;

    return `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: true,
  },
  ${settings.auth === "nextauth" ? `images: { domains: ['lh3.googleusercontent.com', 'avatars.githubusercontent.com'] },` : ""}
};

${pwaConfig}`;
  }

  private generateTailwindConfig(): string {
    return `/** @type {import('tailwindcss').Config} */
import type { Config } from 'tailwindcss';

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

  private generateTsConfig(): Record<string, unknown> {
    return {
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
    };
  }

  private generateNextLayout(config: ArtifactConfig, settings: WebAppSettings): string {
    return `import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: '${config.name}',
  description: '${config.description}',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>${settings.auth !== "none" ? "{children}" : "{children}"}</Providers>
      </body>
    </html>
  );
}`;
  }

  private generateNextPage(config: ArtifactConfig, settings: WebAppSettings): string {
    return `import { Layout } from '@/components/Layout';

export default function Home() {
  return (
    <Layout>
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center space-y-8">
            <h1 className="text-5xl font-bold text-gray-900">${config.name}</h1>
            <p className="text-xl text-gray-600">${config.description}</p>
            <div className="flex justify-center gap-4">
              <a
                href="/dashboard"
                className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Go to Dashboard
              </a>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}`;
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
}

@layer utilities {
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
}`;
  }

  private generateAuthConfig(settings: WebAppSettings): string {
    if (settings.auth === "nextauth") {
      return `import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // Implement your credential verification
        return null;
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/auth/signin',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};`;
    }
    return `// Auth configuration for ${settings.auth}\n// See provider documentation for setup`;
  }

  private generateDatabaseConfig(settings: WebAppSettings): string {
    if (settings.database === "prisma") {
      return `import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;`;
    }
    if (settings.database === "drizzle") {
      return `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;`;
    }
    return `// Database configuration for ${settings.database}`;
  }

  private generateHealthRoute(): string {
    return `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}`;
  }

  private generateProviders(settings: WebAppSettings): string {
    const providers: string[] = ['{children}'];

    if (settings.auth === "nextauth") {
      providers.unshift('<SessionProvider session={session}>');
      providers.push('</SessionProvider>');
    }
    if (settings.stateManagement === "redux") {
      providers.unshift('<Provider store={store}>');
      providers.push('</Provider>');
    }

    return `'use client';

import { SessionProvider } from 'next-auth/react';
${settings.stateManagement === "redux" ? `import { Provider } from 'react-redux';
import { store } from '@/lib/store';` : ""}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    ${providers.join(" ")}
  );
}`;
  }

  private generateLayoutComponent(config: ArtifactConfig): string {
    return `import { ReactNode } from 'react';
import Link from 'next/link';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="text-xl font-bold text-indigo-600">
              ${config.name}
            </Link>
            <nav className="flex gap-6">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}`;
  }

  private generateVitePackageJson(config: ArtifactConfig, settings: WebAppSettings): Record<string, unknown> {
    return {
      name: config.slug || config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: config.description,
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        preview: "vite preview",
      },
      dependencies: {
        "react": "^18.0.0",
        "react-dom": "^18.0.0",
        "tailwindcss": "^3.4.0",
        "postcss": "^8.0.0",
        "autoprefixer": "^10.0.0",
      },
      devDependencies: {
        "@types/react": "^18.0.0",
        "@types/react-dom": "^18.0.0",
        "@vitejs/plugin-react": "^4.0.0",
        "typescript": "^5.0.0",
        "vite": "^5.0.0",
      },
    };
  }

  private generateViteConfig(): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});`;
  }

  private generateViteIndex(config: ArtifactConfig): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${config.description}" />
    <title>${config.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
  }

  private generateViteMain(config: ArtifactConfig, settings: WebAppSettings): string {
    return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;
  }

  private generateViteApp(config: ArtifactConfig, settings: WebAppSettings): string {
    return `import { Layout } from './components/Layout';

function App() {
  return (
    <Layout>
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center space-y-8">
            <h1 className="text-5xl font-bold text-gray-900">${config.name}</h1>
            <p className="text-xl text-gray-600">${config.description}</p>
            <div className="flex justify-center gap-4">
              <button className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors">
                Get Started
              </button>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}

export default App;`;
  }

  private generateReadme(config: ArtifactConfig, settings: WebAppSettings): string {
    const features: string[] = [];
    if (settings.auth !== "none") features.push(`Auth: ${settings.auth}`);
    if (settings.database !== "none") features.push(`Database: ${settings.database}`);
    if (settings.stateManagement !== "none") features.push(`State: ${settings.stateManagement}`);
    if (settings.apiLayer !== "route-handlers") features.push(`API: ${settings.apiLayer}`);
    if (settings.pwa) features.push("PWA enabled");

    return `# ${config.name}

${config.description}

## 🚀 Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:3000

## ✨ Features

${features.map(f => `- ${f}`).join("\n") || "- Modern React app with Tailwind CSS"}

## 📦 Build

\`\`\`bash
npm run build
\`\`\`

## 🚀 Deploy

- Vercel: \`npx vercel --prod\`
- Netlify: \`npx netlify deploy --prod --dir=.next\`
- Docker: Build and deploy container

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
      netlify: "npx netlify deploy --prod --dir=.next",
      docker: "docker build -t app . && docker run -p 3000:3000 app",
      "self-hosted": "npm run build && npm start",
    };
  }

  async build(artifactId: string, projectDir: string): Promise<ArtifactBuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Building web app: ${artifactId}`);
      const { execSync } = await import("node:child_process");
      const output = execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 180000 });
      logs.push(output);

      const framework = this.config?.framework || "next";
      const assets = await this.collectAssets(projectDir, framework === "next" ? ".next" : "dist");

      return {
        artifactId,
        success: true,
        outputDir: path.join(projectDir, framework === "next" ? ".next" : "dist"),
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
      logs.push(`Deploying web app to ${target}: ${artifactId}`);
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

export function createWebAppGenerator(typeDef: ArtifactTypeDefinition): WebAppGenerator {
  return new WebAppGenerator(typeDef);
}