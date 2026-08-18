/**
 * Diff View Component — Liquid Glass Design System
 */

import React, { useMemo, useState, useCallback, ReactNode } from "react";
import "./DiffView.css";

export interface DiffLine {
  type: "add" | "remove" | "unchanged" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffViewProps {
  /** Unified diff string or parsed hunks */
  diff: string | DiffHunk[];
  /** Language for syntax highlighting */
  language?: string;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Show gutter with +/- indicators */
  showGutter?: boolean;
  /** Collapse unchanged context lines */
  collapseContext?: boolean;
  /** Number of context lines to show when collapsed */
  contextLines?: number;
  /** Inline diff (show changes within lines) */
  inline?: boolean;
  /** Word-level diff */
  wordDiff?: boolean;
  /** Theme */
  theme?: "light" | "dark" | "auto";
  /** Maximum height */
  maxHeight?: number;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  /** Render custom line content */
  renderLine?: (line: DiffLine, index: number) => ReactNode;
  /** On line click */
  onLineClick?: (line: DiffLine, lineNumber: number) => void;
}

export const DiffView: React.FC<DiffViewProps> = ({
  diff,
  language,
  showLineNumbers = true,
  showGutter = true,
  collapseContext = false,
  contextLines = 3,
  inline = false,
  wordDiff = false,
  theme = "auto",
  maxHeight,
  className = "",
  style,
  renderLine,
  onLineClick,
}) => {
  const [expandedContext, setExpandedContext] = useState<Set<number>>(new Set());

  const hunks = useMemo(() => {
    if (typeof diff === "string") {
      return parseUnifiedDiff(diff);
    }
    return diff;
  }, [diff]);

  const toggleContext = useCallback((hunkIndex: number) => {
    setExpandedContext((prev) => {
      const next = new Set(prev);
      if (next.has(hunkIndex)) {
        next.delete(hunkIndex);
      } else {
        next.add(hunkIndex);
      }
      return next;
    });
  }, []);

  const classNames = ["diff-view", `diff-view--${theme}`, className].filter(Boolean).join(" ");

  return (
    <div
      className={classNames}
      style={{ ...style, maxHeight }}
      role="region"
      aria-label="Diff view"
      tabIndex={0}
    >
      <div className="diff-view__header">
        <span className="diff-view__stats">
          {hunks.reduce((acc, h) => acc + h.lines.filter((l) => l.type === "add").length, 0)} additions,
          {hunks.reduce((acc, h) => acc + h.lines.filter((l) => l.type === "remove").length, 0)} deletions
        </span>
        {hunks.some((h) => h.lines.some((l) => l.type === "context")) && (
          <button
            className="diff-view__expand-all"
            onClick={() => {
              if (expandedContext.size === hunks.length) {
                setExpandedContext(new Set());
              } else {
                setExpandedContext(new Set(hunks.map((_, i) => i)));
              }
            }}
          >
            {expandedContext.size === hunks.length ? "Collapse all" : "Expand all"} context
          </button>
        )}
      </div>
      <div className="diff-view__content">
        {hunks.map((hunk, hunkIndex) => (
          <DiffHunkComponent
            key={hunkIndex}
            hunk={hunk}
            hunkIndex={hunkIndex}
            showLineNumbers={showLineNumbers}
            showGutter={showGutter}
            collapseContext={collapseContext}
            contextLines={contextLines}
            inline={inline}
            wordDiff={wordDiff}
            expanded={expandedContext.has(hunkIndex)}
            onToggleContext={() => toggleContext(hunkIndex)}
            renderLine={renderLine}
            onLineClick={onLineClick}
          />
        ))}
      </div>
    </div>
  );
};

interface DiffHunkComponentProps {
  hunk: DiffHunk;
  hunkIndex: number;
  showLineNumbers: boolean;
  showGutter: boolean;
  collapseContext: boolean;
  contextLines: number;
  inline: boolean;
  wordDiff: boolean;
  expanded: boolean;
  onToggleContext: () => void;
  renderLine?: (line: DiffLine, index: number) => ReactNode;
  onLineClick?: (line: DiffLine, lineNumber: number) => void;
}

function DiffHunkComponent({
  hunk,
  hunkIndex,
  showLineNumbers,
  showGutter,
  collapseContext,
  contextLines,
  inline,
  wordDiff,
  expanded,
  onToggleContext,
  renderLine,
  onLineClick,
}: DiffHunkComponentProps) {
  const [showAllContext, setShowAllContext] = useState(false);

  // Process lines for display
  const displayLines = useMemo(() => {
    if (!collapseContext) return hunk.lines;

    const contextLineIndices = hunk.lines
      .map((line, i) => (line.type === "context" ? i : -1))
      .filter((i) => i !== -1);

    if (contextLineIndices.length <= contextLines * 2) return hunk.lines;

    if (expanded || showAllContext) return hunk.lines;

    // Show first N and last N context lines
    const firstContext = contextLineIndices.slice(0, contextLines);
    const lastContext = contextLineIndices.slice(-contextLines);
    const showIndices = new Set([...firstContext, ...lastContext]);

    return hunk.lines.map((line, i) => {
      if (line.type !== "context") return line;
      if (showIndices.has(i)) return line;
      return { ...line, type: "hidden-context" as const };
    });
  }, [hunk.lines, collapseContext, contextLines, expanded, showAllContext]);

  const hasHiddenContext = collapseContext && displayLines.some((l) => l.type === "hidden-context");

  return (
    <div className="diff-hunk">
      <div className="diff-hunk__header">
        <span className="diff-hunk__range">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </span>
        {hasHiddenContext && (
          <button
            className="diff-hunk__expand"
            onClick={onToggleContext}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse context" : "Expand context"}
          >
            {expanded ? `Hide ${displayLines.filter((l) => l.type === "hidden-context").length} lines` : `Show ${displayLines.filter((l) => l.type === "hidden-context").length} lines`}
          </button>
        )}
      </div>
      <div className="diff-hunk__lines">
        {displayLines.map((line, lineIndex) => (
          <DiffLineComponent
            key={`${hunkIndex}-${lineIndex}`}
            line={line}
            lineIndex={lineIndex}
            showLineNumbers={showLineNumbers}
            showGutter={showGutter}
            inline={inline}
            wordDiff={wordDiff}
            renderLine={renderLine}
            onClick={onLineClick}
          />
        ))}
      </div>
    </div>
  );
}

interface DiffLineComponentProps {
  line: DiffLine & { type: "add" | "remove" | "unchanged" | "context" | "hidden-context" };
  lineIndex: number;
  showLineNumbers: boolean;
  showGutter: boolean;
  inline: boolean;
  wordDiff: boolean;
  renderLine?: (line: DiffLine, index: number) => ReactNode;
  onClick?: (line: DiffLine, lineNumber: number) => void;
}

function DiffLineComponent({
  line,
  lineIndex,
  showLineNumbers,
  showGutter,
  inline,
  wordDiff,
  renderLine,
  onClick,
}: DiffLineComponentProps) {
  const isHidden = line.type === "hidden-context";

  const handleClick = () => {
    if (!isHidden && onClick) {
      const lineNumber = line.newLineNumber || line.oldLineNumber;
      if (lineNumber) onClick(line, lineNumber);
    }
  };

  if (renderLine) {
    return (
      <div
        className={`diff-line ${line.type} ${isHidden ? "diff-line--hidden" : ""}`}
        onClick={handleClick}
        style={{ opacity: isHidden ? 0.4 : 1 }}
      >
        {renderLine(line, lineIndex)}
      </div>
    );
  }

  const gutterSymbol = showGutter
    ? line.type === "add"
      ? "+"
      : line.type === "remove"
      ? "−"
      : " "
    : null;

  const lineNumbers = showLineNumbers
    ? {
        old: line.oldLineNumber,
        new: line.newLineNumber,
      }
    : null;

  return (
    <div
      className={`diff-line ${line.type} ${isHidden ? "diff-line--hidden" : ""} ${inline ? "diff-line--inline" : ""}`}
      onClick={handleClick}
      style={{ opacity: isHidden ? 0.4 : 1 }}
      data-old-line={line.oldLineNumber}
      data-new-line={line.newLineNumber}
    >
      {showGutter && (
        <span className="diff-line__gutter" aria-hidden="true">
          {gutterSymbol}
        </span>
      )}
      {lineNumbers && (
        <>
          <span className="diff-line__number diff-line__number--old" aria-label={`Old line ${lineNumbers.old}`}>
            {lineNumbers.old ?? " "}
          </span>
          <span className="diff-line__number diff-line__number--new" aria-label={`New line ${lineNumbers.new}`}>
            {lineNumbers.new ?? " "}
          </span>
        </>
      )}
      <div className="diff-line__content">
        {isHidden ? (
          <span className="diff-line__hidden-indicator">…</span>
        ) : inline && wordDiff ? (
          <WordDiffContent line={line} />
        ) : (
          <span className="diff-line__text">{line.content || " "}</span>
        )}
      </div>
    </div>
  );
}

function WordDiffContent({ line }: { line: DiffLine }) {
  // Simple word-level diff - in production use a proper diff library
  const words = line.content.split(/(\s+)/);
  return (
    <>
      {words.map((word, i) => (
        <span key={i} className="diff-word">
          {word}
        </span>
      ))}
    </>
  );
}

/** Parse unified diff format */
function parseUnifiedDiff(diff: string): DiffHunk[] {
  const lines = diff.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: parseInt(hunkMatch[2] || "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newLines: parseInt(hunkMatch[4] || "1", 10),
        lines: [],
      };
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        newLineNumber: newLineNum++,
      });
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "remove",
        content: line.slice(1),
        oldLineNumber: oldLineNum++,
      });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "unchanged",
        content: line.slice(1),
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      });
    } else if (line.startsWith("\\")) {
      // No newline at end of file marker
      continue;
    }
  }

  if (currentHunk) hunks.push(currentHunk);

  return hunks;
}

