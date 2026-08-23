import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptics } from '@/lib/haptics';
import {
  Trash2,
  MessageCircle,
  MessagesSquare,
  X,
  AlertTriangle,
  Search,
  Library,
  Pencil,
  Settings,
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { ProjectGallery, type ProjectSection } from '@/components/project-gallery';

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  snippet?: string;
}

function formatRelativeTime(dateStr: string, t: TFunc): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.mAgo', { n: diffMin });
  if (diffHr < 24) return t('time.hAgo', { n: diffHr });
  if (diffDay === 1) return t('time.yesterday');
  if (diffDay < 7) return t('time.dAgo', { n: diffDay });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Render a human-readable title, recovering from accidental JSON blobs. */
function formatConversationTitle(title: string | undefined | null): string {
  if (!title || title.trim() === '') return 'New Conversation';
  let trimmed = title.trim().replace(/^```json\s*|^```.*\n?|```$/g, '').trim();

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    const fieldMatch = trimmed.match(/['"]?(text|title|message|content)['"]?\s*[:=]\s*['"]([^'"]+)['"]/i);
    if (fieldMatch?.[2]) {
      return fieldMatch[2].trim();
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed.trim() || 'New Conversation';
      if (parsed && typeof parsed === 'object') {
        const text = parsed.text || parsed.title || parsed.message || parsed.content;
        if (typeof text === 'string' && text.trim()) return text.trim();
      }
    } catch { /* fall through to raw title */ }
  }

  trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
  return trimmed || 'New Conversation';
}

function groupByDate(conversations: ConversationSummary[], t: TFunc): { label: string; items: ConversationSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);

  const groups: Record<string, ConversationSummary[]> = {
    [t('sidebar.today')]: [],
    [t('sidebar.yesterday')]: [],
    [t('sidebar.previous7Days')]: [],
    [t('sidebar.older')]: [],
  };

  for (const conv of conversations) {
    const d = new Date(conv.updatedAt);
    if (d >= today) groups[t('sidebar.today')].push(conv);
    else if (d >= yesterday) groups[t('sidebar.yesterday')].push(conv);
    else if (d >= weekAgo) groups[t('sidebar.previous7Days')].push(conv);
    else groups[t('sidebar.older')].push(conv);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

interface SidebarContentProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  deleting: string | null;
  searchQuery: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (e: React.MouseEvent | React.KeyboardEvent, id: string) => void;
  onSearchChange?: (query: string) => void;
  onClearAll?: () => void;
  onMobileClose?: () => void;
  onOpenSettings?: () => void;
  onNavigate?: (mode: 'chat' | 'agent' | 'camera') => void;
  activeProjectId?: string | null;
  onOpenProject?: (projectId: string | null) => void;
  onOpenProjectSection?: (section: ProjectSection) => void;
  onStartProjectChat?: () => void | Promise<void>;
}

function SidebarContent({ conversations, activeId, deleting, searchQuery, onNew, onSelect, onDelete, onSearchChange, onClearAll, onMobileClose, onOpenSettings, onNavigate, activeProjectId, onOpenProject, onOpenProjectSection, onStartProjectChat }: SidebarContentProps) {
  const { t } = useI18n();
  const groups = groupByDate(conversations, t);

  const navItems = [
    { icon: MessagesSquare, label: t('sidebar.chat'), mode: 'chat' as const },
    { icon: Search, label: t('sidebar.navBrowser'), mode: 'agent' as const },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Calm workspace header, the global toolbar already carries the brand. */}
      <div className="flex items-center justify-between border-b border-border/30 px-3 pb-3 pt-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">{t('sidebar.recentItems')}</p>
          <p className="mt-0.5 text-xs font-medium text-foreground">{t('header.title')}</p>
        </div>
        <button
          onClick={() => document.querySelector<HTMLInputElement>('.sidebar-search-input')?.focus()}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-card/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={t('header.search')}
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Primary modes stay compact and visually grouped. */}
      <nav className="mx-2 mt-2 space-y-0.5 rounded-xl bg-secondary/25 p-1">
        {navItems.map(({ icon: Icon, label, mode }) => (
          <button
            key={label}
            onClick={() => { haptics.light(); onNavigate?.(mode); onMobileClose?.(); }}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>

      {/* Projects and Gallery workspace */}
      <ProjectGallery
        activeConversationId={activeId}
        activeProjectId={activeProjectId}
        onSelectConversation={onSelect}
        onOpenProject={onOpenProject}
        onOpenProjectSection={onOpenProjectSection}
        onStartProjectChat={onStartProjectChat}
      />

      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange?.(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            className="sidebar-search-input w-full bg-secondary/50 border border-transparent focus:border-border/60 text-foreground placeholder:text-muted-foreground/50 text-[13px] pl-9 pr-8 py-2 font-rounded rounded-full outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange?.('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Recent items */}
      <div className="px-4 pt-1 pb-1">
        <p className="text-[11px] font-semibold text-muted-foreground tracking-tight">{t('sidebar.recentItems')}</p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1 space-y-3 px-2">
        {conversations.length === 0 && (
          <p className="text-center text-[11px] text-muted-foreground/70 mt-6 px-2">
            {t('sidebar.noConversations')}
          </p>
        )}
        {groups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold text-muted-foreground/70 px-3 mb-1 tracking-wide">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(conv => (
                <motion.div
                  key={conv.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => { haptics.light(); onSelect(conv.id); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(conv.id)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 group transition-all text-[13px] relative cursor-pointer rounded-lg ${
                    activeId === conv.id
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                  }`}
                >
                  <MessageCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-40" />
                  <div className="flex-1 min-w-0">
                    <span className="leading-snug line-clamp-2 break-words block pr-5">
                      {formatConversationTitle(conv.title)}
                    </span>
                    {conv.snippet && (
                      <span className="text-[10px] text-muted-foreground/50 mt-0.5 block line-clamp-1 break-words italic">
                        {conv.snippet}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/40 mt-0.5 block">
                      {formatRelativeTime(conv.updatedAt, t)}
                    </span>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { haptics.medium(); onDelete(e, conv.id); }}
                    onKeyDown={(e) => e.key === 'Enter' && onDelete(e, conv.id)}
                    aria-disabled={deleting === conv.id}
                    className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-red-500 aria-disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer actions stay quiet; New Chat is primary in the top toolbar. */}
      <div className="flex-shrink-0 border-t border-border/30 bg-background/40 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { haptics.light(); onNew(); }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 font-rounded text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
          >
            <Pencil className="h-4 w-4" strokeWidth={2} />
            {t('sidebar.newChat')}
          </button>
          <button
            onClick={() => { haptics.light(); onOpenSettings?.(); }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            aria-label={t('header.settings')}
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </div>
        {conversations.length > 0 && onClearAll ? (
          <button
            onClick={() => { haptics.medium(); onClearAll(); }}
            className="w-full text-[10px] font-medium text-muted-foreground/40 tracking-wider text-center hover:text-red-500/60 transition-colors py-1.5 mt-1"
          >
            {t('sidebar.clearAll')}
          </button>
        ) : (
          <p className="text-[10px] font-medium text-muted-foreground/30 tracking-wider text-center py-1.5 mt-1">
            {t('sidebar.memoryActive')}
          </p>
        )}
      </div>
    </div>
  );
}

