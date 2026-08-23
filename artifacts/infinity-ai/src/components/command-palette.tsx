import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  AudioWaveform,
  Globe,
  Webcam,
  BrainCircuit,
  Sparkles,
  BarChart3,
  Image as ImageIcon,
  Sun,
  Moon,
  Settings,
  MessageCircle,
  Search,
  CornerDownLeft,
  Loader2,
  Pencil,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { haptics } from '@/lib/haptics';

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (mode: 'voice' | 'chat' | 'agent' | 'camera') => void;
  onOpenResearch: () => void;
  onOpenExpert: () => void;
  onOpenDataLab: () => void;
  onToggleWebSearch: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenConversation: (id: string) => void;
  onNewChat: () => void;
}

interface SearchResult {
  id: string;
  title: string;
  snippet?: string;
}

interface ActionItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onOpenResearch,
  onOpenExpert,
  onOpenDataLab,
  onToggleWebSearch,
  onToggleTheme,
  onOpenSettings,
  onOpenConversation,
  onNewChat,
}: PaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const actions: ActionItem[] = [
    { id: 'chat', label: t('header.mode.chat'), hint: 'G', icon: MessageSquare, run: () => onNavigate('chat') },
    { id: 'voice', label: t('header.mode.voice'), hint: 'V', icon: AudioWaveform, run: () => onNavigate('voice') },
    { id: 'agent', label: t('header.mode.agent'), hint: 'A', icon: Globe, run: () => onNavigate('agent') },
    { id: 'camera', label: t('header.mode.camera'), hint: 'C', icon: Webcam, run: () => onNavigate('camera') },
    { id: 'research', label: t('research.title'), hint: 'R', icon: BrainCircuit, run: onOpenResearch },
    { id: 'expert', label: t('expert.menuItem'), hint: 'N', icon: Sparkles, run: onOpenExpert },
    { id: 'datalab', label: t('datalab.menuItem'), hint: 'D', icon: BarChart3, run: onOpenDataLab },
    { id: 'image', label: t('input.generateImage'), hint: 'I', icon: ImageIcon, run: () => onNavigate('chat') },
  ];

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Memory search with debounce
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/infinity/conversations/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const rows = (await res.json()) as SearchResult[];
          setResults(rows.slice(0, 6));
        }
      } catch { /* server down */ }
      setSearching(false);
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open]);

  // Filter actions by query (fuzzy-lite: substring on label)
  const q = query.trim().toLowerCase();
  const filteredActions = q
    ? actions.filter((a) => a.label.toLowerCase().includes(q))
    : actions;

  const list = [
    ...results.map((r) => ({ id: `conv-${r.id}`, kind: 'conv' as const, result: r })),
    ...filteredActions.map((a) => ({ id: `act-${a.id}`, kind: 'act' as const, action: a })),
  ];

  useEffect(() => { setSelected(0); }, [query]);

  const runSelected = useCallback((idx: number) => {
    const item = list[idx];
    if (!item) return;
    haptics.light();
    onClose();
    if (item.kind === 'conv') {
      onOpenConversation(item.result.id);
    } else {
      item.action.run();
    }
  }, [list, onClose, onOpenConversation]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { haptics.light(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, list.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); runSelected(selected); return; }
  };

  // Keep selected item in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, list.length]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[18vh] px-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
            className="relative w-full max-w-lg rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-apple-xl overflow-hidden"
          >
            {/* Search row */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/30">
              <Search className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('palette.placeholder')}
                className="w-full bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none"
                maxLength={200}
              />
              {searching && <Loader2 className="w-3.5 h-3.5 text-muted-foreground/40 animate-spin flex-shrink-0" />}
              <span className="hidden sm:flex items-center gap-0.5 text-[9px] font-mono text-muted-foreground/40 border border-border/50 rounded px-1 py-0.5 flex-shrink-0">
                ESC
              </span>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[46vh] overflow-y-auto scrollbar-thin p-1.5">
              {list.length === 0 && (
                <p className="text-center text-[11px] text-muted-foreground/50 py-6">
                  {query.trim() ? t('palette.noResults') : t('palette.hint')}
                </p>
              )}

              {results.length > 0 && (
                <>
                  <p className="text-[9px] font-mono tracking-widest text-muted-foreground/40 px-2.5 pt-2 pb-1">{t('palette.memory')}</p>
                  {results.map((r, i) => (
                    <button
                      key={r.id}
                      data-idx={i}
                      onClick={() => runSelected(i)}
                      onMouseEnter={() => setSelected(i)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-left transition-colors ${
                        selected === i ? 'bg-primary/10' : ''
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-muted-foreground/40 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-foreground truncate">{r.title}</p>
                        {r.snippet && (
                          <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{r.snippet}</p>
                        )}
                      </div>
                      <CornerDownLeft className="w-3 h-3 text-muted-foreground/30 mt-1 flex-shrink-0" />
                    </button>
                  ))}
                </>
              )}

              {filteredActions.length > 0 && (
                <>
                  {results.length > 0 && (
                    <p className="text-[9px] font-mono tracking-widest text-muted-foreground/40 px-2.5 pt-2 pb-1">{t('palette.actions')}</p>
                  )}
                  {filteredActions.map((a, j) => {
                    const i = results.length + j;
                    return (
                      <button
                        key={a.id}
                        data-idx={i}
                        onClick={() => runSelected(i)}
                        onMouseEnter={() => setSelected(i)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors ${
                          selected === i ? 'bg-primary/10' : ''
                        }`}
                      >
                        <a.icon className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" strokeWidth={1.8} />
                        <span className="flex-1 text-[12.5px] font-medium text-foreground">{a.label}</span>
                        {a.hint && (
                          <span className="text-[9px] font-mono text-muted-foreground/30 border border-border/40 rounded px-1 py-0.5">{a.hint}</span>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* Footer quick toggles */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border/30 bg-muted/20">
              <button
                onClick={() => { haptics.light(); onClose(); onNewChat(); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
              >
                <Pencil className="w-3 h-3" /> {t('sidebar.chat')}
              </button>
              <button
                onClick={() => { haptics.light(); onClose(); onToggleWebSearch(); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
              >
                <Globe className="w-3 h-3" /> {t('input.webSearch')}
              </button>
              <button
                onClick={() => { haptics.light(); onClose(); onToggleTheme(); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
              >
                <Sun className="w-3 h-3" /> <Moon className="w-3 h-3 -ml-1.5" /> {t('palette.theme')}
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { haptics.light(); onClose(); onOpenSettings(); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
              >
                <Settings className="w-3 h-3" /> {t('header.settings')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
