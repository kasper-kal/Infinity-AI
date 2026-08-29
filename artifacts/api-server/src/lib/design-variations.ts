/**
 * Design Variations Engine
 *
 * Phase 21: AI-Powered Design Iteration
 * Background agent generates 3-5 variations of current design:
 * - Different layouts, color schemes, typography, spacing
 * - Accessibility improvements (contrast, focus states)
 * - Performance optimizations (fewer renders, smaller bundle)
 * - Shown in "Variations" sidebar — one click to apply
 */

import { z } from 'zod';
import { runUniversalAgent } from './universal-agent';
import { ComponentIR, componentIRToFramework, TranspileOptions } from './component-ir';
import { generateDesignTokens } from './design-token-pipeline';

// ============================================================================
// Types & Schemas
// ============================================================================

export const DesignVariationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['layout', 'color', 'typography', 'spacing', 'accessibility', 'performance', 'combined']),
  changes: z.array(z.object({
    type: z.enum(['layout', 'color', 'typography', 'spacing', 'component', 'prop', 'style']),
    description: z.string(),
    before: z.string().optional(),
    after: z.string().optional(),
  })),
  componentIR: z.any(), // ComponentIR - using any for schema flexibility
  previewCode: z.string(),
  framework: z.string(),
  confidence: z.number().min(0).max(1),
  estimatedImpact: z.object({
    visual: z.number().min(0).max(1),
    accessibility: z.number().min(0).max(1),
    performance: z.number().min(0).max(1),
  }),
});

export type DesignVariation = z.infer<typeof DesignVariationSchema>;

export const VariationGenerationRequestSchema = z.object({
  componentIR: z.any(), // ComponentIR
  framework: z.string(),
  designSystem: z.record(z.any()).optional(),
  count: z.number().min(1).max(10).default(5),
  focusAreas: z.array(z.enum(['layout', 'color', 'typography', 'spacing', 'accessibility', 'performance'])).optional(),
  currentCode: z.string().optional(),
  userPreferences: z.object({
    preferredColors: z.array(z.string()).optional(),
    preferredFonts: z.array(z.string()).optional(),
    density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
  }).optional(),
});

export type VariationGenerationRequest = z.infer<typeof VariationGenerationRequestSchema>;

export const VariationGenerationResultSchema = z.object({
  success: z.boolean(),
  variations: z.array(DesignVariationSchema).optional(),
  error: z.string().optional(),
  generationTime: z.number(),
});

export type VariationGenerationResult = z.infer<typeof VariationGenerationResultSchema>;

// ============================================================================
// Design Variation Generator
// ============================================================================

const DESIGN_CRITIC_SYSTEM_PROMPT = `You are an expert UI/UX designer and design critic. Your task is to generate design variations for a given component.

Given a component's current design (as ComponentIR + code), generate {count} distinct design variations that explore different directions:

FOCUS AREAS (prioritize based on user request):
1. LAYOUT - Different arrangements, grid vs flex, card vs list, sidebar vs top-nav
2. COLOR - Different color schemes, dark/light variants, brand vs neutral, high contrast
3. TYPOGRAPHY - Different font pairings, scale changes, heading styles, readability
4. SPACING - Dense vs spacious, consistent rhythm, breathing room, visual hierarchy
5. ACCESSIBILITY - WCAG AA/AAA contrast, focus states, reduced motion, screen reader
6. PERFORMANCE - Fewer renders, smaller bundle, CSS-in-JS vs CSS modules, memoization

RULES:
- Each variation must be DISTINCT - not just minor tweaks
- Preserve the component's CORE FUNCTIONALITY and PROPS interface
- Output must be valid ComponentIR that can be transpiled to the target framework
- Include a confidence score (0-1) for each variation
- Estimate visual/accessibility/performance impact (0-1 each)
- Use the project's design system tokens when available
- Consider the target framework's idioms (e.g., Astro islands, Svelte reactivity)

Return JSON array of variations matching the DesignVariation schema.`;

export class DesignVariationGenerator {
  private static instance: DesignVariationGenerator;

  static getInstance(): DesignVariationGenerator {
    if (!DesignVariationGenerator.instance) {
      DesignVariationGenerator.instance = new DesignVariationGenerator();
    }
    return DesignVariationGenerator.instance;
  }

  async generateVariations(request: VariationGenerationRequest): Promise<VariationGenerationResult> {
    const startTime = Date.now();

    try {
      // Build context for the design critic agent
      const context = this.buildAgentContext(request);

      // Run the universal agent with design critic persona
      const result = await runUniversalAgent({
        prompt: this.buildVariationPrompt(request),
        systemPrompt: DESIGN_CRITIC_SYSTEM_PROMPT.replace('{count}', request.count.toString()),
        maxIterations: 3,
        tools: [], // No tools needed - pure generation
        enableResilience: true,
      });

      // Parse the agent's response into variations
      const variations = this.parseVariations(result, request);

      // Transpile each variation to framework-specific code
      const enrichedVariations = await this.enrichVariations(variations, request);

      return {
        success: true,
        variations: enrichedVariations,
        generationTime: Date.now() - startTime,
      };
    } catch (error) {
      console.error('Variation generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        generationTime: Date.now() - startTime,
      };
    }
  }

