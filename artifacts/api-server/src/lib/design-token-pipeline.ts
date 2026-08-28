/**
 * Design Token Pipeline
 *
 * Single source of truth for design tokens that generates:
 * - CSS Custom Properties (variables)
 * - Tailwind CSS config
 * - UnoCSS config
 * - Native framework formats (CSS, SCSS, JS/TS modules)
 */

import { z } from 'zod';

// ============================================================================
// Design Token Schemas
// ============================================================================

export const ColorTokenSchema = z.object({
  light: z.string(),
  dark: z.string().optional(),
});

export const ColorPaletteSchema = z.object({
  50: z.string(),
  100: z.string(),
  200: z.string(),
  300: z.string(),
  400: z.string(),
  500: z.string(),
  600: z.string(),
  700: z.string(),
  800: z.string(),
  900: z.string(),
  950: z.string().optional(),
});

export const SpacingTokenSchema = z.record(z.string());
export const TypographyTokenSchema = z.record(z.string());
export const BorderRadiusTokenSchema = z.record(z.string());
export const ShadowTokenSchema = z.record(z.string());
export const BreakpointTokenSchema = z.record(z.string());
export const ZIndexTokenSchema = z.record(z.number());
export const TransitionTokenSchema = z.record(z.string());

export const DesignTokensSchema = z.object({
  colors: z.object({
    // Semantic colors
    primary: ColorPaletteSchema,
    secondary: ColorPaletteSchema,
    accent: ColorPaletteSchema,
    destructive: ColorPaletteSchema,
    success: ColorPaletteSchema,
    warning: ColorPaletteSchema,
    info: ColorPaletteSchema,
    // Neutral colors
    background: ColorTokenSchema,
    foreground: ColorTokenSchema,
    card: ColorTokenSchema,
    'card-foreground': ColorTokenSchema,
    popover: ColorTokenSchema,
    'popover-foreground': ColorTokenSchema,
    muted: ColorTokenSchema,
    'muted-foreground': ColorTokenSchema,
    border: ColorTokenSchema,
    input: ColorTokenSchema,
    ring: ColorTokenSchema,
    // Extended neutrals
    neutral: ColorPaletteSchema,
    slate: ColorPaletteSchema,
    gray: ColorPaletteSchema,
    zinc: ColorPaletteSchema,
    stone: ColorPaletteSchema,
  }),
  spacing: SpacingTokenSchema,
  typography: z.object({
    fontFamily: TypographyTokenSchema,
    fontSize: TypographyTokenSchema,
    fontWeight: TypographyTokenSchema,
    lineHeight: TypographyTokenSchema,
    letterSpacing: TypographyTokenSchema,
  }),
  borderRadius: BorderRadiusTokenSchema,
  shadows: ShadowTokenSchema,
  breakpoints: BreakpointTokenSchema,
  zIndex: ZIndexTokenSchema,
  transitions: TransitionTokenSchema,
  // Animation
  animation: z.record(z.string()).optional(),
});

export type DesignTokens = z.infer<typeof DesignTokensSchema>;
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;
export type ColorToken = z.infer<typeof ColorTokenSchema>;

// ============================================================================
// Default Design Tokens (Infinity AI Design System)
// ============================================================================

