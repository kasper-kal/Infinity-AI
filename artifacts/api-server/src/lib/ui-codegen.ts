/**
 * UI Code Generation Engine
 *
 * Generates production-ready React/Next.js components with shadcn/ui + Tailwind
 * from natural language prompts. Supports iterative refinement and multi-file generation.
 */

import { z } from 'zod';
import { getLLMAdapter } from './llm-adapter.js';

// ============================================================================
// Types & Schemas
// ============================================================================

export const UIComponentSchema = z.object({
  name: z.string(),
  description: z.string(),
  code: z.string(),
  imports: z.array(z.string()).default([]),
  exports: z.array(z.string()).default(['default']),
  dependencies: z.array(z.string()).default([]),
  designTokens: z.object({
    colors: z.record(z.string()).optional(),
    spacing: z.record(z.string()).optional(),
    typography: z.record(z.string()).optional(),
  }).optional(),
});

export const UIGenerationRequestSchema = z.object({
  prompt: z.string(),
  context: z.object({
    projectId: z.string().optional(),
    framework: z.enum(['nextjs', 'vite', 'astro', 'remix']).default('nextjs'),
    existingComponents: z.array(z.string()).optional(),
    designSystem: z.object({
      colors: z.record(z.string()).optional(),
      spacing: z.record(z.string()).optional(),
      typography: z.record(z.string()).optional(),
      borderRadius: z.record(z.string()).optional(),
      shadows: z.record(z.string()).optional(),
    }).optional(),
    targetFiles: z.array(z.string()).optional(),
  }).optional(),
  options: z.object({
    streaming: z.boolean().default(true),
    includeTypes: z.boolean().default(true),
    includeTests: z.boolean().default(false),
    includeStorybook: z.boolean().default(false),
    accessibility: z.boolean().default(true),
    performance: z.boolean().default(true),
  }).optional(),
});

export const UIGenerationResponseSchema = z.object({
  components: z.array(UIComponentSchema),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
    type: z.enum(['component', 'page', 'style', 'type', 'test', 'config']),
  })),
  preview: z.object({
    html: z.string(),
    css: z.string(),
    js: z.string(),
  }).optional(),
  metadata: z.object({
    model: z.string(),
    tokensUsed: z.number(),
    generationTime: z.number(),
    warnings: z.array(z.string()).default([]),
  }),
});

export type UIComponent = z.infer<typeof UIComponentSchema>;
export type UIGenerationRequest = z.infer<typeof UIGenerationRequestSchema>;
export type UIGenerationResponse = z.infer<typeof UIGenerationResponseSchema>;

// ============================================================================
// Shadcn/UI Component Registry
// ============================================================================

export const SHADCN_COMPONENTS = {
  // Form components
  'button': { imports: ['@/components/ui/button'], variants: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] },
  'input': { imports: ['@/components/ui/input'] },
  'textarea': { imports: ['@/components/ui/textarea'] },
  'select': { imports: ['@/components/ui/select'] },
  'checkbox': { imports: ['@/components/ui/checkbox'] },
  'radio-group': { imports: ['@/components/ui/radio-group'] },
  'switch': { imports: ['@/components/ui/switch'] },
  'slider': { imports: ['@/components/ui/slider'] },
  'form': { imports: ['@/components/ui/form'] },
  'label': { imports: ['@/components/ui/label'] },

  // Layout components
  'card': { imports: ['@/components/ui/card'], variants: ['default', 'header', 'content', 'footer'] },
  'separator': { imports: ['@/components/ui/separator'] },
  'aspect-ratio': { imports: ['@/components/ui/aspect-ratio'] },
  'container': { imports: ['@/components/ui/container'] },

  // Navigation components
  'navigation-menu': { imports: ['@/components/ui/navigation-menu'] },
  'breadcrumb': { imports: ['@/components/ui/breadcrumb'] },
  'pagination': { imports: ['@/components/ui/pagination'] },
  'tabs': { imports: ['@/components/ui/tabs'] },
  'sidebar': { imports: ['@/components/ui/sidebar'] },

  // Data display
  'table': { imports: ['@/components/ui/table'] },
  'badge': { imports: ['@/components/ui/badge'] },
  'avatar': { imports: ['@/components/ui/avatar'] },
  'progress': { imports: ['@/components/ui/progress'] },
  'skeleton': { imports: ['@/components/ui/skeleton'] },
  'tooltip': { imports: ['@/components/ui/tooltip'] },
  'popover': { imports: ['@/components/ui/popover'] },
  'hover-card': { imports: ['@/components/ui/hover-card'] },

  // Feedback components
  'alert': { imports: ['@/components/ui/alert'], variants: ['default', 'destructive'] },
  'alert-dialog': { imports: ['@/components/ui/alert-dialog'] },
  'dialog': { imports: ['@/components/ui/dialog'] },
  'drawer': { imports: ['@/components/ui/drawer'] },
  'sheet': { imports: ['@/components/ui/sheet'] },
  'toast': { imports: ['@/components/ui/toast'], hooks: ['useToast'] },
  'sonner': { imports: ['sonner'], external: true },

  // Overlay components
  'dropdown-menu': { imports: ['@/components/ui/dropdown-menu'] },
  'context-menu': { imports: ['@/components/ui/context-menu'] },
  'menubar': { imports: ['@/components/ui/menubar'] },
  'combobox': { imports: ['@/components/ui/combobox'] },
  'command': { imports: ['@/components/ui/command'] },

  // Advanced components
  'accordion': { imports: ['@/components/ui/accordion'] },
  'collapsible': { imports: ['@/components/ui/collapsible'] },
  'resizable': { imports: ['@/components/ui/resizable'] },
  'scroll-area': { imports: ['@/components/ui/scroll-area'] },
  'carousel': { imports: ['@/components/ui/carousel'] },
  'calendar': { imports: ['@/components/ui/calendar'] },
  'date-picker': { imports: ['@/components/ui/date-picker'] },

  // Typography
  'typography': { imports: ['@/components/ui/typography'] },
} as const;

