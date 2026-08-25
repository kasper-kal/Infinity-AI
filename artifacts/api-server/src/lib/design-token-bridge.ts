/**
 * Design Token Bridge — Unified interface for iOS 27 Liquid Glass + Material You 3
 *
 * This bridges both official Figma design kits and provides a single API for
 * generating platform-native components. It NEVER produces "style knock-offs" —
 * it always emits components that mirror the OFFICIAL system components from
 * the live Figma kits.
 *
 * CRITICAL RULES (per project owner):
 *   - iOS → always use OFFICIAL iOS 27 Liquid Glass components from Apple's kit
 *   - Android → always use OFFICIAL Material You 3 components from Google's kit
 *   - Web → can adapt either (configurable) or use platform-specific builds
 *   - AUTO-REFRESH on both kits (30s default) so we ALWAYS use the newest versions
 *
 * Budget: 0 euro. Free Figma API + free personal access token.
 */

import {
  FigmaDesignToken,
  fetchFigmaDesignTokens,
  parseFigmaUrl,
} from "./figma.js";
import {
  getIos27KitTokens,
  startIos27AutoRefresh,
  stopIos27AutoRefresh,
  generateIos27LiquidGlassComponent,
  generateAllIos27LiquidGlassComponents,
  Ios27LiquidGlassComponent,
  IOS_27_FIGMA_URL,
} from "./figma-ios-sync.js";
import {
  getMaterial3KitTokens,
  startMaterial3AutoRefresh,
  stopMaterial3AutoRefresh,
  generateMaterial3Component,
  generateAllMaterial3Components,
  Material3Component,
  MATERIAL_3_FIGMA_URL,
} from "./figma-android-sync.js";

/** Target platform for component generation. */
export type TargetPlatform = "ios" | "android" | "web" | "universal";

/** Platform-specific component type union. */
export type PlatformComponent =
  | { platform: "ios"; component: Ios27LiquidGlassComponent }
  | { platform: "android"; component: Material3Component }
  | { platform: "web"; component: "ios" | "android" | "adaptive" }
  | { platform: "universal"; component: "adaptive" };

/** Unified design token context. */
export interface UnifiedDesignTokens {
  ios: {
    fileKey: string;
    versionId: string | null;
    versionLabel: string | null;
    publishedAt: string | null;
    tokens: FigmaDesignToken | null;
    fetchedAt: number;
  };
  android: {
    fileKey: string;
    versionId: string | null;
    versionLabel: string | null;
    publishedAt: string | null;
    tokens: FigmaDesignToken | null;
    fetchedAt: number;
  };
  lastSynced: number;
}

/** Current bridge state cache. */
let bridgeCache: UnifiedDesignTokens | null = null;
let bridgePollTimer: ReturnType<typeof setInterval> | null = null;
let isBridgeInitialized = false;

/**
 * Initialize the bridge and start auto-refresh on BOTH design kits.
 * Call once on server start.
 */
export async function initDesignTokenBridge(autoRefreshMs = 30_000): Promise<UnifiedDesignTokens> {
  if (isBridgeInitialized) return bridgeCache!;

  // Start auto-refresh on both kits
  startIos27AutoRefresh(autoRefreshMs);
  startMaterial3AutoRefresh(autoRefreshMs);

  // Initial fetch
  await syncBridge();

  // Set up bridge-level polling
  bridgePollTimer = setInterval(() => {
    syncBridge().catch(() => {
      /* non-fatal */
    });
  }, autoRefreshMs);

  isBridgeInitialized = true;
  return bridgeCache!;
}

/**
 * Sync both design kits and update the unified cache.
 * Forces fresh fetch if either kit has a newer version.
 */
export async function syncBridge(force = false): Promise<UnifiedDesignTokens> {
  const [iosKit, androidKit] = await Promise.all([
    getIos27KitTokens(force),
    getMaterial3KitTokens(force),
  ]);

  bridgeCache = {
    ios: {
      fileKey: iosKit.fileKey,
      versionId: iosKit.versionId,
      versionLabel: iosKit.versionLabel,
      publishedAt: iosKit.publishedAt,
      tokens: iosKit.tokens,
      fetchedAt: iosKit.fetchedAt,
    },
    android: {
      fileKey: androidKit.fileKey,
      versionId: androidKit.versionId,
      versionLabel: androidKit.versionLabel,
      publishedAt: androidKit.publishedAt,
      tokens: androidKit.tokens,
      fetchedAt: androidKit.fetchedAt,
    },
    lastSynced: Date.now(),
  };
  return bridgeCache;
}

/**
 * Stop all auto-refresh timers.
 */
export function shutdownDesignTokenBridge(): void {
  stopIos27AutoRefresh();
  stopMaterial3AutoRefresh();
  if (bridgePollTimer) {
    clearInterval(bridgePollTimer);
    bridgePollTimer = null;
  }
  isBridgeInitialized = false;
}

/**
 * Get the current unified design token state (cached, auto-refreshed).
 */
