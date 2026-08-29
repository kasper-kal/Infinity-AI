/**
 * Design Suggestion Engine
 *
 * Phase 21: AI-Powered Design Iteration
 * Rules + LLM analysis of analytics → actionable fixes:
 * - "Users drop off at step 3 — simplify form"
 * - "Button contrast fails WCAG AA — here's a fix"
 * - "Mobile layout breaks at 375px — here's responsive fix"
 */

import { z } from 'zod';
import { runUniversalAgent } from './universal-agent';
import { getAnalyticsEngine, AnalyticsAggregates, FunnelConfig } from './design-analytics';

// ============================================================================
// Types & Schemas
// ============================================================================

export const DesignSuggestionSchema = z.object({
  id: z.string(),
  type: z.enum(['accessibility', 'performance', 'usability', 'conversion', 'mobile', 'visual']),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string(),
  description: z.string(),
  evidence: z.object({
    metric: z.string(),
    value: z.number(),
    threshold: z.number().optional(),
    comparison: z.string().optional(),
  }).optional(),
  affectedElements: z.array(z.object({
    selector: z.string(),
    issue: z.string(),
  })).optional(),
  fix: z.object({
    description: z.string(),
    codeChange: z.string().optional(), // Suggested code diff
    componentIRPatch: z.any().optional(), // ComponentIR patch for auto-apply
    confidence: z.number().min(0).max(1),
    effort: z.enum(['trivial', 'easy', 'moderate', 'hard']),
  }),
  source: z.enum(['rule', 'llm', 'hybrid']),
  createdAt: z.number(),
});

export type DesignSuggestion = z.infer<typeof DesignSuggestionSchema>;

export const SuggestionRequestSchema = z.object({
  projectId: z.string(),
  shareId: z.string().optional(),
  analytics: z.any(), // AnalyticsAggregates
  funnels: z.array(FunnelConfigSchema).optional(),
  componentIR: z.any().optional(), // Current component for context
  designSystem: z.record(z.any()).optional(),
  framework: z.string().optional(),
});

export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;

export const SuggestionResultSchema = z.object({
  success: z.boolean(),
  suggestions: z.array(DesignSuggestionSchema).optional(),
  error: z.string().optional(),
  generatedAt: z.number(),
});

export type SuggestionResult = z.infer<typeof SuggestionResultSchema>;

const FunnelConfigSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  steps: z.array(z.object({
    id: z.string(),
    name: z.string(),
    selector: z.string().optional(),
    url: z.string().optional(),
    eventType: z.enum(['click', 'form_submit', 'navigation', 'custom']),
  })),
  isActive: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// ============================================================================
// Rule-Based Suggestion Generators
// ============================================================================

interface RuleContext {
  analytics: AnalyticsAggregates;
  funnels?: FunnelConfig[];
  componentIR?: any;
  designSystem?: Record<string, any>;
  framework?: string;
}

