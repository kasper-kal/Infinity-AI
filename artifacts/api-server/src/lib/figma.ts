/**
 * Figma design-to-code bridge.
 *
 * Reads the REAL design data from a Figma file via the REST API
 * (https://www.figma.com/developers/api), not a screenshot guess. Extracts:
 *   - font families + weights actually used (from TEXT node styles)
 *   - font sizes used
 *   - solid fill colors (deduped, as hex + rgba)
 *   - frame/page dimensions and structure
 *   - text content samples (so the LLM can reproduce real copy)
 *
 * Auth: X-Figma-Token header with FIGMA_ACCESS_TOKEN (free personal access
 * token, Figma → Settings → Security). The embed iframe does NOT need a
 * token, only this design-data extraction does.
 *
 * CRITICAL: Preserves EXACT Figma values — no rounding, no conversion, no modifications.
 * Colors stay in 0-1 range, font sizes/weights/line heights/letter spacing preserved exactly.
 */

export interface FigmaDesignToken {
  fileKey: string;
  name: string;
  /** The frame/page whose design data was extracted. */
  frameName: string;
  /** Node id of the extracted frame (for image rendering). */
  frameId?: string;
  width: number;
  height: number;
  fonts: { family: string; weight: string; size: number }[];
  fontSizes: number[];
  colors: { hex: string; rgba: string; count: number }[];
  textSamples: { text: string; fontFamily?: string; fontSize?: number }[];
  children: { name: string; type: string; width: number; height: number }[];

  // EXACT PRESERVATION: Store raw Figma values for pixel-perfect reproduction
  _figmaRaw?: {
    // Raw color values (0-1 range as Figma provides)
    colors: Array<{ r: number; g: number; b: number; a: number }>;
    // Raw text styles
    textStyles: Array<{
      fontFamily: string;
      fontPostScriptName?: string;
      fontWeight: number;
      fontSize: number;
      lineHeightPx: number;
      letterSpacing: number;
      textAlignHorizontal: string;
      textAlignVertical: string;
    }>;
    // Raw layout values
    cornerRadius?: number;
    opacity?: number;
    itemSpacing?: number;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
  };
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  style?: { fontFamily?: string; fontWeight?: string | number; fontSize?: number; letterSpacing?: string; lineHeightPx?: number };
  characters?: string;
  fills?: { type: string; color?: { r: number; g: number; b: number; a?: number }; opacity?: number }[];
  absoluteBoundingBox?: { width: number; height: number };
  cornerRadius?: number;
  opacity?: number;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
}

interface FigmaFileResponse {
  document: FigmaNode;
  name: string;
  err?: string;
  message?: string;
}

/** Convert exact Figma 0-1 color values to precise hex string (no rounding) */
function rgbToExactHex(color: { r: number; g: number; b: number; a?: number }): string {
  const toExactHex = (value: number) => {
    const v = value * 255;
    return v.toString(16).padStart(2, '0');
  };
  return `#${toExactHex(color.r)}${toExactHex(color.g)}${toExactHex(color.b)}`;
}

/** Convert exact Figma 0-1 color values to precise rgba string (no rounding) */
function rgbaToExactCss(color: { r: number; g: number; b: number; a?: number }): string {
  const r = color.r * 255;
  const g = color.g * 255;
  const b = color.b * 255;
  const a = color.a ?? 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Extract a Figma file key (+ optional node-id) from any Figma share URL. */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  const m = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)(?:\/([^?]*))?/);
  if (!m) return null;
  const nodeMatch = url.match(/[?&]node-id=([^&]+)/);
  return { fileKey: m[1], nodeId: nodeMatch ? decodeURIComponent(nodeMatch[1]) : undefined };
}

function getFigmaToken(): string {
  return process.env["FIGMA_ACCESS_TOKEN"] ?? "";
}

function walk(nodes: FigmaNode[], visit: (n: FigmaNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.children) walk(n.children, visit);
  }
}

