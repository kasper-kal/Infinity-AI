import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronRight, X, Terminal, Play, Sparkles, Monitor, FileText, RotateCcw, ChevronLeft, ChevronDown, History, Settings, Zap, Download, Copy, Check, AlertTriangle, GitBranch } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import '@/lib/build-ui-theme.css';

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string[]; // for fuzzy matching
  icon?: React.ReactNode;
  action: () => void;
  shortcut?: string;
  section?: string;
  disabled?: boolean;
  danger?: boolean;
}

interface BuildCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  placeholder?: string;
}

function CommandPaletteItemComponent({
  item,
  highlighted,
  onSelect,
  searchQuery,
}: {
  item: CommandPaletteItem;
  highlighted: boolean;
  onSelect: () => void;
  searchQuery: string;
}) {
  const { t } = useI18n();

  const matchLabel = (text: string) => {
    if (!searchQuery) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === searchQuery.toLowerCase() ? (
            <mark key={i} className="bg-primary/30 text-primary font-medium">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={item.disabled}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
        highlighted ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary/50'
      } ${item.disabled ? 'opacity-40 pointer-events-none' : ''} ${item.danger ? 'text-rose-400' : ''}`}
      style={{ minHeight: 'var(--build-touch-target)' }}
    >
      {item.icon && <span className="flex-shrink-0 h-5 w-5">{item.icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{matchLabel(item.label)}</p>
        {item.description && (
          <p className="text-[11px] text-muted-foreground/70 truncate">{matchLabel(item.description)}</p>
        )}
      </div>
      {item.shortcut && (
        <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-mono text-muted-foreground/60 rounded bg-secondary/50">
          {item.shortcut}
        </span>
      )}
      <ChevronRight className="flex-shrink-0 h-4 w-4 text-muted-foreground/50" />
    </button>
  );
}

export function BuildCommandPalette({ open, onClose, items, placeholder }: BuildCommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Group items by section
  const groupedItems = useMemo(() => {
    const groups: Record<string, CommandPaletteItem[]> = {};
    items.forEach(item => {
      const section = item.section || 'General';
      if (!groups[section]) groups[section] = [];
      groups[section].push(item);
    });
    return groups;
  }, [items]);

  // Filter items
  const filteredGroups = useMemo(() => {
    if (!query) return groupedItems;
    const lowerQuery = query.toLowerCase();
    const filtered: Record<string, CommandPaletteItem[]> = {};
    Object.entries(groupedItems).forEach(([section, sectionItems]) => {
      const filteredItems = sectionItems.filter(item => {
        const searchText = [
          item.label,
          item.description,
          ...(item.keywords || []),
          item.shortcut || '',
        ].join(' ').toLowerCase();
        return searchText.includes(lowerQuery);
      });
      if (filteredItems.length > 0) filtered[section] = filteredItems;
    });
    return filtered;
  }, [groupedItems, query]);

  // Flatten for keyboard navigation
  const flatItems = useMemo(() => {
    const flat: CommandPaletteItem[] = [];
    Object.values(filteredGroups).forEach(sectionItems => {
      flat.push(...sectionItems);
    });
    return flat;
  }, [filteredGroups]);

  // Clamp highlighted index
  useEffect(() => {
    setHighlightedIndex(Math.min(highlightedIndex, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length, highlightedIndex]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!open) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setHighlightedIndex(i => Math.min(i + 1, flatItems.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setHighlightedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (flatItems[highlightedIndex]) {
            flatItems[highlightedIndex].action();
            onClose();
          }
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    },
    [open, flatItems, highlightedIndex, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Scroll highlighted into view
  useEffect(() => {
    if (listRef.current && flatItems[highlightedIndex]) {
      const itemEl = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
      if (itemEl) {
        itemEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, flatItems]);

  if (!open) return null;

  const totalResults = Object.values(filteredGroups).reduce((sum, arr) => sum + arr.length, 0);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('studio.build.commandPaletteTitle') || 'Command Palette'}
    >
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-secondary/30">
          <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder || t('studio.build.commandPalettePlaceholder') || 'Type a command…'}
            className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault();
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="flex-shrink-0 px-2 py-0.5 text-[10px] font-mono text-muted-foreground/60 rounded bg-secondary/50">
            �����K
          </kbd>
        </div>

        {/* Results */}
        <AnimatePresence mode="popLayout">
          {totalResults === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <Search className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">No commands match</p>
              <p className="text-[11px] mt-1">Try a different search term</p>
            </div>
          ) : (
            <div
              ref={listRef}
              className="max-h-[50vh] overflow-y-auto p-2"
              role="listbox"
              aria-label="Commands"
            >
              {Object.entries(filteredGroups).map(([section, sectionItems]) => (
                <div key={section} className="space-y-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    {section}
                  </p>
                  {sectionItems.map((item, i) => {
                    const globalIndex = flatItems.indexOf(item);
                    return (
                      <CommandPaletteItemComponent
                        key={item.id}
                        item={item}
                        highlighted={globalIndex === highlightedIndex}
                        onSelect={() => {
                          item.action();
                          onClose();
                        }}
                        searchQuery={query}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </AnimatePresence>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 bg-secondary/30">
          <span className="text-[10px] text-muted-foreground/60">
            {totalResults} {t('studio.build.commandPaletteResults') || 'command(s)'}
          </span>
          <span className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            <kbd className="px-1.5 py-0.5 rounded bg-secondary/50">���</kbd>
            <span>{t('studio.build.commandPaletteNavigate') || 'Navigate'}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-secondary/50">Enter</kbd>
            <span>{t('studio.build.commandPaletteSelect') || 'Select'}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-secondary/50">Esc</kbd>
            <span>{t('studio.build.commandPaletteClose') || 'Close'}</span>
          </span>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

/**
 * Default command palette items for Build Studio.
 * Pass custom items to override or extend.
 */
export function createDefaultCommandPaletteItems(actions: {
  runBuild?: () => void;
  cancelBuild?: () => void;
  toggleDiff?: () => void;
  openPreview?: () => void;
  openConsole?: () => void;
  openHistory?: () => void;
  createCheckpoint?: () => void;
  rollback?: () => void;
  exportWorkspace?: () => void;
  toggleConfirmation?: () => void;
  toggleParallel?: () => void;
  modelSettings?: () => void;
  refreshFiles?: () => void;
  openSettings?: () => void;
  openBuildMap?: () => void;
}): CommandPaletteItem[] {
  const items: CommandPaletteItem[] = [];

  // Build commands
  if (actions.runBuild) {
    items.push({
      id: 'run-build',
      label: 'Run Build',
      description: 'Start or resume the build',
      keywords: ['start', 'build', 'run', 'scaffold'],
      icon: <Play className="h-5 w-5" />,
      action: actions.runBuild,
      shortcut: '���Enter',
      section: 'Build',
    });
  }

  if (actions.cancelBuild) {
    items.push({
      id: 'cancel-build',
      label: 'Cancel Build',
      description: 'Stop the current build',
      keywords: ['stop', 'cancel', 'abort'],
      icon: <X className="h-5 w-5" />,
      action: actions.cancelBuild,
      shortcut: 'Esc',
      section: 'Build',
    });
  }

  if (actions.toggleDiff) {
    items.push({
      id: 'toggle-diff',
      label: 'Show Diff',
      description: 'Toggle diff preview modal',
      keywords: ['diff', 'changes', 'preview'],
      icon: <FileText className="h-5 w-5" />,
      action: actions.toggleDiff,
      shortcut: '���.',
      section: 'Build',
    });
  }

  if (actions.openPreview) {
    items.push({
      id: 'open-preview',
      label: 'Open Preview',
      description: 'Open live preview in new tab',
      keywords: ['preview', 'browser', 'live'],
      icon: <Monitor className="h-5 w-5" />,
      action: actions.openPreview,
      section: 'Preview',
    });
  }

  if (actions.openConsole) {
    items.push({
      id: 'open-console',
      label: 'Open Console',
      description: 'Show browser console output',
      keywords: ['console', 'logs', 'errors', 'debug'],
      icon: <Terminal className="h-5 w-5" />,
      action: actions.openConsole,
      section: 'Preview',
    });
  }

  if (actions.openHistory) {
    items.push({
      id: 'open-history',
      label: 'View History',
      description: 'Open build history & checkpoints',
      keywords: ['history', 'checkpoints', 'snapshots', 'timeline'],
      icon: <History className="h-5 w-5" />,
      action: actions.openHistory,
      section: 'History',
    });
  }

  if (actions.createCheckpoint) {
    items.push({
      id: 'create-checkpoint',
      label: 'Create Checkpoint',
      description: 'Save current workspace state',
      keywords: ['checkpoint', 'save', 'snapshot', 'backup'],
      icon: <Sparkles className="h-5 w-5" />,
      action: actions.createCheckpoint,
      section: 'History',
    });
  }

  if (actions.rollback) {
    items.push({
      id: 'rollback',
      label: 'Rollback',
      description: 'Restore from a previous checkpoint',
      keywords: ['rollback', 'restore', 'undo', 'revert'],
      icon: <RotateCcw className="h-5 w-5" />,
      action: actions.rollback,
      danger: true,
      section: 'History',
    });
  }

  if (actions.exportWorkspace) {
    items.push({
      id: 'export-workspace',
      label: 'Export Workspace',
      description: 'Download workspace as ZIP',
      keywords: ['export', 'download', 'zip', 'backup'],
      icon: <Download className="h-5 w-5" />,
      action: actions.exportWorkspace,
      section: 'Workspace',
    });
  }

  if (actions.refreshFiles) {
    items.push({
      id: 'refresh-files',
      label: 'Refresh Files',
      description: 'Reload file tree from workspace',
      keywords: ['refresh', 'reload', 'files', 'sync'],
      icon: <RotateCcw className="h-5 w-5" />,
      action: actions.refreshFiles,
      section: 'Workspace',
    });
  }

  // Settings
  if (actions.toggleConfirmation) {
    items.push({
      id: 'toggle-confirmation',
      label: 'Toggle Diff Confirmation',
      description: 'Require approval before applying diffs',
      keywords: ['confirm', 'approval', 'diff', 'safety'],
      icon: <Check className="h-5 w-5" />,
      action: actions.toggleConfirmation,
      section: 'Settings',
    });
  }

  if (actions.toggleParallel) {
    items.push({
      id: 'toggle-parallel',
      label: 'Toggle Parallel Mode',
      description: 'Run independent steps concurrently',
      keywords: ['parallel', 'concurrent', 'speed', 'performance'],
      icon: <Zap className="h-5 w-5" />,
      action: actions.toggleParallel,
      section: 'Settings',
    });
  }

  if (actions.modelSettings) {
    items.push({
      id: 'model-settings',
      label: 'Model Settings',
      description: 'Configure AI model parameters',
      keywords: ['model', 'ai', 'settings', 'temperature', 'tokens'],
      icon: <Settings className="h-5 w-5" />,
      action: actions.modelSettings,
      section: 'Settings',
    });
  }

  if (actions.openSettings) {
    items.push({
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Open build studio settings',
      keywords: ['settings', 'preferences', 'config'],
      icon: <Settings className="h-5 w-5" />,
      action: actions.openSettings,
      section: 'Settings',
    });
  }

  // Visual Build Map
  if (actions.openBuildMap) {
    items.push({
      id: 'open-build-map',
      label: 'Open Build Map',
      description: 'View visual project roadmap graph',
      keywords: ['build', 'map', 'roadmap', 'graph', 'visual', 'plan'],
      icon: <GitBranch className="h-5 w-5" />,
      action: actions.openBuildMap,
      shortcut: '⌘M',
      section: 'Build Map',
    });
  }

  return items;
}