export const defaultDesignTokens: DesignTokens = {
  colors: {
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
    secondary: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
      950: '#020617',
    },
    accent: {
      50: '#fdf4ff',
      100: '#fae8ff',
      200: '#f5d0fe',
      300: '#f0abfc',
      400: '#e879f9',
      500: '#d946ef',
      600: '#c026d3',
      700: '#a21caf',
      800: '#86198f',
      900: '#701a75',
      950: '#4a044e',
    },
    destructive: {
      50: '#fef2f2',
      100: '#fee2e2',
      200: '#fecaca',
      300: '#fca5a5',
      400: '#f87171',
      500: '#ef4444',
      600: '#dc2626',
      700: '#b91c1c',
      800: '#991b1b',
      900: '#7f1d1d',
      950: '#450a0a',
    },
    success: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      300: '#86efac',
      400: '#4ade80',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
      900: '#14532d',
      950: '#052e16',
    },
    warning: {
      50: '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f',
      950: '#451a03',
    },
    info: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
    background: {
      light: '#ffffff',
      dark: '#0f172a',
    },
    foreground: {
      light: '#0f172a',
      dark: '#f8fafc',
    },
    card: {
      light: '#ffffff',
      dark: '#1e293b',
    },
    'card-foreground': {
      light: '#0f172a',
      dark: '#f8fafc',
    },
    popover: {
      light: '#ffffff',
      dark: '#1e293b',
    },
    'popover-foreground': {
      light: '#0f172a',
      dark: '#f8fafc',
    },
    muted: {
      light: '#f1f5f9',
      dark: '#1e293b',
    },
    'muted-foreground': {
      light: '#64748b',
      dark: '#94a3b8',
    },
    border: {
      light: '#e2e8f0',
      dark: '#334155',
    },
    input: {
      light: '#e2e8f0',
      dark: '#334155',
    },
    ring: {
      light: '#3b82f6',
      dark: '#60a5fa',
    },
    neutral: {
      50: '#fafafa',
      100: '#f5f5f5',
      200: '#e5e5e5',
      300: '#d4d4d4',
      400: '#a3a3a3',
      500: '#737373',
      600: '#525252',
      700: '#404040',
      800: '#262626',
      900: '#171717',
      950: '#0a0a0a',
    },
    slate: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
      950: '#020617',
    },
    gray: {
      50: '#fafafa',
      100: '#f5f5f5',
      200: '#e5e5e5',
      300: '#d4d4d4',
      400: '#a3a3a3',
      500: '#737373',
      600: '#525252',
      700: '#404040',
      800: '#262626',
      900: '#171717',
      950: '#0a0a0a',
    },
    zinc: {
      50: '#fafafa',
      100: '#f4f4f5',
      200: '#e4e4e7',
      300: '#d4d4d8',
      400: '#a1a1aa',
      500: '#71717a',
      600: '#52525b',
      700: '#3f3f46',
      800: '#27272a',
      900: '#18181b',
      950: '#09090b',
    },
    stone: {
      50: '#fafaf9',
      100: '#f5f5f4',
      200: '#e7e5e4',
      300: '#d6d3d1',
      400: '#a8a29e',
      500: '#78716c',
      600: '#57534e',
      700: '#44403c',
      800: '#292524',
      900: '#1c1917',
      950: '#0c0a09',
    },
  },
  spacing: {
    0: '0',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    10: '2.5rem',
    12: '3rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
    32: '8rem',
    40: '10rem',
    48: '12rem',
    56: '14rem',
    64: '16rem',
  },
  typography: {
    fontFamily: {
      sans: 'var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
      mono: 'var(--font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace)',
      display: 'var(--font-display, "Cal Sans", "Inter", system-ui, sans-serif)',
    },
    fontSize: {
      xs: ['0.75rem', { lineHeight: '1rem' }],
      sm: ['0.875rem', { lineHeight: '1.25rem' }],
      base: ['1rem', { lineHeight: '1.5rem' }],
      lg: ['1.125rem', { lineHeight: '1.75rem' }],
      xl: ['1.25rem', { lineHeight: '1.75rem' }],
      '2xl': ['1.5rem', { lineHeight: '2rem' }],
      '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      '5xl': ['3rem', { lineHeight: '1' }],
      '6xl': ['3.75rem', { lineHeight: '1' }],
      '7xl': ['4.5rem', { lineHeight: '1' }],
      '8xl': ['6rem', { lineHeight: '1' }],
      '9xl': ['8rem', { lineHeight: '1' }],
    },
    fontWeight: {
      thin: '100',
      extralight: '200',
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
      black: '900',
    },
    lineHeight: {
      none: '1',
      tight: '1.25',
      snug: '1.375',
      normal: '1.5',
      relaxed: '1.625',
      loose: '2',
    },
    letterSpacing: {
      tighter: '-0.05em',
      tight: '-0.025em',
      normal: '0',
      wide: '0.025em',
      wider: '0.05em',
      widest: '0.1em',
    },
  },
  borderRadius: {
    none: '0',
    sm: '0.125rem',
    DEFAULT: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    '3xl': '1.5rem',
    full: '9999px',
  },
  shadows: {
    xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
    inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
    none: 'none',
  },
  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
  zIndex: {
    auto: 'auto',
    0: 0,
    10: 10,
    20: 20,
    30: 30,
    40: 40,
    50: 50,
    dropdown: 1000,
    sticky: 1100,
    fixed: 1200,
    'modal-backdrop': 1300,
    modal: 1400,
    popover: 1500,
    tooltip: 1600,
    toast: 1700,
  },
  transitions: {
    DEFAULT: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    fast: '50ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slower: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  animation: {
    none: 'none',
    spin: 'spin 1s linear infinite',
    ping: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
    pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    bounce: 'bounce 1s infinite',
    'fade-in': 'fadeIn 150ms ease-out',
    'fade-out': 'fadeOut 150ms ease-in',
    'slide-in-from-top': 'slideInFromTop 200ms ease-out',
    'slide-in-from-bottom': 'slideInFromBottom 200ms ease-out',
    'slide-in-from-left': 'slideInFromLeft 200ms ease-out',
    'slide-in-from-right': 'slideInFromRight 200ms ease-out',
    'zoom-in': 'zoomIn 150ms ease-out',
    'zoom-out': 'zoomOut 150ms ease-in',
  },
};