/** Inline Diff — for showing changes within a single line */
export interface InlineDiffProps {
  oldText: string;
  newText: string;
  className?: string;
}

export const InlineDiff: React.FC<InlineDiffProps> = ({ oldText, newText, className = "" }) => {
  // Simple character-level diff for inline display
  const { added, removed } = useMemo(() => computeInlineDiff(oldText, newText), [oldText, newText]);

  return (
    <span className={`inline-diff ${className}`}>
      {removed.map((part, i) => (
        <span key={`rem-${i}`} className="inline-diff__removed">
          {part}
        </span>
      ))}
      {added.map((part, i) => (
        <span key={`add-${i}`} className="inline-diff__added">
          {part}
        </span>
      ))}
    </span>
  );
};

function computeInlineDiff(oldStr: string, newStr: string): { added: string[]; removed: string[] } {
  // Simplified - in production use a proper diff algorithm like Myers
  const oldWords = oldStr.split(/(\s+)/).filter(Boolean);
  const newWords = newStr.split(/(\s+)/).filter(Boolean);

  const added: string[] = [];
  const removed: string[] = [];

  // Very basic implementation
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);

  for (const word of newWords) {
    if (!oldSet.has(word)) added.push(word);
  }
  for (const word of oldWords) {
    if (!newSet.has(word)) removed.push(word);
  }

  return { added, removed };
}

