import { useEffect, useRef, useState, createPortal } from 'react';
import { ChevronLeft, ChevronRight, Code2, Copy, Download, Maximize2, Minimize2, X, Search, FileText, RotateCcw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import '@/lib/build-ui-theme.css';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface FileDiff {
  filePath: string;
  oldPath?: string;
  newPath?: string;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface BuildDiffPreviewProps {
  diffs: FileDiff[];
  open: boolean;
  onClose: () => void;
  onApply?: (filePath: string) => void;
  onReject?: (filePath: string) => void;
  title?: string;
}

function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const diffRegex = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let match;
  let lastIndex = 0;

  while ((match = diffRegex.exec(diffText)) !== null) {
    const filePath = match[1];
    const nextMatch = diffRegex.exec(diffText);
    const fileDiffText = diffText.slice(match.index, nextMatch ? nextMatch.index : diffText.length);
    diffRegex.lastIndex = match.index + match[0].length;

    const parsed = parseFileDiff(filePath, fileDiffText);
    if (parsed) files.push(parsed);
  }

  return files;
}

function parseFileDiff(filePath: string, diffText: string): FileDiff | null {
  const lines = diffText.split('\n');
  let oldPath = filePath;
  let newPath = filePath;
  let isNew = false;
  let isDeleted = false;
  let isBinary = false;
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('--- ')) {
      oldPath = line.slice(4).replace(/^a\//, '');
      if (oldPath === '/dev/null') isNew = true;
    } else if (line.startsWith('+++ ')) {
      newPath = line.slice(4).replace(/^b\//, '');
      if (newPath === '/dev/null') isDeleted = true;
    } else if (line.startsWith('Binary files')) {
      isBinary = true;
      break;
    } else if (line.startsWith('@@ ')) {
      const hunk = parseHunk(lines, i);
      if (hunk) {
        hunks.push(hunk.hunk);
        additions += hunk.additions;
        deletions += hunk.deletions;
        i = hunk.nextIndex - 1;
      }
    }
    i++;
  }

  if (isBinary) {
    return { filePath, oldPath, newPath, isNew, isDeleted, isBinary: true, hunks: [], additions, deletions };
  }

  return { filePath, oldPath, newPath, isNew, isDeleted, isBinary, hunks, additions, deletions };
}

function parseHunk(lines: string[], startIndex: number): { hunk: DiffHunk; nextIndex: number; additions: number; deletions: number } | null {
  const header = lines[startIndex];
  const match = header.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
  if (!match) return null;

  const oldStart = parseInt(match[1], 10);
  const oldLines = match[2] ? parseInt(match[2], 10) : 1;
  const newStart = parseInt(match[3], 10);
  const newLines = match[4] ? parseInt(match[4], 10) : 1;

  const hunkLines: DiffLine[] = [];
  let oldLineNum = oldStart;
  let newLineNum = newStart;
  let additions = 0;
  let deletions = 0;
  let i = startIndex + 1;

  while (i < lines.length && !lines[i].startsWith('@@ ')) {
    const line = lines[i];
    if (line.startsWith('+')) {
      hunkLines.push({ type: 'add', newLineNumber: newLineNum++, content: line.slice(1) });
      additions++;
    } else if (line.startsWith('-')) {
      hunkLines.push({ type: 'remove', oldLineNumber: oldLineNum++, content: line.slice(1) });
      deletions++;
    } else {
      hunkLines.push({ type: 'context', oldLineNumber: oldLineNum, newLineNumber: newLineNum, content: line.slice(1) });
      oldLineNum++;
      newLineNum++;
    }
    i++;
  }

  return {
    hunk: { oldStart, oldLines, newStart, newLines, lines: hunkLines },
    nextIndex: i,
    additions,
    deletions,
  };
}

function DiffHunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="diff-hunk">
      {hunk.lines.map((line, idx) => (
        <div
          key={idx}
          className={`diff-line flex ${
            line.type === 'add' ? 'bg-emerald-400/10' :
            line.type === 'remove' ? 'bg-rose-400/10' :
            'bg-transparent'
          }`}
        >
          <span className={`w-10 shrink-0 text-right pr-2 text-[11px] font-mono text-muted-foreground/50 select-none ${
            line.type === 'remove' ? 'text-rose-400/70' : 'text-muted-foreground/50'
          }`}>
            {line.oldLineNumber !== undefined ? line.oldLineNumber : ''}
          </span>
          <span className={`w-10 shrink-0 text-right pr-2 text-[11px] font-mono text-muted-foreground/50 select-none ${
            line.type === 'add' ? 'text-emerald-400/70' : 'text-muted-foreground/50'
          }`}>
            {line.newLineNumber !== undefined ? line.newLineNumber : ''}
          </span>
          <span className={`flex-1 px-3 py-0.5 text-[12px] font-mono ${
            line.type === 'add' ? 'text-emerald-300' :
            line.type === 'remove' ? 'text-rose-300' :
            'text-foreground'
          }`}>
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{line.content}
          </span>
        </div>
      ))}
    </div>
  );
}

