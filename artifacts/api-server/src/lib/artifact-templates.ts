/**
 * PHASE 12 — ARTIFACT TEMPLATE SYSTEM
 *
 * UI templates for artifact generation. Includes Figma Community design kits
 * and pre-built templates. Optional when creating new artifacts/projects.
 * $0 budget: all Figma templates are free community files.
 */

import type { ArtifactTypeId, Framework } from "./artifact-types";

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

export type TemplateCategory =
  | "figma-design-kit"
  | "starter"
  | "dashboard"
  | "landing-page"
  | "saas"
  | "portfolio"
  | "blog"
  | "ecommerce"
  | "mobile"
  | "presentation"
  | "api"
  | "cli"
  | "extension";

export type TemplatePlatform =
  | "web"
  | "ios"
  | "ipados"
  | "macos"
  | "watchos"
  | "android"
  | "cross-platform";

export interface ArtifactTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: TemplateCategory;
  platform: TemplatePlatform;
  artifactType: ArtifactTypeId;
  framework: Framework;
  // Figma community file reference (if applicable)
  figmaUrl?: string;
  figmaFileId?: string;
  figmaFileName?: string;
  // Template files included
  files: TemplateFile[];
  // Install/setup commands
  installCommands: string[];
  devCommands: string[];
  // Preview image URL or emoji
  preview: string;
  // Tags for search
  tags: string[];
  // Difficulty level
  difficulty: "beginner" | "intermediate" | "advanced";
  // Estimated setup time
  setupTime: string;
  // Author/credit
  author?: string;
  // Whether this is a Figma-importable template
  isFigmaTemplate: boolean;
  // Colors used in the template
  colors: string[];
}

export interface TemplateFile {
  path: string;
  content: string;
  purpose: string;
  isEditable: boolean;
}

export interface TemplateRegistry {
  templates: ArtifactTemplate[];
  categories: TemplateCategory[];
  platforms: TemplatePlatform[];
}

// ============================================================================
// FIGMA COMMUNITY TEMPLATES (User-requested)
// ============================================================================