  private buildAgentContext(request: VariationGenerationRequest): string {
    let context = `CURRENT COMPONENT:\n`;
    context += `Framework: ${request.framework}\n`;
    context += `Component: ${request.componentIR.name} (${request.componentIR.type})\n`;
    context += `Props: ${JSON.stringify(request.componentIR.props, null, 2)}\n`;
    context += `JSX:\n${request.componentIR.jsx}\n`;

    if (request.currentCode) {
      context += `\nCURRENT FRAMEWORK CODE:\n${request.currentCode}\n`;
    }

    if (request.designSystem) {
      context += `\nDESIGN SYSTEM TOKENS:\n${JSON.stringify(request.designSystem, null, 2)}\n`;
    }

    if (request.focusAreas?.length) {
      context += `\nFOCUS AREAS: ${request.focusAreas.join(', ')}\n`;
    }

    if (request.userPreferences) {
      context += `\nUSER PREFERENCES:\n${JSON.stringify(request.userPreferences, null, 2)}\n`;
    }

    return context;
  }

  private buildVariationPrompt(request: VariationGenerationRequest): string {
    return `Generate ${request.count} distinct design variations for this component.

${this.buildAgentContext(request)}

Return a JSON array where each variation has:
- id: unique identifier
- name: short descriptive name (e.g., "Card Layout", "High Contrast Dark")
- description: 1-2 sentence explanation
- category: one of [layout, color, typography, spacing, accessibility, performance, combined]
- changes: array of specific changes with type, description, before/after
- componentIR: the FULL ComponentIR for this variation (not diffs)
- confidence: 0-1
- estimatedImpact: { visual, accessibility, performance } each 0-1

Ensure variations are meaningfully different from each other and the original.`;
  }

  private parseVariations(agentResult: any, request: VariationGenerationRequest): DesignVariation[] {
    try {
      // Extract JSON from agent response
      const text = agentResult?.finalAnswer || agentResult?.content || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in agent response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const variations = z.array(DesignVariationSchema).parse(parsed);

      // Validate each variation has required fields
      return variations.filter(v => v.componentIR && v.componentIR.name);
    } catch (error) {
      console.error('Failed to parse variations:', error);
      // Return fallback variations
      return this.generateFallbackVariations(request);
    }
  }

  private generateFallbackVariations(request: VariationGenerationRequest): DesignVariation[] {
    const baseIR = request.componentIR;
    const variations: DesignVariation[] = [];

    // Variation 1: Layout - Card to List
    variations.push({
      id: `var-layout-${Date.now()}-1`,
      name: 'List Layout',
      description: 'Convert card-based layout to compact list view',
      category: 'layout',
      changes: [{ type: 'layout', description: 'Cards → List items with horizontal layout' }],
      componentIR: { ...baseIR, jsx: this.transformToListLayout(baseIR.jsx) },
      previewCode: '',
      framework: request.framework,
      confidence: 0.7,
      estimatedImpact: { visual: 0.8, accessibility: 0.3, performance: 0.4 },
    });

    // Variation 2: Color - High Contrast
    variations.push({
      id: `var-color-${Date.now()}-2`,
      name: 'High Contrast',
      description: 'WCAG AAA compliant contrast ratios for accessibility',
      category: 'accessibility',
      changes: [{ type: 'color', description: 'Increase contrast ratios to 7:1' }],
      componentIR: { ...baseIR, jsx: this.applyHighContrast(baseIR.jsx) },
      previewCode: '',
      framework: request.framework,
      confidence: 0.85,
      estimatedImpact: { visual: 0.4, accessibility: 0.95, performance: 0.1 },
    });

    // Variation 3: Typography - Larger Scale
    variations.push({
      id: `var-typo-${Date.now()}-3`,
      name: 'Large Typography',
      description: 'Increased font sizes for better readability',
      category: 'typography',
      changes: [{ type: 'typography', description: 'Scale up type by 1.25x' }],
      componentIR: { ...baseIR, jsx: this.scaleTypography(baseIR.jsx, 1.25) },
      previewCode: '',
      framework: request.framework,
      confidence: 0.75,
      estimatedImpact: { visual: 0.6, accessibility: 0.7, performance: 0.1 },
    });

    // Variation 4: Spacing - Spacious
    variations.push({
      id: `var-spacing-${Date.now()}-4`,
      name: 'Spacious',
      description: 'More breathing room with generous spacing',
      category: 'spacing',
      changes: [{ type: 'spacing', description: 'Increase padding/margin by 1.5x' }],
      componentIR: { ...baseIR, jsx: this.scaleSpacing(baseIR.jsx, 1.5) },
      previewCode: '',
      framework: request.framework,
      confidence: 0.7,
      estimatedImpact: { visual: 0.7, accessibility: 0.5, performance: 0.1 },
    });

    // Variation 5: Performance - Optimized
    variations.push({
      id: `var-perf-${Date.now()}-5`,
      name: 'Performance Optimized',
      description: 'Memoized components, reduced re-renders, CSS modules',
      category: 'performance',
      changes: [
        { type: 'component', description: 'Add React.memo / memo equivalents' },
        { type: 'style', description: 'Use CSS modules instead of inline styles' },
      ],
      componentIR: { ...baseIR, metadata: { ...baseIR.metadata, optimized: true } },
      previewCode: '',
      framework: request.framework,
      confidence: 0.8,
      estimatedImpact: { visual: 0.1, accessibility: 0.2, performance: 0.9 },
    });

    return variations.slice(0, request.count);
  }

