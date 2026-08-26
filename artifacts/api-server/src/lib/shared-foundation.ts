/**
 * PHASE 12 — SHARED FOUNDATION LAYER
 *
 * Common infrastructure shared across all artifact types.
 * Enables code sharing between slide-deck, website, web-app, mobile-app, api, cli-tool, chrome-extension.
 * $0 budget: all tools are open source / free tiers.
 */

import { z } from "zod";
import type {
  ArtifactTypeId,
  ArtifactConfig,
  Framework,
  DeployTarget,
  SharedFoundation,
  DesignSystemFoundation,
  ComponentLibraryFoundation,
  ApiClientFoundation,
  AuthConfig,
  ConfigFoundation,
  ComponentDefinition,
  ApiEndpointDefinition,
} from "./artifact-types";

// ============================================================================
// DESIGN SYSTEM SETTINGS SCHEMA (for configuration)
// ============================================================================

export const designSystemSettingsSchema = z.object({
  name: z.string().default("Infinity Design System"),
  colors: z.record(z.string()).default({
    primary: "#3b82f6",
    secondary: "#8b5cf6",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#0f172a",
    textSecondary: "#475569",
    border: "#e2e8f0",
  }),
  darkColors: z.record(z.string()).default({
    primary: "#60a5fa",
    secondary: "#a78bfa",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
    background: "#0f172a",
    surface: "#1e293b",
    text: "#f8fafc",
    textSecondary: "#94a3b8",
    border: "#334155",
  }),
  typography: z.record(z.unknown()).default({
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontFamilyMono: "'JetBrains Mono', 'Fira Code', monospace",
    h1: { size: 48, weight: 700, lineHeight: 1.1 },
    h2: { size: 36, weight: 700, lineHeight: 1.2 },
    h3: { size: 30, weight: 600, lineHeight: 1.3 },
    h4: { size: 24, weight: 600, lineHeight: 1.3 },
    body: { size: 16, weight: 400, lineHeight: 1.6 },
    bodySmall: { size: 14, weight: 400, lineHeight: 1.5 },
    caption: { size: 12, weight: 400, lineHeight: 1.4 },
  }),
  spacing: z.record(z.string()).default({
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
    xxl: "48px",
  }),
  borderRadius: z.record(z.string()).default({
    none: "0",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    full: "9999px",
  }),
  shadows: z.record(z.string()).default({
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  }),
  breakpoints: z.record(z.string()).default({
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
    "2xl": "1536px",
  }),
  darkMode: z.boolean().default(true),
  cssVariables: z.boolean().default(true),
  // Platform-specific overrides
  platformOverrides: z.record(z.unknown()).default({}),
});

export type DesignSystemSettings = z.infer<typeof designSystemSettingsSchema>;

// ============================================================================
// COMPONENT LIBRARY SETTINGS SCHEMA
// ============================================================================