const IOS_27_TEMPLATE: ArtifactTemplate = {
  id: "ios-27-liquid-glass",
  name: "iOS & iPadOS 27 — Liquid Glass",
  description: "Official Apple iOS 27 & iPadOS 27 design system with Liquid Glass materials, SF Symbols 7, and latest Apple Human Interface Guidelines components. Direct from Figma Community.",
  icon: "📱",
  category: "figma-design-kit",
  platform: "ios",
  artifactType: "mobile-app",
  framework: "expo",
  figmaUrl: "https://www.figma.com/community/file/1651309003795292092/ios-and-ipados-27",
  figmaFileId: "1651309003795292092",
  figmaFileName: "iOS and iPadOS 27",
  files: [
    {
      path: "app.json",
      content: `{
  "expo": {
    "name": "iOS 27 App",
    "slug": "ios-27-app",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "splash": {
      "backgroundColor": "#000000"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.infinity.ios27app",
      "infoPlist": {
        "NSCameraUsageDescription": "This app uses the camera for AR features.",
        "NSFaceIDUsageDescription": "This app uses Face ID for authentication."
      }
    },
    "plugins": [
      [
        "expo-router",
        {
          "root": "./src"
        }
      ],
      "nativewind"
    ]
  }
}`,
      purpose: "Expo configuration for iOS 27 Liquid Glass app",
      isEditable: true,
    },
    {
      path: "src/theme/liquid-glass.ts",
      content: `/**
 * iOS 27 Liquid Glass Design Tokens
 * Based on Apple's official iOS 27 design system
 * Figma: https://www.figma.com/community/file/1651309003795292092
 */

export const LiquidGlassTheme = {
  // Material System — Liquid Glass
  materials: {
    regular: {
      background: "rgba(255, 255, 255, 0.72)",
      backgroundDark: "rgba(0, 0, 0, 0.65)",
      blur: 20,
      saturation: 1.2,
      border: "rgba(255, 255, 255, 0.18)",
      borderDark: "rgba(255, 255, 255, 0.08)",
    },
    thick: {
      background: "rgba(255, 255, 255, 0.85)",
      backgroundDark: "rgba(0, 0, 0, 0.80)",
      blur: 40,
      saturation: 1.4,
    },
    thin: {
      background: "rgba(255, 255, 255, 0.50)",
      backgroundDark: "rgba(0, 0, 0, 0.45)",
      blur: 12,
      saturation: 1.1,
    },
    ultraThin: {
      background: "rgba(255, 255, 255, 0.25)",
      backgroundDark: "rgba(0, 0, 0, 0.22)",
      blur: 8,
      saturation: 1.0,
    },
  },

  // System Colors (iOS 27)
  colors: {
    // Primary
    blue: "#007AFF",
    green: "#34C759",
    indigo: "#5856D6",
    mint: "#00C7BE",
    orange: "#FF9500",
    pink: "#FF2D55",
    purple: "#AF52DE",
    red: "#FF3B30",
    teal: "#5AC8FA",
    yellow: "#FFCC00",

    // System Backgrounds
    systemBackground: "#FFFFFF",
    systemBackgroundDark: "#000000",
    secondarySystemBackground: "#F2F2F7",
    secondarySystemBackgroundDark: "#1C1C1E",
    tertiarySystemBackground: "#FFFFFF",
    tertiarySystemBackgroundDark: "#2C2C2E",

    // Labels
    label: "#000000",
    labelDark: "#FFFFFF",
    secondaryLabel: "#3C3C43",
    secondaryLabelDark: "#EBEBF5",
    tertiaryLabel: "#3C3C4399",
    tertiaryLabelDark: "#EBEBF599",

    // Separators
    separator: "#3C3C4349",
    separatorDark: "#54545899",

    // Fill
    systemFill: "#78788033",
    systemFillDark: "#7878805B",
    secondarySystemFill: "#78788029",
    secondarySystemFillDark: "#76768036",
  },

  // Typography (SF Pro / SF Compact)
  typography: {
    largeTitle: { size: 34, weight: "bold", tracking: 0.37 },
    title1: { size: 28, weight: "bold", tracking: 0.36 },
    title2: { size: 22, weight: "bold", tracking: 0.35 },
    title3: { size: 20, weight: "semibold", tracking: 0.38 },
    headline: { size: 17, weight: "semibold", tracking: -0.41 },
    body: { size: 17, weight: "regular", tracking: -0.41 },
    callout: { size: 16, weight: "regular", tracking: -0.32 },
    subheadline: { size: 15, weight: "regular", tracking: -0.24 },
    footnote: { size: 13, weight: "regular", tracking: -0.08 },
    caption1: { size: 12, weight: "regular", tracking: 0 },
    caption2: { size: 11, weight: "regular", tracking: 0.07 },
  },

  // Spacing (iOS Human Interface Guidelines)
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
    xxxl: 44,
    section: 44,
    row: 44,
    gutter: 16,
    margin: 16,
    safeAreaTop: 59,
    safeAreaBottom: 34,
  },

  // Border Radius (iOS 27 — rounded rects)
  borderRadius: {
    small: 8,
    medium: 12,
    large: 16,
    xlarge: 20,
    xxlarge: 24,
    card: 16,
    button: 12,
    input: 10,
    avatar: 9999,
    pill: 9999,
  },

  // Shadows (iOS style)
  shadows: {
    small: { x: 0, y: 1, blur: 3, opacity: 0.12 },
    medium: { x: 0, y: 4, blur: 12, opacity: 0.15 },
    large: { x: 0, y: 10, blur: 40, opacity: 0.20 },
    sheet: { x: 0, y: -2, blur: 16, opacity: 0.15 },
  },

  // Animation (iOS 27 spring physics)
  animation: {
    defaultDuration: 0.35,
    spring: { damping: 12, stiffness: 200, mass: 1 },
    sheetSpring: { damping: 15, stiffness: 180, mass: 1 },
    reducedMotion: { duration: 0.001 },
  },
} as const;

export type LiquidGlassTheme = typeof LiquidGlassTheme;`,
      purpose: "iOS 27 Liquid Glass design tokens extracted from Figma",
      isEditable: true,
    },
    {
      path: "src/components/LiquidGlassCard.tsx",
      content: `import React from "react";
import { View, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { useColorScheme } from "react-native";
import { LiquidGlassTheme } from "../theme/liquid-glass";

interface LiquidGlassCardProps {
  children: React.ReactNode;
  intensity?: "ultraThin" | "thin" | "regular" | "thick";
  style?: any;
}

/**
 * iOS 27 Liquid Glass card component
 * Uses expo-blur for the signature liquid glass material
 */
export function LiquidGlassCard({
  children,
  intensity = "regular",
  style,
}: LiquidGlassCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const material = LiquidGlassTheme.materials[intensity];

  return (
    <View style={[styles.container, style]}>
      <BlurView
        intensity={material.blur}
        tint={isDark ? "dark" : "light"}
        style={[
          styles.blurView,
          {
            backgroundColor: isDark
              ? material.backgroundDark
              : material.background,
          },
        ]}
      >
        <View
          style={[
            styles.border,
            {
              borderColor: isDark
                ? LiquidGlassTheme.colors.separatorDark
                : LiquidGlassTheme.colors.separator,
            },
          ]}
        />
        {children}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: LiquidGlassTheme.borderRadius.card,
    overflow: "hidden",
  },
  blurView: {
    padding: LiquidGlassTheme.spacing.md,
    borderRadius: LiquidGlassTheme.borderRadius.card,
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: LiquidGlassTheme.borderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    pointerEvents: "none",
  },
});`,
      purpose: "iOS 27 Liquid Glass card component using expo-blur",
      isEditable: true,
    },
  ],
  installCommands: ["npx create-expo-app@latest --template blank-typescript"],
  devCommands: ["npx expo start"],
  preview: "📱",
  tags: ["ios", "ipados", "liquid-glass", "apple", "sf-symbols", "design-system", "figma"],
  difficulty: "intermediate",
  setupTime: "15 min",
  author: "Apple (Figma Community)",
  isFigmaTemplate: true,
  colors: ["#007AFF", "#34C759", "#FF3B30", "#FF9500", "#AF52DE"],
};