export type ShadcnComponent = keyof typeof SHADCN_COMPONENTS;

// ============================================================================
// Prompt Templates
// ============================================================================

const SYSTEM_PROMPT = `You are an expert React/Next.js developer specializing in building beautiful, accessible, and performant UI components using shadcn/ui and Tailwind CSS.

## Core Principles
1. **Design System First** - Always use design tokens (colors, spacing, typography) from the project's design system
2. **shadcn/ui Native** - Prefer shadcn/ui components over custom implementations
3. **TypeScript Strict** - All code must be strictly typed, no \`any\`
4. **Accessibility by Default** - Semantic HTML, ARIA attributes, keyboard navigation, focus management
5. **Performance Conscious** - Memoization, lazy loading, code splitting hints
6. **Responsive Design** - Mobile-first, works at all breakpoints
7. **Clean Architecture** - Separation of concerns, reusable components, composable APIs

## Component Structure
- Each component in its own file
- Co-located types and utilities
- Barrel exports from index.ts
- CSS variables for theming (light/dark mode)
- Forward refs for composition

## Available shadcn/ui Components
${Object.entries(SHADCN_COMPONENTS).map(([name, config]) =>
  `- \`${name}\`: ${config.imports.join(', ')}${config.variants ? ` (variants: ${config.variants.join(', ')})` : ''}`
).join('\n')}

## Code Generation Rules
1. Generate complete, runnable components
2. Include all necessary imports
3. Use Tailwind CSS utility classes
4. Follow shadcn/ui patterns exactly
5. Export TypeScript interfaces for props
6. Include JSDoc comments for complex components
7. Handle loading, error, and empty states
8. Use \`cn\` utility for className merging

## Response Format
Return a JSON object matching the UIGenerationResponse schema with:
- components: Array of generated components
- files: Array of file objects with path, content, type
- preview: Optional HTML/CSS/JS for live preview
- metadata: Generation info`;

const REFINEMENT_PROMPT = `You are refining an existing UI component based on user feedback.

## Current Component
{{currentCode}}

## User Request
{{refinementPrompt}}

## Instructions
1. Apply the requested changes precisely
2. Maintain existing patterns and conventions
3. Preserve TypeScript types and accessibility
4. Keep the component working and valid
5. Return the complete updated component

## Response Format
Same as initial generation - complete UIGenerationResponse`;