export const componentLibrarySettingsSchema = z.object({
  name: z.string().default("Infinity Components"),
  framework: z.enum(["react", "vue", "svelte", "solid", "vanilla"]).default("react"),
  styling: z.enum(["tailwind", "css-modules", "styled-components", "nativewind", "emotion"]).default("tailwind"),
  components: z.array(z.object({
    name: z.string(),
    path: z.string(),
    props: z.record(z.unknown()),
    variants: z.array(z.string()).optional(),
    sizes: z.array(z.string()).optional(),
    description: z.string(),
    dependencies: z.array(z.string()).default([]),
  })).default([
    { name: "Button", path: "Button", props: { variant: "primary | secondary | ghost | danger", size: "sm | md | lg", disabled: "boolean" }, variants: ["primary", "secondary", "ghost", "danger"], sizes: ["sm", "md", "lg"], description: "Primary action button", dependencies: [] },
    { name: "Input", path: "Input", props: { type: "text | email | password | number", placeholder: "string", error: "string", disabled: "boolean" }, variants: [], sizes: ["sm", "md", "lg"], description: "Form input field", dependencies: [] },
    { name: "Card", path: "Card", props: { title: "string", children: "ReactNode", footer: "ReactNode" }, variants: ["default", "outlined", "elevated"], sizes: [], description: "Content container", dependencies: [] },
    { name: "Modal", path: "Modal", props: { open: "boolean", onClose: "() => void", title: "string", children: "ReactNode" }, variants: [], sizes: ["sm", "md", "lg", "xl", "full"], description: "Overlay dialog", dependencies: [] },
    { name: "Table", path: "Table", props: { columns: "Column[]", data: "T[]", sortable: "boolean", selectable: "boolean" }, variants: ["striped", "bordered", "hoverable"], sizes: [], description: "Data display table", dependencies: [] },
    { name: "Toast", path: "Toast", props: { message: "string", type: "success | error | warning | info", duration: "number" }, variants: [], sizes: [], description: "Notification toast", dependencies: [] },
    { name: "Avatar", path: "Avatar", props: { src: "string", alt: "string", fallback: "string", size: "xs | sm | md | lg | xl" }, variants: [], sizes: ["xs", "sm", "md", "lg", "xl"], description: "User avatar", dependencies: [] },
    { name: "Badge", path: "Badge", props: { children: "ReactNode", variant: "default | success | warning | error | info", size: "sm | md" }, variants: ["default", "success", "warning", "error", "info"], sizes: ["sm", "md"], description: "Status badge", dependencies: [] },
    { name: "Tabs", path: "Tabs", props: { tabs: "Tab[]", activeTab: "string", onChange: "(tab: string) => void" }, variants: ["line", "enclosed", "soft"], sizes: [], description: "Tab navigation", dependencies: [] },
    { name: "Select", path: "Select", props: { options: "Option[]", value: "string", onChange: "(value: string) => void", placeholder: "string" }, variants: [], sizes: ["sm", "md", "lg"], description: "Dropdown select", dependencies: [] },
  ]),
  exports: z.array(z.string()).default(["Button", "Input", "Card", "Modal", "Table", "Toast", "Avatar", "Badge", "Tabs", "Select"]),
  peerDependencies: z.record(z.string()).default({
    react: ">=18",
    "react-dom": ">=18",
  }),
  dependencies: z.record(z.string()).default({
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "class-variance-authority": "^0.7.0",
  }),
});

export type ComponentLibrarySettings = z.infer<typeof componentLibrarySettingsSchema>;

// ============================================================================
// API CLIENT SETTINGS SCHEMA
// ============================================================================

export const apiClientSettingsSchema = z.object({
  name: z.string().default("Infinity API Client"),
  baseUrl: z.string().default(""),
  auth: z.object({
    type: z.enum(["none", "bearer", "cookie", "oauth", "custom"]).default("bearer"),
    tokenUrl: z.string().optional(),
    refreshUrl: z.string().optional(),
    scopes: z.array(z.string()).default([]),
  }).default({ type: "bearer" }),
  endpoints: z.array(z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    path: z.string(),
    name: z.string(),
    params: z.record(z.unknown()).optional(),
    response: z.record(z.unknown()).optional(),
    description: z.string(),
  })).default([]),
  interceptors: z.array(z.object({
    name: z.string(),
    code: z.string(),
  })).default([]),
  errorHandling: z.enum(["throw", "return", "toast"]).default("throw"),
  retry: z.object({
    enabled: z.boolean().default(true),
    maxRetries: z.number().default(3),
    backoffMs: z.number().default(1000),
  }).default({}),
  timeout: z.number().default(30000),
  cache: z.enum(["none", "memory", "indexeddb"]).default("memory"),
});

export type ApiClientSettings = z.infer<typeof apiClientSettingsSchema>;

// ============================================================================
// CONFIG SETTINGS SCHEMA
// ============================================================================

export const configSettingsSchema = z.object({
  name: z.string().default("Infinity Config"),
  env: z.record(z.string()).default({
    NODE_ENV: "development",
    APP_URL: "http://localhost:3000",
    API_URL: "http://localhost:3001",
  }),
  runtime: z.record(z.unknown()).default({}),
  build: z.record(z.unknown()).default({
    sourcemap: true,
    minify: true,
    target: "es2020",
  }),
  deploy: z.record(z.unknown()).default({
    platform: "vercel",
    region: "iad1",
  }),
  features: z.record(z.boolean()).default({
    analytics: false,
    errorTracking: false,
    featureFlags: false,
  }),
});