// ============================================================================
// Token Transformation Functions
// ============================================================================

export type OutputFormat = 'css' | 'tailwind' | 'unocss' | 'js' | 'ts' | 'json' | 'scss';

export interface PipelineOptions {
  tokens?: Partial<DesignTokens>;
  format: OutputFormat;
  prefix?: string;
  includeDarkMode?: boolean;
  minify?: boolean;
}

export interface PipelineResult {
  content: string;
  format: OutputFormat;
  fileName: string;
  warnings: string[];
}

/**
 * Main pipeline function - generates output for a specific format
 */
export function generateDesignTokens(options: PipelineOptions): PipelineResult {
  const tokens = { ...defaultDesignTokens, ...options.tokens };
  const prefix = options.prefix || '';
  const includeDarkMode = options.includeDarkMode !== false;

  switch (options.format) {
    case 'css':
      return generateCSSVariables(tokens, prefix, includeDarkMode, options.minify);
    case 'tailwind':
      return generateTailwindConfig(tokens, prefix, options.minify);
    case 'unocss':
      return generateUnoCSSConfig(tokens, prefix, options.minify);
    case 'js':
      return generateJSModule(tokens, prefix, options.minify);
    case 'ts':
      return generateTSModule(tokens, prefix, options.minify);
    case 'json':
      return generateJSON(tokens, options.minify);
    case 'scss':
      return generateSCSSVariables(tokens, prefix, includeDarkMode, options.minify);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

/**
 * Generate all formats at once
 */
export function generateAllFormats(tokens?: Partial<DesignTokens>, prefix?: string): PipelineResult[] {
  const formats: OutputFormat[] = ['css', 'tailwind', 'unocss', 'js', 'ts', 'json', 'scss'];
  return formats.map(format => generateDesignTokens({ tokens, format, prefix }));
}

/**
 * Generate CSS Custom Properties
 */
function generateCSSVariables(tokens: DesignTokens, prefix: string, includeDarkMode: boolean, minify: boolean): PipelineResult {
  const lines: string[] = [];

  // Root (light mode)
  lines.push(':root {');
  addColorVariables(lines, tokens.colors, prefix, 'light');
  addSpacingVariables(lines, tokens.spacing, prefix);
  addTypographyVariables(lines, tokens.typography, prefix);
  addBorderRadiusVariables(lines, tokens.borderRadius, prefix);
  addShadowVariables(lines, tokens.shadows, prefix);
  addBreakpointVariables(lines, tokens.breakpoints, prefix);
  addZIndexVariables(lines, tokens.zIndex, prefix);
  addTransitionVariables(lines, tokens.transitions, prefix);
  if (tokens.animation) {
    addAnimationVariables(lines, tokens.animation, prefix);
  }
  lines.push('}');

  // Dark mode
  if (includeDarkMode) {
    lines.push('');
    lines.push('.dark {');
    addColorVariables(lines, tokens.colors, prefix, 'dark');
    lines.push('}');
  }

  // Base styles
  lines.push('');
  lines.push('@layer base {');
  lines.push('  * {');
  lines.push(`    border-color: var(${prefix}border);`);
  lines.push('  }');
  lines.push('  body {');
  lines.push(`    background-color: var(${prefix}background);`);
  lines.push(`    color: var(${prefix}foreground);`);
  lines.push('  }');
  lines.push('}');

  const content = lines.join(minify ? '' : '\n');
  const fileName = `${prefix}variables.css`;

  return { content, format: 'css', fileName, warnings: [] };
}

function addColorVariables(lines: string[], colors: DesignTokens['colors'], prefix: string, mode: 'light' | 'dark'): void {
  // Semantic colors
  const semanticColors = [
    'primary', 'secondary', 'accent', 'destructive', 'success', 'warning', 'info',
    'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    'muted', 'muted-foreground', 'border', 'input', 'ring',
  ];

  for (const color of semanticColors) {
    const colorValue = colors[color as keyof typeof colors];
    if (colorValue) {
      if ('light' in colorValue && 'dark' in colorValue) {
        const value = mode === 'light' ? colorValue.light : (colorValue.dark || colorValue.light);
        lines.push(`  ${prefix}${color}: ${value};`);
      } else {
        // Palette colors
        const palette = colorValue as ColorPalette;
        for (const [shade, value] of Object.entries(palette)) {
          lines.push(`  ${prefix}${color}-${shade}: ${value};`);
        }
      }
    }
  }
}

function addSpacingVariables(lines: string[], spacing: DesignTokens['spacing'], prefix: string): void {
  for (const [key, value] of Object.entries(spacing)) {
    lines.push(`  ${prefix}spacing-${key}: ${value};`);
  }
}

function addTypographyVariables(lines: string[], typography: DesignTokens['typography'], prefix: string): void {
  for (const [category, values] of Object.entries(typography)) {
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) {
        lines.push(`  ${prefix}${category}-${key}: ${value[0]};`);
        if (value[1] && typeof value[1] === 'object') {
          for (const [subKey, subValue] of Object.entries(value[1])) {
            lines.push(`  ${prefix}${category}-${key}-${subKey}: ${subValue};`);
          }
        }
      } else {
        lines.push(`  ${prefix}${category}-${key}: ${value};`);
      }
    }
  }
}

