/**
 * Ambient Intelligence Service
 *
 * Proactive AI design suggestions that generate design variants as you work.
 * Shows suggested progressions you can accept with a single click.
 * Never blocks — suggestions appear alongside, not modal.
 * Learns from your choices to improve future suggestions.
 */

import { EventEmitter } from 'events';
import { DesignCanvasEngine, CanvasArtifact, Layer } from './design-canvas';
import { createBestAdapter } from './adapter-factory';
import { LLMAdapter } from './llm-adapter';
import { buildInfinityPrompt } from './infinity-prompt';

// ============================================================================
// Types
// ============================================================================

export interface AmbientSuggestion {
  id: string;
  type: 'variant' | 'improvement' | 'pattern' | 'layout' | 'color';
  title: string;
  description: string;
  confidence: number; // 0-1
  preview?: string; // base64 image or data URL
  code?: string; // React/Tailwind code snippet
  applyTo: string[]; // Layer IDs this suggestion applies to
  createdAt: number;
  source: 'ai' | 'template' | 'mobbin' | 'design-system';
  accepted?: boolean;
  rejected?: boolean;
}

export interface UserPreferences {
  preferredColors: string[];
  preferredTypography: string[];
  commonPatterns: string[];
  styleKeywords: string[];
  recentChoices: SuggestionOutcome[];
}

export interface SuggestionOutcome {
  suggestionId: string;
  suggestionType: AmbientSuggestion['type'];
  accepted: boolean;
  timestamp: number;
  context: string; // What was on canvas when suggestion made
}

export interface AmbientContext {
  artifactType: CanvasArtifact['type'];
  selectedLayers: Layer[];
  recentChanges: string[];
  designSystem?: any;
  userPreferences: UserPreferences;
}

export type AmbientEvent =
  | { type: 'suggestion:generated'; suggestion: AmbientSuggestion }
  | { type: 'suggestion:accepted'; suggestion: AmbientSuggestion }
  | { type: 'suggestion:rejected'; suggestion: AmbientSuggestion }
  | { type: 'preferences:updated'; preferences: UserPreferences };

export type AmbientEventListener = (event: AmbientEvent) => void;

// ============================================================================
// Ambient Intelligence Engine
// ============================================================================

export class AmbientIntelligence extends EventEmitter {
  private canvas: DesignCanvasEngine;
  private eventListeners: Set<AmbientEventListener> = new Set();
  private suggestions: Map<string, AmbientSuggestion> = new Map();
  private preferences: UserPreferences = {
    preferredColors: [],
    preferredTypography: [],
    commonPatterns: [],
    styleKeywords: [],
    recentChoices: [],
  };
  private adapter: LLMAdapter | null = null;
  private generationTimer: NodeJS.Timeout | null = null;
  private isGenerating = false;
  private debounceMs = 2000; // Wait 2s after changes before generating
  private maxSuggestions = 5;

  constructor(canvas: DesignCanvasEngine) {
    super();
    this.canvas = canvas;
    this.setupCanvasListeners();
  }

  private setupCanvasListeners(): void {
    this.canvas.onCanvasEvent(event => {
      if (event.type === 'layer:created' ||
          event.type === 'layer:updated' ||
          event.type === 'layer:moved' ||
          event.type === 'layer:resized' ||
          event.type === 'selection:changed') {
        this.scheduleGeneration();
      }
    });
  }

  private scheduleGeneration(): void {
    if (this.generationTimer) {
      clearTimeout(this.generationTimer);
    }

    this.generationTimer = setTimeout(() => {
      this.generateSuggestions().catch(error => {
        console.error('Ambient generation error:', error);
      });
    }, this.debounceMs);
  }

  // ---------------------------------------------------------------------------
  // Suggestion Generation
  // ---------------------------------------------------------------------------

  async generateSuggestions(): Promise<AmbientSuggestion[]> {
    if (this.isGenerating) return [];
    this.isGenerating = true;

    try {
      const context = this.buildContext();

      // Don't generate if nothing to suggest on
      if (context.selectedLayers.length === 0 && this.canvas.getLayers().length === 0) {
        return [];
      }

      const newSuggestions = await this.queryLLM(context);

      // Cap total suggestions
      const allSuggestions = [...this.suggestions.values(), ...newSuggestions];
      const sorted = allSuggestions.sort((a, b) => b.confidence - a.confidence);

      this.suggestions.clear();
      for (const s of sorted.slice(0, this.maxSuggestions)) {
        this.suggestions.set(s.id, s);
      }

      for (const s of newSuggestions) {
        this.emitEvent({ type: 'suggestion:generated', suggestion: s });
      }

      return newSuggestions;
    } finally {
      this.isGenerating = false;
    }
  }

