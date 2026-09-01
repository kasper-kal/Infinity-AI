/**
 * DESIGN MODE ENGINE — Visual Editing Bridge Between Preview and Code
 *
 * Provides the backend infrastructure for Cursor-style Design Mode:
 * - Element inspection and selection in preview
 * - Bidirectional sync: preview ↔ code editor
 * - Visual property editing with design token integration
 * - Component registry with prop type extraction
 * - Design system token extraction from existing CSS
 */

import { EventEmitter } from "events";
import { DesignTokens, defaultDesignTokens } from "./design-token-pipeline";
import { createCodebaseIndexer } from "./codebase-indexer";

// ============================================================================
// Types
// ============================================================================

export interface DesignModeConfig {
  projectId: string;
  projectRoot: string;
  enableDesignTokenExtraction: boolean;
  enableComponentRegistry: boolean;
}

export interface InspectedElement {
  id: string;
  selector: string;
  tagName: string;
  className: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  componentInfo?: ComponentInfo;
  sourceLocation?: SourceLocation;
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  props: ComponentProp[];
  isShadcnComponent: boolean;
  shadcnCategory?: string;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  // For visual controls
  controlType?: "color" | "spacing" | "typography" | "boolean" | "enum" | "string" | "number";
  options?: string[]; // for enum
  designTokenPath?: string; // e.g., "colors.primary.500"
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface VisualPropertyChange {
  elementId: string;
  property: string;
  value: string;
  type: "style" | "attribute" | "prop";
  designTokenPath?: string;
}

export interface DesignModeSession {
  id: string;
  projectId: string;
  active: boolean;
  selectedElementId: string | null;
  inspectedElements: Map<string, InspectedElement>;
  pendingChanges: VisualPropertyChange[];
  createdAt: number;
  updatedAt: number;
}

export interface ComponentRegistryEntry {
  name: string;
  filePath: string;
  displayName: string;
  category: string;
  props: ComponentProp[];
  exampleUsage: string;
  tags: string[];
}

export interface DesignTokenExtractionResult {
  tokens: DesignTokens;
  sourceFiles: string[];
  warnings: string[];
  extractedFrom: "css" | "tailwind" | "config" | "mixed";
}

// ============================================================================
// Design Mode Engine
// ============================================================================

export class DesignModeEngine extends EventEmitter {
  private config: DesignModeConfig;
  private sessions: Map<string, DesignModeSession> = new Map();
  private componentRegistry: Map<string, ComponentRegistryEntry> = new Map();
  private designTokens: DesignTokens = defaultDesignTokens;
  private codebaseIndexer: ReturnType<typeof createCodebaseIndexer> | null = null;
  private initialized = false;

  constructor(config: DesignModeConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize codebase indexer for component discovery
    this.codebaseIndexer = createCodebaseIndexer(
      this.config.projectId,
      this.config.projectRoot,
      { enableIncremental: true }
    );
    await this.codebaseIndexer.initialize();

    // Build component registry
    if (this.config.enableComponentRegistry) {
      await this.buildComponentRegistry();
    }

    // Extract design tokens from project
    if (this.config.enableDesignTokenExtraction) {
      const result = await this.extractDesignTokensFromProject();
      this.designTokens = result.tokens;
    }

    this.initialized = true;
    this.emit("initialized");
  }