export type ConfigSettings = z.infer<typeof configSettingsSchema>;

// ============================================================================
// FACTORY FUNCTIONS - Create foundations matching artifact-types.ts interfaces
// ============================================================================

export function createDesignSystemFoundation(
  id: string,
  name: string,
  settings: Partial<DesignSystemSettings> = {}
): DesignSystemFoundation {
  const parsed = designSystemSettingsSchema.parse(settings);
  return {
    id,
    name,
    colors: parsed.colors,
    typography: parsed.typography,
    spacing: parsed.spacing,
    borderRadius: parsed.borderRadius,
    shadows: parsed.shadows,
    motion: {},
    breakpoints: parsed.breakpoints,
    darkMode: parsed.darkMode,
    cssVariables: parsed.cssVariables,
  };
}

export function createComponentLibraryFoundation(
  id: string,
  name: string,
  settings: Partial<ComponentLibrarySettings> = {}
): ComponentLibraryFoundation {
  const parsed = componentLibrarySettingsSchema.parse(settings);
  return {
    id,
    name,
    components: parsed.components.map(c => ({
      name: c.name,
      path: c.path,
      props: c.props,
      variants: c.variants,
      sizes: c.sizes,
      description: c.description,
    })),
    exports: parsed.exports,
    dependencies: [...Object.keys(parsed.dependencies), ...Object.keys(parsed.peerDependencies)],
    peerDependencies: Object.keys(parsed.peerDependencies),
  };
}

export function createApiClientFoundation(
  id: string,
  name: string,
  settings: Partial<ApiClientSettings> = {}
): ApiClientFoundation {
  const parsed = apiClientSettingsSchema.parse(settings);
  return {
    id,
    name,
    baseUrl: parsed.baseUrl,
    endpoints: parsed.endpoints.map(e => ({
      method: e.method,
      path: e.path,
      name: e.name,
      params: e.params,
      response: e.response,
      description: e.description,
    })),
    auth: parsed.auth,
    types: "types/api.d.ts",
  };
}

export function createConfigFoundation(
  id: string,
  name: string,
  settings: Partial<ConfigSettings> = {}
): ConfigFoundation {
  const parsed = configSettingsSchema.parse(settings);
  return {
    id,
    name,
    env: parsed.env,
    runtime: parsed.runtime,
    build: parsed.build,
    deploy: parsed.deploy,
  };
}

// ============================================================================
// SHARED FOUNDATION MANAGER INTERFACE
// ============================================================================

export interface SharedFoundationManager {
  // Design System
  createDesignSystem(projectId: string, name: string, settings?: Partial<DesignSystemSettings>): Promise<DesignSystemFoundation>;
  getDesignSystem(projectId: string, id?: string): Promise<DesignSystemFoundation | undefined>;
  updateDesignSystem(projectId: string, id: string, settings: Partial<DesignSystemSettings>): Promise<DesignSystemFoundation>;
  deleteDesignSystem(projectId: string, id: string): Promise<void>;
  listDesignSystems(projectId: string): Promise<DesignSystemFoundation[]>;

  // Component Library
  createComponentLibrary(projectId: string, name: string, settings?: Partial<ComponentLibrarySettings>): Promise<ComponentLibraryFoundation>;
  getComponentLibrary(projectId: string, id?: string): Promise<ComponentLibraryFoundation | undefined>;
  updateComponentLibrary(projectId: string, id: string, settings: Partial<ComponentLibrarySettings>): Promise<ComponentLibraryFoundation>;
  deleteComponentLibrary(projectId: string, id: string): Promise<void>;
  listComponentLibraries(projectId: string): Promise<ComponentLibraryFoundation[]>;

  // API Client
  createApiClient(projectId: string, name: string, settings?: Partial<ApiClientSettings>): Promise<ApiClientFoundation>;
  getApiClient(projectId: string, id?: string): Promise<ApiClientFoundation | undefined>;
  updateApiClient(projectId: string, id: string, settings: Partial<ApiClientSettings>): Promise<ApiClientFoundation>;
  deleteApiClient(projectId: string, id: string): Promise<void>;
  listApiClients(projectId: string): Promise<ApiClientFoundation[]>;

