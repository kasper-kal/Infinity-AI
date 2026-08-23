import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  Download,
  Edit2,
  File,
  FileImage,
  FileText,
  FileAudio,
  FileCode,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';

interface ProjectFileRecord {
  id: string;
  projectFileId: string;
  name: string;
  kind?: string;
  mime?: string;
  size?: number;
  owner?: string;
  bucket?: string;
  createdAt: string;
  url?: string | null;
}

interface ProjectFilesProps {
  projectId: string;
  onBack: () => void;
}

function asFiles(payload: unknown): ProjectFileRecord[] {
  if (Array.isArray(payload)) return payload as ProjectFileRecord[];
  if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { files?: unknown }).files)) {
    return (payload as { files: ProjectFileRecord[] }).files;
  }
  return [];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function getFileIcon(kind?: string, mime?: string) {
  if (kind === 'image' || mime?.startsWith('image/')) return FileImage;
  if (kind === 'audio' || mime?.startsWith('audio/') || mime?.startsWith('video/')) return FileAudio;
  if (kind === 'code' || mime?.startsWith('text/') || mime === 'application/json') return FileCode;
  return FileText;
}

export function ProjectFiles({ projectId, onBack }: ProjectFilesProps) {
  const { t, lang } = useI18n();
  const locale = lang === 'nl' ? 'nl-NL' : 'en-GB';
  const [files, setFiles] = useState<ProjectFileRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadFiles = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const query = searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : '';
      const response = await fetch(`/api/infinity/projects/${encodeURIComponent(projectId)}/files${query}`, { signal });
      if (!response.ok) throw new Error('Project files request failed');
      setFiles(asFiles(await response.json()));
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId, searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadFiles(controller.signal), 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadFiles]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', projectId);
      const response = await fetch('/api/files', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Could not upload file');
      await loadFiles();
    } catch {
      setError(true);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const renameFile = async (fileId: string, name: string, projectFileId: string) => {
    if (!name.trim() || busyId) return;
    setBusyId(projectFileId);
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) throw new Error('Could not rename file');
      const updated = await response.json() as ProjectFileRecord;
      setFiles((current) => current.map((f) => f.projectFileId === projectFileId ? updated : f));
      setEditingId(null);
      setEditName('');
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const deleteFile = async (fileId: string, projectFileId: string) => {
    if (busyId || !window.confirm(t('projectFiles.deleteConfirm'))) return;
    setBusyId(projectFileId);
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Could not delete file');
      setFiles((current) => current.filter((f) => f.projectFileId !== projectFileId));
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const downloadFile = async (url: string | null, name: string) => {
    if (!url) return;
    try {
      const response = await fetch(`${url}?download=1`);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setError(true);
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
          {t('projectFiles.back')}
        </button>

        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-500">
                <File className="h-4 w-4" />
                {t('projectFiles.eyebrow')}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('projectFiles.title')}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('projectFiles.description')}</p>
            </div>
            <div className="flex w-full items-center gap-2">
              <div className="flex-1 lg:max-w-xs">
                <div className="flex w-full items-center gap-2 rounded-full border border-border/50 bg-background/70 px-3.5 py-2.5">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('projectFiles.searchPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                  {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={t('projectFiles.clearSearch')}><X className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              <label className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-secondary/70 cursor-pointer">
                <Plus className="h-3.5 w-3.5" />
                {t('projectFiles.upload')}
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  disabled={uploading}
                  className="sr-only"
                  aria-label={t('projectFiles.upload')}
                />
              </label>
            </div>
          </div>
        </motion.header>

        {error && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
            <span>{t('projectFiles.loadError')}</span>
            <button type="button" onClick={() => void loadFiles()} className="rounded-full border border-current/20 px-3 py-1.5 font-medium transition hover:bg-rose-500/10">{t('projectFiles.retry')}</button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[35vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />{t('projectFiles.loading')}</div>
        ) : files.length === 0 ? (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="liquid-glass mt-5 flex min-h-[32vh] flex-col items-center justify-center rounded-3xl border border-border/40 p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500"><File className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{searchQuery ? t('projectFiles.noResults') : t('projectFiles.emptyTitle')}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{searchQuery ? t('projectFiles.noResultsDescription') : t('projectFiles.emptyDescription')}</p>
          </motion.section>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/70"><File className="h-3.5 w-3.5 text-blue-500" />{t('projectFiles.fileCount', { n: files.length })}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {files.map((file) => {
                const isEditing = editingId === file.projectFileId;
                const isBusy = busyId === file.projectFileId;
                const Icon = getFileIcon(file.kind, file.mime);
                return (
                  <motion.article layout key={file.projectFileId} className="liquid-glass rounded-2xl border border-border/40 p-4 transition hover:border-primary/30">
                    <div className="flex items-start gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              value={editName}
                              onChange={(event) => setEditName(event.target.value)}
                              onKeyDown={(event) => { if (event.key === 'Enter') void renameFile(file.id, editName, file.projectFileId); if (event.key === 'Escape') { setEditingId(null); setEditName(''); } }}
                              autoFocus
                              className="w-full rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/40"
                            />
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => { setEditingId(null); setEditName(''); }} className="inline-flex items-center gap-1.5 rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" />{t('projectFiles.cancel')}</button>
                              <button type="button" onClick={() => void renameFile(file.id, editName, file.projectFileId)} disabled={!editName.trim() || isBusy} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50">{isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{t('projectFiles.save')}</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <h3 className="text-sm font-medium text-foreground truncate">{file.name}</h3>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/60">
                              {file.kind && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">{file.kind}</span>}
                              {file.size !== undefined && <span>{formatBytes(file.size)}</span>}
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-[10px] leading-4 text-muted-foreground/65">
                              <span>{formatDate(file.createdAt, locale)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {!isEditing && (
                      <div className="mt-4 flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => file.url && downloadFile(file.url, file.name)}
                          disabled={!file.url}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="h-3 w-3" />
                          {t('projectFiles.download')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(file.projectFileId); setEditName(file.name); }}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                        >
                          <Edit2 className="h-3 w-3" />
                          {t('projectFiles.rename')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteFile(file.id, file.projectFileId)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          {t('projectFiles.delete')}
                        </button>
                      </div>
                    )}
                  </motion.article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}