/** File Diff — complete file diff with header */
export interface FileDiffProps extends DiffViewProps {
  oldFile: string;
  newFile: string;
  oldContent: string;
  newContent: string;
  language?: string;
}

export const FileDiff: React.FC<FileDiffProps> = ({
  oldFile,
  newFile,
  oldContent,
  newContent,
  language,
  className = "",
  ...props
}) => {
  const diff = useMemo(() => {
    // Generate unified diff
    return generateUnifiedDiff(oldFile, newFile, oldContent, newContent);
  }, [oldFile, newFile, oldContent, newContent]);

  return (
    <div className={`file-diff ${className}`}>
      <div className="file-diff__header">
        <div className="file-diff__file file-diff__file--old">
          <span className="file-diff__label">−</span>
          <span className="file-diff__path">{oldFile}</span>
        </div>
        <div className="file-diff__file file-diff__file--new">
          <span className="file-diff__label">+</span>
          <span className="file-diff__path">{newFile}</span>
        </div>
      </div>
      <DiffView diff={diff} language={language} {...props} />
    </div>
  );
};

function generateUnifiedDiff(oldFile: string, newFile: string, oldContent: string, newContent: string): string {
  // Simplified - in production use a proper diff library like diff
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  let diff = `--- a/${oldFile}\n+++ b/${newFile}\n`;

  // Simple line-by-line comparison
  const maxLines = Math.max(oldLines.length, newLines.length);
  let inHunk = false;
  let hunkStart = 0;

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine !== newLine) {
      if (!inHunk) {
        inHunk = true;
        hunkStart = i;
        diff += `@@ -${hunkStart + 1},${oldLines.length - hunkStart} +${hunkStart + 1},${newLines.length - hunkStart} @@\n`;
      }
      if (oldLine !== undefined) diff += `-${oldLine}\n`;
      if (newLine !== undefined) diff += `+${newLine}\n`;
    } else if (inHunk) {
      // Context line
      diff += ` ${oldLine}\n`;
    }
  }

  return diff;
}