/**
 * ErrorOverlay
 *
 * Friendly, actionable error overlay for preview with auto-fix suggestions.
 * Matches v0's error experience: "Here's what went wrong, here's how to fix it."
 */

import React, { useState, useCallback, useEffect } from 'react';
import { X, AlertCircle, RefreshCw, Code2, ExternalLink, Copy, ChevronDown, ChevronUp, Zap, HelpCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/Collapsible';
import { useToast } from '@/components/ui/Toast';

export interface ErrorDetail {
  id: string;
  type: 'syntax' | 'runtime' | 'build' | 'import' | 'type' | 'network' | 'permission' | 'unknown';
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  stack?: string;
  suggestion?: string;
  autoFix?: AutoFixAction;
  docsUrl?: string;
  exampleUrl?: string;
  timestamp: number;
}

export interface AutoFixAction {
  label: string;
  description: string;
  action: () => Promise<void> | void;
  confidence: 'high' | 'medium' | 'low';
}

export interface ErrorOverlayProps {
  /** Errors to display */
  errors: ErrorDetail[];
  /** Whether overlay is visible */
  isOpen: boolean;
  /** Callback when user dismisses overlay */
  onClose: () => void;
  /** Callback when user applies auto-fix */
  onAutoFix?: (errorId: string, action: AutoFixAction) => Promise<void>;
  /** Callback when user wants to retry */
  onRetry?: () => void;
  /** Callback when user copies error */
  onCopyError?: (error: ErrorDetail) => void;
  /** Callback when user opens docs */
  onOpenDocs?: (url: string) => void;
  /** Custom className */
  className?: string;
  /** Overlay title */
  title?: string;
  /** Show error count badge */
  showCount?: boolean;
  /** Max errors to show before collapsing */
  maxVisible?: number;
}

interface ParsedError extends ErrorDetail {
  parsed: {
    file: string;
    line: number;
    column: number;
    snippet: string;
  } | null;
}

const ERROR_TYPE_CONFIG: Record<ErrorDetail['type'], { icon: React.ReactNode; label: string; color: string }> = {
  syntax: { icon: <AlertCircle className="w-4 h-4" />, label: 'Syntax Error', color: 'text-red-500' },
  runtime: { icon: <AlertTriangle className="w-4 h-4" />, label: 'Runtime Error', color: 'text-orange-500' },
  build: { icon: <Zap className="w-4 h-4" />, label: 'Build Error', color: 'text-amber-500' },
  import: { icon: <Code2 className="w-4 h-4" />, label: 'Import Error', color: 'text-blue-500' },
  type: { icon: <HelpCircle className="w-4 h-4" />, label: 'Type Error', color: 'text-purple-500' },
  network: { icon: <ExternalLink className="w-4 h-4" />, label: 'Network Error', color: 'text-cyan-500' },
  permission: { icon: <AlertTriangle className="w-4 h-4" />, label: 'Permission Error', color: 'text-red-600' },
  unknown: { icon: <AlertCircle className="w-4 h-4" />, label: 'Unknown Error', color: 'text-gray-500' },
};

const SEVERITY_CONFIG: Record<ErrorDetail['severity'], { badge: string; border: string; bg: string }> = {
  error: { badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', border: 'border-red-500/50', bg: 'bg-red-50/50 dark:bg-red-900/20' },
  warning: { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', border: 'border-amber-500/50', bg: 'bg-amber-50/50 dark:bg-amber-900/20' },
  info: { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', border: 'border-blue-500/50', bg: 'bg-blue-50/50 dark:bg-blue-900/20' },
};

export function ErrorOverlay({
  errors,
  isOpen,
  onClose,
  onAutoFix,
  onRetry,
  onCopyError,
  onOpenDocs,
  className = '',
  title = 'Preview Error',
  showCount = true,
  maxVisible = 3,
}: ErrorOverlayProps) {
  const { toast } = useToast();
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null);

  // Parse error stack traces for file/line info
  const parsedErrors = errors.map(parseError);

  const visibleErrors = parsedErrors.slice(0, maxVisible);
  const hiddenCount = parsedErrors.length - maxVisible;

  const handleCopy = useCallback((error: ParsedError) => {
    const text = `${error.type.toUpperCase()}: ${error.message}\n${error.file ? `File: ${error.file}:${error.line}:${error.column}` : ''}\n${error.stack || ''}`;
    navigator.clipboard.writeText(text);
    setCopiedErrorId(error.id);
    setTimeout(() => setCopiedErrorId(null), 2000);
    onCopyError?.(error);
    toast({ title: 'Error copied to clipboard', variant: 'success' });
  }, [onCopyError, toast]);

  const handleAutoFix = useCallback(async (error: ParsedError) => {
    if (!error.autoFix || !onAutoFix) return;

    try {
      await onAutoFix(error.id, error.autoFix);
      toast({ title: `Applied fix: ${error.autoFix.label}`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Auto-fix failed', description: String(err), variant: 'destructive' });
    }
  }, [onAutoFix, toast]);

  const handleOpenDocs = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    onOpenDocs?.(url);
  }, [onOpenDocs]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!isOpen || errors.length === 0) return null;

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center p-4
        bg-black/50 backdrop-blur-sm animate-fade-in
        ${className}
      `}
      role="alertdialog"
      aria-labelledby="error-overlay-title"
      aria-modal="true"
    >
      <div className="w-full max-w-4xl max-h-[90vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <div>
              <h2 id="error-overlay-title" className="text-lg font-semibold text-foreground">{title}</h2>
              {showCount && (
                <p className="text-sm text-muted-foreground">
                  {errors.length} {errors.length === 1 ? 'error' : 'errors'} detected
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="gap-1"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close error overlay"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Error List */}
        <ScrollArea className="flex-1 overflow-y-auto p-4" style={{ maxHeight: '60vh' }}>
          <div className="space-y-4" role="list" aria-label="Errors">
            {visibleErrors.map((error, index) => (
              <ErrorCard
                key={error.id}
                error={error}
                index={index}
                isExpanded={expandedErrors.has(error.id)}
                onToggleExpand={() => toggleExpand(error.id)}
                onAutoFix={handleAutoFix}
                onCopy={handleCopy}
                onOpenDocs={handleOpenDocs}
                copied={copiedErrorId === error.id}
              />
            ))}

            {hiddenCount > 0 && (
              <div className="text-center py-4 text-muted-foreground">
                <p>+{hiddenCount} more error{hiddenCount !== 1 ? 's' : ''}...</p>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setExpandedErrors(new Set(parsedErrors.map(e => e.id)))}>
                  Show all
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-muted/50">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          {onRetry && (
            <Button onClick={onRetry} className="gap-1">
              <RefreshCw className="w-4 h-4" />
              Retry Preview
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ErrorCardProps {
  error: ParsedError;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAutoFix: (error: ParsedError) => void;
  onCopy: (error: ParsedError) => void;
  onOpenDocs: (url: string) => void;
  copied: boolean;
}

function ErrorCard({ error, index, isExpanded, onToggleExpand, onAutoFix, onCopy, onOpenDocs, copied }: ErrorCardProps) {
  const typeConfig = ERROR_TYPE_CONFIG[error.type];
  const severityConfig = SEVERITY_CONFIG[error.severity];

  return (
    <div
      className={`
        group relative rounded-lg border p-4 transition-all duration-200
        ${severityConfig.border} ${severityConfig.bg}
        hover:border-primary/50
      `}
      role="listitem"
    >
      {/* Error Header */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <span className="text-sm font-mono text-muted-foreground">{index + 1}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={typeConfig.color}>{typeConfig.icon}</span>
            <span className="font-medium text-foreground">{typeConfig.label}</span>
            <Badge variant="outline" className={severityConfig.badge} style={{ fontSize: '0.65rem' }}>
              {error.severity.toUpperCase()}
            </Badge>
            {error.file && (
              <span className="text-xs text-muted-foreground font-mono">
                {error.file}:{error.line}:{error.column}
              </span>
            )}
          </div>

          <p className="mt-2 text-sm text-foreground">{error.message}</p>

          {error.suggestion && (
            <div className="mt-2 p-3 bg-green-50/50 dark:bg-green-900/20 border border-green-500/20 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">Suggestion:</span>
                <span>{error.suggestion}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {error.autoFix && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onAutoFix(error)}
              className="gap-1"
              disabled={copied}
            >
              <Zap className="w-3.5 h-3.5" />
              Auto-fix
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCopy(error)}
            aria-label={copied ? 'Copied!' : 'Copy error'}
            disabled={copied}
          >
            {copied ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleExpand}
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Expanded Details */}
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <CollapsibleContent className="mt-4 pt-4 border-t border-border/50 animate-accordion-down">
          <div className="space-y-4">
            {/* Code Snippet */}
            {error.parsed && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Code Context
                </h4>
                <pre className={`
                  bg-muted p-3 rounded text-xs font-mono overflow-x-auto
                  ${severityConfig.bg} ${severityConfig.border}
                `}>
                  <code>{error.parsed.snippet}</code>
                </pre>
              </div>
            )}

            {/* Stack Trace */}
            {error.stack && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Stack Trace
                </h4>
                <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
                  <code>{error.stack}</code>
                </pre>
              </div>
            )}

            {/* Raw Code */}
            {error.code && !error.parsed && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Source Code
                </h4>
                <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
                  <code>{error.code}</code>
                </pre>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
              {error.autoFix && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAutoFix(error)}
                  className="gap-1"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Apply Fix: {error.autoFix.label}
                </Button>
              )}
              {error.docsUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenDocs(error.docsUrl!)}
                  className="gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Documentation
                </Button>
              )}
              {error.exampleUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenDocs(error.exampleUrl!)}
                  className="gap-1"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  View Example
                </Button>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Parse error stack trace to extract file, line, column, and code snippet
 */
function parseError(error: ErrorDetail): ParsedError {
  let parsed: ParsedError['parsed'] = null;

  if (error.stack) {
    // Try to parse stack trace for file/line/column
    const stackLines = error.stack.split('\n');
    for (const line of stackLines) {
      // Match patterns like: at Function (/path/file.tsx:10:5)
      // or: at /path/file.tsx:10:5
      const match = line.match(/at\s+(?:.+\s+)?\(?([^:]+):(\d+):(\d+)\)?/);
      if (match && !match[1].includes('node_modules')) {
        const [, file, lineStr, columnStr] = match;
        parsed = {
          file,
          line: parseInt(lineStr, 10),
          column: parseInt(columnStr, 10),
          snippet: '',
        };
        break;
      }
    }
  }

  // If we have file/line from error directly, use that
  if (error.file && error.line && !parsed) {
    parsed = {
      file: error.file,
      line: error.line,
      column: error.column || 0,
      snippet: '',
    };
  }

  // Try to extract code snippet if we have code
  if (parsed && error.code) {
    const lines = error.code.split('\n');
    const start = Math.max(0, parsed.line - 3);
    const end = Math.min(lines.length, parsed.line + 2);
    parsed.snippet = lines.slice(start, end).map((l, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === parsed!.line ? '▶' : ' ';
      return `${marker} ${lineNum.toString().padStart(3)} | ${l}`;
    }).join('\n');
  }

  return { ...error, parsed };
}

/**
 * Hook for managing error overlay state
 */
export function useErrorOverlay() {
  const [errors, setErrors] = useState<ErrorDetail[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const addError = useCallback((error: Omit<ErrorDetail, 'id' | 'timestamp'>) => {
    const newError: ErrorDetail = {
      ...error,
      id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };
    setErrors(prev => [...prev, newError]);
    setIsOpen(true);
  }, []);

  const removeError = useCallback((id: string) => {
    setErrors(prev => prev.filter(e => e.id !== id));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setIsOpen(false);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  return {
    errors,
    isOpen,
    addError,
    removeError,
    clearErrors,
    close,
    setErrors,
    setIsOpen,
  };
}

/**
 * Create error from various sources
 */
export function createErrorFromEvent(event: ErrorEvent | PromiseRejectionEvent): ErrorDetail {
  if (event instanceof ErrorEvent) {
    return {
      type: 'runtime',
      severity: 'error',
      message: event.message,
      file: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
      timestamp: Date.now(),
      id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  } else {
    // PromiseRejectionEvent
    const reason = event.reason;
    return {
      type: 'runtime',
      severity: 'error',
      message: reason?.message || String(reason),
      stack: reason?.stack,
      timestamp: Date.now(),
      id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  }
}

/**
 * Create error from build result
 */
export function createErrorFromBuild(errors: Array<{ text: string; location?: { file: string; line: number; column: number } }>): ErrorDetail[] {
  return errors.map((err, i) => ({
    type: 'build' as const,
    severity: 'error' as const,
    message: err.text,
    file: err.location?.file,
    line: err.location?.line,
    column: err.location?.column,
    timestamp: Date.now(),
    id: `build-error-${Date.now()}-${i}`,
  }));
}