  private buildContext(): AmbientContext {
    const selectedLayers = this.canvas.getSelectedLayers();
    const designSystem = this.canvas.getDesignSystem();

    return {
      artifactType: 'web-app-screen', // Simplified
      selectedLayers,
      recentChanges: [], // Would track from history
      designSystem,
      userPreferences: this.preferences,
    };
  }

  private async queryLLM(context: AmbientContext): Promise<AmbientSuggestion[]> {
    if (!this.adapter) {
      try {
        this.adapter = await createBestAdapter();
      } catch {
        // Fallback: template-based suggestions
        return this.generateTemplateSuggestions(context);
      }
    }

    const prompt = this.buildPrompt(context);

    try {
      const response = await this.adapter.complete(
        [
          { role: 'system', content: buildInfinityPrompt({ role: 'chat', extraInstructions: 'You are an ambient design intelligence system. Generate design suggestions.' }) },
          { role: 'user', content: prompt }
        ],
        {
          maxTokens: 2000,
          temperature: 0.7,
        }
      );

      return this.parseSuggestions(response.content, context);
    } catch (error) {
      console.error('LLM query failed, falling back to templates:', error);
      return this.generateTemplateSuggestions(context);
    }
  }

  private buildPrompt(context: AmbientContext): string {
    const { selectedLayers, artifactType, userPreferences } = context;

    return `You are an ambient design intelligence system. Generate design suggestions for a ${artifactType}.

Current canvas state:
${selectedLayers.map(l => `- ${l.name} (${l.type}) at (${l.bounds.x}, ${l.bounds.y}) size ${l.bounds.width}x${l.bounds.height}`).join('\n')}

User style preferences (learned from past choices):
- Colors: ${userPreferences.preferredColors.join(', ') || 'none yet'}
- Typography: ${userPreferences.preferredTypography.join(', ') || 'none yet'}
- Patterns: ${userPreferences.commonPatterns.join(', ') || 'none yet'}
- Style keywords: ${userPreferences.styleKeywords.join(', ') || 'none yet'}

Generate 2-3 design suggestions that would improve this design. Each suggestion should be a JSON object:
{
  "type": "variant|improvement|pattern|layout|color",
  "title": "Short title",
  "description": "What this suggestion does",
  "confidence": 0.0-1.0,
  "code": "React/Tailwind code snippet (if applicable)",
  "applyTo": ["layer IDs this applies to"]
}

Respond ONLY with a JSON array of suggestions.`;
  }