function generateAccessibilitySuggestions(ctx: RuleContext): DesignSuggestion[] {
  const suggestions: DesignSuggestion[] = [];
  const { vitals, interactions } = ctx.analytics;

  // Check for missing Web Vitals (likely not instrumented)
  if (vitals.sampleCount === 0) {
    suggestions.push({
      id: `sug-a11y-instrument-${Date.now()}`,
      type: 'accessibility',
      severity: 'medium',
      title: 'Add Analytics Instrumentation',
      description: 'No Web Vitals data collected. Enable analytics to measure accessibility and performance.',
      fix: {
        description: 'Add the Infinity Analytics script to your preview/deployed app',
        confidence: 0.9,
        effort: 'trivial',
      },
      source: 'rule',
      createdAt: Date.now(),
    });
  }

  // Check CLS (Cumulative Layout Shift) - affects visual stability
  if (vitals.cls && vitals.cls.p75 > 0.1) {
    suggestions.push({
      id: `sug-a11y-cls-${Date.now()}`,
      type: 'accessibility',
      severity: 'high',
      title: 'High Cumulative Layout Shift (CLS)',
      description: `CLS p75 is ${vitals.cls.p75.toFixed(3)} (threshold: 0.1). Layout shifts hurt accessibility and user trust.`,
      evidence: { metric: 'CLS', value: vitals.cls.p75, threshold: 0.1 },
      fix: {
        description: 'Reserve space for dynamic content, avoid inserting content above existing, use aspect-ratio for images',
        codeChange: 'Add width/height to images, use CSS aspect-ratio, avoid late-loading fonts causing shifts',
        confidence: 0.85,
        effort: 'easy',
      },
      source: 'rule',
      createdAt: Date.now(),
    });
  }

  // Check LCP (Largest Contentful Paint) - affects perceived performance
  if (vitals.lcp && vitals.lcp.p75 > 2500) {
    suggestions.push({
      id: `sug-perf-lcp-${Date.now()}`,
      type: 'performance',
      severity: 'high',
      title: 'Slow Largest Contentful Paint (LCP)',
      description: `LCP p75 is ${vitals.lcp.p75}ms (threshold: 2500ms). Main content takes too long to appear.`,
      evidence: { metric: 'LCP', value: vitals.lcp.p75, threshold: 2500 },
      fix: {
        description: 'Optimize LCP element: preload hero image, reduce server response time, eliminate render-blocking resources',
        codeChange: 'Add <link rel="preload" as="image" href="hero.jpg">, use priority on hero image, inline critical CSS',
        confidence: 0.8,
        effort: 'moderate',
      },
      source: 'rule',
      createdAt: Date.now(),
    });
  }

  // Check FID/INP (Interaction responsiveness)
  const inp = vitals.inp?.p75 || vitals.fid?.p75;
  if (inp && inp > 200) {
    suggestions.push({
      id: `sug-perf-inp-${Date.now()}`,
      type: 'performance',
      severity: 'high',
      title: 'Poor Interaction Responsiveness (INP/FID)',
      description: `INP p75 is ${inp}ms (threshold: 200ms). Page feels sluggish on interaction.`,
      evidence: { metric: 'INP', value: inp, threshold: 200 },
      fix: {
        description: 'Break up long tasks, use web workers, optimize event handlers, defer non-critical JS',
        codeChange: 'Use useTransition/useDeferredValue, move heavy computation to web worker, debounce handlers',
        confidence: 0.75,
        effort: 'moderate',
      },
      source: 'rule',
      createdAt: Date.now(),
    });
  }

  // Check FCP (First Contentful Paint)
  if (vitals.fcp && vitals.fcp.p75 > 1800) {
    suggestions.push({
      id: `sug-perf-fcp-${Date.now()}`,
      type: 'performance',
      severity: 'medium',
      title: 'Slow First Contentful Paint (FCP)',
      description: `FCP p75 is ${vitals.fcp.p75}ms (threshold: 1800ms). First visual feedback is delayed.`,
      evidence: { metric: 'FCP', value: vitals.fcp.p75, threshold: 1800 },
      fix: {
        description: 'Inline critical CSS, preload key fonts, reduce server response time, use font-display: swap',
        confidence: 0.8,
        effort: 'easy',
      },
      source: 'rule',
      createdAt: Date.now(),
    });
  }

  return suggestions;
}