const MULTI_FILE_PROMPT = `You are generating a multi-file UI feature from a natural language description.

## Request
{{prompt}}

## Context
{{context}}

## Requirements
Generate a complete feature including:
1. **Page/Route** - Main entry point (page.tsx, route.tsx, etc.)
2. **Components** - Reusable UI components
3. **Types** - TypeScript interfaces/types
4. **Styles** - Any additional CSS/Tailwind config
5. **Hooks** - Custom React hooks if needed
6. **Utils** - Helper functions

## File Structure (Next.js App Router example)
\`\`\`
app/
  (feature)/
    page.tsx              # Main page
    layout.tsx            # Feature layout
    components/
      FeatureComponent.tsx
      SubComponent.tsx
    hooks/
      useFeature.ts
    types/
      feature.ts
    utils/
      helpers.ts
\`\`\`

## Response Format
Same UIGenerationResponse with files array containing all generated files`;

// ============================================================================
// UI Codegen Engine Class
// ============================================================================

export class UICodegenEngine {
  private adapter = getLLMAdapter();
  private model = 'anthropic/claude-3.5-sonnet'; // Best for code generation

  /**
   * Generate UI components from natural language prompt
   */
  async generate(request: UIGenerationRequest): Promise<UIGenerationResponse> {
    const startTime = Date.now();
    const { prompt, context, options = {} } = request;

    // Build context-aware prompt
    const fullPrompt = this.buildPrompt(prompt, context);

    // Generate using LLM
    const response = await this.adapter.generateObject({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: fullPrompt,
      schema: UIGenerationResponseSchema,
      temperature: 0.2,
      maxTokens: 8000,
    });

    const result = response.object;

    // Post-process: validate, enhance, add preview
    const enhanced = await this.postProcess(result, context);

    return {
      ...enhanced,
      metadata: {
        ...enhanced.metadata,
        generationTime: Date.now() - startTime,
      },
    };
  }

  /**
   * Refine an existing component based on user feedback
   */
  async refine(
    currentCode: string,
    refinementPrompt: string,
    context?: UIGenerationRequest['context']
  ): Promise<UIGenerationResponse> {
    const fullPrompt = REFINEMENT_PROMPT
      .replace('{{currentCode}}', currentCode)
      .replace('{{refinementPrompt}}', refinementPrompt);

    const response = await this.adapter.generateObject({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: fullPrompt,
      schema: UIGenerationResponseSchema,
      temperature: 0.2,
      maxTokens: 8000,
    });

    return this.postProcess(response.object, context);
  }

  /**
   * Generate a multi-file feature
   */
  async generateFeature(request: UIGenerationRequest): Promise<UIGenerationResponse> {
    const { prompt, context } = request;

    const fullPrompt = MULTI_FILE_PROMPT
      .replace('{{prompt}}', prompt)
      .replace('{{context}}', JSON.stringify(context, null, 2));

    const response = await this.adapter.generateObject({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: fullPrompt,
      schema: UIGenerationResponseSchema,
      temperature: 0.2,
      maxTokens: 12000,
    });

    return this.postProcess(response.object, context);
  }

  /**
   * Build context-aware prompt
   */
  private buildPrompt(prompt: string, context?: UIGenerationRequest['context']): string {
    let fullPrompt = `## User Request\n${prompt}\n\n`;

    if (context) {
      fullPrompt += `## Project Context\n`;

      if (context.framework) {
        fullPrompt += `- Framework: ${context.framework}\n`;
      }

      if (context.designSystem) {
        fullPrompt += `- Design System:\n`;
        if (context.designSystem.colors) {
          fullPrompt += `  - Colors: ${JSON.stringify(context.designSystem.colors)}\n`;
        }
        if (context.designSystem.spacing) {
          fullPrompt += `  - Spacing: ${JSON.stringify(context.designSystem.spacing)}\n`;
        }
        if (context.designSystem.typography) {
          fullPrompt += `  - Typography: ${JSON.stringify(context.designSystem.typography)}\n`;
        }
        if (context.designSystem.borderRadius) {
          fullPrompt += `  - Border Radius: ${JSON.stringify(context.designSystem.borderRadius)}\n`;
        }
        if (context.designSystem.shadows) {
          fullPrompt += `  - Shadows: ${JSON.stringify(context.designSystem.shadows)}\n`;
        }
      }

      if (context.existingComponents?.length) {
        fullPrompt += `- Existing Components: ${context.existingComponents.join(', ')}\n`;
      }

      if (context.targetFiles?.length) {
        fullPrompt += `- Target Files: ${context.targetFiles.join(', ')}\n`;
      }
    }

    fullPrompt += `\n## Options\n`;
    fullPrompt += `- Streaming: ${true}\n`;
    fullPrompt += `- Include Types: ${true}\n`;
    fullPrompt += `- Accessibility: ${true}\n`;
    fullPrompt += `- Performance: ${true}\n`;

    fullPrompt += `\nGenerate a complete, production-ready implementation.`;

    return fullPrompt;
  }