function addBorderRadiusVariables(lines: string[], borderRadius: DesignTokens['borderRadius'], prefix: string): void {
  for (const [key, value] of Object.entries(borderRadius)) {
    lines.push(`  ${prefix}radius-${key}: ${value};`);
  }
}

function addShadowVariables(lines: string[], shadows: DesignTokens['shadows'], prefix: string): void {
  for (const [key, value] of Object.entries(shadows)) {
    lines.push(`  ${prefix}shadow-${key}: ${value};`);
  }
}

function addBreakpointVariables(lines: string[], breakpoints: DesignTokens['breakpoints'], prefix: string): void {
  for (const [key, value] of Object.entries(breakpoints)) {
    lines.push(`  ${prefix}breakpoint-${key}: ${value};`);
  }
}

function addZIndexVariables(lines: string[], zIndex: DesignTokens['zIndex'], prefix: string): void {
  for (const [key, value] of Object.entries(zIndex)) {
    lines.push(`  ${prefix}z-${key}: ${value};`);
  }
}

function addTransitionVariables(lines: string[], transitions: DesignTokens['transitions'], prefix: string): void {
  for (const [key, value] of Object.entries(transitions)) {
    lines.push(`  ${prefix}transition-${key}: ${value};`);
  }
}

function addAnimationVariables(lines: string[], animations: Record<string, string>, prefix: string): void {
  for (const [key, value] of Object.entries(animations)) {
    lines.push(`  ${prefix}animate-${key}: ${value};`);
  }
}

/**
 * Generate Tailwind CSS config
 */
