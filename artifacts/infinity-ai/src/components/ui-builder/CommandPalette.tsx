/**
 * CommandPalette
 *
 * Cmd+K fuzzy search for all actions — keyboard-first DX.
 * Matches v0/Linear/CommandBar pattern with fuzzy matching, groups, shortcuts.
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  KeyboardEvent,
  ChangeEvent,
} from 'react';
import {
  Search,
  ChevronRight,
  Keyboard,
  Zap,
  Sparkles,
  ExternalLink,
  FolderOpen,
  FileCode,
  Terminal,
  Globe,
  Palette,
  Wrench,
  Rocket,
  History,
  Bookmark,
  Settings,
  HelpCircle,
  X,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScrollArea } from '@/components/ui';
import { Separator } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface CommandAction {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  shortcut?: string;
  group?: string;
  keywords?: string[];
  /** Action to execute */
  action: () => void | Promise<void>;
  /** Whether action is available */
  disabled?: boolean;
  /** Action category for grouping */
  category?: 'navigation' | 'editing' | 'preview' | 'deploy' | 'ai' | 'settings' | 'other';
  /** Priority for sorting (higher = first) */
  priority?: number;
  /** Whether this is a recent/frequent action */
  recent?: boolean;
}

export interface CommandGroup {
  id: string;
  label: string;
  icon?: LucideIcon;
  actions: CommandAction[];
  /** Whether group is collapsible */
  collapsible?: boolean;
  /** Default expanded state */
  defaultExpanded?: boolean;
}

export interface CommandPaletteProps {
  /** Whether palette is open */
  isOpen: boolean;
  /** Callback when palette closes */
  onClose: () => void;
  /** Available actions */
  actions: CommandAction[];
  /** Optional groups (overrides actions grouping) */
  groups?: CommandGroup[];
  /** Placeholder text */
  placeholder?: string;
  /** Title */
  title?: string;
  /** Custom className */
  className?: string;
  /** Trigger key (default: 'k' for Cmd+K) */
  triggerKey?: string;
  /** Whether to show help hint */
  showHint?: boolean;
  /** Max results to show */
  maxResults?: number;
  /** Debounce ms for search */
  debounceMs?: number;
  /** Callback when action executed */
  onActionExecute?: (action: CommandAction) => void;
}

interface CommandPaletteState {
  query: string;
  selectedIndex: number;
  filteredActions: CommandAction[];
  recentActions: string[];
  groupExpanded: Record<string, boolean>;
}

const CATEGORY_CONFIG: Record<CommandAction['category'], { icon: LucideIcon; label: string; color: string }> = {
  navigation: { icon: FolderOpen, label: 'Navigation', color: 'text-blue-500' },
  editing: { icon: FileCode, label: 'Editing', color: 'text-green-500' },
  preview: { icon: Globe, label: 'Preview', color: 'text-purple-500' },
  deploy: { icon: Rocket, label: 'Deploy', color: 'text-orange-500' },
  ai: { icon: Sparkles, label: 'AI Actions', color: 'text-pink-500' },
  settings: { icon: Settings, label: 'Settings', color: 'text-gray-500' },
  other: { icon: Wrench, label: 'Other', color: 'text-muted-foreground' },
};

const DEFAULT_GROUPS: CommandGroup[] = [
  {
    id: 'recent',
    label: 'Recent',
    icon: History,
    actions: [],
    defaultExpanded: true,
  },
  {
    id: 'navigation',
    label: 'Navigation',
    icon: FolderOpen,
    actions: [],
    category: 'navigation',
  },
  {
    id: 'editing',
    label: 'Editing',
    icon: FileCode,
    actions: [],
    category: 'editing',
  },
  {
    id: 'preview',
    label: 'Preview',
    icon: Globe,
    actions: [],
    category: 'preview',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    icon: Rocket,
    actions: [],
    category: 'deploy',
  },
  {
    id: 'ai',
    label: 'AI Actions',
    icon: Sparkles,
    actions: [],
    category: 'ai',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    actions: [],
    category: 'settings',
  },
];