const MACOS_27_TEMPLATE: ArtifactTemplate = {
  id: "macos-27",
  name: "macOS 27",
  description: "Official macOS 27 design system from Apple. Includes window chrome, sidebars, toolbars, inspectors, menus, and the latest macOS design patterns. Direct from Figma Community.",
  icon: "💻",
  category: "figma-design-kit",
  platform: "macos",
  artifactType: "web-app",
  framework: "next",
  figmaUrl: "https://www.figma.com/community/file/1651309434229735362/macos-27",
  figmaFileId: "1651309434229735362",
  figmaFileName: "macOS 27",
  files: [
    {
      path: "src/theme/macos-27.ts",
      content: `/**
 * macOS 27 Design Tokens
 * Based on Apple's official macOS 27 design system
 * Figma: https://www.figma.com/community/file/1651309434229735362
 */

export const MacOSTheme = {
  // Window Chrome
  window: {
    titleBarHeight: 52,
    toolbarHeight: 44,
    sidebarWidth: 220,
    inspectorWidth: 280,
    minWidth: 600,
    minHeight: 400,
    cornerRadius: 10,
    titleBarBackground: "rgba(246, 246, 246, 0.95)",
    titleBarBackgroundDark: "rgba(30, 30, 30, 0.95)",
  },

  // Sidebar
  sidebar: {
    background: "rgba(246, 246, 246, 0.90)",
    backgroundDark: "rgba(30, 30, 30, 0.90)",
    selectedItem: "rgba(0, 122, 255, 0.15)",
    selectedItemDark: "rgba(0, 122, 255, 0.25)",
    hoverItem: "rgba(0, 0, 0, 0.05)",
    hoverItemDark: "rgba(255, 255, 255, 0.05)",
    sectionHeaderHeight: 32,
    itemHeight: 28,
    iconSize: 16,
    indent: 12,
  },

  // Toolbar
  toolbar: {
    height: 44,
    background: "rgba(246, 246, 246, 0.95)",
    backgroundDark: "rgba(30, 30, 30, 0.95)",
    itemSpacing: 4,
    itemPadding: 6,
    iconSize: 18,
    separatorWidth: 1,
    separatorColor: "rgba(0, 0, 0, 0.1)",
    separatorColorDark: "rgba(255, 255, 255, 0.1)",
  },

  // Inspector Panel
  inspector: {
    width: 280,
    background: "rgba(246, 246, 246, 0.95)",
    backgroundDark: "rgba(30, 30, 30, 0.95)",
    sectionHeight: 44,
    propertyHeight: 28,
  },

  // Colors (macOS system colors)
  colors: {
    // Control tint colors
    blue: "#007AFF",
    purple: "#AF52DE",
    pink: "#FF2D55",
    red: "#FF3B30",
    orange: "#FF9500",
    yellow: "#FFCC00",
    green: "#28CD41",
    mint: "#00C7BE",
    teal: "#5AC8FA",
    gray: "#8E8E93",

    // Semantic
    controlBackground: "#FFFFFF",
    controlBackgroundDark: "#3A3A3C",
    controlBorder: "rgba(0, 0, 0, 0.1)",
    controlBorderDark: "rgba(255, 255, 255, 0.1)",
    controlSelected: "#007AFF",

    // Backgrounds
    windowBackground: "#F6F6F6",
    windowBackgroundDark: "#1E1E1E",
    sheetBackground: "#FFFFFF",
    sheetBackgroundDark: "#2C2C2E",
    popoverBackground: "#FFFFFF",
    popoverBackgroundDark: "#3A3A3C",
  },

  // Typography (San Francisco)
  typography: {
    systemLargeTitle: { size: 26, weight: 700, lineHeight: 32 },
    systemTitle1: { size: 22, weight: 700, lineHeight: 28 },
    systemTitle2: { size: 17, weight: 700, lineHeight: 22 },
    systemTitle3: { size: 15, weight: 600, lineHeight: 20 },
    systemHeadline: { size: 13, weight: 600, lineHeight: 16 },
    systemBody: { size: 13, weight: 400, lineHeight: 16 },
    systemCallout: { size: 12, weight: 400, lineHeight: 16 },
    systemSubheadline: { size: 11, weight: 400, lineHeight: 14 },
    systemFootnote: { size: 10, weight: 400, lineHeight: 13 },
    systemCaption1: { size: 10, weight: 400, lineHeight: 13 },
    systemCaption2: { size: 10, weight: 400, lineHeight: 13 },
    mono: { size: 13, weight: 400, lineHeight: 16, family: "SF Mono" },
  },

  // Spacing
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },

  // Border Radius
  borderRadius: {
    small: 4,
    medium: 6,
    large: 8,
    xlarge: 10,
    control: 6,
  },

  // Shadows
  shadows: {
    window: { x: 0, y: 8, blur: 32, opacity: 0.15, color: "rgba(0,0,0,0.3)" },
    popover: { x: 0, y: 4, blur: 16, opacity: 0.12, color: "rgba(0,0,0,0.25)" },
    sheet: { x: 0, y: -1, blur: 8, opacity: 0.1, color: "rgba(0,0,0,0.2)" },
    toolbar: { x: 0, y: 1, blur: 0, opacity: 0.1, color: "rgba(0,0,0,0.1)", inset: true },
  },
} as const;`,
      purpose: "macOS 27 design tokens from Apple Figma",
      isEditable: true,
    },
  ],
  installCommands: ["npx create-next-app@latest --typescript --tailwind --app"],
  devCommands: ["npm run dev"],
  preview: "💻",
  tags: ["macos", "apple", "desktop", "sidebar", "toolbar", "inspector", "figma"],
  difficulty: "intermediate",
  setupTime: "15 min",
  author: "Apple (Figma Community)",
  isFigmaTemplate: true,
  colors: ["#007AFF", "#AF52DE", "#FF2D55", "#FF3B30", "#FF9500"],
};