export function getUnifiedDesignTokens(): UnifiedDesignTokens | null {
  return bridgeCache;
}

/**
 * Check if either design kit has a newer version available.
 */
export async function checkForKitUpdates(): Promise<{
  ios: { hasUpdate: boolean; currentVersion: string | null; latestVersion: string | null };
  android: { hasUpdate: boolean; currentVersion: string | null; latestVersion: string | null };
}> {
  const [iosKit, androidKit] = await Promise.all([
    getIos27KitTokens(true),
    getMaterial3KitTokens(true),
  ]);

  return {
    ios: {
      hasUpdate: iosKit.versionId !== bridgeCache?.ios.versionId,
      currentVersion: bridgeCache?.ios.versionId ?? null,
      latestVersion: iosKit.versionId,
    },
    android: {
      hasUpdate: androidKit.versionId !== bridgeCache?.android.versionId,
      currentVersion: bridgeCache?.android.versionId ?? null,
      latestVersion: androidKit.versionId,
    },
  };
}

/**
 * Generate a platform-native component for a specific platform.
 * NEVER produces style knock-offs — uses the official kit's components.
 */
export function generatePlatformComponent(
  platform: "ios" | "android",
  component: Ios27LiquidGlassComponent | Material3Component,
): string {
  const cache = getUnifiedDesignTokens();
  if (!cache) throw new Error("Bridge not initialized. Call initDesignTokenBridge() first.");

  if (platform === "ios") {
    return generateIos27LiquidGlassComponent(component as Ios27LiquidGlassComponent, cache.ios.tokens);
  } else {
    return generateMaterial3Component(component as Material3Component, cache.android.tokens);
  }
}

/**
 * Generate ALL platform-native components for a platform.
 * Returns a record of componentName -> componentCode.
 */
export function generateAllPlatformComponents(platform: "ios" | "android"): Record<string, string> {
  const cache = getUnifiedDesignTokens();
  if (!cache) throw new Error("Bridge not initialized. Call initDesignTokenBridge() first.");

  if (platform === "ios") {
    return generateAllIos27LiquidGlassComponents(cache.ios.tokens);
  } else {
    return generateAllMaterial3Components(cache.android.tokens);
  }
}

/**
 * Generate an adaptive web component that uses iOS Liquid Glass on iOS
 * and Material 3 on Android (via platform detection).
 */
export function generateAdaptiveWebComponent(
  iosComponent: Ios27LiquidGlassComponent,
  androidComponent: Material3Component,
): string {
  const cache = getUnifiedDesignTokens();
  if (!cache) throw new Error("Bridge not initialized. Call initDesignTokenBridge() first.");

  const iosCode = generateIos27LiquidGlassComponent(iosComponent, cache.ios.tokens);
  const androidCode = generateMaterial3Component(androidComponent, cache.android.tokens);

  // Extract the component function names
  const iosFuncMatch = iosCode.match(/export function (\w+)/);
  const androidFuncMatch = androidCode.match(/export function (\w+)/);
  const iosFunc = iosFuncMatch?.[1] ?? "IosComponent";
  const androidFunc = androidFuncMatch?.[1] ?? "AndroidComponent";

  return `/**
 * Adaptive web component — uses iOS 27 Liquid Glass on iOS,
 * Material You 3 on Android, falls back to system default on web.
 * AUTO-GENERATED from OFFICIAL Figma design kits.
 * iOS kit: ${IOS_27_FIGMA_URL}
 * Android kit: ${MATERIAL_3_FIGMA_URL}
 */

import { Platform, View } from "react-native";
import { ${iosFunc} } from "./ios-components";
import { ${androidFunc} } from "./android-components";

export function Adaptive${iosFunc.replace(/^[a-z]/, (c) => c.toUpperCase())}(props: any) {
  if (Platform.OS === "ios") {
    return <${iosFunc} {...props} />;
  }
  if (Platform.OS === "android") {
    return <${androidFunc} {...props} />;
  }
  // Web fallback — use the iOS Liquid Glass look as default
  return <${iosFunc} {...props} />;
}`;
}

/**
 * Generate a complete mobile app scaffold with all official components
 * for the target platform(s).
 */