function generateTailwindConfig(tokens: DesignTokens, prefix: string, minify: boolean): PipelineResult {
  const themeExtend: Record<string, any> = {};

  // Colors
  themeExtend.colors = {};
  for (const [colorName, colorValue] of Object.entries(tokens.colors)) {
    if ('light' in colorValue && 'dark' in colorValue) {
      themeExtend.colors[colorName] = {
        DEFAULT: `var(${prefix}${colorName})`,
        light: colorValue.light,
        dark: colorValue.dark || colorValue.light,
      };
    } else {
      themeExtend.colors[colorName] = colorValue;
    }
  }

  // Spacing
  themeExtend.spacing = {};
  for (const [key, value] of Object.entries(tokens.spacing)) {
    themeExtend.spacing[key] = value;
  }

  // Typography
  themeExtend.fontFamily = tokens.typography.fontFamily;
  themeExtend.fontSize = {};
  for (const [key, value] of Object.entries(tokens.typography.fontSize)) {
    themeExtend.fontSize[key] = Array.isArray(value) ? value : [value];
  }
  themeExtend.fontWeight = tokens.typography.fontWeight;
  themeExtend.lineHeight = tokens.typography.lineHeight;
  themeExtend.letterSpacing = tokens.typography.letterSpacing;

  // Border radius
  themeExtend.borderRadius = tokens.borderRadius;

  // Shadows
  themeExtend.boxShadow = tokens.shadows;

  // Breakpoints
  themeExtend.screens = tokens.breakpoints;

  // Z-index
  themeExtend.zIndex = tokens.zIndex;

  // Transitions
  themeExtend.transitionDuration = {};
  themeExtend.transitionTimingFunction = {};
  for (const [key, value] of Object.entries(tokens.transitions)) {
    const match = value.match(/(\d+)ms\s+([^ ]+)/);
    if (match) {
      themeExtend.transitionDuration[key] = `${match[1]}ms`;
      themeExtend.transitionTimingFunction[key] = match[2];
    }
  }

  // Animations
  if (tokens.animation) {
    themeExtend.animation = tokens.animation;
    themeExtend.keyframes = {
      fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      fadeOut: { '0%': { opacity: '1' }, '100%': { opacity: '0' } },
      slideInFromTop: { '0%': { transform: 'translateY(-10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      slideInFromBottom: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      slideInFromLeft: { '0%': { transform: 'translateX(-10px)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
      slideInFromRight: { '0%': { transform: 'translateX(10px)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
      zoomIn: { '0%': { transform: 'scale(0.95)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
      zoomOut: { '0%': { transform: 'scale(1)', opacity: '1' }, '100%': { transform: 'scale(0.95)', opacity: '0' } },
    };
  }

  const config = {
    content: [],
    theme: { extend: themeExtend },
    plugins: [],
  };

  const content = `/** @type {import('tailwindcss').Config} */
${JSON.stringify(config, null, minify ? 0 : 2)}`;

  return { content, format: 'tailwind', fileName: 'tailwind.config.js', warnings: [] };
}

/**
 * Generate UnoCSS config
 */
function generateUnoCSSConfig(tokens: DesignTokens, prefix: string, minify: boolean): PipelineResult {
  const theme: Record<string, any> = {};

  // Colors
  theme.colors = {};
  for (const [colorName, colorValue] of Object.entries(tokens.colors)) {
    if ('light' in colorValue && 'dark' in colorValue) {
      theme.colors[colorName] = `var(${prefix}${colorName})`;
    } else {
      theme.colors[colorName] = colorValue;
    }
  }

  // Spacing
  theme.spacing = tokens.spacing;

  // Border radius
  theme.borderRadius = tokens.borderRadius;

  // Shadows
  theme.boxShadow = tokens.shadows;

  // Breakpoints
  theme.breakpoints = tokens.breakpoints;

  // Typography
  theme.fontFamily = tokens.typography.fontFamily;
  theme.fontSize = tokens.typography.fontSize;
  theme.fontWeight = tokens.typography.fontWeight;
  theme.lineHeight = tokens.typography.lineHeight;
  theme.letterSpacing = tokens.typography.letterSpacing;

  // Transitions
  theme.transitionDuration = {};
  theme.transitionTimingFunction = {};
  for (const [key, value] of Object.entries(tokens.transitions)) {
    const match = value.match(/(\d+)ms\s+([^ ]+)/);
    if (match) {
      theme.transitionDuration[key] = `${match[1]}ms`;
      theme.transitionTimingFunction[key] = match[2];
    }
  }

  // Animations
  if (tokens.animation) {
    theme.animation = tokens.animation;
  }

  const config = {
    theme,
    shortcuts: {},
    rules: [],
    variants: [],
  };

  const content = `import { defineConfig } from 'unocss';

export default defineConfig(${JSON.stringify(config, null, minify ? 0 : 2)});`;

  return { content, format: 'unocss', fileName: 'uno.config.ts', warnings: [] };
}

/**
 * Generate JavaScript module
 */
function generateJSModule(tokens: DesignTokens, prefix: string, minify: boolean): PipelineResult {
  const content = `/**
 * Design Tokens - JavaScript Module
 * Generated by Infinity AI Design Token Pipeline
 */

export const designTokens = ${JSON.stringify(tokens, null, minify ? 0 : 2)};

export const cssVariables = {
${Object.entries(tokens.colors).map(([key, value]) => {
  if ('light' in value && 'dark' in value) {
    return `  ${key}: 'var(${prefix}${key})',`;
  }
  return `  ${key}: ${JSON.stringify(value)},`;
}).join('\n')}
};

export default designTokens;`;

  return { content, format: 'js', fileName: 'design-tokens.js', warnings: [] };
}

/**
 * Generate TypeScript module
 */
function generateTSModule(tokens: DesignTokens, prefix: string, minify: boolean): PipelineResult {
  const content = `/**
 * Design Tokens - TypeScript Module
 * Generated by Infinity AI Design Token Pipeline
 */

export interface DesignTokens {
  colors: {
    primary: ColorPalette;
    secondary: ColorPalette;
    accent: ColorPalette;
    destructive: ColorPalette;
    success: ColorPalette;
    warning: ColorPalette;
    info: ColorPalette;
    background: ColorToken;
    foreground: ColorToken;
    card: ColorToken;
    'card-foreground': ColorToken;
    popover: ColorToken;
    'popover-foreground': ColorToken;
    muted: ColorToken;
    'muted-foreground': ColorToken;
    border: ColorToken;
    input: ColorToken;
    ring: ColorToken;
    neutral: ColorPalette;
    slate: ColorPalette;
    gray: ColorPalette;
    zinc: ColorPalette;
    stone: ColorPalette;
  };
  spacing: Record<string, string>;
  typography: {
    fontFamily: Record<string, string>;
    fontSize: Record<string, string | [string, Record<string, string>]>;
    fontWeight: Record<string, string>;
    lineHeight: Record<string, string>;
    letterSpacing: Record<string, string>;
  };
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  breakpoints: Record<string, string>;
  zIndex: Record<string, number>;
  transitions: Record<string, string>;
  animation?: Record<string, string>;
}

export interface ColorPalette {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950?: string;
}

export interface ColorToken {
  light: string;
  dark?: string;
}

export const designTokens: DesignTokens = ${JSON.stringify(tokens, null, minify ? 0 : 2)};

export const cssVariables = {
${Object.entries(tokens.colors).map(([key, value]) => {
  if ('light' in value && 'dark' in value) {
    return `  ${key}: 'var(${prefix}${key})',`;
  }
  return `  ${key}: ${JSON.stringify(value)},`;
}).join('\n')}
} as const;

export default designTokens;`;

  return { content, format: 'ts', fileName: 'design-tokens.ts', warnings: [] };
}

/**
 * Generate JSON
 */
function generateJSON(tokens: DesignTokens, minify: boolean): PipelineResult {
  const content = JSON.stringify(tokens, null, minify ? 0 : 2);
  return { content, format: 'json', fileName: 'design-tokens.json', warnings: [] };
}

/**
 * Generate SCSS variables
 */
function generateSCSSVariables(tokens: DesignTokens, prefix: string, includeDarkMode: boolean, minify: boolean): PipelineResult {
  const lines: string[] = [];

  // Light mode variables
  lines.push('// Light mode (default)');
  addSCSSColorVariables(lines, tokens.colors, prefix, 'light');
  addSCSSSpacingVariables(lines, tokens.spacing, prefix);
  addSCSSTypographyVariables(lines, tokens.typography, prefix);
  addSCSSBorderRadiusVariables(lines, tokens.borderRadius, prefix);
  addSCSSShadowVariables(lines, tokens.shadows, prefix);
  addSCSSBreakpointVariables(lines, tokens.breakpoints, prefix);
  addSCSSZIndexVariables(lines, tokens.zIndex, prefix);
  addSCSSTransitionVariables(lines, tokens.transitions, prefix);
  if (tokens.animation) {
    addSCSSAnimationVariables(lines, tokens.animation, prefix);
  }

  // Dark mode
  if (includeDarkMode) {
    lines.push('');
    lines.push('// Dark mode');
    lines.push('.dark {');
    addSCSSColorVariables(lines, tokens.colors, prefix, 'dark');
    lines.push('}');
  }

  // Base styles
  lines.push('');
  lines.push('@layer base {');
  lines.push('  * {');
  lines.push(`    border-color: $${prefix}border;`);
  lines.push('  }');
  lines.push('  body {');
  lines.push(`    background-color: $${prefix}background;`);
  lines.push(`    color: $${prefix}foreground;`);
  lines.push('  }');
  lines.push('}');

  const content = lines.join(minify ? '' : '\n');
  return { content, format: 'scss', fileName: '_variables.scss', warnings: [] };
}

function addSCSSColorVariables(lines: string[], colors: DesignTokens['colors'], prefix: string, mode: 'light' | 'dark'): void {
  const semanticColors = [
    'primary', 'secondary', 'accent', 'destructive', 'success', 'warning', 'info',
    'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    'muted', 'muted-foreground', 'border', 'input', 'ring',
  ];

  for (const color of semanticColors) {
    const colorValue = colors[color as keyof typeof colors];
    if (colorValue) {
      if ('light' in colorValue && 'dark' in colorValue) {
        const value = mode === 'light' ? colorValue.light : (colorValue.dark || colorValue.light);
        lines.push(`  $${prefix}${color}: ${value};`);
      } else {
        const palette = colorValue as ColorPalette;
        for (const [shade, value] of Object.entries(palette)) {
          lines.push(`  $${prefix}${color}-${shade}: ${value};`);
        }
      }
    }
  }
}

function addSCSSSpacingVariables(lines: string[], spacing: DesignTokens['spacing'], prefix: string): void {
  for (const [key, value] of Object.entries(spacing)) {
    lines.push(`  $${prefix}spacing-${key}: ${value};`);
  }
}

function addSCSSTypographyVariables(lines: string[], typography: DesignTokens['typography'], prefix: string): void {
  for (const [category, values] of Object.entries(typography)) {
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) {
        lines.push(`  $${prefix}${category}-${key}: ${value[0]};`);
        if (value[1] && typeof value[1] === 'object') {
          for (const [subKey, subValue] of Object.entries(value[1])) {
            lines.push(`  $${prefix}${category}-${key}-${subKey}: ${subValue};`);
          }
        }
      } else {
        lines.push(`  $${prefix}${category}-${key}: ${value};`);
      }
    }
  }
}

function addSCSSBorderRadiusVariables(lines: string[], borderRadius: DesignTokens['borderRadius'], prefix: string): void {
  for (const [key, value] of Object.entries(borderRadius)) {
    lines.push(`  $${prefix}radius-${key}: ${value};`);
  }
}

function addSCSSShadowVariables(lines: string[], shadows: DesignTokens['shadows'], prefix: string): void {
  for (const [key, value] of Object.entries(shadows)) {
    lines.push(`  $${prefix}shadow-${key}: ${value};`);
  }
}

function addSCSSBreakpointVariables(lines: string[], breakpoints: DesignTokens['breakpoints'], prefix: string): void {
  for (const [key, value] of Object.entries(breakpoints)) {
    lines.push(`  $${prefix}breakpoint-${key}: ${value};`);
  }
}

function addSCSSZIndexVariables(lines: string[], zIndex: DesignTokens['zIndex'], prefix: string): void {
  for (const [key, value] of Object.entries(zIndex)) {
    lines.push(`  $${prefix}z-${key}: ${value};`);
  }
}

function addSCSSTransitionVariables(lines: string[], transitions: DesignTokens['transitions'], prefix: string): void {
  for (const [key, value] of Object.entries(transitions)) {
    lines.push(`  $${prefix}transition-${key}: ${value};`);
  }
}

function addSCSSAnimationVariables(lines: string[], animations: Record<string, string>, prefix: string): void {
  for (const [key, value] of Object.entries(animations)) {
    lines.push(`  $${prefix}animate-${key}: ${value};`);
  }
}

// ============================================================================
// Theme Builder
// ============================================================================

export class DesignTokenBuilder {
  private tokens: DesignTokens;

  constructor(baseTokens: DesignTokens = defaultDesignTokens) {
    this.tokens = JSON.parse(JSON.stringify(baseTokens));
  }

  // Color methods
  setPrimaryColor(palette: ColorPalette): this {
    this.tokens.colors.primary = palette;
    return this;
  }

  setSemanticColor(name: string, light: string, dark?: string): this {
    (this.tokens.colors as any)[name] = { light, dark };
    return this;
  }

  setColorPalette(name: string, palette: ColorPalette): this {
    (this.tokens.colors as any)[name] = palette;
    return this;
  }

  // Spacing
  setSpacing(spacing: Record<string, string>): this {
    this.tokens.spacing = spacing;
    return this;
  }

  addSpacing(key: string, value: string): this {
    this.tokens.spacing[key] = value;
    return this;
  }

  // Typography
  setFontFamily(family: Record<string, string>): this {
    this.tokens.typography.fontFamily = family;
    return this;
  }

  setFontSize(sizes: Record<string, string | [string, Record<string, string>]>): this {
    this.tokens.typography.fontSize = sizes;
    return this;
  }

  // Border radius
  setBorderRadius(radius: Record<string, string>): this {
    this.tokens.borderRadius = radius;
    return this;
  }

  // Shadows
  setShadows(shadows: Record<string, string>): this {
    this.tokens.shadows = shadows;
    return this;
  }

  // Breakpoints
  setBreakpoints(breakpoints: Record<string, string>): this {
    this.tokens.breakpoints = breakpoints;
    return this;
  }

  // Z-index
  setZIndex(zIndex: Record<string, number>): this {
    this.tokens.zIndex = zIndex;
    return this;
  }

  // Transitions
  setTransitions(transitions: Record<string, string>): this {
    this.tokens.transitions = transitions;
    return this;
  }

  // Animations
  setAnimations(animations: Record<string, string>): this {
    this.tokens.animation = animations;
    return this;
  }

  build(): DesignTokens {
    return this.tokens;
  }
}

// ============================================================================
// Validation
// ============================================================================

export function validateDesignTokens(tokens: unknown): { success: boolean; data?: DesignTokens; errors?: string[] } {
  const result = DesignTokensSchema.safeParse(tokens);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) };
}

// ============================================================================
// Theme Presets
// ============================================================================

export const themePresets = {
  default: defaultDesignTokens,

  // High contrast theme
  highContrast: {
    ...defaultDesignTokens,
    colors: {
      ...defaultDesignTokens.colors,
      background: { light: '#ffffff', dark: '#000000' },
      foreground: { light: '#000000', dark: '#ffffff' },
      border: { light: '#000000', dark: '#ffffff' },
      ring: { light: '#000000', dark: '#ffffff' },
    },
  },

  // Minimal theme
  minimal: {
    ...defaultDesignTokens,
    colors: {
      ...defaultDesignTokens.colors,
      primary: {
        50: '#f5f5f5',
        100: '#e5e5e5',
        200: '#d4d4d4',
        300: '#a3a3a3',
        400: '#737373',
        500: '#525252',
        600: '#404040',
        700: '#262626',
        800: '#171717',
        900: '#0a0a0a',
        950: '#050505',
      },
    },
    borderRadius: {
      none: '0',
      sm: '0',
      DEFAULT: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '9999px',
    },
  },

  // Warm theme
  warm: {
    ...defaultDesignTokens,
    colors: {
      ...defaultDesignTokens.colors,
      primary: {
        50: '#fff7ed',
        100: '#ffedd5',
        200: '#fed7aa',
        300: '#fdba74',
        400: '#fb923c',
        500: '#f97316',
        600: '#ea580c',
        700: '#c2410c',
        800: '#9a3412',
        900: '#7c2d12',
        950: '#431407',
      },
    },
  },

  // Cool theme
  cool: {
    ...defaultDesignTokens,
    colors: {
      ...defaultDesignTokens.colors,
      primary: {
        50: '#f0f9ff',
        100: '#e0f2fe',
        200: '#bae6fd',
        300: '#7dd3fc',
        400: '#38bdf8',
        500: '#0ea5e9',
        600: '#0284c7',
        700: '#0369a1',
        800: '#075985',
        900: '#0c4a6e',
        950: '#082f49',
      },
    },
  },
};

export type ThemePreset = keyof typeof themePresets;

export function getThemePreset(name: ThemePreset): DesignTokens {
  return themePresets[name] || themePresets.default;
}