const MATERIAL_YOU_3_TEMPLATE: ArtifactTemplate = {
  id: "material-you-3",
  name: "Material You 3",
  description: "Google's Material Design 3 (Material You) design kit. Dynamic color, M3 components, motion system, typography scale, and elevation. Direct from Figma Community.",
  icon: "🎨",
  category: "figma-design-kit",
  platform: "cross-platform",
  artifactType: "web-app",
  framework: "next",
  figmaUrl: "https://www.figma.com/community/file/1035203688168086460/material-3-design-kit",
  figmaFileId: "1035203688168086460",
  figmaFileName: "Material 3 Design Kit",
  files: [
    {
      path: "src/theme/material-you-3.ts",
      content: `/**
 * Material You 3 (Material Design 3) Design Tokens
 * Based on Google's official M3 design kit
 * Figma: https://www.figma.com/community/file/1035203688168086460
 */

export const MaterialYouTheme = {
  // M3 Color System — Dynamic Color
  colors: {
    // Light Theme
    light: {
      // Primary
      primary: "#6750A4",
      onPrimary: "#FFFFFF",
      primaryContainer: "#EADDFF",
      onPrimaryContainer: "#21005E",

      // Secondary
      secondary: "#625B71",
      onSecondary: "#FFFFFF",
      secondaryContainer: "#E8DEF8",
      onSecondaryContainer: "#1E192B",

      // Tertiary
      tertiary: "#7D5260",
      onTertiary: "#FFFFFF",
      tertiaryContainer: "#FFD8E4",
      onTertiaryContainer: "#370B1E",

      // Error
      error: "#B3261E",
      onError: "#FFFFFF",
      errorContainer: "#F9DEDC",
      onErrorContainer: "#410E0B",

      // Background & Surface
      background: "#FEF7FF",
      onBackground: "#1D1B20",
      surface: "#FEF7FF",
      onSurface: "#1D1B20",
      surfaceVariant: "#E7E0EC",
      onSurfaceVariant: "#49454E",
      surfaceContainerLowest: "#FFFFFF",
      surfaceContainerLow: "#F7F2FA",
      surfaceContainer: "#F3EDF7",
      surfaceContainerHigh: "#ECE6F0",
      surfaceContainerHighest: "#E6E0E9",

      // Outline
      outline: "#79747E",
      outlineVariant: "#CAC4D0",

      // Inverse
      inverseSurface: "#322F35",
      inverseOnSurface: "#F5EFF7",
      inversePrimary: "#D0BCFF",

      // Scrim & Shadow
      scrim: "#000000",
      shadow: "#000000",
      surfaceTint: "#6750A4",
    },

    // Dark Theme
    dark: {
      primary: "#D0BCFF",
      onPrimary: "#371E73",
      primaryContainer: "#4F378B",
      onPrimaryContainer: "#EADDFF",

      secondary: "#CCC2DC",
      onSecondary: "#332D41",
      secondaryContainer: "#4A4458",
      onSecondaryContainer: "#E8DEF8",

      tertiary: "#EFB8C8",
      onTertiary: "#492532",
      tertiaryContainer: "#633B48",
      onTertiaryContainer: "#FFD8E4",

      error: "#F2B8B5",
      onError: "#601410",
      errorContainer: "#8C1D18",
      onErrorContainer: "#F9DEDC",

      background: "#141218",
      onBackground: "#E6E0E9",
      surface: "#141218",
      onSurface: "#E6E0E9",
      surfaceVariant: "#49454F",
      onSurfaceVariant: "#CAC4D0",
      surfaceContainerLowest: "#0F0D13",
      surfaceContainerLow: "#1D1B20",
      surfaceContainer: "#211F26",
      surfaceContainerHigh: "#2B2930",
      surfaceContainerHighest: "#36343B",

      outline: "#938F99",
      outlineVariant: "#49454F",

      inverseSurface: "#E6E0E9",
      inverseOnSurface: "#322F35",
      inversePrimary: "#6750A4",

      scrim: "#000000",
      shadow: "#000000",
      surfaceTint: "#D0BCFF",
    },
  },

  // M3 Typography Scale
  typography: {
    displayLarge: { size: 57, weight: 400, lineHeight: 64, tracking: -0.25 },
    displayMedium: { size: 45, weight: 400, lineHeight: 52, tracking: 0 },
    displaySmall: { size: 36, weight: 400, lineHeight: 44, tracking: 0 },
    headlineLarge: { size: 32, weight: 400, lineHeight: 40, tracking: 0 },
    headlineMedium: { size: 28, weight: 400, lineHeight: 36, tracking: 0 },
    headlineSmall: { size: 24, weight: 400, lineHeight: 32, tracking: 0 },
    titleLarge: { size: 22, weight: 400, lineHeight: 28, tracking: 0 },
    titleMedium: { size: 16, weight: 500, lineHeight: 24, tracking: 0.15 },
    titleSmall: { size: 14, weight: 500, lineHeight: 20, tracking: 0.1 },
    bodyLarge: { size: 16, weight: 400, lineHeight: 24, tracking: 0.5 },
    bodyMedium: { size: 14, weight: 400, lineHeight: 20, tracking: 0.25 },
    bodySmall: { size: 12, weight: 400, lineHeight: 16, tracking: 0.4 },
    labelLarge: { size: 14, weight: 500, lineHeight: 20, tracking: 0.1 },
    labelMedium: { size: 12, weight: 500, lineHeight: 16, tracking: 0.5 },
    labelSmall: { size: 11, weight: 500, lineHeight: 16, tracking: 0.5 },
  },

  // M3 Shape Scale
  shape: {
    none: 0,
    extraSmall: 4,
    small: 8,
    medium: 12,
    large: 16,
    extraLarge: 28,
    full: 9999,
  },

  // M3 Elevation
  elevation: {
    level0: "none",
    level1: "0 1px 2px rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15)",
    level2: "0 1px 2px rgba(0,0,0,0.3), 0 2px 6px 2px rgba(0,0,0,0.15)",
    level3: "0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3)",
    level4: "0 6px 10px 4px rgba(0,0,0,0.15), 0 2px 3px rgba(0,0,0,0.3)",
    level5: "0 8px 12px 6px rgba(0,0,0,0.15), 0 4px 4px rgba(0,0,0,0.3)",
  },

  // M3 Motion
  motion: {
    easing: {
      emphasized: "cubic-bezier(0.2, 0, 0, 1)",
      emphasizedDecelerate: "cubic-bezier(0.05, 0.7, 0.1, 1)",
      emphasizedAccelerate: "cubic-bezier(0.3, 0, 0.8, 0.15)",
      standard: "cubic-bezier(0.2, 0, 0, 1)",
      standardDecelerate: "cubic-bezier(0, 0, 0, 1)",
      standardAccelerate: "cubic-bezier(0.3, 0, 1, 1)",
    },
    duration: {
      short1: 50,
      short2: 100,
      short3: 150,
      short4: 200,
      medium1: 250,
      medium2: 300,
      medium3: 350,
      medium4: 400,
      long1: 450,
      long2: 500,
      long3: 550,
      long4: 600,
      extraLong1: 700,
      extraLong2: 800,
      extraLong3: 900,
      extraLong4: 1000,
    },
  },

  // M3 Spacing
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
} as const;`,
      purpose: "Material You 3 design tokens from Google Figma",
      isEditable: true,
    },
  ],
  installCommands: ["npx create-next-app@latest --typescript --tailwind --app"],
  devCommands: ["npm run dev"],
  preview: "🎨",
  tags: ["material", "design", "google", "m3", "dynamic-color", "android", "figma"],
  difficulty: "intermediate",
  setupTime: "15 min",
  author: "Google (Figma Community)",
  isFigmaTemplate: true,
  colors: ["#6750A4", "#625B71", "#7D5260", "#B3261E", "#79747E"],
};

