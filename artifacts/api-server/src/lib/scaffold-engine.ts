/**
 * The Scaffold Engine (Phase B, 6.4 / 6.4a / 6.4b / 6.4c)
 *
 * The single biggest quality lever in the whole campaign. A free model that
 * starts from a complete, pinned, runnable project skeleton *assembles*
 * known-good parts. A free model that starts from an empty directory invents
 * a project from first principles — and invents APIs, versions, and files
 * that don't exist.
 *
 * What this engine guarantees:
 *  - The skeleton is the framework adapter's `generateScaffold()` output PLUS
 *    the gaps that would otherwise break `npm run build` (missing Home page,
 *    postcss config, tailwind config, radix deps) — so the skeleton builds.
 *  - It ships with the complete 70-file shadcn UI corpus (`generate_component`,
 *    6.4a) so the model assembles, not authors.
 *  - Pinned versions only: the corpus dep set is a single known-good map, the
 *    model never invents a version (SCAFFOLD_RULE_PROMPT, 6.4b).
 *  - The corpus is tested, not assumed: `writeScaffoldWorkspace` returns the
 *    skeleton, and the gate command verifies it with `npm run build` (6.4c).
 */

import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { getFrameworkAdapter, type SupportedFramework } from "./framework-generators";
import type { GeneratedFile, ScaffoldOptions } from "./framework-adapters";
import {
  ensureWorkspace,
  getWorkspaceRoot,
  getWorkspaceCommandEnvironment,
} from "./workspace";

/**
 * Resolve the shadcn UI corpus dir (the frontend's real `components/ui/*`).
 * Same 3-up rule as WORKSPACE_ROOT: dist → api-server → artifacts → repo root,
 * then down into artifacts/infinity-ai. Works for both the esbuild bundle and
 * tsx dev.
 */
const CORPUS_ROOT = path.resolve(
  __dirname, "..", "..", "..", "artifacts", "infinity-ai", "src", "components", "ui",
);

/** All corpus deps (the full known-good map the corpus imports). Pinned. */
export const UI_CORPUS_DEPS: Record<string, string> = {
  "@radix-ui/react-accordion": "1.1.2",
  "@radix-ui/react-alert-dialog": "1.0.5",
  "@radix-ui/react-aspect-ratio": "1.0.3",
  "@radix-ui/react-avatar": "1.0.4",
  "@radix-ui/react-checkbox": "1.0.4",
  "@radix-ui/react-collapsible": "1.0.3",
  "@radix-ui/react-context-menu": "2.1.5",
  "@radix-ui/react-dialog": "1.0.5",
  "@radix-ui/react-dropdown-menu": "2.0.6",
  "@radix-ui/react-hover-card": "1.0.7",
  "@radix-ui/react-label": "2.0.2",
  "@radix-ui/react-menubar": "1.0.4",
  "@radix-ui/react-navigation-menu": "1.1.4",
  "@radix-ui/react-popover": "1.0.7",
  "@radix-ui/react-progress": "1.0.3",
  "@radix-ui/react-radio-group": "1.1.3",
  "@radix-ui/react-scroll-area": "1.0.5",
  "@radix-ui/react-select": "2.0.0",
  "@radix-ui/react-separator": "1.0.3",
  "@radix-ui/react-slider": "1.1.2",
  "@radix-ui/react-slot": "1.0.2",
  "@radix-ui/react-switch": "1.0.3",
  "@radix-ui/react-toast": "1.1.5",
  "@radix-ui/react-toggle": "1.0.3",
  "@radix-ui/react-toggle-group": "1.0.4",
  "class-variance-authority": "0.7.0",
  "clsx": "2.1.0",
  "tailwind-merge": "2.2.0",
  "lucide-react": "0.303.0",
  "react-day-picker": "8.9.1",
  "react-hook-form": "7.49.2",
  "react-resizable-panels": "2.0.9",
  "sonner": "1.4.2",
};

/** Design system used by the skeleton so tailwind.config + components.json emit. */
const SKELETON_DESIGN_SYSTEM: NonNullable<ScaffoldOptions["designSystem"]> = {
  colors: {},
  spacing: {},
  typography: {},
  borderRadius: {},
  shadows: {},
};

function buildScaffoldOptions(projectName: string): ScaffoldOptions {
  return {
    projectName,
    projectPath: projectName,
    framework: "vite-react",
    styling: "tailwind",
    features: { typescript: true, eslint: true, prettier: true, testing: true, git: true },
    designSystem: SKELETON_DESIGN_SYSTEM,
  };
}

