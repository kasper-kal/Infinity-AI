/**
 * File Format Converter — universal `@File` conversion engine.
 *
 * Converts between 35+ formats across documents, images, audio/video and data
 * in a fully local, $0 pipeline. Data formats convert through a single
 * parse→object→serialize hub; documents use local open-source libs; images and
 * audio/video use lazy-loaded WASM/native modules (see wasm-modules.ts).
 */
import { fileTypeFromBuffer } from "file-type";
import { marked } from "marked";
import Turndown from "turndown";
import * as yaml from "js-yaml";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureSharp,
  ensureSheetJS,
  ffmpegBinaryPath,
} from "./wasm-modules.js";

import { PDFParse } from "pdf-parse";
// @ts-expect-error — mammoth ships no typings; used exactly like routes/infinity/chat.ts
import { extractRawText } from "mammoth";

const require = createRequire(import.meta.url);
let PDFDocumentCtor: unknown;
function getPDFDocumentCtor(): any {
  if (!PDFDocumentCtor) PDFDocumentCtor = require("pdfkit");
  return PDFDocumentCtor;
}

// ============================================================================
// TYPES
// ============================================================================

export type FormatFamily = "document" | "image" | "video" | "audio" | "data" | "code";

export interface FormatInfo {
  format: string;
  family: FormatFamily;
  label: string;
  ext: string[];
  mime: string[];
}

export interface FormatGroup {
  id: FormatFamily;
  label: string;
  formats: FormatInfo[];
}

export interface DetectionResult {
  format: string;
  confidence: number;
  suggestedOutputs: string[];
  method: "magic" | "extension" | "sniff";
}

export interface ConvertRequest {
  buffer: Buffer;
  from?: string;
  to: string;
  filename?: string;
  options?: Record<string, unknown>;
  onProgress?: (percent: number) => void;
  abortSignal?: AbortSignal;
}

export interface ConversionResult {
  buffer: Buffer;
  format: string;
  mime: string;
  ext: string;
  meta?: Record<string, unknown>;
}

export interface BatchFile {
  name: string;
  buffer: Buffer;
}

export interface BatchResult {
  name: string;
  ok: boolean;
  format?: string;
  mime?: string;
  size?: number;
  data?: string; // base64
  error?: string;
  meta?: Record<string, unknown>;
}

export interface FileInfo {
  format: string;
  name?: string;
  size: number;
  mime?: string;
  dimensions?: { width: number; height: number };
  pages?: number;
  characters?: number;
  lines?: number;
  rows?: number;
  meta?: Record<string, unknown>;
}

// ============================================================================
// FORMAT REGISTRY
// ============================================================================

const MH = (format: string, family: FormatFamily, label: string, ext: string[], mime: string[]): FormatInfo => ({ format, family, label, ext, mime });