const WATCHOS_TEMPLATE: ArtifactTemplate = {
  id: "watchos",
  name: "watchOS",
  description: "Apple watchOS design system with watch faces, complications, app layouts, and HealthKit integration patterns. Direct from Figma Community.",
  icon: "⌚",
  category: "figma-design-kit",
  platform: "watchos",
  artifactType: "mobile-app",
  framework: "expo",
  figmaUrl: "https://www.figma.com/community/file/1540060090060216489",
  figmaFileId: "1540060090060216489",
  figmaFileName: "watchOS",
  files: [
    {
      path: "src/theme/watchos.ts",
      content: `/**
 * watchOS Design Tokens
 * Based on Apple's watchOS design system
 * Figma: https://www.figma.com/community/file/1540060090060216489
 */

export const WatchOSTheme = {
  // Device dimensions
  device: {
    // Apple Watch Ultra 2 (49mm)
    ultra: { width: 2056, height: 2462, ppi: 338 },
    // Apple Watch Series 9 (45mm)
    series45: { width: 198, height: 242, ppi: 326 },
    // Apple Watch Series 9 (41mm)
    series41: { width: 176, height: 215, ppi: 326 },
  },

  // Colors
  colors: {
    // System
    black: "#000000",
    white: "#FFFFFF",
    red: "#FF3B30",
    green: "#30D158",
    blue: "#007AFF",
    yellow: "#FFD60A",
    orange: "#FF9F0A",
    pink: "#FF375F",
    purple: "#BF5AF2",
    teal: "#64D2FF",
    mint: "#00C7BE",
    cyan: "#5AC8FA",
    gray: "#8E8E93",
    gray2: "#AEAEB2",
    gray3: "#C7C7CC",
    gray4: "#D1D1D6",
    gray5: "#E5E5EA",
    gray6: "#F2F2F7",

    // Semantic
    background: "#000000",
    foreground: "#FFFFFF",
    accent: "#FF375F",
    tint: "#FF375F",
  },

  // Typography (SF Compact)
  typography: {
    // Optimized for small displays
    extraLargeTitle: { size: 34, weight: "bold", tracking: 0.4 },
    largeTitle: { size: 28, weight: "bold", tracking: 0.36 },
    title1: { size: 22, weight: "bold", tracking: 0.35 },
    title2: { size: 20, weight: "semibold", tracking: 0.38 },
    title3: { size: 17, weight: "semibold", tracking: 0.41 },
    headline: { size: 16, weight: "semibold", tracking: -0.32 },
    body: { size: 14, weight: "regular", tracking: -0.24 },
    callout: { size: 13, weight: "regular", tracking: -0.16 },
    footnote: { size: 12, weight: "regular", tracking: -0.08 },
    caption1: { size: 11, weight: "regular", tracking: 0.06 },
    caption2: { size: 10, weight: "regular", tracking: 0.07 },
    // Watch-specific
    complication: { size: 42, weight: "bold", tracking: 0 },
    systemLarge: { size: 60, weight: "bold", tracking: 0 },
    systemMedium: { size: 40, weight: "semibold", tracking: 0 },
    systemSmall: { size: 20, weight: "semibold", tracking: 0 },
    systemExtraLarge: { size: 80, weight: "bold", tracking: 0 },
  },

  // Spacing (optimized for touch targets — min 44pt)
  spacing: {
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
    touchTarget: 44,
    edgeMargin: 4,
  },

  // Border Radius
  borderRadius: {
    small: 4,
    medium: 8,
    large: 12,
    xlarge: 16,
    device: 48, // Watch screen corner radius
    complication: 8,
  },

  // Complications
  complications: {
    size: {
      small: 44,
      medium: 80,
      large: 160,
    },
    cornerRadius: 8,
  },

  // Animation
  animation: {
    defaultDuration: 0.3,
    spring: { damping: 15, stiffness: 200, mass: 1 },
    reducedMotion: { duration: 0.001 },
  },
} as const;`,
      purpose: "watchOS design tokens from Apple Figma",
      isEditable: true,
    },
  ],
  installCommands: ["npx create-expo-app@latest --template blank-typescript"],
  devCommands: ["npx expo start"],
  preview: "⌚",
  tags: ["watchos", "apple", "watch", "wearable", "healthkit", "figma"],
  difficulty: "advanced",
  setupTime: "20 min",
  author: "Apple (Figma Community)",
  isFigmaTemplate: true,
  colors: ["#FF375F", "#30D158", "#007AFF", "#FFD60A", "#BF5AF2"],
};