function generateFunnelSuggestions(ctx: RuleContext): DesignSuggestion[] {
  const suggestions: DesignSuggestion[] = [];
  const { funnels } = ctx.analytics;

  if (!funnels || funnels.length === 0) return suggestions;

  for (const funnel of funnels) {
    if (funnel.sessions < 10) continue; // Not enough data

    if (funnel.dropOffRate > 0.5) {
      suggestions.push({
        id: `sug-conv-funnel-${funnel.funnelId}-${Date.now()}`,
        type: 'conversion',
        severity: 'critical',
        title: `High Drop-off in "${funnel.funnelName}"`,
        description: `${(funnel.dropOffRate * 100).toFixed(1)}% of users drop off before completing the funnel.`,
        evidence: { metric: 'Funnel Drop-off', value: funnel.dropOffRate, threshold: 0.5 },
        affectedElements: funnel.stepDropOffs
          .filter(s => s.dropOffs > s.sessions * 0.3)
          .map(s => ({ selector: s.stepName, issue: `${((s.dropOffs / s.sessions) * 100).toFixed(0)}% drop-off at this step` })),
        fix: {
          description: 'Analyze the highest drop-off step. Common fixes: reduce form fields, clarify value prop, add progress indicator, fix validation errors',
          confidence: 0.8,
          effort: 'moderate',
        },
        source: 'rule',
        createdAt: Date.now(),
      });
    }

    // Find specific problematic step
    const worstStep = funnel.stepDropOffs
      .filter(s => s.sessions > 5)
      .sort((a, b) => (b.dropOffs / b.sessions) - (a.dropOffs / a.sessions))[0];

    if (worstStep && worstStep.dropOffs / worstStep.sessions > 0.4) {
      suggestions.push({
        id: `sug-conv-step-${funnel.funnelId}-${worstStep.stepIndex}-${Date.now()}`,
        type: 'usability',
        severity: 'high',
        title: `Step "${worstStep.stepName}" has ${((worstStep.dropOffs / worstStep.sessions) * 100).toFixed(0)}% drop-off`,
        description: `Users abandon at step ${worstStep.stepIndex + 1} (${worstStep.stepName}).`,
        evidence: { metric: 'Step Drop-off', value: worstStep.dropOffs / worstStep.sessions, threshold: 0.4 },
        affectedElements: [{ selector: worstStep.stepName, issue: 'High abandonment' }],
        fix: {
          description: 'Review this step: simplify form, improve copy, add inline validation, show progress, remove friction',
          confidence: 0.75,
          effort: 'moderate',
        },
        source: 'rule',
        createdAt: Date.now(),
      });
    }
  }

  return suggestions;
}