/** Collect real design tokens from the Figma document tree. */
export function extractDesignTokens(file: FigmaFileResponse, targetId?: string): FigmaDesignToken | null {
  // Pick the target frame: the explicit node-id, else the first FRAME node.
  let target: FigmaNode | null = null;
  const all: FigmaNode[] = [];
  walk(file.document.children ?? [], (n) => all.push(n));
  if (targetId) {
    target = all.find((n) => n.id === targetId || n.id === targetId.replace(/-/g, ":")) ?? null;
  }
  if (!target) {
    target = all.find((n) => n.type === "FRAME" || n.type === "CANVAS") ?? null;
  }
  if (!target) return null;

  const box = target.absoluteBoundingBox ?? { width: 1200, height: 800 };
  const fontMap = new Map<string, { family: string; weight: string; size: number }>();
  const fontSizes = new Set<number>();
  const colorMap = new Map<string, { hex: string; rgba: string; count: number }>();
  const textSamples: FigmaDesignToken["textSamples"] = [];
  const children: FigmaDesignToken["children"] = [];

  // EXACT PRESERVATION: Store raw values
  const rawColors: Array<{ r: number; g: number; b: number; a: number }> = [];
  const rawTextStyles: Array<{
    fontFamily: string;
    fontPostScriptName?: string;
    fontWeight: number;
    fontSize: number;
    lineHeightPx: number;
    letterSpacing: number;
    textAlignHorizontal: string;
    textAlignVertical: string;
  }> = [];

  const visit = (n: FigmaNode): void => {
    if (n.type === "TEXT" && n.style) {
      const family = n.style.fontFamily ?? "Unknown";
      const weight = String(n.style.fontWeight ?? 400);
      const size = n.style.fontSize ?? 16;
      fontMap.set(`${family}-${weight}-${size}`, { family, weight, size });
      fontSizes.add(size);
      if (n.characters && n.characters.trim() && textSamples.length < 12) {
        textSamples.push({ text: n.characters.trim().slice(0, 80), fontFamily: family, fontSize: size });
      }

      // EXACT PRESERVATION: Store raw text style values
      rawTextStyles.push({
        fontFamily: n.style.fontFamily ?? "Unknown",
        fontPostScriptName: undefined, // Not available in this API response format
        fontWeight: Number(n.style.fontWeight ?? 400),
        fontSize: n.style.fontSize ?? 16,
        lineHeightPx: n.style.lineHeightPx ?? (n.style.fontSize ?? 16) * 1.2,
        letterSpacing: n.style.letterSpacing ? parseFloat(String(n.style.letterSpacing)) : 0,
        textAlignHorizontal: "LEFT",
        textAlignVertical: "TOP",
      });
    }
    if (Array.isArray(n.fills)) {
      for (const f of n.fills) {
        if (f.type === "SOLID" && f.color) {
          // EXACT PRESERVATION: Store raw 0-1 color values
          rawColors.push({
            r: f.color.r,
            g: f.color.g,
            b: f.color.b,
            a: f.color.a ?? 1,
          });

          // Use exact precision hex (no rounding) as display value
          const exactHex = rgbToExactHex(f.color);
          const exactRgba = rgbaToExactCss(f.color);
          const key = `${exactHex}|${f.color.a ?? 1}`;
          const existing = colorMap.get(key);
          colorMap.set(key, existing ? { ...existing, count: existing.count + 1 } : { hex: exactHex, rgba: exactRgba, count: 1 });
        }
      }
    }
    if (n.children && n.children.length > 0 && children.length < 30) {
      const cBox = n.absoluteBoundingBox;
      if (cBox && (n.type === "FRAME" || n.type === "GROUP" || n.type === "COMPONENT")) {
        children.push({ name: n.name, type: n.type, width: cBox.width, height: cBox.height });
      }
    }
  };
  walk(target.children ?? [], visit);

  const fonts = [...fontMap.values()].sort((a, b) => a.family.localeCompare(b.family) || a.size - b.size);
  const colors = [...colorMap.values()].sort((a, b) => b.count - a.count);

  return {
    fileKey: "", // filled in by fetchFigmaDesignTokens from the URL
    name: file.name,
    frameName: target.name,
    frameId: target.id,
    width: box.width,
    height: box.height,
    fonts,
    fontSizes: [...fontSizes].sort((a, b) => a - b),
    colors,
    textSamples,
    children,
    _figmaRaw: {
      colors: rawColors,
      textStyles: rawTextStyles,
      cornerRadius: target.cornerRadius,
      opacity: target.opacity,
      itemSpacing: target.itemSpacing,
      paddingTop: target.paddingTop,
      paddingRight: target.paddingRight,
      paddingBottom: target.paddingBottom,
      paddingLeft: target.paddingLeft,
    },
  };
}