  private parseSuggestions(content: string, context: AmbientContext): AmbientSuggestion[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return this.generateTemplateSuggestions(context);

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return this.generateTemplateSuggestions(context);

      return parsed.map(item => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: item.type || 'variant',
        title: item.title || 'Suggestion',
        description: item.description || '',
        confidence: Math.min(1, Math.max(0, item.confidence || 0.5)),
        code: item.code,
        applyTo: item.applyTo || context.selectedLayers.map(l => l.id),
        createdAt: Date.now(),
        source: 'ai',
      }));
    } catch {
      return this.generateTemplateSuggestions(context);
    }
  }

  private generateTemplateSuggestions(context: AmbientContext): AmbientSuggestion[] {
    const { selectedLayers, artifactType } = context;
    const suggestions: AmbientSuggestion[] = [];

    if (selectedLayers.length > 0) {
      // Color harmony suggestion
      suggestions.push({
        id: `template-color-${Date.now()}`,
        type: 'color',
        title: 'Color Harmony Adjustment',
        description: 'Apply a complementary color scheme to selected elements for visual balance.',
        confidence: 0.6,
        applyTo: selectedLayers.map(l => l.id),
        createdAt: Date.now(),
        source: 'template',
      });

      // Spacing suggestion
      suggestions.push({
        id: `template-spacing-${Date.now()}`,
        type: 'layout',
        title: 'Consistent Spacing',
        description: 'Normalize padding and margins to an 8px grid for cleaner layout.',
        confidence: 0.7,
        applyTo: selectedLayers.map(l => l.id),
        createdAt: Date.now(),
        source: 'template',
      });

      // Typography hierarchy
      if (artifactType === 'website-page' || artifactType === 'web-app-screen') {
        suggestions.push({
          id: `template-typography-${Date.now()}`,
          type: 'variant',
          title: 'Typography Hierarchy',
          description: 'Improve text hierarchy with clearer size and weight contrast.',
          confidence: 0.65,
          applyTo: selectedLayers.map(l => l.id),
          createdAt: Date.now(),
          source: 'template',
        });
      }
    }

    return suggestions;
  }

  // ---------------------------------------------------------------------------
  // Suggestion Actions
  // ---------------------------------------------------------------------------

  acceptSuggestion(suggestionId: string): AmbientSuggestion | null {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion) return null;

    suggestion.accepted = true;
    suggestion.rejected = false;

    // Record outcome for learning
    this.recordOutcome({
      suggestionId,
      suggestionType: suggestion.type,
      accepted: true,
      timestamp: Date.now(),
      context: `Artifact: ${suggestion.applyTo.length} layers`,
    });

    // Update preferences
    this.learnFromChoice(suggestion);

    this.emitEvent({ type: 'suggestion:accepted', suggestion });
    return suggestion;
  }

  rejectSuggestion(suggestionId: string): AmbientSuggestion | null {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion) return null;

    suggestion.accepted = false;
    suggestion.rejected = true;

    this.recordOutcome({
      suggestionId,
      suggestionType: suggestion.type,
      accepted: false,
      timestamp: Date.now(),
      context: `Artifact: ${suggestion.applyTo.length} layers`,
    });

    this.emitEvent({ type: 'suggestion:rejected', suggestion });
    return suggestion;
  }

  private recordOutcome(outcome: SuggestionOutcome): void {
    this.preferences.recentChoices.unshift(outcome);
    // Keep last 50
    this.preferences.recentChoices = this.preferences.recentChoices.slice(0, 50);
  }

  private learnFromChoice(suggestion: AmbientSuggestion): void {
    if (!suggestion.accepted) return;

    // Extract style keywords from title/description
    const keywords = `${suggestion.title} ${suggestion.description}`.toLowerCase();
    const styleWords = ['minimal', 'modern', 'bold', 'elegant', 'playful', 'professional', 'clean', 'dark', 'light', 'colorful'];
    for (const word of styleWords) {
      if (keywords.includes(word) && !this.preferences.styleKeywords.includes(word)) {
        this.preferences.styleKeywords.push(word);
      }
    }

    // Keep last 10 style keywords
    this.preferences.styleKeywords = this.preferences.styleKeywords.slice(-10);

    this.emitEvent({ type: 'preferences:updated', preferences: { ...this.preferences } });
  }

  // ---------------------------------------------------------------------------
  // Preference Management
  // ---------------------------------------------------------------------------

  setPreferences(preferences: Partial<UserPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    this.emitEvent({ type: 'preferences:updated', preferences: { ...this.preferences } });
  }

  getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  clearPreferences(): void {
    this.preferences = {
      preferredColors: [],
      preferredTypography: [],
      commonPatterns: [],
      styleKeywords: [],
      recentChoices: [],
    };
    this.emitEvent({ type: 'preferences:updated', preferences: { ...this.preferences } });
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  serializePreferences(): string {
    return JSON.stringify(this.preferences, null, 2);
  }

  deserializePreferences(json: string): void {
    try {
      this.preferences = JSON.parse(json);
    } catch (error) {
      console.error('Failed to deserialize preferences:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  getSuggestions(): AmbientSuggestion[] {
    return Array.from(this.suggestions.values()).sort((a, b) => b.confidence - a.confidence);
  }

  getSuggestion(suggestionId: string): AmbientSuggestion | undefined {
    return this.suggestions.get(suggestionId);
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  onAmbientEvent(listener: AmbientEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emitEvent(event: AmbientEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Ambient event listener error:', error);
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAmbientIntelligence(canvas: DesignCanvasEngine): AmbientIntelligence {
  return new AmbientIntelligence(canvas);
}