  /**
   * Post-process generation result
   */
  private async postProcess(
    result: UIGenerationResponse,
    context?: UIGenerationRequest['context']
  ): Promise<UIGenerationResponse> {
    // Validate components
    const validatedComponents = result.components.map(comp => this.validateComponent(comp, context));

    // Generate preview HTML if not present
    let preview = result.preview;
    if (!preview && validatedComponents.length > 0) {
      preview = this.generatePreview(validatedComponents, context);
    }

    // Ensure all files have proper paths
    const files = result.files.map(file => ({
      ...file,
      path: this.normalizePath(file.path, context?.framework || 'nextjs'),
    }));

    return {
      components: validatedComponents,
      files,
      preview,
      metadata: {
        model: this.model,
        tokensUsed: result.metadata?.tokensUsed || 0,
        generationTime: result.metadata?.generationTime || 0,
        warnings: result.metadata?.warnings || [],
      },
    };
  }

  /**
   * Validate and enhance a component
   */
  private validateComponent(comp: UIComponent, context?: UIGenerationRequest['context']): UIComponent {
    // Ensure imports are properly formatted
    const imports = [...new Set(comp.imports)];

    // Add cn utility if className merging is used
    if (comp.code.includes('cn(') && !imports.some(i => i.includes('cn'))) {
      imports.unshift("import { cn } from '@/lib/utils'");
    }

    // Add React import if JSX is used
    if ((comp.code.includes('<') || comp.code.includes('jsx')) && !imports.some(i => i.includes('react'))) {
      imports.unshift("import * as React from 'react'");
    }

    return {
      ...comp,
      imports,
      code: this.formatCode(comp.code),
    };
  }

  /**
   * Format code with proper indentation
   */
  private formatCode(code: string): string {
    // Basic formatting - in production, use Prettier
    return code
      .trim()
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^ +/gm, (match) => '  '.repeat(Math.floor(match.length / 2)));
  }

  /**
   * Normalize file paths for framework
   */
  private normalizePath(path: string, framework: string): string {
    // Ensure paths use forward slashes
    return path.replace(/\\/g, '/');
  }

  /**
   * Generate preview HTML for live preview
   */
  private generatePreview(
    components: UIComponent[],
    context?: UIGenerationRequest['context']
  ): UIGenerationResponse['preview'] {
    const componentCode = components.map(c => c.code).join('\n\n');

    // Create a minimal HTML preview with React + Tailwind via CDN
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    body { margin: 0; padding: 2rem; min-height: 100vh; }
    #root { max-width: 1200px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    ${this.transformForPreview(componentCode)}

    const App = () => (
      <div className="space-y-8">
        ${components.map(c => `<${c.name} key="${c.name}" />`).join('\n        ')}
      </div>
    );

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
</body>`;

    return { html, css: '', js: '' };
  }

  /**
   * Transform component code for browser preview
   */
  private transformForPreview(code: string): string {
    // Remove import statements for preview (components defined inline)
    return code
      .split('\n')
      .filter(line => !line.trim().startsWith('import '))
      .join('\n');
  }

  /**
   * Get available shadcn/ui components for autocomplete
   */
  getAvailableComponents(): ShadcnComponent[] {
    return Object.keys(SHADCN_COMPONENTS) as ShadcnComponent[];
  }

  /**
   * Get component info for suggestions
   */
  getComponentInfo(name: ShadcnComponent) {
    return SHADCN_COMPONENTS[name];
  }

  /**
   * Detect which shadcn/ui components are referenced in a prompt
   */
  detectComponents(prompt: string): ShadcnComponent[] {
    const lowerPrompt = prompt.toLowerCase();
    const detected: ShadcnComponent[] = [];

    for (const component of Object.keys(SHADCN_COMPONENTS) as ShadcnComponent[]) {
      const keywords = [component.replace('-', ' '), component];
      if (keywords.some(k => lowerPrompt.includes(k))) {
        detected.push(component);
      }
    }

    return detected;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let uiCodegenInstance: UICodegenEngine | null = null;

export function getUICodegenEngine(): UICodegenEngine {
  if (!uiCodegenInstance) {
    uiCodegenInstance = new UICodegenEngine();
  }
  return uiCodegenInstance;
}

export const uiCodegen = getUICodegenEngine();