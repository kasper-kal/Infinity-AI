/**
 * Markdown Renderer Component — Liquid Glass Design System
 */

import React, { useMemo, useEffect, useRef } from "react";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { markedFootnote } from "marked-footnote";
import { markedGfmHeadingId } from "marked-gfm-heading-id";
import { markedAlert } from "marked-alert";
import DOMPurify from "dompurify";
import "./MarkdownRenderer.css";

export interface MarkdownRendererProps {
  /** Markdown content to render */
  content: string;
  /** Syntax highlighting theme */
  highlightTheme?: "light" | "dark" | "auto";
  /** Enable GFM (GitHub Flavored Markdown) */
  gfm?: boolean;
  /** Enable footnotes */
  footnotes?: boolean;
  /** Enable heading IDs */
  headingIds?: boolean;
  /** Enable alerts (GitHub-style) */
  alerts?: boolean;
  /** Custom renderers */
  renderers?: Partial<marked.Renderer>;
  /** Extensions */
  extensions?: marked.TokenizerExtension[];
  /** Sanitize HTML (security) */
  sanitize?: boolean;
  /** Allowed tags for sanitization */
  allowedTags?: string[];
  /** Allowed attributes for sanitization */
  allowedAttributes?: string[];
  /** Base URL for relative links */
  baseUrl?: string;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  /** Callback when links are clicked */
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Callback when images fail to load */
  onImageError?: (src: string, event: React.SyntheticEvent<HTMLImageElement>) => void;
  /** Copy code button */
  showCopyButton?: boolean;
  /** Line numbers in code blocks */
  showLineNumbers?: boolean;
  /** Max height */
  maxHeight?: number;
}

const DEFAULT_ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr",
  "strong", "em", "u", "s", "code", "pre", "kbd", "samp", "var",
  "blockquote", "cite", "q",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "a", "img",
  "details", "summary",
  "div", "span",
  "sup", "sub",
  "mark", "ins", "del",
];

const DEFAULT_ALLOWED_ATTRIBUTES = [
  "href", "src", "alt", "title", "target", "rel",
  "id", "class", "style",
  "data-language", "data-line", "data-highlight",
  "colspan", "rowspan", "scope",
  "open",
];