function FileDiffView({
  diff,
  index,
  onApply,
  onReject,
  viewMode,
}: {
  diff: FileDiff;
  index: number;
  onApply?: (filePath: string) => void;
  onReject?: (filePath: string) => void;
  viewMode: 'side-by-side' | 'unified';
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (diff.isBinary) {
    return (
      <div className="rounded-xl border border-border bg-secondary p-6 text-center">
        <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">Binary file: {diff.filePath}</p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">Binary diffs not displayed</p>
      </div>
    );
  }

  if (diff.isNew && diff.hunks.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-6 text-center">
        <FileText className="h-12 w-12 mx-auto text-emerald-400" />
        <p className="mt-3 text-sm text-foreground">New file: {diff.filePath}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">No content to display (empty file)</p>
      </div>
    );
  }

  if (diff.isDeleted && diff.hunks.length === 0) {
    return (
      <div className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-6 text-center">
        <FileText className="h-12 w-12 mx-auto text-rose-400" />
        <p className="mt-3 text-sm text-foreground">Deleted file: {diff.filePath}</p>
      </div>
    );
  }

  return (
    <article className="diff-file rounded-xl border border-border bg-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className={`h-5 w-5 ${diff.isNew ? 'text-emerald-400' : diff.isDeleted ? 'text-rose-400' : 'text-primary'}`} />
          <span className="font-mono text-sm text-foreground truncate max-w-[300px]">{diff.filePath}</span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-mono text-emerald-400">
            +{diff.additions}
          </span>
          <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-mono text-rose-400">
            -{diff.deletions}
          </span>

          <button
            type="button"
            onClick={() => {
              const text = diff.hunks.map(h => h.lines.map(l =>
                `${l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' '}${l.content}`
              ).join('\n')).join('\n\n');
              navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Copy diff"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied && <span className="ml-1 text-emerald-400">Copied!</span>}
          </button>

          {onApply && !diff.isDeleted && (
            <button
              type="button"
              onClick={() => onApply(diff.filePath)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Apply
            </button>
          )}

          {onReject && (
            <button
              type="button"
              onClick={() => onReject(diff.filePath)}
              className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-[11px] text-rose-400 hover:bg-rose-400/10"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Reject
            </button>
          )}
        </div>
      </header>

      <div className="max-h-[60vh] overflow-auto p-3 font-mono text-[12px]">
        {viewMode === 'side-by-side' ? (
          <SideBySideDiff diff={diff} />
        ) : (
          <UnifiedDiff diff={diff} />
        )}
      </div>
    </article>
  );
}

function SideBySideDiff({ diff }: { diff: FileDiff }) {
  // For side-by-side, we interleave the hunks
  return (
    <div className="grid grid-cols-2 gap-0">
      <div className="border-r border-border">
        <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-border px-3 py-1 text-[10px] font-medium text-muted-foreground">
          Old
        </div>
        <div className="p-3 space-y-0.5">
          {diff.hunks.map((hunk, hi) => (
            <div key={hi} className="space-y-0.5">
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={`flex ${
                    line.type === 'remove' ? 'bg-rose-400/10' :
                    line.type === 'context' ? 'bg-transparent' :
                    'bg-transparent opacity-30'
                  }`}
                >
                  <span className="w-10 shrink-0 text-right pr-2 text-[11px] text-muted-foreground/50 select-none">
                    {line.oldLineNumber !== undefined ? line.oldLineNumber : ''}
                  </span>
                  <span className={`flex-1 px-3 py-0.5 ${
                    line.type === 'remove' ? 'text-rose-300 line-through' :
                    line.type === 'context' ? 'text-foreground' :
                    'text-muted-foreground/40'
                  }`}>
                    {line.type === 'remove' ? '-' : line.type === 'add' ? '+' : ' '}{line.content}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-border px-3 py-1 text-[10px] font-medium text-muted-foreground">
          New
        </div>
        <div className="p-3 space-y-0.5">
          {diff.hunks.map((hunk, hi) => (
            <div key={hi} className="space-y-0.5">
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={`flex ${
                    line.type === 'add' ? 'bg-emerald-400/10' :
                    line.type === 'context' ? 'bg-transparent' :
                    'bg-transparent opacity-30'
                  }`}
                >
                  <span className="w-10 shrink-0 text-right pr-2 text-[11px] text-muted-foreground/50 select-none">
                    {line.newLineNumber !== undefined ? line.newLineNumber : ''}
                  </span>
                  <span className={`flex-1 px-3 py-0.5 ${
                    line.type === 'add' ? 'text-emerald-300' :
                    line.type === 'context' ? 'text-foreground' :
                    'text-muted-foreground/40'
                  }`}>
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{line.content}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UnifiedDiff({ diff }: { diff: FileDiff }) {
  return (
    <div className="space-y-2">
      {diff.hunks.map((hunk, idx) => (
        <DiffHunkView key={idx} hunk={hunk} />
      ))}
    </div>
  );
}

export function BuildDiffPreview({
  diffs,
  open,
  onClose,
  onApply,
  onReject,
  title = 'Diff Preview',
}: BuildDiffPreviewProps) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('unified');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const parsedDiffs = useRef<FileDiff[]>([]);

  // Parse diffs on mount/change
  useEffect(() => {
    if (typeof diffs === 'string') {
      parsedDiffs.current = parseDiff(diffs);
    } else if (Array.isArray(diffs)) {
      parsedDiffs.current = diffs;
    }
    setSelectedIndex(0);
  }, [diffs]);

  if (!open || parsedDiffs.current.length === 0) return null;

  const currentDiff = parsedDiffs.current[selectedIndex];

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="flex h-[90vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/15 p-2 text-primary">
              <Code2 className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Search */}
            <div className="relative hidden sm:block">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search in diff…"
                className="rounded-lg border border-border bg-input pl-8 pr-3 py-1.5 w-64 text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary p-1">
              <button
                type="button"
                onClick={() => setViewMode('unified')}
                className={`rounded-md px-2.5 py-1.5 text-[11px] transition ${viewMode === 'unified' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                title="Unified view"
              >
                <FileText className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('side-by-side')}
                className={`rounded-md px-2.5 py-1.5 text-[11px] transition ${viewMode === 'side-by-side' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                title="Side-by-side view"
              >
                <Code2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* File navigator */}
            {parsedDiffs.current.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
                  disabled={selectedIndex === 0}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Previous file"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 text-[11px] font-mono text-muted-foreground">
                  {selectedIndex + 1}/{parsedDiffs.current.length}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedIndex(Math.min(parsedDiffs.current.length - 1, selectedIndex + 1))}
                  disabled={selectedIndex === parsedDiffs.current.length - 1}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Next file"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-auto">
          <FileDiffView
            diff={currentDiff}
            index={selectedIndex}
            onApply={onApply}
            onReject={onReject}
            viewMode={viewMode}
          />
        </div>

        {/* Mobile file selector */}
        {parsedDiffs.current.length > 1 && (
          <div className="border-t border-border px-4 py-2 sm:hidden">
            <select
              value={selectedIndex}
              onChange={e => setSelectedIndex(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none"
            >
              {parsedDiffs.current.map((d, i) => (
                <option key={d.filePath} value={i}>
                  {d.filePath} ({i + 1}/{parsedDiffs.current.length})
                </option>
              ))}
            </select>
          </div>
        )}

        <style jsx>{`
          .diff-line {
            white-space: pre;
            word-break: break-all;
          }
          @media (max-width: 768px) {
            .grid-cols-2 {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </div>,
    document.body
  );
}