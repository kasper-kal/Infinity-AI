import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  FileLock2,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface ProjectInstructionRecord {
  id: string;
  projectId: string;
  text: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectInstructionsProps {
  projectId: string;
  onBack: () => void;
}

function parseInstructions(payload: unknown): ProjectInstructionRecord[] {
  if (Array.isArray(payload)) return payload as ProjectInstructionRecord[];
  if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { instructions?: unknown }).instructions)) {
    return (payload as { instructions: ProjectInstructionRecord[] }).instructions;
  }
  return [];
}

export function ProjectInstructions({ projectId, onBack }: ProjectInstructionsProps) {
  const { t } = useI18n();
  const [instructions, setInstructions] = useState<ProjectInstructionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const loadInstructions = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/infinity/projects/${encodeURIComponent(projectId)}/instructions`);
      if (!response.ok) throw new Error('Project instructions request failed');
      setInstructions(parseInstructions(await response.json()));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadInstructions();
  }, [loadInstructions]);

  const addInstruction = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(`/api/infinity/projects/${encodeURIComponent(projectId)}/instructions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error('Could not add project instruction');
      const created = await response.json() as ProjectInstructionRecord;
      setInstructions((current) => [...current, created]);
      setDraft('');
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (instruction: ProjectInstructionRecord) => {
    setEditingId(instruction.id);
    setEditText(instruction.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async (instructionId: string) => {
    const text = editText.trim();
    if (!text || busyId) return;
    setBusyId(instructionId);
    setError(false);
    try {
      const response = await fetch(
        `/api/infinity/projects/${encodeURIComponent(projectId)}/instructions/${encodeURIComponent(instructionId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        },
      );
      if (!response.ok) throw new Error('Could not update project instruction');
      const updated = await response.json() as ProjectInstructionRecord;
      setInstructions((current) => current.map((item) => item.id === instructionId ? updated : item));
      cancelEdit();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const deleteInstruction = async (instructionId: string) => {
    if (busyId || !window.confirm(t('projectInstructions.deleteConfirm'))) return;
    setBusyId(instructionId);
    setError(false);
    try {
      const response = await fetch(
        `/api/infinity/projects/${encodeURIComponent(projectId)}/instructions/${encodeURIComponent(instructionId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('Could not delete project instruction');
      setInstructions((current) => current.filter((item) => item.id !== instructionId));
      if (editingId === instructionId) cancelEdit();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const moveInstruction = async (index: number, direction: -1 | 1) => {
    if (busyId) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= instructions.length) return;

    const reordered = [...instructions];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setInstructions(reordered);
    setBusyId('reorder');
    setError(false);
    try {
      const response = await fetch(
        `/api/infinity/projects/${encodeURIComponent(projectId)}/instructions/reorder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: reordered.map((item) => item.id) }),
        },
      );
      if (!response.ok) throw new Error('Could not reorder project instructions');
      const payload = parseInstructions(await response.json());
      if (payload.length > 0 || reordered.length === 0) setInstructions(payload.length > 0 ? payload : reordered);
    } catch {
      setError(true);
      await loadInstructions();
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
          {t('projectInstructions.back')}
        </button>

        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8"
        >
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-500">
                <ShieldCheck className="h-4 w-4" />
                {t('projectInstructions.eyebrow')}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('projectInstructions.title')}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('projectInstructions.description')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
              <FileLock2 className="h-3.5 w-3.5" />
              {t('projectInstructions.explicitBadge')}
            </div>
          </div>
        </motion.header>

        <section className="liquid-glass mt-5 rounded-3xl border border-emerald-500/15 bg-emerald-500/[0.03] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              <Plus className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">{t('projectInstructions.addTitle')}</h2>
              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground/70">{t('projectInstructions.addDescription')}</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void addInstruction(); }}
                  placeholder={t('projectInstructions.inputPlaceholder')}
                  rows={2}
                  className="min-h-20 min-w-0 flex-1 resize-y rounded-2xl border border-border/50 bg-background/70 px-3.5 py-3 text-xs leading-5 text-foreground outline-none transition focus:border-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => void addInstruction()}
                  disabled={!draft.trim() || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {saving ? t('projectInstructions.saving') : t('projectInstructions.add')}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 flex items-start gap-3 rounded-2xl border border-border/40 bg-secondary/25 px-4 py-3 text-xs text-muted-foreground">
          <FileLock2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <p className="leading-5">{t('projectInstructions.memoryNote')}</p>
        </section>

        {error && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
            <span>{t('projectInstructions.loadError')}</span>
            <button type="button" onClick={() => void loadInstructions()} className="rounded-full border border-current/20 px-3 py-1.5 font-medium transition hover:bg-rose-500/10">{t('projectInstructions.retry')}</button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[35vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-500" />{t('projectInstructions.loading')}</div>
        ) : instructions.length === 0 ? (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="liquid-glass mt-5 flex min-h-[28vh] flex-col items-center justify-center rounded-3xl border border-border/40 p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500"><ShieldCheck className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{t('projectInstructions.emptyTitle')}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('projectInstructions.emptyDescription')}</p>
          </motion.section>
        ) : (
          <section className="mt-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('projectInstructions.listTitle')}</h2>
                <p className="mt-1 text-[11px] text-muted-foreground/65">{t('projectInstructions.listDescription')}</p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] text-muted-foreground/70">{t('projectInstructions.count', { n: instructions.length })}</span>
            </div>
            {instructions.map((instruction, index) => {
              const isEditing = editingId === instruction.id;
              const isBusy = busyId === instruction.id || busyId === 'reorder';
              return (
                <motion.article layout key={instruction.id} className="liquid-glass rounded-2xl border border-border/40 p-4 transition hover:border-emerald-500/20 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-xs font-semibold text-emerald-600 dark:text-emerald-300">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-3">
                          <textarea value={editText} onChange={(event) => setEditText(event.target.value)} rows={3} className="w-full resize-y rounded-xl border border-border/50 bg-background/70 px-3 py-2.5 text-xs leading-5 text-foreground outline-none focus:border-emerald-500/40" />
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={cancelEdit} className="inline-flex items-center gap-1.5 rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" />{t('projectInstructions.cancel')}</button>
                            <button type="button" onClick={() => void saveEdit(instruction.id)} disabled={!editText.trim() || isBusy} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-emerald-500 dark:text-emerald-950"><Check className="h-3 w-3" />{t('projectInstructions.save')}</button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{instruction.text}</p>
                      )}
                    </div>
                  </div>
                  {!isEditing && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/30 pt-3">
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => void moveInstruction(index, -1)} disabled={index === 0 || isBusy} className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30" aria-label={t('projectInstructions.moveUp')}><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => void moveInstruction(index, 1)} disabled={index === instructions.length - 1 || isBusy} className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30" aria-label={t('projectInstructions.moveDown')}><ArrowDown className="h-3.5 w-3.5" /></button>
                        <span className="ml-1 text-[10px] text-muted-foreground/60">{t('projectInstructions.orderHint')}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => beginEdit(instruction)} disabled={isBusy} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"><Pencil className="h-3 w-3" />{t('projectInstructions.edit')}</button>
                        <button type="button" onClick={() => void deleteInstruction(instruction.id)} disabled={isBusy} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"><Trash2 className="h-3 w-3" />{t('projectInstructions.delete')}</button>
                      </div>
                    </div>
                  )}
                </motion.article>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