export const FORMATS: FormatInfo[] = [
  // ---- Documents ----
  MH("pdf", "document", "PDF", ["pdf"], ["application/pdf"]),
  MH("docx", "document", "Word (DOCX)", ["docx"], ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  MH("html", "document", "HTML", ["html", "htm"], ["text/html"]),
  MH("md", "document", "Markdown", ["md", "markdown"], ["text/markdown"]),
  MH("txt", "document", "Plain Text", ["txt", "text"], ["text/plain"]),
  MH("rtf", "document", "Rich Text (RTF)", ["rtf"], ["application/rtf"]),
  MH("odt", "document", "OpenDocument (ODT)", ["odt"], ["application/vnd.oasis.opendocument.text"]),
  // ---- Images ----
  MH("png", "image", "PNG", ["png"], ["image/png"]),
  MH("jpg", "image", "JPEG", ["jpg", "jpeg"], ["image/jpeg"]),
  MH("webp", "image", "WebP", ["webp"], ["image/webp"]),
  MH("gif", "image", "GIF", ["gif"], ["image/gif"]),
  MH("avif", "image", "AVIF", ["avif"], ["image/avif"]),
  MH("tiff", "image", "TIFF", ["tiff", "tif"], ["image/tiff"]),
  MH("bmp", "image", "BMP", ["bmp"], ["image/bmp"]),
  MH("svg", "image", "SVG", ["svg"], ["image/svg+xml"]),
  MH("ico", "image", "ICON", ["ico"], ["image/x-icon", "image/vnd.microsoft.icon"]),
  MH("heic", "image", "HEIC", ["heic"], ["image/heic"]),
  // ---- Video ----
  MH("mp4", "video", "MP4", ["mp4"], ["video/mp4"]),
  MH("webm", "video", "WebM", ["webm"], ["video/webm"]),
  MH("mov", "video", "QuickTime (MOV)", ["mov"], ["video/quicktime"]),
  MH("avi", "video", "AVI", ["avi"], ["video/x-msvideo"]),
  MH("mkv", "video", "Matroska (MKV)", ["mkv"], ["video/x-matroska"]),
  // ---- Audio ----
  MH("mp3", "audio", "MP3", ["mp3"], ["audio/mpeg"]),
  MH("wav", "audio", "WAV", ["wav"], ["audio/wav", "audio/x-wav"]),
  MH("ogg", "audio", "OGG", ["ogg", "oga"], ["audio/ogg", "audio/opus"]),
  MH("flac", "audio", "FLAC", ["flac"], ["audio/flac"]),
  MH("m4a", "audio", "M4A", ["m4a"], ["audio/mp4"]),
  MH("aac", "audio", "AAC", ["aac"], ["audio/aac"]),
  MH("opus", "audio", "Opus", ["opus"], ["audio/opus"]),
  // ---- Data ----
  MH("json", "data", "JSON", ["json"], ["application/json"]),
  MH("yaml", "data", "YAML", ["yaml", "yml"], ["text/yaml", "application/yaml"]),
  MH("toml", "data", "TOML", ["toml"], ["application/toml"]),
  MH("xml", "data", "XML", ["xml"], ["text/xml", "application/xml"]),
  MH("csv", "data", "CSV", ["csv"], ["text/csv"]),
  MH("tsv", "data", "TSV", ["tsv"], ["text/tab-separated-values"]),
  MH("xlsx", "data", "Excel (XLSX)", ["xlsx"], ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  MH("xls", "data", "Excel (XLS)", ["xls"], ["application/vnd.ms-excel"]),
];

export const FORMAT_ID_TO_META: Record<string, FormatInfo> = Object.fromEntries(FORMATS.map((f) => [f.format, f]));

/** Normalize any alias (extension, case) to a canonical format id. */
export function canonicalFormat(s: string | undefined | null): string | null {
  if (!s) return null;
  const lower = s.toLowerCase().replace(/^\.+/, "");
  if (FORMAT_ID_TO_META[lower]) return lower;
  const hit = FORMATS.find((f) => f.ext.includes(lower));
  return hit ? hit.format : null;
}

export function mimeOf(format: string): string {
  return FORMAT_ID_TO_META[format]?.mime[0] ?? "application/octet-stream";
}

export function extOf(format: string): string {
  return FORMAT_ID_TO_META[format]?.ext[0] ?? format;
}

// ============================================================================
// DETECTION
// ============================================================================

const HTML_TAGS = new Set([
  "html", "head", "body", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "p",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "a", "img", "br",
  "hr", "button", "input", "form", "nav", "header", "footer", "section", "article",
  "main", "aside", "blockquote", "code", "pre", "em", "strong", "b", "i", "label",
  "select", "option", "textarea", "details", "summary",
]);

/** Extract the first tag name after an optional XML decl / doctype. */
function firstTag(head: string): string | null {
  const cleaned = head.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
  const doctype = cleaned.match(/^\s*<!DOCTYPE\s+([\w:]+)/i);
  if (doctype) return doctype[1];
  const tag = cleaned.match(/^\s*<([\w:]+)/);
  return tag ? tag[1] : null;
}

const TEXT_SNIFFERS: Array<{ format: string; test: (head: string) => boolean }> = [
  { format: "json", test: (h) => /^\s*[\[{]/.test(h) && /[\[{][\s\S]*[\]}]\s*$/.test(h.slice(0, 400)) },
  { format: "html", test: (h) => {
      const tag = firstTag(h);
      return !!tag && (tag.toLowerCase() === "html" || HTML_TAGS.has(tag.toLowerCase()));
    } },
  { format: "xml", test: (h) => {
      if (/^\s*<\?xml/i.test(h)) return true;
      const tag = firstTag(h);
      return !!tag && !HTML_TAGS.has(tag.toLowerCase());
    } },
  { format: "yaml", test: (h) => /^\s*(---\s*)?[\w"'\d\-]+:[\s\S]/.test(h) },
  { format: "toml", test: (h) => /^\s*\[[\w.]+\]\s*$/m.test(h.slice(0, 800)) && /^\s*[\w."]+=/.test(h) },
  { format: "csv", test: (h) => {
      const first = h.split(/\r?\n/)[0] ?? "";
      if (!first.includes(",")) return false;
      const parts = first.split(",");
      return parts.every((p) => /^"([^"]*( ""[^"]*)*)"$|^\s*[^",\s]*\s*$/.test(p))
        && parts.length > 1 && h.split(/\r?\n/).filter((l) => l.trim()).length > 1;
    } },
  { format: "tsv", test: (h) => { const first = h.split(/\r?\n/)[0] ?? ""; return first.includes("\t") && h.split(/\r?\n/).filter((l) => l.trim()).length > 1; } },
];

/** Best-effort: does this buffer look like HTML markup vs a data-XML document? */
function smellsLikeHtml(buffer: Buffer): boolean {
  const tag = firstTag(buffer.subarray(0, 32 * 1024).toString("utf8"));
  return !!tag && (tag.toLowerCase() === "html" || HTML_TAGS.has(tag.toLowerCase()));
}

const MAGIC_EXT_TO_FORMAT: Record<string, string> = {
  pdf: "pdf", docx: "docx", png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp",
  gif: "gif", avif: "avif", tiff: "tiff", bmp: "bmp", svg: "svg", ico: "ico",
  heic: "heic", mp4: "mp4", webm: "webm", mov: "mov", avi: "avi", mkv: "mkv",
  mp3: "mp3", wav: "wav", ogg: "ogg", flac: "flac", m4a: "m4a", aac: "aac",
  opus: "opus", xlsx: "xlsx", xls: "xls", json: "json", xml: "xml",
};

function sniffText(buffer: Buffer): { format: string; confidence: number } | null {
  const head = buffer.subarray(0, 16 * 1024).toString("utf8");
  for (const s of TEXT_SNIFFERS) {
    if (s.test(head)) return { format: s.format, confidence: 0.55 };
  }
  const trimmed = head.trim();
  if (trimmed.length === 0) return { format: "txt", confidence: 0.5 };
  // markdown heuristics
  if (/^\s{0,3}#{1,6}\s/.test(trimmed) || /^\s*(```|~~~|>\s|[-*_]\s|\|.*\|)/m.test(trimmed)) {
    return { format: "md", confidence: 0.5 };
  }
  if (/[ --]/.test(head.slice(0, 512))) {
    return null; // binary, magic already tried
  }
  return { format: "txt", confidence: 0.45 };
}

function formatFromFileName(filename: string | undefined): string | null {
  if (!filename) return null;
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  return canonicalFormat(base.slice(dot + 1));
}

export async function detectFormat(buffer: Buffer, filename?: string): Promise<DetectionResult> {
  let format: string | null = null;
  let confidence = 0;
  let method: DetectionResult["method"] = "sniff";

  const extFormat = formatFromFileName(filename);
  const sniffed = sniffText(buffer);

  // 1) Magic bytes (binary formats: PDF, images, office, media…)
  const ft = await fileTypeFromBuffer(buffer).catch(() => null);
  if (ft) {
    const f = MAGIC_EXT_TO_FORMAT[ft.ext.toLowerCase()] ?? canonicalFormat(ft.ext) ?? null;
    if (f) {
      format = f;
      confidence = 0.98;
      method = "magic";
    }
  }

  // 2) Content sniffing — only when it yields a *structural* text format.
  //    A generic `txt` sniff does not yet win (an extension is more specific).
  if (!format && sniffed && sniffed.format !== "txt" && sniffed.format !== "md") {
    format = sniffed.format;
    confidence = sniffed.confidence;
    method = "sniff";
  }

  // 3) Extension — most reliable for non-structural text (md, txt, code).
  if (!format && extFormat) {
    // An .html file sniffed as xml (custom elements) should stay html.
    format = extFormat;
    confidence = 0.85;
    method = "extension";
  }

  // 4) Final fallbacks: prefer a content sniff (md/txt) over nothing.
  if (!format) {
    if (sniffed) {
      format = sniffed.format;
      confidence = sniffed.confidence;
      method = "sniff";
    } else {
      format = "txt";
      confidence = 0.3;
      method = "sniff";
    }
  }

  if (!format || !FORMAT_ID_TO_META[format]) {
    return { format: "txt", confidence: 0.3, suggestedOutputs: [], method: "sniff" };
  }

  return { format, confidence, suggestedOutputs: suggestedOutputsFor(format), method };
}

// ============================================================================
// SUGGESTED OUTPUTS
// ============================================================================

export function suggestedOutputsFor(format: string): string[] {
  const out: string[] = [];
  for (const key of converters.keys()) {
    if (key.startsWith(`${format}:`)) out.push(key.slice(format.length + 1));
  }
  return out.slice(0, 12);
}

export function listFormatGroups(): FormatGroup[] {
  const groups: FormatGroup[] = [];
  for (const family of ["document", "image", "video", "audio", "data", "code"] as const) {
    groups.push({
      id: family,
      label: family.charAt(0).toUpperCase() + family.slice(1),
      formats: FORMATS.filter((f) => f.family === family),
    });
  }
  return groups;
}

export function listSupportedConversions(): Array<{ from: string; to: string; detail: string }> {
  const rows: Array<{ from: string; to: string; detail: string }> = [];
  for (const key of converters.keys()) {
    const [from, to] = key.split(":");
    rows.push({ from, to, detail: `${from} → ${to}` });
  }
  return rows.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

// ============================================================================
// TEXT HELPERS
// ============================================================================

function decodeText(buffer: Buffer): string {
  return buffer.toString("utf8");
}

function encodeText(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

/** Very small Markdown subset → HTML (used when marked is not preferred). */
function fallbackMarkdownToHtml(src: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = src.split(/\r?\n/);
  let html = "";
  let inCode = false;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      html += inCode ? "</code></pre>\n" : "<pre><code>\n";
      inCode = !inCode;
      continue;
    }
    if (inCode) { html += escape(raw) + "\n"; continue; }
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.*)/);
    if (heading) { html += `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>\n`; continue; }
    if (/^\s{0,3}([-*_])\s*$/.test(raw)) { html += "<hr/>\n"; continue; }
    if (/^\s*>\s?/.test(raw)) { html += `<blockquote>${escape(raw.replace(/^\s*>\s?/, ""))}</blockquote>\n`; continue; }
    if (/^\s*[-*+]\s+/.test(raw)) { html += `<li>${escape(raw.replace(/^\s*[-*+]\s+/, ""))}</li>\n`; continue; }
    let line = escape(raw);
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    line = line.replace(/\*(.+?)\*/g, "<em>$1</em>");
    line = line.replace(/`(.+?)`/g, "<code>$1</code>");
    line = line.replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
    if (line.trim()) html += `<p>${line}</p>\n`;
  }
  return html;
}

async function markdownToHtml(src: string): Promise<string> {
  try {
    const out = await marked.parse(src, { gfm: true, breaks: true });
    return typeof out === "string" ? out : decodeText(Buffer.from(await out));
  } catch {
    return fallbackMarkdownToHtml(src);
  }
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/^```.*$/gm, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^\s*[-:|-]+\s*$/gm, "")
    .trim();
}

// ============================================================================
// DATA HUB — parse any data format to object, serialize back
// ============================================================================

function parseCsv(text: string, delim = ","): unknown[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.length > 0) || rows.length > 0) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.length > 0)) rows.push(row);
  if (rows.length <= 1) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    header.forEach((h, idx) => { obj[h.trim() || `col${idx + 1}`] = (r[idx] ?? "").trim(); });
    return obj;
  });
}

function stringifyCsv(obj: unknown, delim = ","): string {
  const rows = Array.isArray(obj) ? obj : [obj];
  const header = new Set<string>();
  for (const r of rows) {
    if (r && typeof r === "object") Object.keys(r as object).forEach((k) => header.add(k));
  }
  if (header.size === 0 && rows.length > 0) header.add("value");
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  if (header.size > 0) lines.push([...header].map(esc).join(delim));
  for (const r of rows) {
    if (r && typeof r === "object") {
      lines.push([...header].map((h) => esc((r as Record<string, unknown>)[h])).join(delim));
    } else {
      lines.push(esc(r));
    }
  }
  return lines.join("\n");
}

// --- Minimal TOML ---
function parseToml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let currentPath: string[] = [];
  let current: Record<string, unknown> = result;
  const arrayTables: Record<string, unknown[]> = {};

  const setNested = (path: string[], val: unknown) => {
    let obj: Record<string, unknown> = result;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!obj[key] || typeof obj[key] !== "object" || Array.isArray(obj[key])) {
        obj[key] = {};
      }
      obj = obj[key] as Record<string, unknown>;
    }
    obj[path[path.length - 1]] = val;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const table = line.match(/^\[\[(.+)\]\]$/);
    if (table) {
      const path = table[1].trim().split(".");
      const arr = (arrayTables[path.join(".")] ??= []);
      const obj: Record<string, unknown> = {};
      arr.push(obj);
      setNested(path, arr);
      current = obj;
      currentPath = path;
      continue;
    }
    const simpleTable = line.match(/^\[(.+)\]$/);
    if (simpleTable) {
      const path = simpleTable[1].trim().split(".");
      let obj: Record<string, unknown> = result;
      for (const key of path) {
        const next = obj[key];
        if (!next || typeof next !== "object") { obj[key] = {}; }
        obj = obj[key] as Record<string, unknown>;
      }
      current = obj;
      currentPath = path;
      continue;
    }
    const kv = line.match(/^([\w."\-]+)\s*=\s*(.*)$/);
    if (kv) {
      const key = kv[1].replace(/^"|"$/g, "").replace(/\s+/g, "");
      const val = kv[2].trim();
      let parsed: unknown;
      if (/^".*"$/.test(val)) parsed = val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, "\t");
      else if (val === "true") parsed = true;
      else if (val === "false") parsed = false;
      else if (/^-?\d+(\.\d+)?$/.test(val)) parsed = Number(val);
      else if (/^-?\d+e-?\d+$/i.test(val)) parsed = Number(val);
      else if (/^\[.*\]$/.test(val)) {
        const inner = val.slice(1, -1);
        parsed = inner.split(",").filter((s) => s.trim().length > 0).map((s) => {
          const t = s.trim();
          return /^".*"$/.test(t) ? t.slice(1, -1) : (/^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t);
        });
      } else parsed = val;
      current[key] = parsed;
    }
  }
  return result;
}

function stringifyToml(obj: unknown, depth = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(Math.max(0, depth - 1));
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const entries = Object.entries(obj as Record<string, unknown>);
    for (const [k, v] of entries) {
      if (v == null) continue;
      if (Array.isArray(v) && v.every((x) => x && typeof x === "object")) {
        for (const item of v) {
          lines.push(`${prefix}[[${k}]]`);
          lines.push(stringifyToml(item, depth + 1).trimEnd());
        }
      } else if (v && typeof v === "object") {
        lines.push(`${prefix}[${k}]`);
        lines.push(stringifyToml(v, depth + 1).trimEnd());
      } else {
        const str = typeof v === "string" ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : String(v);
        lines.push(`${prefix}${k} = ${str}`);
      }
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** Serialize object → XML using fast-xml-parser's builder. */
function objToXml(obj: unknown): string {
  const builder = new XMLBuilder({ format: true, indentBy: "  ", ignoreAttributes: false });
  try {
    return builder.build(obj as Record<string, unknown>);
  } catch {
    throw new Error("Could not serialize as XML");
  }
}

function xmlToObj(xmlText: string): unknown {
  const parser = new XMLParser({ ignoreAttributes: false });
  try {
    return parser.parse(xmlText);
  } catch {
    throw new Error("Could not parse XML input");
  }
}

async function dataToObj(format: string, buffer: Buffer): Promise<unknown> {
  switch (format) {
    case "json": return JSON.parse(decodeText(buffer));
    case "yaml": return yaml.load(decodeText(buffer));
    case "xml": return xmlToObj(decodeText(buffer));
    case "toml": return parseToml(decodeText(buffer));
    case "csv": return parseCsv(decodeText(buffer));
    case "tsv": return parseCsv(decodeText(buffer), "\t");
    case "xlsx":
    case "xls": {
      const XLSX = await ensureSheetJS();
      const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const first = wb.SheetNames[0];
      const sheet = wb.Sheets[first];
      return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    }
    default: return decodeText(buffer);
  }
}

async function objToData(format: string, obj: unknown): Promise<Buffer> {
  switch (format) {
    case "json": return encodeText(JSON.stringify(obj, null, 2));
    case "yaml": return encodeText(yaml.dump(obj, { noRefs: true, lineWidth: 120 }));
    case "toml": return encodeText(stringifyToml(obj));
    case "xml": return encodeText(objToXml(obj));
    case "csv": return encodeText(stringifyCsv(obj));
    case "tsv": return encodeText(stringifyCsv(obj, "\t"));
    case "xlsx":
    case "xls": {
      const XLSX = await ensureSheetJS();
      const rows = Array.isArray(obj) ? obj : [obj];
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const out = XLSX.write(wb, { type: "buffer", bookType: format === "xls" ? "biff8" : "xlsx" });
      return Buffer.from(out);
    }
    default: return encodeText(String(obj ?? ""));
  }
}

// ============================================================================
// DOCUMENT HELPERS
// ============================================================================

async function docxToHtml(buffer: Buffer): Promise<string> {
  // @ts-expect-error — loose typings
  const { convertToHtml } = await import("mammoth");
  const result = await convertToHtml({ buffer });
  return result.value ?? "";
}

async function docxToText(buffer: Buffer): Promise<string> {
  const result = await extractRawText({ buffer });
  return result.value ?? "";
}

async function pdfToText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return parsed.text ?? "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** Render plain text into a real PDF using pdfkit (free, local). */
async function textToPdf(text: string, title?: string): Promise<Buffer> {
  const PDFDocument = getPDFDocumentCtor() as new (opts?: Record<string, unknown>) => Record<string, any>;
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margin: 48, autoFirstPage: true });
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  if (title) {
    doc.fontSize(20).text(title);
    doc.moveDown();
  }
  doc.fontSize(11).text(text.slice(0, 2_500_000), { lineGap: 2 });
  doc.end();
  return done;
}

// ============================================================================
// IMAGE HELPERS (sharp)
// ============================================================================

const SHARP_OUTPUTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "tiff", "bmp"]);
const SHARP_INPUTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "tiff", "bmp", "svg", "ico", "heic"]);

function sharpFormatId(to: string): string {
  return to === "jpg" ? "jpeg" : to;
}

async function convertImage(req: ConvertRequest): Promise<ConversionResult> {
  const sharpModule = await ensureSharp();
  const sharp = sharpModule.default;
  const outFamily = FORMAT_ID_TO_META[req.to].family;
  const target = sharpFormatId(req.to);
  const opts = req.options ?? {};
  const quality = typeof opts.quality === "number" ? opts.quality : 80;

  let pipeline = sharp(req.buffer);
  const width = typeof opts.width === "number" ? opts.width : undefined;
  const height = typeof opts.height === "number" ? opts.height : undefined;
  if (width || height) {
    pipeline = pipeline.resize({ width, height, fit: (opts.fit as "contain" | "cover" | "fill" | "inside" | "outside") ?? "inside", withoutEnlargement: opts.dontEnlarge === true });
  }
  if (typeof opts.rotate === "number") pipeline = pipeline.rotate(opts.rotate);
  if (typeof opts.flip === "boolean") pipeline = opts.flip ? pipeline.flip() : pipeline;
  if (typeof opts.flop === "boolean") pipeline = opts.flop ? pipeline.flop() : pipeline;

  const toFormatArgs: Record<string, unknown> = { quality, compressionLevel: opts.compressionLevel ?? 6, effort: opts.effort ?? 4 };
  if (opts.lossless === true) (toFormatArgs as Record<string, unknown>).lossless = true;
  if (typeof opts.speed === "number") (toFormatArgs as Record<string, unknown>).speed = opts.speed;

  const out = await pipeline.toFormat(target as Parameters<typeof pipeline.toFormat>[0], toFormatArgs).toBuffer();
  return { buffer: out, format: req.to, mime: mimeOf(req.to), ext: extOf(req.to), meta: { width: opts.width, height: opts.height, quality, family: outFamily } };
}

// ============================================================================
// AUDIO / VIDEO HELPERS (ffmpeg WASM)
// ============================================================================

const VIDEO_OUT = new Set(["mp4", "webm", "mov", "avi", "mkv", "gif"]);
const AUDIO_OUT = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);

const VIDEO_PRESETS: Record<string, (vcodec: string) => string[]> = {};
const AUDIO_CODEC: Record<string, string> = {
  mp3: "libmp3lame", wav: "pcm_s16le", ogg: "libvorbis", flac: "flac", m4a: "aac", aac: "aac", opus: "libopus",
};

async function convertMedia(req: ConvertRequest): Promise<ConversionResult> {
  const ffmpegPath = ffmpegBinaryPath();
  const opts = req.options ?? {};
  const inputExt = extOf(req.from ?? req.to);
  const outputExt = extOf(req.to);

  const isVideoOut = VIDEO_OUT.has(req.to);
  const tmpDir = await mkdtemp(join(tmpdir(), "fileconv-"));
  const inFile = join(tmpDir, `input.${inputExt}`);
  const outFile = join(tmpDir, `output.${outputExt}`);

  try {
    // Write input buffer to temp file
    await writeFile(inFile, req.buffer);

    // Build FFmpeg args
    const args: string[] = ["-i", inFile];
    if (isVideoOut) {
      args.push("-movflags", "+faststart");
      if (typeof opts.bitrate === "number") args.push("-b:v", `${opts.bitrate}k`);
      args.push("-preset", typeof opts.preset === "string" ? opts.preset : "medium");
    } else {
      const codec = AUDIO_CODEC[req.to] ?? "libmp3lame";
      args.push("-c:a", codec);
      if (typeof opts.bitrate === "number") args.push("-b:a", `${opts.bitrate}k`);
      if (req.to === "wav") args.push("-ar", String(typeof opts.sampleRate === "number" ? opts.sampleRate : 44100));
    }
    args.push("-y", outFile);

    // Spawn ffmpeg process
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });

      // Parse stderr for progress (time=HH:MM:SS.mm pattern)
      let stderr = "";
      const onStderr = (chunk: Buffer) => {
        stderr += chunk.toString();
        if (req.onProgress) {
          const match = stderr.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (match) {
            const seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
            const frac = parseInt(match[4]) / 100;
            // We don't know total duration, so estimate progress as time elapsed
            // Cap at 0.99 until we finish
            req.onProgress(Math.min(0.99, (seconds + frac) / 10));
          }
        }
      };
      child.stderr?.on("data", onStderr);

      // Handle abort
      if (req.abortSignal) {
        const onAbort = () => {
          child.kill("SIGKILL");
          reject(new Error("Conversion aborted"));
        };
        req.abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      child.on("error", reject);
      child.on("close", (code) => {
        child.stderr?.off("data", onStderr);
        if (code !== 0) {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        } else {
          resolve();
        }
      });
    });

    // Read output file
    const data = await readFile(outFile);
    if (!data.length) throw new Error(`FFmpeg produced an empty output (${req.from} → ${req.to})`);
    return { buffer: data, format: req.to, mime: mimeOf(req.to), ext: outputExt, meta: { codec: req.to } };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ============================================================================
// CONVERTER REGISTRY
// ============================================================================

export type ConverterFn = (req: ConvertRequest) => Promise<ConversionResult>;

const converters = new Map<string, ConverterFn>();

function register(from: string, to: string, fn: ConverterFn): void {
  converters.set(`${from}:${to}`, fn);
}

function registerDataHub(): void {
  const dataFormats = ["json", "yaml", "toml", "xml", "csv", "tsv", "xlsx", "xls"];
  const registerPair = (a: string, b: string) => {
    if (a === b) return;
    register(a, b, async (req) => {
      const obj = await dataToObj(a, req.buffer);
      const buffer = await objToData(b, obj);
      return { buffer, format: b, mime: mimeOf(b), ext: extOf(b) };
    });
  };
  for (const a of dataFormats) {
    for (const b of dataFormats) registerPair(a, b);
  }
}

function registerDocuments(): void {
  const mdToHtml = (src: string) => markdownToHtml(src);
  const htmlToMd = (html: string) => new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(html);

  // markdown
  register("md", "html", async (req) => {
    const html = await mdToHtml(decodeText(req.buffer));
    return { buffer: encodeText(html), format: "html", mime: "text/html", ext: "html" };
  });
  register("md", "txt", async (req) => ({
    buffer: encodeText(stripMarkdown(decodeText(req.buffer))), format: "txt", mime: "text/plain", ext: "txt",
  }));
  register("md", "pdf", async (req) => ({
    buffer: await textToPdf(stripMarkdown(decodeText(req.buffer)), req.filename), format: "pdf", mime: "application/pdf", ext: "pdf",
  }));

  // html
  register("html", "md", async (req) => ({
    buffer: encodeText(htmlToMd(decodeText(req.buffer))), format: "md", mime: "text/markdown", ext: "md",
  }));
  register("html", "txt", async (req) => ({
    buffer: encodeText(htmlToPlainText(decodeText(req.buffer))), format: "txt", mime: "text/plain", ext: "txt",
  }));
  register("html", "pdf", async (req) => ({
    buffer: await textToPdf(htmlToPlainText(decodeText(req.buffer)), req.filename), format: "pdf", mime: "application/pdf", ext: "pdf",
  }));

  // plain text
  register("txt", "html", async (req) => {
    const text = decodeText(req.buffer).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return { buffer: encodeText(`<pre style="white-space:pre-wrap;font-family:monospace">${text}</pre>`), format: "html", mime: "text/html", ext: "html" };
  });
  register("txt", "md", async (req) => ({
    buffer: encodeText(decodeText(req.buffer)), format: "md", mime: "text/markdown", ext: "md",
  }));
  register("txt", "pdf", async (req) => ({
    buffer: await textToPdf(decodeText(req.buffer), req.filename), format: "pdf", mime: "application/pdf", ext: "pdf",
  }));

  // docx
  register("docx", "md", async (req) => ({
    buffer: encodeText(htmlToMd(await docxToHtml(req.buffer))), format: "md", mime: "text/markdown", ext: "md",
  }));
  register("docx", "html", async (req) => ({
    buffer: encodeText(await docxToHtml(req.buffer)), format: "html", mime: "text/html", ext: "html",
  }));
  register("docx", "txt", async (req) => ({
    buffer: encodeText(await docxToText(req.buffer)), format: "txt", mime: "text/plain", ext: "txt",
  }));
  register("docx", "pdf", async (req) => ({
    buffer: await textToPdf(await docxToText(req.buffer), req.filename), format: "pdf", mime: "application/pdf", ext: "pdf",
  }));

  // pdf (text extraction)
  register("pdf", "txt", async (req) => ({
    buffer: encodeText(await pdfToText(req.buffer)), format: "txt", mime: "text/plain", ext: "txt",
  }));
  register("pdf", "md", async (req) => ({
    buffer: encodeText(await pdfToText(req.buffer)), format: "md", mime: "text/markdown", ext: "md",
  }));
  register("pdf", "html", async (req) => {
    const text = (await pdfToText(req.buffer)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return { buffer: encodeText(`<pre style="white-space:pre-wrap">${text}</pre>`), format: "html", mime: "text/html", ext: "html" };
  });
}

function registerImages(): void {
  for (const input of SHARP_INPUTS) {
    for (const output of SHARP_OUTPUTS) {
      const to = output === "jpeg" ? "jpg" : output;
      if (input === to) continue;
      register(input, to, convertImage);
    }
  }
}

function registerMedia(): void {
  const mediaInputs = new Set([...VIDEO_OUT, ...AUDIO_OUT, "gif"]);
  for (const input of mediaInputs) {
    for (const output of [...VIDEO_OUT, ...AUDIO_OUT]) {
      if (input === output) continue;
      // video output requires video input; audio output accepts any media input
      const inFamily = FORMAT_ID_TO_META[input]?.family ?? "video";
      const outFamily = FORMAT_ID_TO_META[output]?.family ?? "video";
      if (outFamily === "video" && inFamily === "audio") continue; // can't make video from audio only
      register(input, output, convertMedia);
    }
  }
}

function registerAll(): void {
  registerDataHub();
  registerDocuments();
  registerImages();
  registerMedia();
}

registerAll();

// ============================================================================
// ENGINE
// ============================================================================

export class UnsupportedConversionError extends Error {
  constructor(from: string, to: string) {
    super(`Unsupported conversion: ${from} → ${to}`);
    this.name = "UnsupportedConversionError";
  }
}

export interface ConvertOptions {
  onProgress?: (percent: number) => void;
  abortSignal?: AbortSignal;
}

export class FileConverter {
  async detect(buffer: Buffer, filename?: string): Promise<DetectionResult> {
    return detectFormat(buffer, filename);
  }

  async convert(req: ConvertRequest): Promise<ConversionResult> {
    const to = canonicalFormat(req.to);
    if (!to) throw new Error(`Unknown target format: ${req.to}`);
    let from = canonicalFormat(req.from);
    if (!from) {
      const detected = await this.detect(req.buffer, req.filename);
      from = detected.format;
    }
    let key = `${from}:${to}`;
    let fn = converters.get(key);
    // XML/HTML are both `<>` markup. If XML was sniffed but the buffer is really
    // an HTML document and the target is a document format, retry as HTML.
    if (!fn && from === "xml" && smellsLikeHtml(req.buffer) && ["md", "html", "txt", "pdf"].includes(to)) {
      key = `html:${to}`;
      fn = converters.get(key);
      if (fn) from = "html";
    }
    if (!fn) throw new UnsupportedConversionError(from, to);
    req.onProgress?.(0);
    const result = await fn({ ...req, from, to });
    req.onProgress?.(1);
    return result;
  }

  async convertBatch(files: BatchFile[], to: string, options?: Record<string, unknown>, onProgress?: (index: number, percent: number) => void): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    await Promise.all(files.map(async (file, index) => {
      try {
        const res = await this.convert({ buffer: file.buffer, to, filename: file.name, options, onProgress: (p) => onProgress?.(index, p) });
        results.push({ name: file.name, ok: true, format: res.format, mime: res.mime, size: res.buffer.length, data: res.buffer.toString("base64"), meta: res.meta });
      } catch (err) {
        results.push({ name: file.name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }));
    return results;
  }

  async info(buffer: Buffer, filename?: string): Promise<FileInfo> {
    const detected = await this.detect(buffer, filename);
    const info: FileInfo = { format: detected.format, name: filename, size: buffer.length, mime: mimeOf(detected.format) };
    const family = FORMAT_ID_TO_META[detected.format]?.family;
    if (family === "image") {
      try {
        const sharpModule = await ensureSharp();
        const meta = await sharpModule.default(buffer).metadata();
        info.dimensions = { width: meta.width ?? 0, height: meta.height ?? 0 };
        info.meta = { channels: meta.channels, space: meta.space, format: meta.format };
      } catch { /* not a valid/readable image */ }
    } else if (detected.format === "pdf") {
      try {
        const text = await pdfToText(buffer);
        info.characters = text.length;
        info.lines = text.split("\n").length;
      } catch { /* ignore */ }
    } else if (["json", "yaml", "toml", "xml", "csv", "tsv", "xlsx", "xls"].includes(detected.format)) {
      try {
        const text = decodeText(buffer);
        info.characters = text.length;
        info.lines = text.split(/\r?\n/).length;
        if (["csv", "tsv", "xlsx", "xls"].includes(detected.format)) {
          const obj = await dataToObj(detected.format, buffer);
          info.rows = Array.isArray(obj) ? obj.length : 0;
        }
        if (detected.format === "json") {
          const obj = JSON.parse(text);
          info.rows = Array.isArray(obj) ? obj.length : undefined;
        }
      } catch { /* ignore */ }
    } else {
      try {
        const text = decodeText(buffer);
        info.characters = text.length;
        info.lines = text.split(/\r?\n/).length;
      } catch { /* binary */ }
    }
    return info;
  }

  formats(): FormatGroup[] {
    return listFormatGroups();
  }

  supported(from: string): string[] {
    return suggestedOutputsFor(from);
  }

  allSupported(): Array<{ from: string; to: string; detail: string }> {
    return listSupportedConversions();
  }
}

// Export the singleton
export const fileConverter = new FileConverter();