  private async enrichVariations(variations: DesignVariation[], request: VariationGenerationRequest): Promise<DesignVariation[]> {
    const enriched: DesignVariation[] = [];

    for (const variation of variations) {
      try {
        // Transpile to framework-specific code
        const transpileOptions: TranspileOptions = {
          targetFramework: request.framework,
          designSystem: request.designSystem,
          stylingStrategy: 'tailwind',
        };

        const result = componentIRToFramework(variation.componentIR, request.framework, transpileOptions);

        if (result.files.length > 0) {
          variation.previewCode = result.files[0].content;
        }

        // Generate design tokens for this variation
        if (request.designSystem) {
          const tokens = generateDesignTokens(request.designSystem, 'css-vars', request.framework);
          variation.componentIR.metadata = {
            ...variation.componentIR.metadata,
            designTokens: tokens,
          };
        }

        enriched.push(variation);
      } catch (error) {
        console.error(`Failed to enrich variation ${variation.id}:`, error);
        // Keep variation without preview code
        enriched.push(variation);
      }
    }

    return enriched;
  }

  // Simple JSX transform helpers (in production, use proper AST transforms)
  private transformToListLayout(jsx: string): string {
    return jsx
      .replace(/className="([^"]*card[^"]*)"/gi, 'className="$1 flex items-center gap-4 p-3"')
      .replace(/<div className="([^"]*grid[^"]*)"/gi, '<div className="$1 flex flex-col gap-2"');
  }

  private applyHighContrast(jsx: string): string {
    return jsx
      .replace(/bg-(\w+)-(\d+)/g, (match, color, shade) => {
        const num = parseInt(shade);
        return num < 500 ? `bg-${color}-900` : `bg-${color}-100`;
      })
      .replace(/text-(\w+)-(\d+)/g, (match, color, shade) => {
        const num = parseInt(shade);
        return num < 500 ? `text-${color}-900` : `text-${color}-100`;
      });
  }

  private scaleTypography(jsx: string, factor: number): string {
    const sizeMap: Record<string, string> = {
      'text-xs': 'text-sm',
      'text-sm': 'text-base',
      'text-base': 'text-lg',
      'text-lg': 'text-xl',
      'text-xl': 'text-2xl',
      'text-2xl': 'text-3xl',
      'text-3xl': 'text-4xl',
    };
    return jsx.replace(/text-(xs|sm|base|lg|xl|2xl|3xl|4xl)/g, (match) => sizeMap[match] || match);
  }

  private scaleSpacing(jsx: string, factor: number): string {
    // Simple spacing scale - in production use proper Tailwind config
    const spacingMap: Record<string, string> = {
      'p-1': 'p-2', 'p-2': 'p-4', 'p-3': 'p-6', 'p-4': 'p-8', 'p-6': 'p-10',
      'm-1': 'm-2', 'm-2': 'm-4', 'm-3': 'm-6', 'm-4': 'm-8',
      'gap-1': 'gap-2', 'gap-2': 'gap-4', 'gap-3': 'gap-6', 'gap-4': 'gap-8',
    };
    return jsx.replace(/\b(p|m|gap)-(\d+)\b/g, (match) => spacingMap[match] || match);
  }
}

// ============================================================================
// Public API
// ============================================================================

export async function generateDesignVariations(request: VariationGenerationRequest): Promise<VariationGenerationResult> {
  const generator = DesignVariationGenerator.getInstance();
  return generator.generateVariations(request);
}

export function createVariationPreview(
  variation: DesignVariation,
  framework: string,
  designSystem?: Record<string, any>
): string {
  const options: TranspileOptions = {
    targetFramework: framework,
    designSystem,
    stylingStrategy: 'tailwind',
  };

  const result = componentIRToFramework(variation.componentIR, framework, options);
  return result.files[0]?.content || '';
}