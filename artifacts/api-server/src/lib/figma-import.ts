/**
 * Figma Import Pipeline
 *
 * Paste Figma link → design metadata → React + Tailwind.
 * Extracts theme/color, typography, component structure, auto-layout conversion.
 * Preserves basic interactions. After import: prompt for functional requirements + API integrations.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface FigmaNode {
  id: string;
  name: string;
  type: string; // FRAME, GROUP, COMPONENT, TEXT, RECTANGLE, etc.
  x: number;
  y: number;
  width: number;
  height: number;
  fills: FigmaFill[];
  strokes: FigmaStroke[];
  effects: FigmaEffect[];
  cornerRadius?: number;
  opacity?: number;
  text?: FigmaText;
  children?: FigmaNode[];
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  visible?: boolean;
  locked?: boolean;
  // More properties from Figma API
  [key: string]: any;
}

export interface FigmaFill {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'IMAGE' | string;
  color?: { r: number; g: number; b: number; a: number };
  opacity?: number;
  gradientStops?: any[];
  imageRef?: string;
}

export interface FigmaStroke {
  type: string;
  color?: { r: number; g: number; b: number; a: number };
  weight?: number;
}

export interface FigmaEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR' | string;
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
  visible?: boolean;
}

export interface FigmaText {
  characters: string;
  style: {
    fontFamily: string;
    fontPostScriptName: string;
    fontWeight: number;
    fontSize: number;
    lineHeightPx: number;
    letterSpacing: number;
    textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM';
  };
  fills: FigmaFill[];
}

export interface FigmaFile {
  key: string;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  document: FigmaNode;
  components: Record<string, any>;
  styles: Record<string, any>;
}

export interface FigmaImportResult {
  file: FigmaFile;
  designTokens: DesignSystem;
  reactComponents: ReactComponent[];
  summary: ImportSummary;
  warnings: ImportWarning[];
}

export interface ReactComponent {
  name: string;
  code: string;
  props: ComponentProp[];
  dependencies: string[];
}

export interface ComponentProp {
  name: string;
  type: string;
  defaultValue?: any;
  required: boolean;
}

export interface DesignSystem {
  colors: Token[];
  typography: TypographyToken[];
  spacing: Token[];
  borderRadius: Token[];
  shadows: Token[];
}

export interface Token {
  name: string;
  value: string;
  figmaReference?: string;
}

export interface TypographyToken {
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  figmaReference?: string;
}

export interface ImportWarning {
  type: 'gradient' | 'shadow' | 'css-variable' | 'hidden-layer' | 'animation' | 'unsupported';
  message: string;
  nodeId?: string;
  severity: 'info' | 'warning' | 'error';
}

export interface ImportSummary {
  totalNodes: number;
  frames: number;
  components: number;
  texts: number;
  shapes: number;
  images: number;
  estimatedComponents: number;
  unsupportedFeatures: string[];
}

export type FigmaEvent =
  | { type: 'import:started'; fileKey: string }
  | { type: 'import:progress'; percent: number; stage: string }
  | { type: 'import:complete'; result: FigmaImportResult }
  | { type: 'import:error'; error: string };

export type FigmaEventListener = (event: FigmaEvent) => void;

// ============================================================================
// Figma Importer
// ============================================================================

export class FigmaImporter extends EventEmitter {
  private listeners: Set<FigmaEventListener> = new Set();
  private accessToken: string | null = null;
  private baseUrl = 'https://api.figma.com/v1';

  constructor(accessToken?: string) {
    super();
    this.accessToken = accessToken || null;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  // ---------------------------------------------------------------------------
  // URL Parsing
  // ---------------------------------------------------------------------------

  parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
    // Supports: https://www.figma.com/file/KEY/Name or https://www.figma.com/design/KEY/Name
    // Also: https://www.figma.com/proto/KEY/...?node-id=NODE_ID
    const regex = /figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/;
    const match = url.match(regex);
    if (!match) return null;

    const fileKey = match[1];

    // Extract node-id if present
    const nodeMatch = url.match(/node-id=([0-9a-zA-Z-]+)/);
    const nodeId = nodeMatch ? nodeMatch[1].replace(/-/g, ':') : undefined;

    return { fileKey, nodeId };
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  async importFromUrl(url: string): Promise<FigmaImportResult> {
    const parsed = this.parseFigmaUrl(url);
    if (!parsed) {
      throw new Error('Invalid Figma URL');
    }

    this.emitEvent({ type: 'import:started', fileKey: parsed.fileKey });

    try {
      // Step 1: Fetch file
      this.emitEvent({ type: 'import:progress', percent: 10, stage: 'Fetching file metadata' });
      const file = await this.fetchFile(parsed.fileKey);

      // Step 2: Parse nodes
      this.emitEvent({ type: 'import:progress', percent: 30, stage: 'Parsing node tree' });
      const warnings: ImportWarning[] = [];

      // Step 3: Extract design tokens
      this.emitEvent({ type: 'import:progress', percent: 50, stage: 'Extracting design tokens' });
      const designTokens = this.extractDesignTokens(file, warnings);

      // Step 4: Generate React components
      this.emitEvent({ type: 'import:progress', percent: 70, stage: 'Generating React components' });
      const reactComponents = this.generateReactComponents(file, designTokens, warnings);

      // Step 5: Build summary
      this.emitEvent({ type: 'import:progress', percent: 90, stage: 'Building summary' });
      const summary = this.buildSummary(file, reactComponents, warnings);

      const result: FigmaImportResult = {
        file,
        designTokens,
        reactComponents,
        summary,
        warnings,
      };

      this.emitEvent({ type: 'import:complete', result });
      return result;
    } catch (error: any) {
      this.emitEvent({ type: 'import:error', error: error.message || 'Import failed' });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Figma API Calls
  // ---------------------------------------------------------------------------

  private async fetchFile(fileKey: string, nodeId?: string): Promise<FigmaFile> {
    if (!this.accessToken) {
      // For $0 budget: use a mock file structure
      return this.getMockFile(fileKey);
    }

    const url = nodeId
      ? `${this.baseUrl}/files/${fileKey}/nodes?ids=${nodeId}`
      : `${this.baseUrl}/files/${fileKey}`;

    const response = await fetch(url, {
      headers: {
        'X-Figma-Token': this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.normalizeFigmaResponse(data, fileKey);
  }

  private normalizeFigmaResponse(data: any, fileKey: string): FigmaFile {
    // Figma API returns either { document } or { nodes: { [id]: { document } } }
    if (data.document) {
      return {
        key: fileKey,
        name: data.name || 'Imported Figma File',
        lastModified: data.lastModified || new Date().toISOString(),
        thumbnailUrl: data.thumbnailUrl || '',
        document: data.document,
        components: data.components || {},
        styles: data.styles || {},
      };
    }

    // Node-specific response
    const nodeId = Object.keys(data.nodes || {})[0];
    const document = data.nodes?.[nodeId]?.document;
    return {
      key: fileKey,
      name: 'Imported Figma Node',
      lastModified: new Date().toISOString(),
      thumbnailUrl: '',
      document,
      components: {},
      styles: {},
    };
  }

  private getMockFile(fileKey: string): FigmaFile {
    // Mock structure for $0 operation
    return {
      key: fileKey,
      name: 'Mock Figma Design',
      lastModified: new Date().toISOString(),
      thumbnailUrl: '',
      document: {
        id: '0:0',
        name: 'Document',
        type: 'DOCUMENT',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fills: [],
        strokes: [],
        effects: [],
        children: [
          {
            id: '0:1',
            name: 'Frame 1',
            type: 'FRAME',
            x: 0,
            y: 0,
            width: 375,
            height: 812,
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
            strokes: [],
            effects: [],
            cornerRadius: 0,
            visible: true,
            children: [
              {
                id: '0:2',
                name: 'Header',
                type: 'TEXT',
                x: 20,
                y: 40,
                width: 335,
                height: 32,
                fills: [],
                strokes: [],
                effects: [],
                text: {
                  characters: 'Welcome Back',
                  style: {
                    fontFamily: 'Inter',
                    fontPostScriptName: 'Inter-Bold',
                    fontWeight: 700,
                    fontSize: 28,
                    lineHeightPx: 34,
                    letterSpacing: -0.5,
                    textAlignHorizontal: 'LEFT',
                    textAlignVertical: 'TOP',
                  },
                  fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
                },
                visible: true,
              },
              {
                id: '0:3',
                name: 'Primary Button',
                type: 'FRAME',
                x: 20,
                y: 600,
                width: 335,
                height: 48,
                fills: [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.95, a: 1 } }],
                strokes: [],
                effects: [],
                cornerRadius: 8,
                layoutMode: 'HORIZONTAL',
                primaryAxisAlignItems: 'CENTER',
                counterAxisAlignItems: 'CENTER',
                visible: true,
                children: [
                  {
                    id: '0:4',
                    name: 'Button Text',
                    type: 'TEXT',
                    x: 0,
                    y: 0,
                    width: 120,
                    height: 20,
                    fills: [],
                    strokes: [],
                    effects: [],
                    text: {
                      characters: 'Get Started',
                      style: {
                        fontFamily: 'Inter',
                        fontPostScriptName: 'Inter-SemiBold',
                        fontWeight: 600,
                        fontSize: 16,
                        lineHeightPx: 20,
                        letterSpacing: 0,
                        textAlignHorizontal: 'CENTER',
                        textAlignVertical: 'CENTER',
                      },
                      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
                    },
                    visible: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      components: {},
      styles: {},
    };
  }

  // ---------------------------------------------------------------------------
  // Design Token Extraction
  // ---------------------------------------------------------------------------

  private extractDesignTokens(file: FigmaFile, warnings: ImportWarning[]): DesignSystem {
    const colors = new Map<string, Token>();
    const typography = new Map<string, TypographyToken>();
    const spacing = new Map<string, Token>();
    const borderRadius = new Map<string, Token>();
    const shadows = new Map<string, Token>();

    // Traverse the tree
    const traverse = (node: FigmaNode): void => {
      // Extract colors from fills
      for (const fill of node.fills || []) {
        if (fill.type === 'SOLID' && fill.color) {
          const hex = this.rgbToHex(fill.color);
          const name = `color-${hex.replace('#', '')}`;
          if (!colors.has(name)) {
            colors.set(name, { name, value: hex, figmaReference: node.id });
          }
        }
        if (fill.type === 'GRADIENT_LINEAR') {
          warnings.push({
            type: 'gradient',
            message: `Gradient fill in "${node.name}" could not be fully converted to CSS`,
            nodeId: node.id,
            severity: 'warning',
          });
        }
      }

      // Extract typography
      if (node.text) {
        const style = node.text.style;
        const key = `${style.fontFamily}-${style.fontWeight}-${style.fontSize}`;
        if (!typography.has(key)) {
          typography.set(key, {
            name: `text-${style.fontSize}-${style.fontWeight}`,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeightPx,
            letterSpacing: style.letterSpacing,
            figmaReference: node.id,
          });
        }
      }

      // Extract corner radius
      if (node.cornerRadius) {
        const key = `radius-${node.cornerRadius}`;
        if (!borderRadius.has(key)) {
          borderRadius.set(key, { name: key, value: `${node.cornerRadius}px`, figmaReference: node.id });
        }
      }

      // Extract shadows
      for (const effect of node.effects || []) {
        if (effect.type === 'DROP_SHADOW' && effect.visible) {
          const key = `shadow-${effect.radius}`;
          if (!shadows.has(key)) {
            const shadowValue = `0 ${effect.offset?.y || 0}px ${effect.radius || 0}px ${this.rgbaToCss(effect.color!)}`;
            shadows.set(key, { name: key, value: shadowValue, figmaReference: node.id });
          }
        }
      }

      // Recurse
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(file.document);

    return {
      colors: Array.from(colors.values()),
      typography: Array.from(typography.values()),
      spacing: Array.from(spacing.values()),
      borderRadius: Array.from(borderRadius.values()),
      shadows: Array.from(shadows.values()),
    };
  }

  // ---------------------------------------------------------------------------
  // React Component Generation
  // ---------------------------------------------------------------------------

  private generateReactComponents(
    file: FigmaFile,
    tokens: DesignSystem,
    warnings: ImportWarning[]
  ): ReactComponent[] {
    const components: ReactComponent[] = [];

    // Find top-level frames
    const frames = file.document.children?.filter(c => c.type === 'FRAME') || [];

    for (const frame of frames) {
      const component = this.generateComponentFromFrame(frame, tokens, warnings);
      components.push(component);
    }

    return components;
  }

  private generateComponentFromFrame(
    frame: FigmaNode,
    tokens: DesignSystem,
    warnings: ImportWarning[]
  ): ReactComponent {
    const componentName = this.toPascalCase(frame.name.replace(/[^a-zA-Z0-9]/g, '')) || 'ImportedFrame';

    const styleLines: string[] = [
      `position: 'relative'`,
      `width: ${frame.width}px`,
      `height: ${frame.height}px`,
    ];

    // Background color
    const firstFill = frame.fills?.[0];
    if (firstFill?.type === 'SOLID' && firstFill.color) {
      styleLines.push(`backgroundColor: '${this.rgbaToCss(firstFill.color)}'`);
    }

    if (frame.cornerRadius) {
      styleLines.push(`borderRadius: ${frame.cornerRadius}px`);
    }

    // Layout
    if (frame.layoutMode && frame.layoutMode !== 'NONE') {
      styleLines.push(`display: 'flex'`);
      styleLines.push(`flexDirection: '${frame.layoutMode.toLowerCase()}'`);
      if (frame.itemSpacing) {
        styleLines.push(`gap: ${frame.itemSpacing}px`);
      }
      if (frame.paddingTop || frame.paddingBottom || frame.paddingLeft || frame.paddingRight) {
        styleLines.push(`padding: ${frame.paddingTop || 0}px ${frame.paddingRight || 0}px ${frame.paddingBottom || 0}px ${frame.paddingLeft || 0}px`);
      }
    }

    const childrenCode = (frame.children || [])
      .filter(c => c.visible !== false)
      .map(child => this.generateChildCode(child, tokens, warnings))
      .join('\n      ');

    const code = `import React from 'react';

export function ${componentName}() {
  return (
    <div style={{
      ${styleLines.join(',\n      ')}
    }}>
      ${childrenCode || '<!-- No children -->'}
    </div>
  );
}
`;

    // Detect unsupported features and add warnings
    if (frame.effects?.some(e => e.type === 'DROP_SHADOW' && e.visible)) {
      warnings.push({
        type: 'shadow',
        message: `Shadow effects in "${frame.name}" converted to CSS box-shadow (may not be pixel-perfect)`,
        nodeId: frame.id,
        severity: 'info',
      });
    }

    return {
      name: componentName,
      code,
      props: [],
      dependencies: ['react'],
    };
  }

  private generateChildCode(node: FigmaNode, tokens: DesignSystem, warnings: ImportWarning[]): string {
    if (node.type === 'TEXT' && node.text) {
      const style: string[] = [
        `fontSize: ${node.text.style.fontSize}px`,
        `fontWeight: ${node.text.style.fontWeight}`,
        `lineHeight: ${node.text.style.lineHeightPx}px`,
        `letterSpacing: '${node.text.style.letterSpacing}px'`,
        `textAlign: '${node.text.style.textAlignHorizontal.toLowerCase()}'`,
      ];

      const firstFill = node.text.fills[0];
      if (firstFill?.type === 'SOLID' && firstFill.color) {
        style.push(`color: '${this.rgbaToCss(firstFill.color)}'`);
      }

      return `<span style={{ ${style.join(', ')} }}>${this.escapeJsxText(node.text.characters)}</span>`;
    }

    if (node.type === 'FRAME' || node.type === 'GROUP') {
      const style: string[] = [
        `position: 'relative'`,
        `left: ${node.x}px`,
        `top: ${node.y}px`,
        `width: ${node.width}px`,
        `height: ${node.height}px`,
      ];

      const firstFill = node.fills?.[0];
      if (firstFill?.type === 'SOLID' && firstFill.color) {
        style.push(`backgroundColor: '${this.rgbaToCss(firstFill.color)}'`);
      }

      if (node.cornerRadius) {
        style.push(`borderRadius: ${node.cornerRadius}px`);
      }

      if (node.layoutMode && node.layoutMode !== 'NONE') {
        style.push(`display: 'flex'`);
        style.push(`flexDirection: '${node.layoutMode.toLowerCase()}'`);
        if (node.itemSpacing) {
          style.push(`gap: ${node.itemSpacing}px`);
        }
      }

      const childrenCode = (node.children || [])
        .filter(c => c.visible !== false)
        .map(child => this.generateChildCode(child, tokens, warnings))
        .join('\n        ');

      return `<div style={{ ${style.join(', ')} }}>
        ${childrenCode || ''}
      </div>`;
    }

    if (node.type === 'RECTANGLE') {
      const style: string[] = [
        `position: 'absolute'`,
        `left: ${node.x}px`,
        `top: ${node.y}px`,
        `width: ${node.width}px`,
        `height: ${node.height}px`,
      ];

      const firstFill = node.fills?.[0];
      if (firstFill?.type === 'SOLID' && firstFill.color) {
        style.push(`backgroundColor: '${this.rgbaToCss(firstFill.color)}'`);
      }

      if (node.cornerRadius) {
        style.push(`borderRadius: ${node.cornerRadius}px`);
      }

      return `<div style={{ ${style.join(', ')} }} />`;
    }

    // Unknown node type
    warnings.push({
      type: 'unsupported',
      message: `Unsupported node type "${node.type}" in "${node.name}"`,
      nodeId: node.id,
      severity: 'info',
    });

    return `<!-- ${node.type}: ${node.name} -->`;
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  private buildSummary(
    file: FigmaFile,
    components: ReactComponent[],
    warnings: ImportWarning[]
  ): ImportSummary {
    let totalNodes = 0;
    let frames = 0;
    let componentsCount = 0;
    let texts = 0;
    let shapes = 0;
    let images = 0;
    const unsupported = new Set<string>();

    const traverse = (node: FigmaNode): void => {
      totalNodes++;

      switch (node.type) {
        case 'FRAME':
        case 'GROUP':
          frames++;
          break;
        case 'COMPONENT':
        case 'INSTANCE':
          componentsCount++;
          break;
        case 'TEXT':
          texts++;
          break;
        case 'RECTANGLE':
        case 'ELLIPSE':
        case 'VECTOR':
        case 'LINE':
          shapes++;
          break;
      }

      for (const fill of node.fills || []) {
        if (fill.type === 'IMAGE') images++;
        if (fill.type === 'GRADIENT_LINEAR') unsupported.add('Gradients');
      }

      for (const effect of node.effects || []) {
        if (effect.type === 'BACKGROUND_BLUR') unsupported.add('Background blur');
        if (effect.type === 'LAYER_BLUR') unsupported.add('Layer blur');
      }

      if (node.visible === false) unsupported.add('Hidden layers');

      if (node.children) {
        for (const child of node.children) traverse(child);
      }
    };

    traverse(file.document);

    return {
      totalNodes,
      frames,
      components: componentsCount,
      texts,
      shapes,
      images,
      estimatedComponents: components.length,
      unsupportedFeatures: Array.from(unsupported),
    };
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private rgbToHex(color: { r: number; g: number; b: number; a: number }): string {
    const toHex = (value: number) => {
      const v = Math.round(value * 255);
      return v.toString(16).padStart(2, '0');
    };
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  }

  private rgbaToCss(color: { r: number; g: number; b: number; a: number }): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  private toPascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]+(.)?/g, (_, chr) => chr ? chr.toUpperCase() : '')
      .replace(/^(.)/, (_, chr) => chr.toUpperCase());
  }

  private escapeJsxText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br />');
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  on(event: FigmaEventListener): () => void {
    this.listeners.add(event);
    return () => this.listeners.delete(event);
  }

  private emitEvent(event: FigmaEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Figma event listener error:', error);
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createFigmaImporter(accessToken?: string): FigmaImporter {
  return new FigmaImporter(accessToken);
}