  // Config
  createConfig(projectId: string, name: string, settings?: Partial<ConfigSettings>): Promise<ConfigFoundation>;
  getConfig(projectId: string, id?: string): Promise<ConfigFoundation | undefined>;
  updateConfig(projectId: string, id: string, settings: Partial<ConfigSettings>): Promise<ConfigFoundation>;
  deleteConfig(projectId: string, id: string): Promise<void>;
  listConfigs(projectId: string): Promise<ConfigFoundation[]>;

  // Get full shared foundation for an artifact
  getSharedFoundationForArtifact(projectId: string, artifactType: ArtifactTypeId): Promise<SharedFoundation>;
}

// ============================================================================
// ARTIFACT CONFIG GENERATION
// ============================================================================

export function generateArtifactConfigs(
  projectId: string,
  artifactConfigs: Array<{ type: ArtifactTypeId; name: string; framework: Framework; deployTargets: DeployTarget[]; settings?: Record<string, unknown> }>
): ArtifactConfig[] {
  return artifactConfigs.map((ac, index) => ({
    id: `artifact-${Date.now()}-${index}`,
    projectId,
    type: ac.type,
    name: ac.name,
    slug: ac.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: "",
    framework: ac.framework,
    deployTarget: ac.deployTargets,
    settings: ac.settings || {},
    sharedFoundation: {
      designSystemId: "design-system-main",
      componentLibraryId: "components-main",
      apiClientId: "api-client-main",
      configId: "config-main",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

// ============================================================================
// CROSS-ARTIFACT SYNC
// ============================================================================

export interface FoundationChange {
  type: "design-system" | "component-library" | "api-client" | "config";
  action: "created" | "updated" | "deleted";
  foundationId: string;
  projectId: string;
  artifactTypesAffected: ArtifactTypeId[];
  timestamp: string;
  changes: Record<string, unknown>;
}

export interface SyncResult {
  artifactId: string;
  artifactType: ArtifactTypeId;
  success: boolean;
  updatedFiles: string[];
  errors: string[];
}

// In-memory event bus for cross-artifact sync (replace with real event system in production)
type ChangeListener = (change: FoundationChange) => void;
const changeListeners: ChangeListener[] = [];

export function onFoundationChange(listener: ChangeListener): () => void {
  changeListeners.push(listener);
  return () => {
    const index = changeListeners.indexOf(listener);
    if (index !== -1) changeListeners.splice(index, 1);
  };
}

export function emitFoundationChange(change: FoundationChange): void {
  changeListeners.forEach((listener) => listener(change));
}

// ============================================================================
// FRAMEWORK-SPECIFIC GENERATORS (Integration points)
// ============================================================================

export interface FrameworkGenerator {
  framework: Framework;
  generateDesignSystem(foundation: DesignSystemFoundation): string[];
  generateComponentLibrary(foundation: ComponentLibraryFoundation): string[];
  generateApiClient(foundation: ApiClientFoundation): string[];
  generateConfig(foundation: ConfigFoundation): string[];
}

// TypeScript/React/Tailwind generator
export const reactTailwindGenerator: FrameworkGenerator = {
  framework: "next",
  generateDesignSystem: (foundation) => [
    `// lib/design-system.ts
import { createTheme } from '@/theme';

export const theme = createTheme(${JSON.stringify({
  colors: foundation.colors,
  darkColors: {
    primary: foundation.colors.primary,
    secondary: foundation.colors.secondary,
    success: foundation.colors.success,
    warning: foundation.colors.warning,
    error: foundation.colors.error,
    background: "#0f172a",
    surface: "#1e293b",
    text: "#f8fafc",
    textSecondary: "#94a3b8",
    border: "#334155",
  },
  typography: foundation.typography,
  spacing: foundation.spacing,
  borderRadius: foundation.borderRadius,
  shadows: foundation.shadows,
  breakpoints: foundation.breakpoints,
  darkMode: foundation.darkMode,
  cssVariables: foundation.cssVariables,
  platformOverrides: {},
}, null, 2)});

export type Theme = typeof theme;
export default theme;`,
    `// app/globals.css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --color-primary: ${foundation.colors.primary};
    --color-secondary: ${foundation.colors.secondary};
    --color-success: ${foundation.colors.success};
    --color-warning: ${foundation.colors.warning};
    --color-error: ${foundation.colors.error};
    --color-background: ${foundation.colors.background};
    --color-surface: ${foundation.colors.surface};
    --color-text: ${foundation.colors.text};
    --color-text-secondary: ${foundation.colors.textSecondary};
    --color-border: ${foundation.colors.border};
  }

  .dark {
    --color-primary: ${foundation.colors.primary};
    --color-secondary: ${foundation.colors.secondary};
    --color-success: ${foundation.colors.success};
    --color-warning: ${foundation.colors.warning};
    --color-error: ${foundation.colors.error};
    --color-background: #0f172a;
    --color-surface: #1e293b;
    --color-text: #f8fafc;
    --color-text-secondary: #94a3b8;
    --color-border: #334155;
  }
}`,
  ],
  generateComponentLibrary: (foundation) => {
    const components = foundation.components.map((c) => {
      const props = Object.entries(c.props)
        .map(([key, type]) => `${key}: ${type}`)
        .join(", ");
      return `// components/${c.name}.tsx
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { ${c.variants?.join(", ") || "default"} } from '@/theme/variants';

export interface ${c.name}Props {
  ${props}
  className?: string;
}

export const ${c.name} = forwardRef<HTMLDivElement, ${c.name}Props>(
  ({ ${Object.keys(c.props).join(", ")}, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("${c.path.toLowerCase()}", className)}
        {...props}
      />
    );
  }
);

${c.name}.displayName = "${c.name}";
`;
    });
    return [
      `// components/index.ts
${foundation.components.map((c) => `export { ${c.name} } from './${c.name}';`).join("\n")}
export type { ${foundation.components.map((c) => `${c.name}Props`).join(", ")} } from './${foundation.components[0]?.name}';`,
      ...components,
    ];
  },
  generateApiClient: (foundation) => [
    `// lib/api-client.ts
import { createApiClient } from '@/lib/api-factory';

export const api = createApiClient({
  baseUrl: '${foundation.baseUrl}',
  auth: ${JSON.stringify(foundation.auth, null, 2)},
});

${foundation.endpoints.map((e) => `
export async function ${e.name}(${Object.entries(e.params || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}) {
  return api.${e.method.toLowerCase()}('${e.path}');
}`).join("\n")}`,
  ],
  generateConfig: (foundation) => [
    `// lib/config.ts
export const config = ${JSON.stringify({
  env: foundation.env,
  runtime: foundation.runtime,
  build: foundation.build,
  deploy: foundation.deploy,
}, null, 2)};

export type Config = typeof config;
export default config;`,
  ],
};

// Expo/React Native/NativeWind generator
export const expoNativeWindGenerator: FrameworkGenerator = {
  framework: "expo",
  generateDesignSystem: (foundation) => [
    `// theme/index.ts
import { createTheme } from './create-theme';

export const theme = createTheme(${JSON.stringify({
  colors: foundation.colors,
  darkColors: {
    primary: foundation.colors.primary,
    secondary: foundation.colors.secondary,
    success: foundation.colors.success,
    warning: foundation.colors.warning,
    error: foundation.colors.error,
    background: "#0f172a",
    surface: "#1e293b",
    text: "#f8fafc",
    textSecondary: "#94a3b8",
    border: "#334155",
  },
  typography: foundation.typography,
  spacing: foundation.spacing,
  borderRadius: foundation.borderRadius,
  shadows: foundation.shadows,
  breakpoints: foundation.breakpoints,
  darkMode: foundation.darkMode,
  cssVariables: foundation.cssVariables,
  platformOverrides: {},
}, null, 2)});

export type Theme = typeof theme;
export default theme;`,
    `// global.css
@tailwind base;
@tailwind components;
@tailwind utilities;

@theme {
  --color-primary: ${foundation.colors.primary};
  --color-secondary: ${foundation.colors.secondary};
  --color-success: ${foundation.colors.success};
  --color-warning: ${foundation.colors.warning};
  --color-error: ${foundation.colors.error};
  --color-background: ${foundation.colors.background};
  --color-surface: ${foundation.colors.surface};
  --color-text: ${foundation.colors.text};
  --color-text-secondary: ${foundation.colors.textSecondary};
  --color-border: ${foundation.colors.border};

  --font-family: ${foundation.typography.fontFamily};
  --font-family-mono: ${foundation.typography.fontFamilyMono};
}`,
  ],
  generateComponentLibrary: (foundation) => {
    const components = foundation.components.map((c) => {
      return `// components/${c.name}.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';

export interface ${c.name}Props {
  ${Object.entries(c.props).map(([key, type]) => `${key}: ${type}`).join(";\n  ")}
  style?: any;
}

export function ${c.name}({ ${Object.keys(c.props).join(", ")}, style, ...props }: ${c.name}Props) {
  const { colors, spacing, borderRadius } = useTheme();
  return (
    <View style={[styles.container, style]} {...props}>
      {/* ${c.name} implementation */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Base styles using theme tokens
  },
});`;
    });
    return [
      `// components/index.ts
${foundation.components.map((c) => `export { ${c.name} } from './${c.name}';`).join("\n")}
export type { ${foundation.components.map((c) => `${c.name}Props`).join(", ")} } from './${foundation.components[0]?.name}';`,
      ...components,
    ];
  },
  generateApiClient: (foundation) => [
    `// lib/api-client.ts
import { createApiClient } from '@/lib/api-factory';

export const api = createApiClient({
  baseUrl: '${foundation.baseUrl}',
  auth: ${JSON.stringify(foundation.auth, null, 2)},
});

${foundation.endpoints.map((e) => `
export async function ${e.name}(${Object.entries(e.params || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}) {
  return api.${e.method.toLowerCase()}('${e.path}');
}`).join("\n")}`,
  ],
  generateConfig: (foundation) => [
    `// lib/config.ts
export const config = ${JSON.stringify({
  env: foundation.env,
  runtime: foundation.runtime,
  build: foundation.build,
  deploy: foundation.deploy,
}, null, 2)};

export type Config = typeof config;
export default config;`,
  ],
};

// Hono/Express/Fastify API generator
export const apiGenerator: FrameworkGenerator = {
  framework: "hono",
  generateDesignSystem: () => [], // Not applicable for API
  generateComponentLibrary: () => [], // Not applicable for API
  generateApiClient: (foundation) => [
    `// src/client.ts
import { hc } from 'hono/client';

export const client = hc<AppType>('${foundation.baseUrl}');

${foundation.endpoints.map((e) => `
export const ${e.name} = client.api.${e.path.split("/").slice(2).join(".")}.${e.method.toLowerCase()};`).join("\n")}`,
  ],
  generateConfig: (foundation) => [
    `// src/config.ts
export const config = ${JSON.stringify({
  env: foundation.env,
  runtime: foundation.runtime,
  build: foundation.build,
  deploy: foundation.deploy,
}, null, 2)};

export type Config = typeof config;
export default config;`,
  ],
};

// Astro generator
export const astroGenerator: FrameworkGenerator = {
  framework: "astro",
  generateDesignSystem: (foundation) => [
    `// src/styles/global.css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --color-primary: ${foundation.colors.primary};
    --color-secondary: ${foundation.colors.secondary};
    --color-success: ${foundation.colors.success};
    --color-warning: ${foundation.colors.warning};
    --color-error: ${foundation.colors.error};
    --color-background: ${foundation.colors.background};
    --color-surface: ${foundation.colors.surface};
    --color-text: ${foundation.colors.text};
    --color-text-secondary: ${foundation.colors.textSecondary};
    --color-border: ${foundation.colors.border};
  }

  .dark {
    --color-primary: ${foundation.colors.primary};
    --color-secondary: ${foundation.colors.secondary};
    --color-success: ${foundation.colors.success};
    --color-warning: ${foundation.colors.warning};
    --color-error: ${foundation.colors.error};
    --color-background: #0f172a;
    --color-surface: #1e293b;
    --color-text: #f8fafc;
    --color-text-secondary: #94a3b8;
    --color-border: #334155;
  }
}`,
  ],
  generateComponentLibrary: (foundation) => {
    const components = foundation.components.map((c) => {
      return `// src/components/${c.name}.astro
---
interface Props {
  ${Object.entries(c.props).map(([key, type]) => `${key}: ${type}`).join(";\n  ")}
  class?: string;
}

const { ${Object.keys(c.props).join(", ")} } = Astro.props;
---

<div class:list={["${c.path.toLowerCase()}", class]} {...Astro.props}>
  <slot />
</div>`;
    });
    return [
      `// src/components/index.ts
${foundation.components.map((c) => `export { default as ${c.name} } from './${c.name}.astro';`).join("\n")}`,
      ...components,
    ];
  },
  generateApiClient: (foundation) => [
    `// src/lib/api.ts
const baseUrl = '${foundation.baseUrl}';

${foundation.endpoints.map((e) => `
export async function ${e.name}(${Object.entries(e.params || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}) {
  const response = await fetch(\`\${baseUrl}${e.path}\`, {
    method: '${e.method}',
    headers: { 'Content-Type': 'application/json' },
    body: ${Object.keys(e.params || {}).length > 0 ? "JSON.stringify({ " + Object.keys(e.params || {}).join(", ") + " })" : "undefined"},
  });
  return response.json();
}`).join("\n")}`,
  ],
  generateConfig: (foundation) => [
    `// src/config.ts
export const config = ${JSON.stringify({
  env: foundation.env,
  runtime: foundation.runtime,
  build: foundation.build,
  deploy: foundation.deploy,
}, null, 2)};

export type Config = typeof config;
export default config;`,
  ],
};

// CLI tool generator (Commander/CAC)
export const cliGenerator: FrameworkGenerator = {
  framework: "commander",
  generateDesignSystem: () => [],
  generateComponentLibrary: () => [],
  generateApiClient: (foundation) => [
    `// src/api-client.ts
import { createApiClient } from './api-factory';

export const api = createApiClient({
  baseUrl: '${foundation.baseUrl}',
  auth: ${JSON.stringify(foundation.auth, null, 2)},
});

${foundation.endpoints.map((e) => `
export async function ${e.name}(${Object.entries(e.params || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}) {
  return api.${e.method.toLowerCase()}('${e.path}');
}`).join("\n")}`,
  ],
  generateConfig: (foundation) => [
    `// src/config.ts
export const config = ${JSON.stringify({
  env: foundation.env,
  runtime: foundation.runtime,
  build: foundation.build,
  deploy: foundation.deploy,
}, null, 2)};

export type Config = typeof config;
export default config;`,
  ],
};

// Chrome Extension generator
export const chromeExtensionGenerator: FrameworkGenerator = {
  framework: "manifest-v3",
  generateDesignSystem: (foundation) => [
    `// src/theme.css
:root {
  --color-primary: ${foundation.colors.primary};
  --color-secondary: ${foundation.colors.secondary};
  --color-success: ${foundation.colors.success};
  --color-warning: ${foundation.colors.warning};
  --color-error: ${foundation.colors.error};
  --color-background: ${foundation.colors.background};
  --color-surface: ${foundation.colors.surface};
  --color-text: ${foundation.colors.text};
  --color-text-secondary: ${foundation.colors.textSecondary};
  --color-border: ${foundation.colors.border};
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: ${foundation.colors.primary};
    --color-secondary: ${foundation.colors.secondary};
    --color-success: ${foundation.colors.success};
    --color-warning: ${foundation.colors.warning};
    --color-error: ${foundation.colors.error};
    --color-background: #0f172a;
    --color-surface: #1e293b;
    --color-text: #f8fafc;
    --color-text-secondary: #94a3b8;
    --color-border: #334155;
  }
}`,
  ],
  generateComponentLibrary: (foundation) => {
    const components = foundation.components.map((c) => {
      return `// src/components/${c.name}.tsx
import React from 'react';
import './${c.name}.css';

export interface ${c.name}Props {
  ${Object.entries(c.props).map(([key, type]) => `${key}: ${type}`).join(";\n  ")}
  className?: string;
}

export function ${c.name}({ ${Object.keys(c.props).join(", ")}, className, ...props }: ${c.name}Props) {
  return (
    <div className={\`${c.path.toLowerCase()} \${className || ''}\`} {...props}>
      {/* ${c.name} implementation */}
    </div>
  );
}`;
    });
    return [
      `// src/components/index.ts
${foundation.components.map((c) => `export { ${c.name} } from './${c.name}';`).join("\n")}
export type { ${foundation.components.map((c) => `${c.name}Props`).join(", ")} } from './${foundation.components[0]?.name}';`,
      ...components,
    ];
  },
  generateApiClient: (foundation) => [
    `// src/lib/api.ts
const baseUrl = '${foundation.baseUrl}';

${foundation.endpoints.map((e) => `
export async function ${e.name}(${Object.entries(e.params || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}) {
  const response = await fetch(\`\${baseUrl}${e.path}\`, {
    method: '${e.method}',
    headers: { 'Content-Type': 'application/json' },
    body: ${Object.keys(e.params || {}).length > 0 ? "JSON.stringify({ " + Object.keys(e.params || {}).join(", ") + " })" : "undefined"},
  });
  return response.json();
}`).join("\n")}`,
  ],
  generateConfig: (foundation) => [
    `// src/config.ts
export const config = ${JSON.stringify({
  env: foundation.env,
  runtime: foundation.runtime,
  build: foundation.build,
  deploy: foundation.deploy,
}, null, 2)};

export type Config = typeof config;
export default config;`,
  ],
};

// Registry of framework generators
export const FRAMEWORK_GENERATORS: Record<Framework, FrameworkGenerator> = {
  marp: reactTailwindGenerator,
  reveal: reactTailwindGenerator,
  astro: astroGenerator,
  next: reactTailwindGenerator,
  vite: reactTailwindGenerator,
  expo: expoNativeWindGenerator,
  fastify: apiGenerator,
  express: apiGenerator,
  hono: apiGenerator,
  elysia: apiGenerator,
  cli: cliGenerator,
  commander: cliGenerator,
  cac: cliGenerator,
  yargs: cliGenerator,
  oclif: cliGenerator,
  "manifest-v3": chromeExtensionGenerator,
};

export function getFrameworkGenerator(framework: Framework): FrameworkGenerator {
  return FRAMEWORK_GENERATORS[framework] || reactTailwindGenerator;
}

// ============================================================================
// SHARED FOUNDATION FILE GENERATION
// ============================================================================

export function generateSharedFoundationFiles(
  foundation: SharedFoundation,
  framework: Framework
): { path: string; content: string; purpose: string }[] {
  const generator = getFrameworkGenerator(framework);
  const files: { path: string; content: string; purpose: string }[] = [];

  if (foundation.designSystem) {
    const dsFiles = generator.generateDesignSystem(foundation.designSystem);
    dsFiles.forEach((content, index) => {
      files.push({
        path: `shared/design-system/${index === 0 ? "theme.ts" : index === 1 ? "globals.css" : `file-${index}.ts`}`,
        content,
        purpose: "Design system theme and CSS variables",
      });
    });
  }

  if (foundation.componentLibrary) {
    const clFiles = generator.generateComponentLibrary(foundation.componentLibrary);
    clFiles.forEach((content, index) => {
      files.push({
        path: `shared/components/${index === 0 ? "index.ts" : `file-${index}.ts`}`,
        content,
        purpose: "Shared component library",
      });
    });
  }

  if (foundation.apiClient) {
    const apiFiles = generator.generateApiClient(foundation.apiClient);
    apiFiles.forEach((content, index) => {
      files.push({
        path: `shared/api/${index === 0 ? "client.ts" : `file-${index}.ts`}`,
        content,
        purpose: "Shared API client with typed endpoints",
      });
    });
  }

  if (foundation.config) {
    const configFiles = generator.generateConfig(foundation.config);
    configFiles.forEach((content, index) => {
      files.push({
        path: `shared/config/${index === 0 ? "config.ts" : `file-${index}.ts`}`,
        content,
        purpose: "Shared configuration",
      });
    });
  }

  return files;
}