export function generateMobileAppScaffold(params: {
  appName: string;
  platform: TargetPlatform;
  bundleIdentifier: string;
  packageName: string;
}): {
  iosComponents: Record<string, string>;
  androidComponents: Record<string, string>;
  sharedComponents: Record<string, string>;
  easConfig: string;
} {
  const cache = getUnifiedDesignTokens();
  if (!cache) throw new Error("Bridge not initialized. Call initDesignTokenBridge() first.");

  const iosComponents = generateAllPlatformComponents("ios");
  const androidComponents = generateAllPlatformComponents("android");

  // Shared adaptive components
  const sharedComponents: Record<string, string> = {};
  const adaptivePairs: Array<[Ios27LiquidGlassComponent, Material3Component]> = [
    ["glass-button", "m3-button"],
    ["glass-card", "m3-card"],
    ["glass-sheet", "m3-bottom-sheet"],
    ["glass-modal", "m3-dialog"],
    ["glass-tab-bar", "m3-navigation-bar"],
    ["glass-navigation", "m3-top-app-bar"],
  ];
  for (const [iosComp, androidComp] of adaptivePairs) {
    sharedComponents[`Adaptive${iosComp.replace(/-/g, "").replace(/^./, (c) => c.toUpperCase())}`] =
      generateAdaptiveWebComponent(iosComp, androidComp);
  }

  // EAS config template
  const easConfig = `{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": { "distribution": "store" }
  },
  "submit": {
    "ios": { "appleId": "\${APPLE_ID}", "ascApiKeyPath": "\${ASC_API_KEY_PATH}" },
    "android": { "serviceAccountKeyPath": "\${GOOGLE_SERVICE_ACCOUNT_KEY}", "track": "internal" }
  }
}`;

  return { iosComponents, androidComponents, sharedComponents, easConfig };
}

/**
 * Generate a design system context string for LLM prompting.
 * Contains exact values from BOTH official kits.
 */
export function generateUnifiedDesignContext(): string {
  const cache = getUnifiedDesignTokens();
  if (!cache) return "Design token bridge not initialized.";

  const formatKit = (name: string, kit: typeof cache.ios) => {
    if (!kit.tokens) return `### ${name}\nNo tokens available (check FIGMA_ACCESS_TOKEN).\n`;
    const tokens = kit.tokens;
    const fonts = tokens.fonts.length
      ? tokens.fonts.map((f) => `- ${f.family} ${f.weight} @ ${f.size}px`).join("\n")
      : "- (no text styles)";
    const colors = tokens.colors.length
      ? tokens.colors.map((c) => `- ${c.hex} (${c.rgba}), used ${c.count}x`).join("\n")
      : "- (no colors)";
    const samples = tokens.textSamples.length
      ? tokens.textSamples.map((s) => `- "${s.text}" (${s.fontFamily ?? "?"} ${s.fontSize ?? "?"}px)`).join("\n")
      : "- (no text samples)";
    return `### ${name} (v${kit.versionLabel ?? "unknown"} — published ${kit.publishedAt ?? "unknown"})\n**Fonts:**\n${fonts}\n\n**Colors:**\n${colors}\n\n**Text samples:**\n${samples}\n`;
  };

  return [
    "# UNIFIED DESIGN SYSTEM CONTEXT",
    "",
    "Source: OFFICIAL Figma community design kits — auto-refreshed every 30s.",
    "",
    formatKit("iOS 27 Liquid Glass", cache.ios),
    formatKit("Material You 3", cache.android),
    "",
    "## BUILD INSTRUCTION",
    "- iOS builds MUST use Liquid Glass components from the iOS 27 kit.",
    "- Android builds MUST use Material 3 components from the Material 3 kit.",
    "- Web builds CAN use adaptive components (iOS on iOS, Android on Android).",
    "- NEVER create 'Apple-style' or 'Material-style' knock-offs.",
    "- Always use the exact hex/rgba values, font sizes, weights from the kits.",
  ].join("\n");
}

/**
 * Fetch design tokens from a custom Figma URL (user's own design file)
 * and merge with the official kit tokens for a complete context.
 */
export async function fetchCustomDesignTokens(
  figmaUrl: string,
): Promise<{ ok: true; tokens: FigmaDesignToken; mergedContext: string } | { ok: false; error: string }> {
  const result = await fetchFigmaDesignTokens(figmaUrl);
  if (!result.ok) return result;

  const cache = getUnifiedDesignTokens();
  const customTokens = result.tokens;

  // Merge contexts
  const context = [
    generateUnifiedDesignContext(),
    "",
    "## CUSTOM DESIGN FILE",
    `File: ${customTokens.name} (${customTokens.frameName})`,
    `Dimensions: ${customTokens.width}×${customTokens.height}`,
    "",
    "### Custom Fonts",
    customTokens.fonts.length
      ? customTokens.fonts.map((f) => `- ${f.family} ${f.weight} @ ${f.size}px`).join("\n")
      : "- (none)",
    "",
    "### Custom Colors",
    customTokens.colors.length
      ? customTokens.colors.map((c) => `- ${c.hex} (${c.rgba}), used ${c.count}x`).join("\n")
      : "- (none)",
    "",
    "### Custom Text Samples",
    customTokens.textSamples.length
      ? customTokens.textSamples.map((s) => `- "${s.text}" (${s.fontFamily ?? "?"} ${s.fontSize ?? "?"}px)`).join("\n")
      : "- (none)",
    "",
    "### Build Instruction",
    "Merge custom tokens with the official kit tokens above. Use official kit components as base,",
    "apply custom colors/fonts/spacing from this file. NEVER deviate from official component structure.",
  ].join("\n");

  return { ok: true, tokens: customTokens, mergedContext: context };
}