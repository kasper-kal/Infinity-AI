import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  Clock3,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';

interface ProjectMemoryRecord {
  id: string;
  projectId: string;
  category: string;
  content: string;
  key: string;
  sourceType: string;
  sourceRef: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProjectMemoryProps {
  projectId: string;
  onBack: () => void;
}

const categoryLabelKeys: Record<string, TranslationKey> = {
  about: 'projectMemory.category.about',
  technical: 'projectMemory.category.technical',
  architecture: 'projectMemory.category.architecture',
  decisions: 'projectMemory.category.decisions',
  constraints: 'projectMemory.category.constraints',
  requirements: 'projectMemory.category.requirements',
  preferences: 'projectMemory.category.preferences',
  goals: 'projectMemory.category.goals',
};

const sourceLabelKeys: Record<string, TranslationKey> = {
  conversation: 'projectMemory.source.conversation',
  file: 'projectMemory.source.file',
  research: 'projectMemory.source.research',
  instruction: 'projectMemory.source.instruction',
  agent: 'projectMemory.source.agent',
  manual: 'projectMemory.source.manual',
};

function asMemories(payload: unknown): ProjectMemoryRecord[] {
  if (Array.isArray(payload)) return payload as ProjectMemoryRecord[];
  if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { memories?: unknown }).memories)) {
    return (payload as { memories: ProjectMemoryRecord[] }).memories;
  }
  return [];
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function fallbackLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ProjectMemory({ projectId, onBack }: ProjectMemoryProps) {
  const { t, lang } = useI18n();
  const locale = lang === 'nl' ? 'nl-NL' : 'en-GB';
  const [memories, setMemories] = useState<ProjectMemoryRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [draftCategory, setDraftCategory] = useState('about');
  const [draftSource, setDraftSource] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('about');

  const loadMemories = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const query = searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : '';
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/memories${query}`, { signal });
      if (!response.ok) throw new Error('Project memory request failed');
      setMemories(asMemories(await response.json()));
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId, searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadMemories(controller.signal), 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadMemories]);

  const groupedMemories = useMemo(() => {
    const groups = new Map<string, ProjectMemoryRecord[]>();
    for (const memory of memories) {
      const current = groups.get(memory.category) ?? [];
      current.push(memory);
      groups.set(memory.category, current);
    }
    return [...groups.entries()];
  }, [memories]);

  const categoryLabel = (category: string) => {
    const key = categoryLabelKeys[category];
    return key ? t(key) : fallbackLabel(category);
  };

  const sourceLabel = (sourceType: string) => {
    const key = sourceLabelKeys[sourceType];
    return key ? t(key) : fallbackLabel(sourceType);
  };

  const addMemory = async () => {
    const content = draftContent.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          category: draftCategory,
          sourceRef: draftSource.trim(),
        }),
      });
      if (!response.ok) throw new Error('Could not add project memory');
      setDraftContent('');
      setDraftSource('');
      await loadMemories();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (memory: ProjectMemoryRecord) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditCategory(memory.category);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
    setEditCategory('about');
  };

  const saveEdit = async (memoryId: string) => {
    if (!editContent.trim() || busyId) return;
    setBusyId(memoryId);
    try {
      const response = await fetch(
        `/api/jarvis/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent.trim(), category: editCategory }),
        },
      );
      if (!response.ok) throw new Error('Could not update project memory');
      const updated = await response.json() as ProjectMemoryRecord;
      setMemories((current) => current.map((memory) => memory.id === memoryId ? updated : memory));
      cancelEdit();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const forgetMemory = async (memoryId: string) => {
    if (busyId || !window.confirm(t('projectMemory.forgetConfirm'))) return;
    setBusyId(memoryId);
    try {
      const response = await fetch(
        `/api/jarvis/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('Could not forget project memory');
      setMemories((current) => current.filter((memory) => memory.id !== memoryId));
      if (editingId === memoryId) cancelEdit();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const togglePin = async (memory: ProjectMemoryRecord) => {
    if (busyId) return;
    setBusyId(memory.id);
    try {
      const response = await fetch(
        `/api/jarvis/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memory.id)}/pin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: !memory.pinned }),
        },
      );
      if (!response.ok) throw new Error('Could not pin project memory');
      const updated = await response.json() as ProjectMemoryRecord;
      setMemories((current) => current.map((item) => item.id === memory.id ? updated : item));
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-4 sm:px-6 lg:px-10 lg:pt-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('projectMemory.back')}
        </button>

        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-rose-500/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-500">
                <BrainCircuit className="h-4 w-4" />
                {t('projectMemory.eyebrow')}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('projectMemory.title')}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('projectMemory.description')}</p>
            </div>
            <div className="flex w-full items-center gap-2 rounded-full border border-border/50 bg-background/70 px-3.5 py-2.5 lg:max-w-xs">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('projectMemory.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
              />
              {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={t('projectMemory.clearSearch')}><X className="h-3.5 w-3.5" /></button>}
            </div>
          </div>
        </motion.header>

        <section className="liquid-glass mt-5 rounded-3xl border border-primary/15 bg-primary/[0.03] p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary"><Plus className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('projectMemory.addTitle')}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">{t('projectMemory.addDescription')}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_150px_190px_auto] lg:items-end">
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void addMemory(); }}
              placeholder={t('projectMemory.contentPlaceholder')}
              rows={2}
              className="min-h-20 w-full resize-y rounded-2xl border border-border/50 bg-background/70 px-3.5 py-3 text-xs leading-5 text-foreground outline-none transition focus:border-primary/40"
            />
            <input value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} placeholder={t('projectMemory.categoryPlaceholder')} className="w-full rounded-2xl border border-border/50 bg-background/70 px-3.5 py-3 text-xs text-foreground outline-none focus:border-primary/40" />
            <input value={draftSource} onChange={(event) => setDraftSource(event.target.value)} placeholder={t('projectMemory.sourcePlaceholder')} className="w-full rounded-2xl border border-border/50 bg-background/70 px-3.5 py-3 text-xs text-foreground outline-none focus:border-primary/40" />
            <button type="button" onClick={() => void addMemory()} disabled={!draftContent.trim() || saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {saving ? t('projectMemory.saving') : t('projectMemory.add')}
            </button>
          </div>
        </section>

        {error && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
            <span>{t('projectMemory.loadError')}</span>
            <button type="button" onClick={() => void loadMemories()} className="rounded-full border border-current/20 px-3 py-1.5 font-medium transition hover:bg-rose-500/10">{t('projectMemory.retry')}</button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[35vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />{t('projectMemory.loading')}</div>
        ) : memories.length === 0 ? (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="liquid-glass mt-5 flex min-h-[32vh] flex-col items-center justify-center rounded-3xl border border-border/40 p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500"><Sparkles className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{searchQuery ? t('projectMemory.noResults') : t('projectMemory.emptyTitle')}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{searchQuery ? t('projectMemory.noResultsDescription') : t('projectMemory.emptyDescription')}</p>
          </motion.section>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/70"><BrainCircuit className="h-3.5 w-3.5 text-rose-500" />{t('projectMemory.memoryCount', { n: memories.length })}</div>
            {groupedMemories.map(([category, categoryMemories]) => (
              <section key={category}>
                <div className="mb-3 flex items-center gap-2 px-1"><Tag className="h-3.5 w-3.5 text-primary" /><h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{categoryLabel(category)}</h2><span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground/70">{categoryMemories.length}</span></div>
                <div className="grid gap-3 md:grid-cols-2">
                  {categoryMemories.map((memory) => {
                    const isEditing = editingId === memory.id;
                    const isBusy = busyId === memory.id;
                    return (
                      <motion.article layout key={memory.id} className={`liquid-glass rounded-2xl border p-4 transition ${memory.pinned ? 'border-rose-500/35 bg-rose-500/[0.04]' : 'border-border/40'}`}>
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${memory.pinned ? 'bg-rose-500/15 text-rose-500' : 'bg-secondary text-muted-foreground'}`}>
                            {memory.pinned ? <Pin className="h-3.5 w-3.5" /> : <BrainCircuit className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {memory.pinned && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-500">{t('projectMemory.pinned')}</span>}
                              <span className="text-[10px] text-muted-foreground/60">{t(sourceLabelKeys[memory.sourceType] ?? 'projectMemory.source.manual')}</span>
                            </div>
                            {isEditing ? (
                              <div className="mt-3 space-y-2">
                                <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={4} className="w-full resize-y rounded-xl border border-border/50 bg-background/70 px-3 py-2.5 text-xs leading-5 text-foreground outline-none focus:border-primary/40" />
                                <input value={editCategory} onChange={(event) => setEditCategory(event.target.value)} className="w-full rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/40" aria-label={t('projectMemory.category')} />
                                <div className="flex justify-end gap-2"><button type="button" onClick={cancelEdit} className="inline-flex items-center gap-1.5 rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" />{t('projectMemory.cancel')}</button><button type="button" onClick={() => void saveEdit(memory.id)} disabled={!editContent.trim() || isBusy} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50">{isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{t('projectMemory.save')}</button></div>
                              </div>
                            ) : (
                              <p className="mt-2 text-sm leading-6 text-foreground">{memory.content}</p>
                            )}
                          </div>
                        </div>
                        {!isEditing && (
                          <>
                            <div className="mt-4 flex items-start gap-2 border-t border-border/30 pt-3 text-[10px] leading-4 text-muted-foreground/65"><Clock3 className="mt-0.5 h-3 w-3 shrink-0" /><span>{t('projectMemory.updated')} {formatDate(memory.updatedAt, locale)}{memory.sourceRef ? ` · ${memory.sourceRef}` : ''}</span></div>
                            <div className="mt-3 flex flex-wrap items-center gap-1.5"><button type="button" onClick={() => beginEdit(memory)} className="rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground">{t('projectMemory.edit')}</button><button type="button" onClick={() => void togglePin(memory)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50">{isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : memory.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}{memory.pinned ? t('projectMemory.unpin') : t('projectMemory.pin')}</button><button type="button" onClick={() => void forgetMemory(memory.id)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"><Trash2 className="h-3 w-3" />{t('projectMemory.forget')}</button></div>
                          </>
                        )}
                      </motion.article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