// Configure marked with extensions
const configureMarked = (options: {
  gfm: boolean;
  footnotes: boolean;
  headingIds: boolean;
  alerts: boolean;
  highlightTheme: "light" | "dark" | "auto";
  extensions?: marked.TokenizerExtension[];
  renderers?: Partial<marked.Renderer>;
}) => {
  const { gfm, footnotes, headingIds, alerts, highlightTheme, extensions, renderers } = options;

  const extensionsArray: marked.TokenizerExtension[] = [];

  if (gfm) {
    extensionsArray.push(...[
      marked.markedGfmBreaks(),
      marked.markedGfmStrikethrough(),
      marked.markedGfmTaskList(),
      marked.markedGfmTable(),
      marked.markedGfmAutolink(),
    ]);
  }

  if (footnotes) {
    extensionsArray.push(markedFootnote());
  }

  if (headingIds) {
    extensionsArray.push(markedGfmHeadingId());
  }

  if (alerts) {
    extensionsArray.push(markedAlert());
  }

  if (extensions) {
    extensionsArray.push(...extensions);
  }

  // Syntax highlighting
  extensionsArray.push(
    markedHighlight({
      async: false,
      langPrefix: "language-",
      highlight(code, lang, info) {
        // This would use a highlighter like shiki or highlight.js
        // For now, return escaped code
        return `<pre><code class="language-${lang || "plaintext"}">${escapeHtml(code)}</code></pre>`;
      },
    })
  );

  marked.use({ extensions: extensionsArray });

  // Custom renderers
  if (renderers) {
    marked.use({ renderer: { ...new marked.Renderer(), ...renderers } });
  }

  return marked;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  highlightTheme = "auto",
  gfm = true,
  footnotes = true,
  headingIds = true,
  alerts = true,
  renderers,
  extensions,
  sanitize = true,
  allowedTags = DEFAULT_ALLOWED_TAGS,
  allowedAttributes = DEFAULT_ALLOWED_ATTRIBUTES,
  baseUrl,
  className = "",
  style,
  onLinkClick,
  onImageError,
  showCopyButton = true,
  showLineNumbers = false,
  maxHeight,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");

  useEffect(() => {
    const markedInstance = configureMarked({
      gfm,
      footnotes,
      headingIds,
      alerts,
      highlightTheme,
      extensions,
      renderers,
    });

    let result = markedInstance.parse(content, { async: false }) as string;

    // Post-process for base URL
    if (baseUrl) {
      result = result.replace(/(href|src)="([^"]*)"/g, (match, attr, value) => {
        if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("//") || value.startsWith("mailto:") || value.startsWith("#")) {
          return match;
        }
        return `${attr}="${new URL(value, baseUrl).href}"`;
      });
    }

    // Sanitize
    if (sanitize) {
      result = DOMPurify.sanitize(result, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: allowedAttributes,
      });
    }

    // Add copy buttons to code blocks
    if (showCopyButton) {
      result = result.replace(
        /<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
        (match, lang, code) => {
          return `
            <div class="markdown-code-block" data-language="${lang}">
              <div class="markdown-code-block__header">
                <span class="markdown-code-block__lang">${lang || "plaintext"}</span>
                <button class="markdown-code-block__copy" type="button" aria-label="Copy code">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>Copy</span>
                </button>
              </div>
              <pre><code class="language-${lang || "plaintext"}">${code}</code></pre>
            </div>
          `;
        }
      );
    }

    // Add line numbers
    if (showLineNumbers) {
      result = result.replace(
        /<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
        (match, lang, code) => {
          const lines = code.split("\n");
          const lineNumbers = lines.map((_, i) => `<span class="markdown-line-number">${i + 1}</span>`).join("");
          return `
            <div class="markdown-code-block markdown-code-block--numbered" data-language="${lang}">
              <pre><code class="language-${lang || "plaintext"}">${code}</code></pre>
              <div class="markdown-line-numbers">${lineNumbers}</div>
            </div>
          `;
        }
      );
    }

    setHtml(result);

    // Attach event listeners after render
    const handleClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a");
      if (link && onLinkClick) {
        e.preventDefault();
        onLinkClick(link.href, e as unknown as React.MouseEvent<HTMLAnchorElement>);
      }
    };

    const handleImageError = (e: Event) => {
      const img = e.target as HTMLImageElement;
      if (onImageError) {
        onImageError(img.src, e as unknown as React.SyntheticEvent<HTMLImageElement>);
      }
    };

    // Use setTimeout to wait for render
    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.addEventListener("click", handleClick);
        containerRef.current.querySelectorAll("img").forEach((img) => {
          img.addEventListener("error", handleImageError);
        });
      }
    }, 0);

    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener("click", handleClick);
        containerRef.current.querySelectorAll("img").forEach((img) => {
          img.removeEventListener("error", handleImageError);
        });
      }
    };
  }, [
    content,
    gfm,
    footnotes,
    headingIds,
    alerts,
    highlightTheme,
    extensions,
    renderers,
    sanitize,
    allowedTags,
    allowedAttributes,
    baseUrl,
    showCopyButton,
    showLineNumbers,
    onLinkClick,
    onImageError,
  ]);

  const classNames = ["markdown-renderer", className].filter(Boolean).join(" ");

  return (
    <div
      ref={containerRef}
      className={classNames}
      style={{ ...style, maxHeight, overflow: maxHeight ? "auto" : "visible" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Markdown Editor — live preview editor */
export interface MarkdownEditorProps extends MarkdownRendererProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showPreview?: boolean;
  previewPosition?: "side" | "bottom" | "tab";
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  placeholder,
  showPreview = true,
  previewPosition = "side",
  className = "",
  style,
  ...rendererProps
}) => {
  const [previewMode, setPreviewMode] = useState<"edit" | "preview" | "split">(
    previewPosition === "tab" ? "edit" : "split"
  );

  const classNames = [
    "markdown-editor",
    `markdown-editor--${previewPosition}`,
    previewMode === "edit" && "markdown-editor--edit-only",
    previewMode === "preview" && "markdown-editor--preview-only",
    previewMode === "split" && "markdown-editor--split",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={className} style={style}>
      <div className="markdown-editor__toolbar">
        <div className="markdown-editor__toolbar-group">
          <button type="button" className="markdown-editor__btn" title="Bold (Ctrl+B)" onClick={() => wrapSelection("**", "**")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
          </button>
          <button type="button" className="markdown-editor__btn" title="Italic (Ctrl+I)" onClick={() => wrapSelection("*", "*")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
          </button>
          <button type="button" className="markdown-editor__btn" title="Strikethrough" onClick={() => wrapSelection("~~", "~~")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="12" x2="20" y2="12"/></svg>
          </button>
          <button type="button" className="markdown-editor__btn" title="Inline Code" onClick={() => wrapSelection("`", "`")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
        </div>
        <div className="markdown-editor__toolbar-group">
          <button type="button" className="markdown-editor__btn" title="Heading 1" onClick={() => insertAtCursor("# ")}>H1</button>
          <button type="button" className="markdown-editor__btn" title="Heading 2" onClick={() => insertAtCursor("## ")}>H2</button>
          <button type="button" className="markdown-editor__btn" title="Heading 3" onClick={() => insertAtCursor("### ")}>H3</button>
        </div>
        <div className="markdown-editor__toolbar-group">
          <button type="button" className="markdown-editor__btn" title="Unordered List" onClick={() => insertAtCursor("- ")}>•</button>
          <button type="button" className="markdown-editor__btn" title="Ordered List" onClick={() => insertAtCursor("1. ")}>1.</button>
          <button type="button" className="markdown-editor__btn" title="Task List" onClick={() => insertAtCursor("- [ ] ")}>✓</button>
          <button type="button" className="markdown-editor__btn" title="Quote" onClick={() => insertAtCursor("> ")}>″</button>
        </div>
        <div className="markdown-editor__toolbar-group">
          <button type="button" className="markdown-editor__btn" title="Link" onClick={() => wrapSelection("[", "]()")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button type="button" className="markdown-editor__btn" title="Image" onClick={() => wrapSelection("![", "]()")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
          <button type="button" className="markdown-editor__btn" title="Code Block" onClick={() => insertAtCursor("\n```\n\n```\n")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
          <button type="button" className="markdown-editor__btn" title="Table" onClick={() => insertAtCursor("| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h18v18H3z"/><path d="M12 3v18"/><path d="M3 12h18"/></svg>
          </button>
        </div>
        <div className="markdown-editor__toolbar-group markdown-editor__toolbar-group--right">
          {showPreview && previewPosition === "tab" && (
            <div className="markdown-editor__mode-toggle" role="tablist">
              <button
                role="tab"
                aria-selected={previewMode === "edit"}
                className={`markdown-editor__mode-btn ${previewMode === "edit" ? "active" : ""}`}
                onClick={() => setPreviewMode("edit")}
                type="button"
              >
                Edit
              </button>
              <button
                role="tab"
                aria-selected={previewMode === "preview"}
                className={`markdown-editor__mode-btn ${previewMode === "preview" ? "active" : ""}`}
                onClick={() => setPreviewMode("preview")}
                type="button"
              >
                Preview
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="markdown-editor__content">
        {previewMode !== "preview" && (
          <textarea
            className="markdown-editor__textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            data-gramm={false}
          />
        )}

        {(previewMode !== "edit" || previewPosition !== "tab") && (
          <div className="markdown-editor__preview">
            <MarkdownRenderer content={value} {...rendererProps} />
          </div>
        )}
      </div>
    </div>
  );
};

// Simple selection manipulation (in production, use a proper textarea selection library)
function wrapSelection(prefix: string, suffix: string) {
  const textarea = document.querySelector(".markdown-editor__textarea:focus") as HTMLTextAreaElement;
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.slice(start, end);
  const newText = prefix + selectedText + suffix;

  textarea.setRangeText(newText, start, end, "end");
  textarea.focus();
}

function insertAtCursor(text: string) {
  const textarea = document.querySelector(".markdown-editor__textarea:focus") as HTMLTextAreaElement;
  if (!textarea) return;

  const start = textarea.selectionStart;
  textarea.setRangeText(text, start, start, "end");
  textarea.focus();
}

// Need useState import
import { useState } from "react";