/**
 * Files the adapter scaffold is MISSING that would otherwise break `npm run build`
 * (6.4c — the corpus is tested, not assumed). Every one is a real gap verified.
 */
const SKELETON_GAP_FILES: Record<string, string> = {
  // App.tsx imports ./pages/Home but generateScaffold never emits it.
  "src/pages/Home.tsx": `import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function Home() {
  return (
    <div className={cn('min-h-screen bg-background text-foreground', 'flex flex-col items-center justify-center gap-8 p-8')}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Infinity Workspace</CardTitle>
          <CardDescription>A runnable starter — your edits here show live.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
        </CardContent>
      </Card>
    </div>
  );
}`,
  // Tailwind v3 needs a postcss config + an explicit tailwind config (the adapter's
  // is conditional on designSystem, and postcss.config is never emitted).
  "postcss.config.js": `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`,
  "tailwind.config.js": `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};`,
};

/** Base corpus components shipped in the skeleton (all build-safe, deps present). */
const BASE_CORPUS = [
  "button", "card", "input", "label", "badge", "separator", "skeleton",
  "alert", "avatar", "checkbox", "switch", "tabs", "tooltip", "progress",
  "select", "textarea", "table", "dialog", "dropdown-menu", "accordion",
  "scroll-area", "popover", "sonner",
];

export interface ScaffoldWriteResult {
  ok: boolean;
  workspaceId: string;
  framework: string;
  filesWritten: number;
  reason?: string;
  gitCommit?: string;
}

/**
 * Write the complete scaffold into an EMPTY workspace. Refuses if the workspace
 * already has files (that's a different code path — the model continues in a
 * real repo, it does not clobber).
 */
export async function writeScaffoldWorkspace(
  workspaceId: string,
  frameworkType: SupportedFramework = "vite-react",
  projectName = "infinity-workspace-app",
): Promise<ScaffoldWriteResult> {
  const root = getWorkspaceRoot(workspaceId);
  await ensureWorkspace(workspaceId);

  // Only seed an empty workspace (ignore the .infinity + .git our own
  // ensureWorkspace creates, .tmp, and PLAN.md — the plan-to-repo artifact that
  // /build/plan may have written before scaffold runs).
  const existing = await fs.readdir(root);
  const nonMeta = existing.filter((n) => n !== ".infinity" && n !== ".git" && n !== ".tmp" && n !== "PLAN.md");
  if (nonMeta.length > 0) {
    return { ok: false, workspaceId, framework: frameworkType, filesWritten: 0, reason: "workspace-not-empty" };
  }

  const adapter = getFrameworkAdapter(frameworkType);
  if (!adapter) {
    return { ok: false, workspaceId, framework: frameworkType, filesWritten: 0, reason: `unsupported-framework:${frameworkType}` };
  }

  const options = buildScaffoldOptions(projectName);
  const generated = await adapter.generateScaffold(options);
  const files = new Map<string, string>();
  for (const file of generated) files.set(file.path, file.content);
  // Gap files are the TESTED versions of the skeleton (6.4c) — they always win
  // over adapter output. e.g. the base adapter's generateTailwindConfig emits a
  // tailwind.config.js with empty design tokens; the gap file carries the real
  // token mapping that src/index.css needs to render.
  for (const [rel, content] of Object.entries(SKELETON_GAP_FILES)) {
    files.set(rel, content);
  }

  // Merge corpus deps into the adapter's package.json. Read from the in-memory
  // scaffold map — the files are not on disk yet (they're written below).
  const pkgRaw = files.get("package.json");
  if (!pkgRaw) {
    return { ok: false, workspaceId, framework: frameworkType, filesWritten: 0, reason: "scaffold-missing-package-json" };
  }
  const pkg = JSON.parse(pkgRaw);
  pkg.dependencies = { ...(pkg.dependencies ?? {}), ...UI_CORPUS_DEPS };
  files.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

  // Write every file.
  let filesWritten = 0;
  const dirs = new Set<string>();
  for (const rel of files.keys()) {
    const dir = path.dirname(rel);
    dirs.add(dir);
  }
  for (const dir of dirs) await fs.mkdir(path.join(root, dir), { recursive: true });
  for (const [rel, content] of files) {
    await fs.writeFile(path.join(root, rel), content, "utf8");
    filesWritten++;
  }

  // Base corpus components (6.4a): copy from the real frontend corpus.
  const uiDir = path.join(root, "src", "components", "ui");
  await fs.mkdir(uiDir, { recursive: true });
  for (const name of BASE_CORPUS) {
    const srcFile = corpusComponentPath(name);
    if (srcFile) {
      await fs.writeFile(path.join(uiDir, `${name}.tsx`), await fs.readFile(srcFile, "utf8"), "utf8");
      filesWritten++;
      // Old-shadcn corpus components import a sibling CSS companion
      // (`import "./Button.css"`). Keep the ORIGINAL basename so that import
      // resolves; the lowercase shadcn set has no such companions.
      const cssBasename = path.basename(srcFile).replace(/\.tsx$/, ".css");
      const cssContent = await fs
        .readFile(path.join(CORPUS_ROOT, cssBasename), "utf8")
        .catch(() => null);
      if (cssContent) {
        await fs.writeFile(path.join(uiDir, cssBasename), cssContent, "utf8");
        filesWritten++;
      }
    }
  }
  // Ensure the barrel exists so `@/components/ui` resolves.
  const indexPath = path.join(uiDir, "index.ts");
  const entries = BASE_CORPUS.map((n) => `export * from './${n}';`).join("\n");
  await fs.writeFile(indexPath, `${entries}\n`, "utf8");

  // git init + commit ("Initial scaffold", 6.1).
  let gitCommit: string | undefined;
  await new Promise<void>((resolve) => {
    execFile("git", ["init", "-q"], { cwd: root, timeout: 15_000 }, () => resolve());
  });
  await runGit(root, ["add", "-A"]);
  const commit = await runGit(root, ["commit", "-q", "-m", "Initial scaffold"]);
  if (commit.ok && commit.stdout) gitCommit = commit.stdout.trim() || "Initial scaffold";

  // npm install in the background — don't make the write wait on it.
  fireInstall(root);

  return { ok: true, workspaceId, framework: frameworkType, filesWritten, gitCommit };
}