interface ChatSidebarProps {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  refreshTick: number;
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onMobileClose?: () => void;
  onOpenSettings?: () => void;
  onNavigate?: (mode: 'chat' | 'agent' | 'camera') => void;
  activeProjectId?: string | null;
  onOpenProject?: (projectId: string | null) => void;
  onOpenProjectSection?: (section: ProjectSection) => void;
  onStartProjectChat?: () => void | Promise<void>;
}

export function ChatSidebar({ activeId, onSelect, onNew, refreshTick, mobileOpen, desktopOpen = true, onMobileClose, onOpenSettings, onNavigate, activeProjectId, onOpenProject, onOpenProjectSection, onStartProjectChat }: ChatSidebarProps) {
  const { t } = useI18n();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');


  const load = useCallback(async () => {
    try {
      // With an active query, search across titles AND message contents
      // (episodic memory) instead of just filtering titles client-side.
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (activeProjectId) params.set('projectId', activeProjectId);
      const query = params.toString();
      const url = searchQuery
        ? `/api/jarvis/conversations/search?${query}`
        : query
          ? `/api/jarvis/conversations?${query}`
          : '/api/jarvis/conversations';
      const res = await fetch(url);
      if (res.ok) setConversations(await res.json());
    } catch { /* silent */ }
  }, [activeProjectId, searchQuery]);

  useEffect(() => { load(); }, [load, refreshTick]);

  const handleDelete = async (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    e.stopPropagation();
    setDeleting(id);
    try {
      await fetch(`/api/jarvis/conversations/${id}`, { method: 'DELETE' });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeId === id) onNew();
    } finally {
      setDeleting(null);
    }
  };

  const handleClearAll = async () => {
    try {
      await fetch('/api/jarvis/conversations', { method: 'DELETE' });
      setConversations([]);
      onNew();
    } finally {
      setConfirmClearAll(false);
    }
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    onMobileClose?.();
  };

  const handleNew = () => {
    onNew();
    onMobileClose?.();
  };

  const sharedProps: SidebarContentProps = {
    conversations,
    activeId,
    deleting,
    searchQuery,
    onNew: handleNew,
    onSelect: handleSelect,
    onDelete: handleDelete,
    onSearchChange: setSearchQuery,
    onClearAll: () => setConfirmClearAll(true),
    onMobileClose,
    onOpenSettings,
    onNavigate,
    activeProjectId,
    onOpenProject,
    onOpenProjectSection,
    onStartProjectChat,
  };

  return (
    <>
      {/* Desktop */}
      <AnimatePresence initial={false}>
        {desktopOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 256, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="hidden flex-shrink-0 flex-col overflow-hidden border-r border-border/40 bg-background/80 backdrop-blur-2xl lg:flex"
          >
            <div className="w-64 h-full flex flex-col">
              <SidebarContent {...sharedProps} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onMobileClose}
              className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="lg:hidden fixed left-0 top-0 h-full w-[85vw] max-w-[320px] z-50 liquid-glass shadow-apple-xl"
            >
              <SidebarContent {...sharedProps} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Clear all confirmation */}
      <AnimatePresence>
        {confirmClearAll && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setConfirmClearAll(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border/60 rounded-xl p-5 max-w-sm w-full shadow-apple-xl space-y-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('sidebar.deleteAllTitle')}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
                    {t('sidebar.deleteAllDesc')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmClearAll(false)}
                  className="px-4 py-2 rounded-lg border border-border/50 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  onClick={handleClearAll}
                  className="px-4 py-2 rounded-lg bg-red-500 text-white text-[11px] font-medium hover:opacity-90 transition-opacity"
                >
                  {t('sidebar.deleteAll')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