const DASHBOARD_UI_KIT_TEMPLATE: ArtifactTemplate = {
  id: "dashboard-admin",
  name: "Dashboard UI Kit",
  description: "Professional admin dashboard UI kit with charts, tables, forms, navigation, and analytics components. Free community template from Figma.",
  icon: "📊",
  category: "figma-design-kit",
  platform: "web",
  artifactType: "web-app",
  framework: "next",
  figmaUrl: "https://www.figma.com/community/file/1210542873091115123/dashboard-ui-kit-dashboard-free-admin-dashboard",
  figmaFileId: "1210542873091115123",
  figmaFileName: "Dashboard UI Kit",
  files: [
    {
      path: "src/theme/dashboard.ts",
      content: `/**
 * Dashboard UI Kit Design Tokens
 * Professional admin dashboard theme
 * Figma: https://www.figma.com/community/file/1210542873091115123
 */

export const DashboardTheme = {
  colors: {
    // Primary
    primary: "#6366F1",
    primaryLight: "#818CF8",
    primaryDark: "#4F46E5",

    // Sidebar
    sidebarBackground: "#0F172A",
    sidebarText: "#94A3B8",
    sidebarTextActive: "#FFFFFF",
    sidebarHover: "rgba(255, 255, 255, 0.05)",
    sidebarActive: "rgba(99, 102, 241, 0.2)",
    sidebarWidth: 260,
    sidebarCollapsedWidth: 72,

    // Content
    background: "#F8FAFC",
    surface: "#FFFFFF",
    surfaceHover: "#F1F5F9",
    border: "#E2E8F0",
    divider: "#F1F5F9",

    // Text
    textPrimary: "#0F172A",
    textSecondary: "#475569",
    textTertiary: "#94A3B8",
    textInverse: "#FFFFFF",

    // Status
    success: "#10B981",
    successLight: "#D1FAE5",
    warning: "#F59E0B",
    warningLight: "#FEF3C7",
    error: "#EF4444",
    errorLight: "#FEE2E2",
    info: "#3B82F6",
    infoLight: "#DBEAFE",

    // Charts
    chart1: "#6366F1",
    chart2: "#EC4899",
    chart3: "#F59E0B",
    chart4: "#10B981",
    chart5: "#3B82F6",
    chart6: "#8B5CF6",
  },

  typography: {
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    h1: { size: 30, weight: 700, lineHeight: 36 },
    h2: { size: 24, weight: 700, lineHeight: 32 },
    h3: { size: 20, weight: 600, lineHeight: 28 },
    h4: { size: 16, weight: 600, lineHeight: 24 },
    body: { size: 14, weight: 400, lineHeight: 20 },
    bodySmall: { size: 13, weight: 400, lineHeight: 18 },
    caption: { size: 12, weight: 400, lineHeight: 16 },
    overline: { size: 11, weight: 500, lineHeight: 16, letterSpacing: "0.05em" },
    mono: { size: 13, weight: 400, lineHeight: 18, family: "'JetBrains Mono', monospace" },
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },

  borderRadius: {
    sm: 4,
    md: 6,
    lg: 8,
    xl: 12,
    xxl: 16,
    full: 9999,
  },

  shadows: {
    sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
    xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
  },
} as const;`,
      purpose: "Dashboard UI kit design tokens from Figma",
      isEditable: true,
    },
  ],
  installCommands: ["npx create-next-app@latest --typescript --tailwind --app --eslint"],
  devCommands: ["npm run dev"],
  preview: "📊",
  tags: ["dashboard", "admin", "analytics", "charts", "tables", "saas", "figma"],
  difficulty: "beginner",
  setupTime: "10 min",
  author: "UI Kit (Figma Community)",
  isFigmaTemplate: true,
  colors: ["#6366F1", "#EC4899", "#F59E0B", "#10B981", "#3B82F6"],
};

// ============================================================================
// ADDITIONAL TEMPLATES (User-decided additions)
// ============================================================================

const SaaS_LANDING_TEMPLATE: ArtifactTemplate = {
  id: "saas-landing",
  name: "SaaS Landing Page",
  description: "Modern SaaS landing page with hero, features, pricing, testimonials, and CTA sections. Built with Tailwind CSS and responsive design.",
  icon: "🚀",
  category: "landing-page",
  platform: "web",
  artifactType: "website",
  framework: "astro",
  files: [
    {
      path: "src/pages/index.astro",
      content: `---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/Hero.astro';
import Features from '../components/Features.astro';
import Pricing from '../components/Pricing.astro';
import Testimonials from '../components/Testimonials.astro';
import CTA from '../components/CTA.astro';
import Footer from '../components/Footer.astro';
---

<Layout title="Your SaaS Product">
  <Hero />
  <Features />
  <Pricing />
  <Testimonials />
  <CTA />
  <Footer />
</Layout>`,
      purpose: "Main landing page with all sections",
      isEditable: true,
    },
  ],
  installCommands: ["npm create astro@latest -- --template basics"],
  devCommands: ["npm run dev"],
  preview: "🚀",
  tags: ["landing", "saas", "marketing", "responsive", "tailwind"],
  difficulty: "beginner",
  setupTime: "5 min",
  isFigmaTemplate: false,
  colors: ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#3B82F6"],
};