  /**
   * Create a new design mode session
   */
  createSession(): DesignModeSession {
    const session: DesignModeSession = {
      id: `design-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      projectId: this.config.projectId,
      active: true,
      selectedElementId: null,
      inspectedElements: new Map(),
      pendingChanges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    this.emit("session:created", session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): DesignModeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Register an inspected element from the preview
   */
  registerInspectedElement(sessionId: string, element: InspectedElement): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.inspectedElements.set(element.id, element);
    session.updatedAt = Date.now();
    this.emit("element:registered", { sessionId, element });
  }

  /**
   * Select an element for editing
   */
  selectElement(sessionId: string, elementId: string | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.selectedElementId = elementId;
    session.updatedAt = Date.now();
    this.emit("element:selected", { sessionId, elementId });
  }

  /**
   * Apply a visual property change
   */
  async applyPropertyChange(
    sessionId: string,
    change: VisualPropertyChange
  ): Promise<{ success: boolean; codeChange?: string; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    const element = session.inspectedElements.get(change.elementId);
    if (!element) {
      return { success: false, error: "Element not found" };
    }

    // Add to pending changes
    session.pendingChanges.push(change);
    session.updatedAt = Date.now();

    // Generate code change if we have source location
    if (element.sourceLocation) {
      const codeChange = await this.generateCodeChange(element, change);
      if (codeChange) {
        return { success: true, codeChange };
      }
    }

    return { success: true };
  }

  /**
   * Generate code change for a visual property edit
   */
  private async generateCodeChange(
    element: InspectedElement,
    change: VisualPropertyChange
  ): Promise<string | null> {
    if (!element.sourceLocation || !this.codebaseIndexer) return null;

    try {
      // Read the source file
      const fileContent = await this.readSourceFile(element.sourceLocation.file);
      if (!fileContent) return null;

      // Use AST-based transformation
      const transformed = await this.transformSourceCode(
        fileContent,
        element.sourceLocation,
        change
      );

      return transformed;
    } catch (error) {
      console.error("[DesignMode] Failed to generate code change:", error);
      return null;
    }
  }

  /**
   * Read source file from project
   */
  private async readSourceFile(filePath: string): Promise<string | null> {
    try {
      const fs = await import("fs/promises");
      const fullPath = `${this.config.projectRoot}/${filePath}`;
      return await fs.readFile(fullPath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Transform source code using AST
   */
  private async transformSourceCode(
    source: string,
    location: SourceLocation,
    change: VisualPropertyChange
  ): Promise<string> {
    // For now, do a simple string-based replacement
    // In production, this would use babel/recast for proper AST transformation
    const lines = source.split("\n");
    const targetLine = lines[location.line - 1];

    if (change.type === "style" && change.property.startsWith("--")) {
      // CSS custom property - update in CSS file or style block
      return this.updateCSSVariable(source, location, change.property, change.value);
    }

    if (change.type === "prop" && elementHasClassName(targetLine)) {
      // Update className in JSX
      return this.updateClassName(lines, location, change);
    }

    return source;
  }

  private updateCSSVariable(
    source: string,
    location: SourceLocation,
    property: string,
    value: string
  ): string {
    const lines = source.split("\n");
    const lineIdx = location.line - 1;
    const line = lines[lineIdx];

    // Simple regex replacement for CSS variables
    const regex = new RegExp(`(${property}\\s*:\\s*)[^;]+`);
    if (regex.test(line)) {
      lines[lineIdx] = line.replace(regex, `$1${value}`);
    }
    return lines.join("\n");
  }

  private updateClassName(
    lines: string[],
    location: SourceLocation,
    change: VisualPropertyChange
  ): string {
    const lineIdx = location.line - 1;
    const line = lines[lineIdx];

    // Find className attribute and update Tailwind classes
    const classNameMatch = line.match(/className\s*=\s*["']([^"']*)["']/);
    if (classNameMatch) {
      const currentClasses = classNameMatch[1];
      const newClasses = this.updateTailwindClasses(currentClasses, change);
      lines[lineIdx] = line.replace(classNameMatch[1], newClasses);
    }

    return lines.join("\n");
  }

  private updateTailwindClasses(currentClasses: string, change: VisualPropertyChange): string {
    // Parse and update Tailwind classes based on change
    // This is simplified - real implementation would be more sophisticated
    const classes = currentClasses.split(" ").filter(Boolean);
    const property = change.property;
    const value = change.value;

    // Map design tokens to Tailwind classes
    if (change.designTokenPath) {
      const tokenClass = this.designTokenToTailwind(change.designTokenPath, value);
      if (tokenClass) {
        // Remove existing classes for this property
        const filtered = classes.filter(
          (c) => !this.isTailwindProperty(c, property)
        );
        filtered.push(tokenClass);
        return filtered.join(" ");
      }
    }

    return currentClasses;
  }

  private isTailwindProperty(className: string, property: string): boolean {
    const prefixes: Record<string, string[]> = {
      color: ["text-", "bg-", "border-", "ring-", "divide-", "placeholder-"],
      spacing: ["p-", "m-", "px-", "py-", "pt-", "pb-", "pl-", "pr-", "gap-", "space-"],
      typography: ["text-", "font-", "leading-", "tracking-"],
      borderRadius: ["rounded-"],
      shadow: ["shadow-"],
    };

    const relevantPrefixes = prefixes[property] || [];
    return relevantPrefixes.some((p) => className.startsWith(p));
  }

  private designTokenToTailwind(tokenPath: string, value: string): string | null {
    // Convert design token path to Tailwind class
    // e.g., "colors.primary.500" -> "text-primary-500" or "bg-primary-500"
    const parts = tokenPath.split(".");
    if (parts[0] === "colors" && parts[1] && parts[2]) {
      return `bg-${parts[1]}-${parts[2]}`;
    }
    if (parts[0] === "spacing" && parts[1]) {
      return `p-${parts[1]}`;
    }
    if (parts[0] === "typography" && parts[1] === "fontSize" && parts[2]) {
      return `text-${parts[2]}`;
    }
    return null;
  }

  /**
   * Build component registry by analyzing project files
   */
  private async buildComponentRegistry(): Promise<void> {
    if (!this.codebaseIndexer) return;

    try {
      // Search for component files
      const componentFiles = await this.findComponentFiles();

      for (const file of componentFiles) {
        const entry = await this.parseComponentFile(file);
        if (entry) {
          this.componentRegistry.set(entry.name, entry);
        }
      }

      this.emit("registry:built", { count: this.componentRegistry.size });
    } catch (error) {
      console.error("[DesignMode] Failed to build component registry:", error);
    }
  }

  private async findComponentFiles(): Promise<string[]> {
    if (!this.codebaseIndexer) return [];

    // Search for React/Vue/Svelte component files
    const results = await this.codebaseIndexer.search({
      query: "component",
      filters: {
        extensions: [".tsx", ".jsx", ".vue", ".svelte"],
        paths: ["src/components", "components", "ui"],
      },
      limit: 100,
    });

    return results.map((r) => r.file);
  }

  private async parseComponentFile(
    filePath: string
  ): Promise<ComponentRegistryEntry | null> {
    try {
      const content = await this.readSourceFile(filePath);
      if (!content) return null;

      // Extract component name, props, etc. using simple parsing
      // In production, would use proper AST parsing
      const nameMatch = content.match(
        /export\s+(?:default\s+)?(?:function|const)\s+(\w+)/
      );
      const name = nameMatch ? nameMatch[1] : filePath.split("/").pop()?.replace(/\.(tsx|jsx|vue|svelte)$/, "");

      if (!name) return null;

      // Extract props from TypeScript interface or JSDoc
      const props = this.extractPropsFromContent(content);

      return {
        name,
        filePath,
        displayName: name,
        category: this.inferCategory(filePath, content),
        props,
        exampleUsage: `<${name} />`,
        tags: this.inferTags(content),
      };
    } catch {
      return null;
    }
  }

  private extractPropsFromContent(content: string): ComponentProp[] {
    const props: ComponentProp[] = [];

    // Try to find Props interface
    const interfaceMatch = content.match(
      /interface\s+\w+Props\s*{([^}]+)}/s
    ) || content.match(/type\s+\w+Props\s*=\s*{([^}]+)}/s);

    if (interfaceMatch) {
      const propLines = interfaceMatch[1].split("\n");
      for (const line of propLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//")) continue;

        const propMatch = trimmed.match(
          /(\w+)(\?)?:\s*([^;]+);?/
        );
        if (propMatch) {
          const [, name, optional, type] = propMatch;
          props.push({
            name,
            type: type.trim(),
            required: !optional,
            controlType: this.inferControlType(name, type.trim()),
          });
        }
      }
    }

    // Also check for shadcn/ui component patterns
    if (content.includes("cva(") || content.includes("classVarianceAuthority")) {
      // This is likely a shadcn component - infer variant props
      this.inferShadcnProps(content, props);
    }

    return props;
  }

  private inferShadcnProps(content: string, props: ComponentProp[]): void {
    // Look for variant definitions
    const variantMatch = content.match(
      /cva\([^)]*variants:\s*{([^}]+)}/s
    );
    if (variantMatch) {
      const variantContent = variantMatch[1];
      const variantNames = variantContent.match(/(\w+):\s*{/g);
      if (variantNames) {
        for (const vn of variantNames) {
          const name = vn.replace(/:\s*{/, "").trim();
          if (!props.find((p) => p.name === name)) {
            props.push({
              name,
              type: "string",
              required: false,
              controlType: "enum",
              options: this.extractVariantOptions(variantContent, name),
            });
          }
        }
      }
    }
  }

  private extractVariantOptions(variantContent: string, variantName: string): string[] {
    const regex = new RegExp(
      `${variantName}:\\s*{([^}]+)}`
    );
    const match = variantContent.match(regex);
    if (match) {
      const options = match[1].match(/['"](\w+)['"]/g);
      return options ? options.map((o) => o.replace(/['"]/g, "")) : [];
    }
    return [];
  }

  private inferControlType(propName: string, propType: string): ComponentProp["controlType"] {
    const lowerName = propName.toLowerCase();
    const lowerType = propType.toLowerCase();

    if (lowerType.includes("boolean") || lowerType === "bool") return "boolean";
    if (lowerType.includes("number")) return "number";
    if (lowerName.includes("color") || lowerName.includes("background")) return "color";
    if (lowerName.includes("size") || lowerName.includes("spacing")) return "spacing";
    if (lowerName.includes("font") || lowerName.includes("typography")) return "typography";
    if (lowerType.includes("|") || lowerType.includes("union")) return "enum";

    return "string";
  }

  private inferCategory(filePath: string, content: string): string {
    const path = filePath.toLowerCase();
    if (path.includes("button")) return "button";
    if (path.includes("input") || path.includes("form")) return "form";
    if (path.includes("card")) return "card";
    if (path.includes("dialog") || path.includes("modal")) return "dialog";
    if (path.includes("nav") || path.includes("menu")) return "navigation";
    if (path.includes("table") || path.includes("grid")) return "data-display";
    if (content.includes("shadcn") || content.includes("radix")) return "shadcn-ui";
    return "custom";
  }

  private inferTags(content: string): string[] {
    const tags: string[] = [];
    if (content.includes("forwardRef")) tags.push("forward-ref");
    if (content.includes("cva(") || content.includes("classVarianceAuthority")) tags.push("shadcn");
    if (content.includes("radix")) tags.push("radix");
    if (content.includes("react")) tags.push("react");
    if (content.includes("vue")) tags.push("vue");
    if (content.includes("svelte")) tags.push("svelte");
    return tags;
  }

  /**
   * Extract design tokens from project files
   */
  async extractDesignTokensFromProject(): Promise<DesignTokenExtractionResult> {
    const warnings: string[] = [];
    const sourceFiles: string[] = [];
    let tokens: DesignTokens = { ...defaultDesignTokens };
    let extractedFrom: DesignTokenExtractionResult["extractedFrom"] = "mixed";

    try {
      // 1. Try to read tailwind.config.ts/js
      const tailwindConfig = await this.readTailwindConfig();
      if (tailwindConfig) {
        const extracted = this.extractTokensFromTailwindConfig(tailwindConfig);
        tokens = this.mergeTokens(tokens, extracted);
        sourceFiles.push("tailwind.config.ts");
        extractedFrom = "tailwind";
      }

      // 2. Try to read CSS files for custom properties
      const cssFiles = await this.findCSSFiles();
      for (const cssFile of cssFiles) {
        const content = await this.readSourceFile(cssFile);
        if (content) {
          const extracted = this.extractTokensFromCSS(content);
          if (Object.keys(extracted.colors || {}).length > 0) {
            tokens = this.mergeTokens(tokens, extracted);
            sourceFiles.push(cssFile);
            extractedFrom = "css";
          }
        }
      }

      // 3. Try to read design token config files
      const tokenConfigFiles = await this.findTokenConfigFiles();
      for (const configFile of tokenConfigFiles) {
        const content = await this.readSourceFile(configFile);
        if (content) {
          const extracted = this.parseTokenConfig(content);
          tokens = this.mergeTokens(tokens, extracted);
          sourceFiles.push(configFile);
          extractedFrom = "config";
        }
      }
    } catch (error) {
      warnings.push(`Extraction error: ${error}`);
    }

    return { tokens, sourceFiles, warnings, extractedFrom };
  }

  private async readTailwindConfig(): Promise<string | null> {
    const possiblePaths = [
      "tailwind.config.ts",
      "tailwind.config.js",
      "tailwind.config.cjs",
      "tailwind.config.mjs",
    ];

    for (const path of possiblePaths) {
      const content = await this.readSourceFile(path);
      if (content) return content;
    }
    return null;
  }

  private extractTokensFromTailwindConfig(config: string): Partial<DesignTokens> {
    // Simplified extraction - real implementation would parse the config properly
    const tokens: Partial<DesignTokens> = { colors: {} as any };

    // Extract theme.extend.colors
    const colorMatch = config.match(
      /theme:\s*{[\s\S]*?extend:\s*{[\s\S]*?colors:\s*{([\s\S]*?)}}/
    );
    if (colorMatch) {
      // Would parse the color object here
    }

    return tokens;
  }

  private async findCSSFiles(): Promise<string[]> {
    if (!this.codebaseIndexer) return [];

    const results = await this.codebaseIndexer.search({
      query: "css custom properties",
      filters: { extensions: [".css", ".scss", ".sass", ".less"] },
      limit: 20,
    });

    return results.map((r) => r.file);
  }

  private extractTokensFromCSS(css: string): Partial<DesignTokens> {
    const tokens: Partial<DesignTokens> = {
      colors: {} as any,
      spacing: {},
      typography: { fontFamily: {}, fontSize: {}, fontWeight: {}, lineHeight: {}, letterSpacing: {} },
    };

    // Extract CSS custom properties
    const rootMatch = css.match(/:root\s*{([^}]+)}/s) || css.match(/@layer\s+base\s*{([^}]+)}/s);
    if (rootMatch) {
      const props = rootMatch[1];
      const varMatches = props.matchAll(/--([^:]+):\s*([^;]+);/g);

      for (const match of varMatches) {
        const [, name, value] = match;
        this.assignCSSVariableToTokens(tokens, name.trim(), value.trim());
      }
    }

    return tokens;
  }

  private assignCSSVariableToTokens(
    tokens: Partial<DesignTokens>,
    name: string,
    value: string
  ): void {
    // Map CSS variable names to design token paths
    // e.g., --color-primary-500 -> colors.primary.500
    const parts = name.split("-");
    if (parts[0] === "color" && parts[1] && parts[2]) {
      if (!tokens.colors) tokens.colors = {} as any;
      if (!tokens.colors[parts[1]]) tokens.colors[parts[1]] = {} as any;
      (tokens.colors[parts[1]] as any)[parts[2]] = value;
    } else if (parts[0] === "spacing" && parts[1]) {
      if (!tokens.spacing) tokens.spacing = {};
      tokens.spacing[parts[1]] = value;
    }
    // ... more mappings
  }

  private async findTokenConfigFiles(): Promise<string[]> {
    const possibleNames = [
      "design-tokens.json",
      "tokens.json",
      "design-system.json",
      ".design-tokens.json",
    ];

    const found: string[] = [];
    for (const name of possibleNames) {
      const content = await this.readSourceFile(name);
      if (content) found.push(name);
    }
    return found;
  }

  private parseTokenConfig(content: string): Partial<DesignTokens> {
    try {
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private mergeTokens(
    base: DesignTokens,
    overlay: Partial<DesignTokens>
  ): DesignTokens {
    // Deep merge tokens
    return {
      ...base,
      ...overlay,
      colors: { ...base.colors, ...overlay.colors },
      spacing: { ...base.spacing, ...overlay.spacing },
      typography: { ...base.typography, ...overlay.typography },
      borderRadius: { ...base.borderRadius, ...overlay.borderRadius },
      shadows: { ...base.shadows, ...overlay.shadows },
      breakpoints: { ...base.breakpoints, ...overlay.breakpoints },
      zIndex: { ...base.zIndex, ...overlay.zIndex },
      transitions: { ...base.transitions, ...overlay.transitions },
      animation: { ...base.animation, ...overlay.animation },
    };
  }

  /**
   * Get component registry
   */
  getComponentRegistry(): ComponentRegistryEntry[] {
    return Array.from(this.componentRegistry.values());
  }

  /**
   * Get design tokens
   */
  getDesignTokens(): DesignTokens {
    return this.designTokens;
  }

  /**
   * Update design tokens (propagates to all components)
   */
  updateDesignTokens(tokens: Partial<DesignTokens>): void {
    this.designTokens = this.mergeTokens(this.designTokens, tokens);
    this.emit("tokens:updated", this.designTokens);
  }

  /**
   * Get visual controls for a prop based on design tokens
   */
  getVisualControlsForProp(prop: ComponentProp): VisualControlConfig | null {
    if (prop.controlType === "color" && prop.designTokenPath) {
      return {
        type: "color-picker",
        tokenPath: prop.designTokenPath,
        availableTokens: this.getColorTokenOptions(),
      };
    }
    if (prop.controlType === "spacing" && prop.designTokenPath) {
      return {
        type: "spacing-slider",
        tokenPath: prop.designTokenPath,
        availableTokens: this.getSpacingTokenOptions(),
      };
    }
    if (prop.controlType === "typography" && prop.designTokenPath) {
      return {
        type: "typography-select",
        tokenPath: prop.designTokenPath,
        availableTokens: this.getTypographyTokenOptions(),
      };
    }
    if (prop.controlType === "enum" && prop.options) {
      return {
        type: "select",
        options: prop.options,
      };
    }
    if (prop.controlType === "boolean") {
      return { type: "toggle" };
    }
    return null;
  }

  private getColorTokenOptions(): string[] {
    const options: string[] = [];
    if (this.designTokens.colors) {
      for (const [palette, shades] of Object.entries(this.designTokens.colors)) {
        if (typeof shades === "object" && shades !== null) {
          for (const shade of Object.keys(shades)) {
            options.push(`colors.${palette}.${shade}`);
          }
        }
      }
    }
    return options;
  }

  private getSpacingTokenOptions(): string[] {
    return Object.keys(this.designTokens.spacing || {});
  }

  private getTypographyTokenOptions(): string[] {
    const options: string[] = [];
    if (this.designTokens.typography?.fontSize) {
      for (const size of Object.keys(this.designTokens.typography.fontSize)) {
        options.push(`typography.fontSize.${size}`);
      }
    }
    return options;
  }

  /**
   * Shutdown engine
   */
  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.active = false;
    }
    this.sessions.clear();
    this.componentRegistry.clear();
    if (this.codebaseIndexer) {
      // Indexer shutdown if needed
    }
    this.initialized = false;
    this.emit("shutdown");
  }
}

// ============================================================================
// Visual Control Config
// ============================================================================

export interface VisualControlConfig {
  type: "color-picker" | "spacing-slider" | "typography-select" | "select" | "toggle" | "input";
  tokenPath?: string;
  availableTokens?: string[];
  options?: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

function elementHasClassName(line: string): boolean {
  return /className\s*=/.test(line);
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createDesignModeEngine(
  projectId: string,
  projectRoot: string,
  options?: Partial<DesignModeConfig>
): Promise<DesignModeEngine> {
  const engine = new DesignModeEngine({
    projectId,
    projectRoot,
    enableDesignTokenExtraction: true,
    enableComponentRegistry: true,
    ...options,
  });

  await engine.initialize();
  return engine;
}

export default DesignModeEngine;