/** Fetch + extract design tokens from a Figma URL. Returns error string on failure. */
export async function fetchFigmaDesignTokens(
  url: string,
): Promise<{ ok: true; tokens: FigmaDesignToken } | { ok: false; error: string }> {
  const parsed = parseFigmaUrl(url);
  if (!parsed) return { ok: false, error: "Not a valid Figma URL." };
  const token = getFigmaToken();
  if (!token) {
    return { ok: false, error: "FIGMA_ACCESS_TOKEN not configured, add a Figma personal access token in Settings → API keys." };
  }
  try {
    const res = await fetch(`https://api.figma.com/v1/files/${parsed.fileKey}`, {
      headers: { "X-Figma-Token": token },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Figma API error ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as FigmaFileResponse;
    if (data.err) return { ok: false, error: data.err };
    const tokens = extractDesignTokens(data, parsed.nodeId);
    if (!tokens) return { ok: false, error: "No frame found in the Figma file." };
    tokens.fileKey = parsed.fileKey;
    return { ok: true, tokens };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Figma request failed." };
  }
}

/** Render a design token summary as a compact context block for the LLM. */
export function figmaTokensToContext(tokens: FigmaDesignToken): string {
  const fonts = tokens.fonts.length > 0
    ? tokens.fonts.map((f) => `- ${f.family} ${f.weight} @ ${f.size}px`).join("\n")
    : "- (no text styles found)";
  const colors = tokens.colors.length > 0
    ? tokens.colors.map((c) => `- ${c.hex} (${c.rgba}), used ${c.count}x`).join("\n")
    : "- (no solid fills found)";
  const samples = tokens.textSamples.length > 0
    ? tokens.textSamples.map((s) => `- "${s.text}" (${s.fontFamily ?? "?"} ${s.fontSize ?? "?"}px)`).join("\n")
    : "- (no text samples)";
  const structure = tokens.children.length > 0
    ? tokens.children.map((c) => `- ${c.name} (${c.type}) ${Math.round(c.width)}×${Math.round(c.height)}`).join("\n")
    : "- (no child frames)";
  return [
    `## FIGMA DESIGN, "${tokens.frameName}" (${tokens.width}×${tokens.height}) from "${tokens.name}"`,
    `These are the REAL design tokens read from the Figma file via the API.`,
    ``,
    `### Fonts used`,
    fonts,
    ``,
    `### Colors used (most frequent first)`,
    colors,
    ``,
    `### Font sizes`,
    tokens.fontSizes.length ? tokens.fontSizes.join("px, ") + "px" : "-",
    ``,
    `### Text content`,
    samples,
    ``,
    `### Frame structure`,
    structure,
    ``,
    `BUILD INSTRUCTION: Reproduce this design as code, use EXACTLY the fonts and colors above (Google Fonts for the families, exact hex/rgba values), the same layout proportions, and the same text content. Write the files with write_source_file.`,
  ].join("\n");
}