const PORTFOLIO_TEMPLATE: ArtifactTemplate = {
  id: "portfolio",
  name: "Developer Portfolio",
  description: "Clean developer portfolio with project showcase, blog, skills, and contact form. Minimalist design, fast performance.",
  icon: "👨‍💻",
  category: "portfolio",
  platform: "web",
  artifactType: "website",
  framework: "astro",
  files: [
    {
      path: "src/pages/index.astro",
      content: `---
import Layout from '../layouts/Layout.astro';
import Header from '../components/Header.astro';
import Hero from '../components/Hero.astro';
import Projects from '../components/Projects.astro';
import Skills from '../components/Skills.astro';
import Blog from '../components/Blog.astro';
import Contact from '../components/Contact.astro';
import Footer from '../components/Footer.astro';
---

<Layout title="Developer Portfolio">
  <Header />
  <Hero />
  <Projects />
  <Skills />
  <Blog />
  <Contact />
  <Footer />
</Layout>`,
      purpose: "Main portfolio page",
      isEditable: true,
    },
  ],
  installCommands: ["npm create astro@latest -- --template basics"],
  devCommands: ["npm run dev"],
  preview: "👨‍💻",
  tags: ["portfolio", "developer", "personal", "blog", "minimal"],
  difficulty: "beginner",
  setupTime: "5 min",
  isFigmaTemplate: false,
  colors: ["#0F172A", "#6366F1", "#10B981", "#F8FAFC", "#E2E8F0"],
};

const ECOMMERCE_TEMPLATE: ArtifactTemplate = {
  id: "ecommerce",
  name: "E-commerce Store",
  description: "Full-featured e-commerce store with product catalog, cart, checkout, and user accounts. Stripe integration ready.",
  icon: "🛒",
  category: "ecommerce",
  platform: "web",
  artifactType: "web-app",
  framework: "next",
  files: [
    {
      path: "src/app/page.tsx",
      content: `import { ProductGrid } from '@/components/ProductGrid';
import { Hero } from '@/components/Hero';
import { Categories } from '@/components/Categories';

export default function Home() {
  return (
    <main>
      <Hero />
      <Categories />
      <ProductGrid />
    </main>
  );
}`,
      purpose: "Main e-commerce page",
      isEditable: true,
    },
  ],
  installCommands: ["npx create-next-app@latest --typescript --tailwind --app"],
  devCommands: ["npm run dev"],
  preview: "🛒",
  tags: ["ecommerce", "store", "shop", "stripe", "cart", "checkout"],
  difficulty: "intermediate",
  setupTime: "15 min",
  isFigmaTemplate: false,
  colors: ["#000000", "#FFFFFF", "#059669", "#F59E0B", "#EF4444"],
};

const BLOG_TEMPLATE: ArtifactTemplate = {
  id: "blog",
  name: "Blog / MDX",
  description: "Fast, SEO-optimized blog with MDX support, syntax highlighting, RSS feed, and newsletter signup.",
  icon: "✍️",
  category: "blog",
  platform: "web",
  artifactType: "website",
  framework: "astro",
  files: [
    {
      path: "src/content/config.ts",
      content: `import { defineCollection, z } from 'astro:content';

const postsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    heroImage: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  posts: postsCollection,
};`,
      purpose: "Content collection schema for blog posts",
      isEditable: true,
    },
  ],
  installCommands: ["npm create astro@latest -- --template blog"],
  devCommands: ["npm run dev"],
  preview: "✍️",
  tags: ["blog", "mdx", "seo", "content", "newsletter"],
  difficulty: "beginner",
  setupTime: "5 min",
  isFigmaTemplate: false,
  colors: ["#0F172A", "#6366F1", "#10B981", "#F8FAFC", "#E2E8F0"],
};

const API_STARTER_TEMPLATE: ArtifactTemplate = {
  id: "api-starter",
  name: "REST API Starter",
  description: "Production-ready REST API with Hono, Zod validation, Drizzle ORM, JWT auth, rate limiting, and OpenAPI docs.",
  icon: "🔌",
  category: "api",
  platform: "web",
  artifactType: "api",
  framework: "hono",
  files: [
    {
      path: "src/index.ts",
      content: `import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { swaggerUI } from '@hono/swagger-ui';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());
app.use('*', prettyJSON());

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Swagger UI
app.get('/docs', swaggerUI({ url: '/api-docs' }));

// API routes
app.route('/api/users', usersRoutes);
app.route('/api/posts', postsRoutes);

export default {
  port: 3000,
  fetch: app.fetch,
};`,
      purpose: "Main API server entry point",
      isEditable: true,
    },
  ],
  installCommands: ["npm init -y", "npm install hono @hono/swagger-ui"],
  devCommands: ["npx tsx watch src/index.ts"],
  preview: "🔌",
  tags: ["api", "rest", "hono", "backend", "openapi"],
  difficulty: "beginner",
  setupTime: "5 min",
  isFigmaTemplate: false,
  colors: ["#059669", "#10B981", "#34D399", "#6EE7B7", "#A7F3D0"],
};