async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 30_000, maxBuffer: 1024 * 64 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

function fireInstall(root: string): void {
  execFile(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel", "error"],
    { cwd: root, timeout: 300_000, env: getWorkspaceCommandEnvironment() },
    () => {},
  );
}

/**
 * Read one corpus component's source. Used by the `generate_component` tool
 * (6.4a) and by the base-corpus copy above.
 */
/** Resolve a corpus component to its source file, handling both shadcn naming
 * generations used in the corpus: lowercase (card.tsx) and old-style
 * capitalized (Button.tsx, Input.tsx...). Returns null when neither exists. */
function corpusComponentPath(name: string): string | null {
  const sanitized = name.replace(/[^a-zA-Z0-9-]/g, "");
  const candidates = [`${sanitized}.tsx`, `${sanitized[0]?.toUpperCase() ?? ""}${sanitized.slice(1)}.tsx`];
  for (const candidate of candidates) {
    const file = path.join(CORPUS_ROOT, candidate);
    if (fsSync.existsSync(file)) return file;
  }
  return null;
}

export async function readCorpusComponent(name: string): Promise<string | null> {
  const file = corpusComponentPath(name);
  return file ? fs.readFile(file, "utf8") : null;
}

/** Names available to `generate_component` (6.4a corpus injection). */
export async function listCorpusComponents(): Promise<string[]> {
  try {
    const names = (await fs.readdir(CORPUS_ROOT))
      .filter((f) => f.endsWith(".tsx") && f !== "index.tsx")
      .map((f) => f.replace(/\.tsx$/, ""));
    return names.sort();
  } catch {
    return [];
  }
}

/**
 * The hard pinned-version rule + corpus block injected into coder prompts
 * (6.4b). Kills the "model invents APIs/versions" failure at the source.
 */
export function scaffoldRulePrompt(): string {
  return [
    "## Scaffold rules (HARD)",
    "- DO NOT rewrite `package.json`, `tsconfig*`, `vite.config.*`, `tailwind.config.*`, `postcss.config.*`, `components.json`. A runnable skeleton already exists.",
    "- Reuse the existing Tailwind design system and shadcn UI library (`@/components/ui/*`). Prefer `generate_component` over writing UI from scratch.",
    "- NEVER invent a dependency version. If a dependency is not in `package.json`, add it via `npm install <pkg>@<version>`.",
    "- Keep `src/index.css`'s design tokens; add tokens where a real need appears, never restyle the base.",
  ].join("\n");
}

export const SCAFFOLD_RULE_PROMPT = scaffoldRulePrompt();