function generateInteractionSuggestions(ctx: RuleContext): DesignSuggestion[] {
  const suggestions: DesignSuggestion[] = [];
  const { interactions } = ctx.analytics;

  // Dead clicks (clicks on non-interactive elements)
  const clickEvents = interactions.byType['click'] || 0;
  const totalInteractions = interactions.total;

  // Low engagement on key elements
  for (const [selector, count] of Object.entries(interactions.byElement)) {
    if (count < 5) continue; // Too little data

    // Elements that look interactive but aren't clicked
    if (selector.includes('button') || selector.includes('[role="button"]') || selector.includes('a.')) {
      const clickRate = count / totalInteractions;
      if (clickRate < 0.01 && totalInteractions > 100) {
        suggestions.push({
          id: `sug-usability-dead-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          type: 'usability',
          severity: 'medium',
          title: `Low Engagement: "${selector}"`,
          description: `This interactive element receives very few clicks (${count} total). May be unclear or poorly positioned.`,
          evidence: { metric: 'Click Rate', value: clickRate, threshold: 0.01 },
          affectedElements: [{ selector, issue: 'Low click-through rate' }],
          fix: {
            description: 'Improve visual affordance (button styling), reposition above fold, clarify label, add hover state',
            confidence: 0.65,
            effort: 'easy',
          },
          source: 'rule',
          createdAt: Date.now(),
        });
      }
    }
  }

  // Rage clicks (rapid repeated clicks on same element)
  // Would need session-level analysis - placeholder
  suggestions.push({
    id: `sug-usability-rage-${Date.now()}`,
    type: 'usability',
    severity: 'info',
    title: 'Monitor for Rage Clicks',
    description: 'Enable session replay to detect rage clicks (rapid repeated clicks indicating frustration).',
    fix: {
      description: 'Integrate session replay tool or add custom rage-click detection',
      confidence: 0.5,
      effort: 'moderate',
    },
    source: 'rule',
    createdAt: Date.now(),
  });

  return suggestions;
}

function generateMobileSuggestions(ctx: RuleContext): DesignSuggestion[] {
  const suggestions: DesignSuggestion[] = [];
  const { interactions } = ctx.analytics;

  // Check for mobile viewport interactions
  const mobileInteractions = Object.values(interactions.byElement).reduce((sum, count) => sum + count, 0);
  // This is a simplified check - in reality we'd analyze viewport distribution

  suggestions.push({
    id: `sug-mobile-touch-${Date.now()}`,
    type: 'mobile',
    severity: 'medium',
    title: 'Ensure Touch Targets Meet 48x48dp Minimum',
    description: 'Verify all interactive elements meet minimum touch target size for mobile accessibility.',
    fix: {
      description: 'Add padding to small buttons/links, increase spacing between adjacent targets, use min-h-[48px] min-w-[48px]',
      codeChange: 'button { min-height: 48px; min-width: 48px; } a { min-height: 48px; display: inline-flex; align-items: center; padding: 8px 12px; }',
      confidence: 0.9,
      effort: 'easy',
    },
    source: 'rule',
    createdAt: Date.now(),
  });

  suggestions.push({
    id: `sug-mobile-responsive-${Date.now()}`,
    type: 'mobile',
    severity: 'medium',
    title: 'Test Responsive Breakpoints',
    description: 'Verify layout works at 375px (mobile), 768px (tablet), 1440px (desktop).',
    fix: {
      description: 'Test in Chrome DevTools device toolbar, fix horizontal overflow, ensure text readable at 375px',
      confidence: 0.85,
      effort: 'easy',
    },
    source: 'rule',
    createdAt: Date.now(),
  });

  return suggestions;
}

function generateVisualSuggestions(ctx: RuleContext): DesignSuggestion[] {
  const suggestions: DesignSuggestion[] = [];
  const { designSystem, componentIR } = ctx;

  if (!designSystem) {
    suggestions.push({
      id: `sug-visual-tokens-${Date.now()}`,
      type: 'visual',
      severity: 'info',
      title: 'Define Design Tokens for Consistency',
      description: 'No design system detected. Define colors, spacing, typography tokens for consistent UI.',
      fix: {
        description: 'Create design system in Design Canvas, extract tokens from existing components',
        confidence: 0.8,
        effort: 'moderate',
      },
      source: 'rule',
      createdAt: Date.now(),
    });
  }

  if (componentIR && componentIR.jsx) {
    // Check for hardcoded values vs design tokens
    const hasHardcodedColors = /#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(|hsla\(/.test(componentIR.jsx);
    const hasTailwindArbitrary = /\[#[0-9a-fA-F]{3,8}\]|\[rgb\(/.test(componentIR.jsx);

    if (hasHardcodedColors || hasTailwindArbitrary) {
      suggestions.push({
        id: `sug-visual-tokens-usage-${Date.now()}`,
        type: 'visual',
        severity: 'medium',
        title: 'Use Design Tokens Instead of Hardcoded Values',
        description: 'Component uses hardcoded colors/spacing instead of design system tokens.',
        fix: {
          description: 'Replace hardcoded values with design token references (e.g., bg-primary-500, p-4)',
          confidence: 0.9,
          effort: 'easy',
        },
        source: 'rule',
        createdAt: Date.now(),
      });
    }
  }

  return suggestions;
}

// ============================================================================
// LLM-Based Suggestion Generator
// ============================================================================

const SUGGESTION_SYSTEM_PROMPT = `You are an expert product designer and UX researcher. Analyze the provided analytics data and generate actionable design suggestions.

Given:
- Interaction analytics (clicks, hovers, scroll depth, element engagement)
- Web Vitals (LCP, FID/INP, CLS, FCP)
- Funnel drop-off data
- Current component design (ComponentIR)
- Design system tokens

Generate 3-7 specific, actionable suggestions. Each must include:
1. Clear problem statement with evidence
2. Specific fix description
3. Code change suggestion (Tailwind/React diff)
4. Confidence (0-1) and effort estimate

Focus on HIGH-IMPACT changes. Prioritize:
- Critical accessibility failures
- Major conversion blockers
- Severe performance issues
- Mobile usability problems

Return JSON array of DesignSuggestion objects.`;

export class DesignSuggestionEngine {
  private static instance: DesignSuggestionEngine;

  static getInstance(): DesignSuggestionEngine {
    if (!DesignSuggestionEngine.instance) {
      DesignSuggestionEngine.instance = new DesignSuggestionEngine();
    }
    return DesignSuggestionEngine.instance;
  }

  async generateSuggestions(request: SuggestionRequest): Promise<SuggestionResult> {
    const startTime = Date.now();

    try {
      const ctx: RuleContext = {
        analytics: request.analytics,
        funnels: request.funnels,
        componentIR: request.componentIR,
        designSystem: request.designSystem,
        framework: request.framework,
      };

      // 1. Run rule-based generators (fast, deterministic)
      const ruleSuggestions = [
        ...generateAccessibilitySuggestions(ctx),
        ...generateFunnelSuggestions(ctx),
        ...generateInteractionSuggestions(ctx),
        ...generateMobileSuggestions(ctx),
        ...generateVisualSuggestions(ctx),
      ];

      // 2. Run LLM analysis for deeper insights
      const llmSuggestions = await this.generateLLMSuggestions(ctx);

      // 3. Merge and deduplicate
      const allSuggestions = this.mergeSuggestions(ruleSuggestions, llmSuggestions);

      // 4. Sort by severity + confidence
      const sorted = allSuggestions.sort((a, b) => {
        const severityOrder = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
        const sevDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (sevDiff !== 0) return sevDiff;
        return b.fix.confidence - a.fix.confidence;
      });

      return {
        success: true,
        suggestions: sorted.slice(0, 10), // Top 10
        generatedAt: Date.now(),
      };
    } catch (error) {
      console.error('Suggestion generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        generatedAt: Date.now(),
      };
    }
  }

  private async generateLLMSuggestions(ctx: RuleContext): Promise<DesignSuggestion[]> {
    try {
      const prompt = this.buildLLMPrompt(ctx);

      const result = await runUniversalAgent({
        prompt,
        systemPrompt: SUGGESTION_SYSTEM_PROMPT,
        maxIterations: 2,
        tools: [],
        enableResilience: true,
      });

      const text = result?.finalAnswer || result?.content || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const suggestions = z.array(DesignSuggestionSchema).parse(parsed);

      return suggestions.map(s => ({ ...s, source: 'llm' as const }));
    } catch (error) {
      console.error('LLM suggestion generation failed:', error);
      return [];
    }
  }

  private buildLLMPrompt(ctx: RuleContext): string {
    let prompt = `ANALYTICS DATA:\n`;
    prompt += JSON.stringify(ctx.analytics, null, 2).slice(0, 5000);

    if (ctx.funnels?.length) {
      prompt += `\n\nFUNNELS:\n${JSON.stringify(ctx.funnels, null, 2)}`;
    }

    if (ctx.componentIR) {
      prompt += `\n\nCURRENT COMPONENT:\n`;
      prompt += `Name: ${ctx.componentIR.name}\n`;
      prompt += `JSX: ${ctx.componentIR.jsx.slice(0, 2000)}\n`;
      prompt += `Props: ${JSON.stringify(ctx.componentIR.props, null, 2)}`;
    }

    if (ctx.designSystem) {
      prompt += `\n\nDESIGN SYSTEM:\n${JSON.stringify(ctx.designSystem, null, 2).slice(0, 2000)}`;
    }

    prompt += `\n\nFRAMEWORK: ${ctx.framework || 'react'}`;

    return prompt;
  }

  private mergeSuggestions(rule: DesignSuggestion[], llm: DesignSuggestion[]): DesignSuggestion[] {
    const merged = [...rule];

    for (const llmSug of llm) {
      // Check if similar rule suggestion exists
      const similar = merged.find(r =>
        r.type === llmSug.type &&
        r.title.toLowerCase().includes(llmSug.title.toLowerCase().slice(0, 20))
      );

      if (!similar) {
        merged.push(llmSug);
      } else {
        // Boost confidence of rule suggestion if LLM agrees
        similar.fix.confidence = Math.min(1, similar.fix.confidence + 0.15);
        similar.source = 'hybrid';
      }
    }

    return merged;
  }
}

// ============================================================================
// Public API
// ============================================================================

export async function generateDesignSuggestions(request: SuggestionRequest): Promise<SuggestionResult> {
  const engine = DesignSuggestionEngine.getInstance();
  return engine.generateSuggestions(request);
}

export function getSuggestionEngine(): DesignSuggestionEngine {
  return DesignSuggestionEngine.getInstance();
}