const CLI_STARTER_TEMPLATE: ArtifactTemplate = {
  id: "cli-starter",
  name: "CLI Tool Starter",
  description: "Production-ready CLI tool with Commander.js, TypeScript, auto-complete, config file support, and tests.",
  icon: "⌨️",
  category: "cli",
  platform: "web",
  artifactType: "cli-tool",
  framework: "commander",
  files: [
    {
      path: "src/index.ts",
      content: `#!/usr/bin/env node
import { Command } from 'commander';
import { version } from '../package.json';

const program = new Command();

program
  .name('my-cli')
  .description('My awesome CLI tool')
  .version(version);

program
  .command('hello [name]')
  .description('Say hello to someone')
  .option('--upper', 'Uppercase the greeting')
  .action((name: string, options: { upper?: boolean }) => {
    const greeting = \`Hello, \${name || 'World'}!\`;
    console.log(options.upper ? greeting.toUpperCase() : greeting);
  });

program.parse();`,
      purpose: "Main CLI entry point",
      isEditable: true,
    },
  ],
  installCommands: ["npm init -y", "npm install commander"],
  devCommands: ["npx tsx src/index.ts"],
  preview: "⌨️",
  tags: ["cli", "commander", "typescript", "tool"],
  difficulty: "beginner",
  setupTime: "5 min",
  isFigmaTemplate: false,
  colors: ["#6B7280", "#9CA3AF", "#D1D5DB", "#F3F4F6", "#111827"],
};

const CHROME_EXTENSION_TEMPLATE: ArtifactTemplate = {
  id: "chrome-extension",
  name: "Chrome Extension",
  description: "Manifest V3 Chrome extension with popup, content scripts, background service worker, and storage API.",
  icon: "🧩",
  category: "extension",
  platform: "web",
  artifactType: "chrome-extension",
  framework: "manifest-v3",
  files: [
    {
      path: "manifest.json",
      content: `{
  "manifest_version": 3,
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A Chrome extension built with Infinity AI",
  "permissions": ["storage", "activeTab"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icons/icon-48.png"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"]
    }
  ]
}`,
      purpose: "Manifest V3 configuration",
      isEditable: true,
    },
  ],
  installCommands: [],
  devCommands: [],
  preview: "🧩",
  tags: ["chrome", "extension", "browser", "manifest-v3"],
  difficulty: "beginner",
  setupTime: "5 min",
  isFigmaTemplate: false,
  colors: ["#4285F4", "#34A853", "#FBBC05", "#EA4335", "#FFFFFF"],
};

const REACT_NATIVE_DASHBOARD_TEMPLATE: ArtifactTemplate = {
  id: "rn-dashboard",
  name: "React Native Dashboard",
  description: "Cross-platform dashboard app with charts, lists, notifications, and profile management. React Native + Expo.",
  icon: "📱",
  category: "mobile",
  platform: "cross-platform",
  artifactType: "mobile-app",
  framework: "expo",
  files: [
    {
      path: "app/(tabs)/dashboard.tsx",
      content: `import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Card } from '@/components/Card';
import { StatCard } from '@/components/StatCard';
import { Chart } from '@/components/Chart';

export default function DashboardScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Dashboard</Text>

      <View style={styles.statsRow}>
        <StatCard title="Users" value="12,345" change="+12%" color="#6366F1" />
        <StatCard title="Revenue" value="$45,678" change="+8%" color="#10B981" />
      </View>

      <Card title="Analytics">
        <Chart />
      </Card>

      <Card title="Recent Activity">
        {/* Activity list */}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 24, fontWeight: '700', padding: 16 },
  statsRow: { flexDirection: 'row', gap: 12, padding: 16 },
});`,
      purpose: "Main dashboard screen",
      isEditable: true,
    },
  ],
  installCommands: ["npx create-expo-app@latest --template tabs"],
  devCommands: ["npx expo start"],
  preview: "📱",
  tags: ["react-native", "dashboard", "mobile", "expo", "charts"],
  difficulty: "intermediate",
  setupTime: "10 min",
  isFigmaTemplate: false,
  colors: ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#3B82F6"],
};

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================

export const ALL_TEMPLATES: ArtifactTemplate[] = [
  // Figma Community Templates (User-requested)
  IOS_27_TEMPLATE,
  MACOS_27_TEMPLATE,
  MATERIAL_YOU_3_TEMPLATE,
  WATCHOS_TEMPLATE,
  DASHBOARD_UI_KIT_TEMPLATE,

  // Additional Templates
  SaaS_LANDING_TEMPLATE,
  PORTFOLIO_TEMPLATE,
  ECOMMERCE_TEMPLATE,
  BLOG_TEMPLATE,
  API_STARTER_TEMPLATE,
  CLI_STARTER_TEMPLATE,
  CHROME_EXTENSION_TEMPLATE,
  REACT_NATIVE_DASHBOARD_TEMPLATE,
];

export function getTemplateRegistry(): TemplateRegistry {
  const categories = [...new Set(ALL_TEMPLATES.map((t) => t.category))];
  const platforms = [...new Set(ALL_TEMPLATES.map((t) => t.platform))];

  return {
    templates: ALL_TEMPLATES,
    categories: categories.sort(),
    platforms: platforms.sort(),
  };
}

export function getTemplate(id: string): ArtifactTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByArtifactType(type: ArtifactTypeId): ArtifactTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.artifactType === type);
}

export function getTemplatesByCategory(category: TemplateCategory): ArtifactTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.category === category);
}

export function getTemplatesByPlatform(platform: TemplatePlatform): ArtifactTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.platform === platform);
}

export function getFigmaTemplates(): ArtifactTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.isFigmaTemplate);
}

export function searchTemplates(query: string): ArtifactTemplate[] {
  const lower = query.toLowerCase();
  return ALL_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.tags.some((tag) => tag.includes(lower))
  );
}