export function CommandPalette({
  isOpen,
  onClose,
  actions,
  groups,
  placeholder = 'Search commands...',
  title = 'Command Palette',
  className = '',
  triggerKey = 'k',
  showHint = true,
  maxResults = 20,
  debounceMs = 0,
  onActionExecute,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CommandPaletteState>({
    query: '',
    selectedIndex: 0,
    filteredActions: [],
    recentActions: [],
    groupExpanded: {},
  });
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Load recent actions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('infinity-command-palette-recent');
      if (stored) {
        setState(prev => ({ ...prev, recentActions: JSON.parse(stored) }));
      }
    } catch {}
  }, []);

  // Save recent actions
  const saveRecent = useCallback((actionId: string) => {
    setState(prev => {
      const recent = [actionId, ...prev.recentActions.filter(id => id !== actionId)].slice(0, 10);
      try {
        localStorage.setItem('infinity-command-palette-recent', JSON.stringify(recent));
      } catch {}
      return { ...prev, recentActions: recent };
    });
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setState(prev => ({
          ...prev,
          selectedIndex: Math.min(prev.selectedIndex + 1, prev.filteredActions.length - 1),
        }));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setState(prev => ({
          ...prev,
          selectedIndex: Math.max(prev.selectedIndex - 1, 0),
        }));
        break;
      case 'Enter':
        e.preventDefault();
        const action = state.filteredActions[state.selectedIndex];
        if (action && !action.disabled) {
          executeAction(action);
        }
        break;
      case 'Tab':
        // Allow tab for navigation, but prevent default form behavior
        break;
    }
  }, [onClose, state.filteredActions, state.selectedIndex]);

  // Execute action
  const executeAction = useCallback(async (action: CommandAction) => {
    if (action.disabled) return;

    saveRecent(action.id);
    setIsLoading(true);

    try {
      await action.action();
      onActionExecute?.(action);
      onClose();
    } catch (error) {
      console.error('Command execution failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [saveRecent, onActionExecute, onClose]);

  // Filter actions based on query
  const filteredActions = useMemo(() => {
    const allActions = groups ? groups.flatMap(g => g.actions) : actions;
    const query = debouncedQuery.toLowerCase().trim();

    if (!query) {
      // Show recent actions first, then all actions grouped by category
      const recentActions = state.recentActions
        .map(id => allActions.find(a => a.id === id))
        .filter(Boolean) as CommandAction[];

      const otherActions = allActions.filter(a => !state.recentActions.includes(a.id));

      return [...recentActions, ...otherActions].slice(0, maxResults);
    }

    // Fuzzy search
    return allActions
      .map(action => {
        const searchText = [
          action.label,
          action.description || '',
          action.keywords?.join(' ') || '',
          action.group || '',
          action.category || '',
        ].join(' ').toLowerCase();

        // Simple fuzzy match score
        let score = 0;
        let queryIndex = 0;

        for (let i = 0; i < searchText.length && queryIndex < query.length; i++) {
          if (searchText[i] === query[queryIndex]) {
            score += 1;
            queryIndex++;
            // Bonus for consecutive matches
            if (i > 0 && searchText[i - 1] === query[queryIndex - 1]) {
              score += 0.5;
            }
            // Bonus for word boundary matches
            if (i === 0 || searchText[i - 1] === ' ') {
              score += 1;
            }
          }
        }

        // Exact label match bonus
        if (action.label.toLowerCase().includes(query)) {
          score += 10;
        }

        // Category match bonus
        if (action.category && query.includes(action.category)) {
          score += 5;
        }

        // Recent action bonus
        if (state.recentActions.includes(action.id)) {
          score += 3;
        }

        return { action, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        // Sort by score desc, then priority desc, then recent
        if (b.score !== a.score) return b.score - a.score;
        const priorityDiff = (b.action.priority || 0) - (a.action.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        return state.recentActions.indexOf(b.action.id) - state.recentActions.indexOf(a.action.id);
      })
      .slice(0, maxResults)
      .map(({ action }) => action);
  }, [actions, groups, debouncedQuery, state.recentActions, maxResults]);

  // Update filtered actions when query changes
  useEffect(() => {
    setState(prev => ({ ...prev, filteredActions, selectedIndex: 0 }));
  }, [filteredActions]);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(state.query);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [state.query, debounceMs]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setState(prev => ({ ...prev, query: '', selectedIndex: 0 }));
      setDebouncedQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle global keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === triggerKey.toLowerCase()) {
        e.preventDefault();
        onClose(); // Toggle - if open, close; if closed, the parent should open
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [triggerKey, onClose]);

  // Group actions for display
  const displayGroups = useMemo(() => {
    if (groups) {
      return groups.map(group => ({
        ...group,
        actions: group.actions.filter(a => filteredActions.includes(a)),
      })).filter(g => g.actions.length > 0);
    }

    // Auto-group by category
    const categorized = new Map<string, CommandAction[]>();
    filteredActions.forEach(action => {
      const category = action.category || 'other';
      if (!categorized.has(category)) categorized.set(category, []);
      categorized.get(category)!.push(action);
    });

    return Array.from(categorized.entries()).map(([category, actions]) => ({
      id: category,
      label: CATEGORY_CONFIG[category as CommandAction['category']]?.label || category,
      icon: CATEGORY_CONFIG[category as CommandAction['category']]?.icon || Wrench,
      actions,
      category: category as CommandAction['category'],
    }));
  }, [groups, filteredActions]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex items-start justify-center pt-16 px-4',
        'bg-black/30 backdrop-blur-sm animate-fade-in',
        className
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={handleKeyDown}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn(
        'w-full max-w-2xl bg-background border border-border rounded-xl shadow-2xl overflow-hidden',
        'animate-slide-down',
        'ring-2 ring-ring ring-offset-2 ring-offset-background'
      )}>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Keyboard className="w-5 h-5" />
            <kbd className="px-2 py-0.5 text-xs bg-muted rounded font-mono">
              {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘' : 'Ctrl'}
            </kbd>
            <kbd className="px-2 py-0.5 text-xs bg-muted rounded font-mono">
              {triggerKey.toUpperCase()}
            </kbd>
          </div>
          <Input
            ref={inputRef}
            type="search"
            placeholder={placeholder}
            value={state.query}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setState(prev => ({ ...prev, query: e.target.value }))
            }
            className="flex-1 bg-transparent border-none focus:ring-0 text-lg"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search commands"
            disabled={isLoading}
          />
          {state.query && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setState(prev => ({ ...prev, query: '' }))}
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        </div>

        {/* Hint */}
        {showHint && !state.query && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30">
            <kbd className="px-1.5 py-0.5 text-xs bg-background border border-border rounded">
              ↑↓
            </kbd>{' '}
            Navigate •
            <kbd className="px-1.5 py-0.5 text-xs bg-background border border-border rounded">
              Enter
            </kbd>{' '}
            Execute •
            <kbd className="px-1.5 py-0.5 text-xs bg-background border border-border rounded">
              Esc
            </kbd>{' '}
            Close
          </div>
        )}

        {/* Results */}
        <ScrollArea className="max-h-[60vh]" ref={listRef}>
          {state.query && filteredActions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No commands found for "{state.query}"</p>
              <p className="text-xs mt-1">Try different keywords or check spelling</p>
            </div>
          ) : (
            <div className="py-2" role="listbox" aria-label="Commands">
              {displayGroups.map((group, groupIndex) => (
                <CommandGroupComponent
                  key={group.id}
                  group={group}
                  selectedIndex={state.selectedIndex}
                  filteredActions={filteredActions}
                  onSelect={executeAction}
                  isRecent={group.id === 'recent'}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
          <span>{filteredActions.length} command{filteredActions.length !== 1 ? 's' : ''} available</span>
          {showHint && (
            <span className="flex items-center gap-4">
              <kbd className="px-1.5 py-0.5 text-xs bg-background border border-border rounded">
                ⌘{triggerKey.toUpperCase()}
              </kbd>{' '}
              to close
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface CommandGroupComponentProps {
  group: CommandGroup & { category?: CommandAction['category'] };
  selectedIndex: number;
  filteredActions: CommandAction[];
  onSelect: (action: CommandAction) => void;
  isRecent?: boolean;
}

function CommandGroupComponent({ group, selectedIndex, filteredActions, onSelect, isRecent }: CommandGroupComponentProps) {
  const categoryConfig = group.category ? CATEGORY_CONFIG[group.category] : null;
  const Icon = group.icon || categoryConfig?.icon || Wrench;
  const color = categoryConfig?.color || 'text-muted-foreground';

  // Calculate which actions in this group are selected
  const groupActionIndices = group.actions.map(a => filteredActions.indexOf(a)).filter(i => i >= 0);
  const hasSelection = groupActionIndices.some(i => i === selectedIndex);
  const localSelectedIndex = hasSelection ? groupActionIndices.indexOf(selectedIndex) : -1;

  return (
    <div className="group">
      {/* Group Header */}
      {group.actions.length > 0 && (
        <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2 bg-muted/30 border-b border-border/50">
          <Icon className={cn('w-4 h-4', color)} />
          {group.label}
          {isRecent && group.actions.length > 0 && (
            <Badge variant="outline" className="ml-auto text-xs">
              {group.actions.length}
            </Badge>
          )}
        </div>
      )}

      {/* Actions */}
      <div role="group" aria-label={group.label}>
        {group.actions.map((action, index) => {
          const globalIndex = filteredActions.indexOf(action);
          const isSelected = globalIndex === selectedIndex;
          const categoryConfig = action.category ? CATEGORY_CONFIG[action.category] : null;
          const CatIcon = action.icon || categoryConfig?.icon;

          return (
            <button
              key={action.id}
              role="option"
              aria-selected={isSelected}
              aria-disabled={action.disabled}
              onClick={() => !action.disabled && onSelect(action)}
              onMouseEnter={() => {
                // Update selection on hover for keyboard continuity
              }}
              className={cn(
                'w-full px-4 py-3 text-left transition-colors duration-100',
                'flex items-center gap-3',
                isSelected
                  ? 'bg-primary/10 text-primary outline-none'
                  : 'hover:bg-muted/50 text-foreground',
                action.disabled && 'opacity-40 cursor-not-allowed'
              )}
              style={isSelected ? { scrollIntoView: { block: 'nearest' } } : undefined}
            >
              {CatIcon && <CatIcon className={cn('w-5 h-5 flex-shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'font-medium truncate',
                    isSelected ? 'text-primary' : 'text-foreground'
                  )}>
                    {action.label}
                  </span>
                  {action.recent && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Recent
                    </span>
                  )}
                </div>
                {action.description && (
                  <p className={cn(
                    'text-xs truncate mt-0.5',
                    isSelected ? 'text-primary/70' : 'text-muted-foreground'
                  )}>
                    {action.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {action.shortcut && (
                  <kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded font-mono text-muted-foreground hidden sm:inline-flex">
                    {action.shortcut}
                  </kbd>
                )}
                <ChevronRight className={cn(
                  'w-4 h-4 flex-shrink-0',
                  isSelected ? 'text-primary' : 'text-muted-foreground/50'
                )} />
              </div>
            </button>
          );
        })}
      </div>

      <Separator className="my-1" />
    </div>
  );
}

/**
 * Hook for using command palette
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  // Register global shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === 'k') {
        // Only trigger if not in an input
        const target = e.target as HTMLElement;
        if (!target.matches('input, textarea, [contenteditable="true"]')) {
          e.preventDefault();
          toggle();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return { isOpen, open, close, toggle, setIsOpen };
}

/**
 * Create standard UI Builder actions
 */
export function createUIBuilderActions(context: {
  onNewComponent: () => void;
  onTogglePreview: () => void;
  onExtractComponent: () => void;
  onDeploy: () => void;
  onGenerateVariations: () => void;
  onOpenSettings: () => void;
  onOpenMarketplace: () => void;
  onToggleDarkMode: () => void;
  onShowShortcuts: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): CommandAction[] {
  return [
    // Navigation
    {
      id: 'nav.chat',
      label: 'Open Chat',
      description: 'Switch to chat mode',
      icon: HelpCircle,
      shortcut: '⌘1',
      category: 'navigation',
      priority: 100,
      action: () => {}, // Handled by parent
    },
    {
      id: 'nav.build',
      label: 'Open Build View',
      description: 'Switch to build mode',
      icon: FileCode,
      shortcut: '⌘2',
      category: 'navigation',
      priority: 90,
      action: () => {},
    },
    {
      id: 'nav.preview',
      label: 'Open Preview',
      description: 'Focus preview panel',
      icon: Globe,
      shortcut: '⌘3',
      category: 'navigation',
      priority: 80,
      action: context.onTogglePreview,
    },
    {
      id: 'nav.settings',
      label: 'Open Settings',
      description: 'Open project settings',
      icon: Settings,
      shortcut: '⌘,',
      category: 'navigation',
      priority: 70,
      action: context.onOpenSettings,
    },

    // Editing
    {
      id: 'edit.undo',
      label: 'Undo',
      description: 'Undo last change',
      icon: ChevronRight,
      shortcut: '⌘Z',
      category: 'editing',
      priority: 100,
      action: context.onUndo,
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      description: 'Redo last undone change',
      icon: ChevronRight,
      shortcut: '⌘⇧Z',
      category: 'editing',
      priority: 90,
      action: context.onRedo,
    },
    {
      id: 'edit.duplicate',
      label: 'Duplicate Element',
      description: 'Duplicate selected element',
      icon: FileCode,
      shortcut: '⌘D',
      category: 'editing',
      priority: 80,
      action: context.onDuplicate,
    },
    {
      id: 'edit.delete',
      label: 'Delete Element',
      description: 'Delete selected element',
      icon: X,
      shortcut: 'Del',
      category: 'editing',
      priority: 70,
      action: context.onDelete,
    },
    {
      id: 'edit.extract',
      label: 'Extract Component',
      description: 'Extract selection as new component',
      icon: FolderOpen,
      shortcut: '⌘E',
      category: 'editing',
      priority: 60,
      action: context.onExtractComponent,
    },

    // Preview
    {
      id: 'preview.toggle',
      label: 'Toggle Preview',
      description: 'Show/hide preview panel',
      icon: Globe,
      shortcut: '⌘P',
      category: 'preview',
      priority: 100,
      action: context.onTogglePreview,
    },
    {
      id: 'preview.dark',
      label: 'Toggle Dark Mode',
      description: 'Switch preview dark/light mode',
      icon: Palette,
      shortcut: '⌘⇧D',
      category: 'preview',
      priority: 90,
      action: context.onToggleDarkMode,
    },
    {
      id: 'preview.mobile',
      label: 'Mobile Viewport',
      description: 'Set preview to mobile (375px)',
      icon: Globe,
      shortcut: '⌘1',
      category: 'preview',
      priority: 80,
      action: () => {},
    },
    {
      id: 'preview.tablet',
      label: 'Tablet Viewport',
      description: 'Set preview to tablet (768px)',
      icon: Globe,
      shortcut: '⌘2',
      category: 'preview',
      priority: 70,
      action: () => {},
    },
    {
      id: 'preview.desktop',
      label: 'Desktop Viewport',
      description: 'Set preview to desktop (1440px)',
      icon: Globe,
      shortcut: '⌘3',
      category: 'preview',
      priority: 60,
      action: () => {},
    },

    // AI Actions
    {
      id: 'ai.generate',
      label: 'Generate Component',
      description: 'Generate new component from prompt',
      icon: Sparkles,
      shortcut: '⌘G',
      category: 'ai',
      priority: 100,
      action: context.onNewComponent,
    },
    {
      id: 'ai.variations',
      label: 'Generate Variations',
      description: 'Create design variations',
      icon: Zap,
      shortcut: '⌘⇧V',
      category: 'ai',
      priority: 90,
      action: context.onGenerateVariations,
    },

    // Deploy
    {
      id: 'deploy.deploy',
      label: 'Deploy to Production',
      description: 'Deploy current project',
      icon: Rocket,
      shortcut: '⌘⇧P',
      category: 'deploy',
      priority: 100,
      action: context.onDeploy,
    },
    {
      id: 'deploy.preview',
      label: 'Create Preview Deploy',
      description: 'Create preview deployment',
      icon: ExternalLink,
      category: 'deploy',
      priority: 90,
      action: () => {},
    },

    // Settings
    {
      id: 'settings.marketplace',
      label: 'Open Marketplace',
      description: 'Browse component marketplace',
      icon: Bookmark,
      category: 'settings',
      priority: 100,
      action: context.onOpenMarketplace,
    },
    {
      id: 'settings.shortcuts',
      label: 'Show Shortcuts',
      description: 'Display all keyboard shortcuts',
      icon: Keyboard,
      shortcut: '⌘/',
      category: 'settings',
      priority: 90,
      action: context.onShowShortcuts,
    },
  ];
}