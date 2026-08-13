import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Archive,
  ArrowRight,
  Activity,
  BrainCircuit,
  Check,
  ChevronDown,
  FileText,
  FlaskConical,
  Folder,
  FolderPlus,
  Home,
  Image as ImageIcon,
  Library,
  ListTodo,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';

export type ProjectSection =
  | 'home'
  | 'chat'
  | 'conversations'
  | 'memory'
  | 'files'
  | 'research'
  | 'tasks'
  | 'instructions'
  | 'activity';

interface Project {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  archived: boolean;
  pinned: boolean;
  lastOpenedAt?: string | null;
  updatedAt?: string;
}

interface GalleryFile {
  id: string;
  name: string;
  kind: string;
  mime: string;
  url: string;
  createdAt: string;
}

interface ProjectChat {
  id: string;
  title: string;
}

interface ProjectGalleryProps {
  activeConversationId: string | null;
  activeProjectId?: string | null;
  onSelectConversation: (id: string) => void;
  onOpenProject?: (projectId: string | null) => void;
  onOpenProjectSection?: (section: ProjectSection) => void;
  onStartProjectChat?: () => void | Promise<void>;
}

type ProjectSort = 'updated' | 'created' | 'name' | 'recently-used';

const quickAccessItems: { section: ProjectSection; icon: typeof Home; labelKey: TranslationKey }[] = [
  { section: 'home', icon: Home, labelKey: 'projectGallery.home' },
  { section: 'chat', icon: MessageSquarePlus, labelKey: 'projectGallery.newChat' },
  { section: 'memory', icon: BrainCircuit, labelKey: 'projectGallery.memory' },
  { section: 'files', icon: FileText, labelKey: 'projectGallery.files' },
  { section: 'research', icon: FlaskConical, labelKey: 'projectGallery.research' },
  { section: 'tasks', icon: ListTodo, labelKey: 'projectGallery.tasks' },
  { section: 'instructions', icon: ShieldCheck, labelKey: 'projectGallery.instructions' },
  { section: 'activity', icon: Activity, labelKey: 'projectGallery.activity' },
];

function projectQueryUrl(query: string, sort: ProjectSort, includeArchived: boolean): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  params.set('sort', sort);
  params.set('archived', includeArchived ? 'all' : 'false');
  return `/api/jarvis/projects?${params.toString()}`;
}

export function ProjectGallery({
  activeConversationId,
  activeProjectId,
  onSelectConversation,
  onOpenProject,
  onOpenProjectSection,
  onStartProjectChat,
}: ProjectGalleryProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [expanded, setExpanded] = useState<'projects' | 'gallery' | null>(null);
  const [localActiveProjectId, setLocalActiveProjectId] = useState<string | null>(null);
  const [projectChats, setProjectChats] = useState<Record<string, ProjectChat[]>>({});
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [projectSort, setProjectSort] = useState<ProjectSort>('updated');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [galleryFilter, setGalleryFilter] = useState('all');
  const [galleryQuery, setGalleryQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  const selectedProjectId = activeProjectId !== undefined ? activeProjectId : localActiveProjectId;

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch(projectQueryUrl(projectQuery, projectSort, includeArchived));
      if (response.ok) setProjects(await response.json() as Project[]);
    } catch {
      // Keep the sidebar usable when storage is unavailable.
    }
  }, [includeArchived, projectQuery, projectSort]);

  const loadFiles = useCallback(async () => {
    try {
      const response = await fetch('/api/files');
      if (response.ok) setFiles((await response.json()).files ?? []);
    } catch {
      // The gallery is best effort.
    }
  }, []);

  const loadProjectChats = useCallback(async (projectId: string) => {
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/conversations`);
      if (response.ok) {
        const chats = await response.json() as ProjectChat[];
        setProjectChats((current) => ({ ...current, [projectId]: chats }));
      }
    } catch {
      setProjectChats((current) => ({ ...current, [projectId]: [] }));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProjects(), 180);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (selectedProjectId) void loadProjectChats(selectedProjectId);
  }, [loadProjectChats, selectedProjectId]);

  const updateProjectInState = (updated: Project) => {
    setProjects((current) => current.map((project) => project.id === updated.id ? updated : project));
  };

  const selectProject = async (projectId: string) => {
    const nextProjectId = selectedProjectId === projectId ? null : projectId;
    setLocalActiveProjectId(nextProjectId);
    setProjectMenuId(null);
    setEditingProjectId(null);
    setExpanded('projects');
    onOpenProject?.(nextProjectId);
    if (!nextProjectId) return;

    void fetch(`/api/jarvis/projects/${encodeURIComponent(nextProjectId)}/open`, { method: 'POST' });
    await loadProjectChats(nextProjectId);
  };

  const createProject = async (fromCurrentConversation = false) => {
    const name = projectDraft.trim();
    if ((!name && !fromCurrentConversation) || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/jarvis/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(name ? { name } : {}),
          ...(fromCurrentConversation && activeConversationId ? { fromConversationId: activeConversationId } : {}),
        }),
      });
      if (!response.ok) return;
      const created = await response.json() as Project;
      setProjectDraft('');
      setProjects((current) => [created, ...current.filter((project) => project.id !== created.id)]);
      setLocalActiveProjectId(created.id);
      onOpenProject?.(created.id);
      await loadProjectChats(created.id);
    } finally {
      setBusy(false);
    }
  };

  const saveProjectName = async (projectId: string) => {
    const name = editingProjectName.trim();
    if (!name || busyProjectId) return;
    setBusyProjectId(projectId);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return;
      updateProjectInState(await response.json() as Project);
      setEditingProjectId(null);
      setEditingProjectName('');
    } finally {
      setBusyProjectId(null);
    }
  };

  const toggleArchive = async (project: Project) => {
    if (busyProjectId) return;
    setBusyProjectId(project.id);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !project.archived }),
      });
      if (!response.ok) return;
      const updated = await response.json() as Project;
      updateProjectInState(updated);
      setProjectMenuId(null);
      if (updated.archived && selectedProjectId === project.id) {
        setLocalActiveProjectId(null);
        onOpenProject?.(null);
      }
      if (!includeArchived && updated.archived) {
        setProjects((current) => current.filter((item) => item.id !== project.id));
      }
    } finally {
      setBusyProjectId(null);
    }
  };

  const togglePin = async (project: Project) => {
    if (busyProjectId) return;
    setBusyProjectId(project.id);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(project.id)}/pin`, {
        method: project.pinned ? 'DELETE' : 'POST',
      });
      if (!response.ok) return;
      updateProjectInState(await response.json() as Project);
    } finally {
      setBusyProjectId(null);
    }
  };

  const deleteProject = async (project: Project) => {
    if (busyProjectId || !window.confirm(t('projectGallery.deleteConfirm'))) return;
    setBusyProjectId(project.id);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      if (!response.ok) return;
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setProjectMenuId(null);
      if (selectedProjectId === project.id) {
        setLocalActiveProjectId(null);
        onOpenProject?.(null);
      }
    } finally {
      setBusyProjectId(null);
    }
  };

  const moveCurrentConversation = async (projectId: string) => {
    if (!activeConversationId || busyProjectId) return;
    setBusyProjectId(projectId);
    try {
      const response = await fetch(`/api/jarvis/conversations/${encodeURIComponent(activeConversationId)}/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) return;
      await loadProjectChats(projectId);
      setLocalActiveProjectId(projectId);
      onOpenProject?.(projectId);
    } finally {
      setBusyProjectId(null);
    }
  };

  const beginRename = (project: Project) => {
    setProjectMenuId(null);
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  };

  const filteredFiles = useMemo(() => files.filter((file) => {
    const matchesType = galleryFilter === 'all' || file.kind === galleryFilter;
    const matchesQuery = !galleryQuery.trim() || file.name.toLowerCase().includes(galleryQuery.trim().toLowerCase());
    return matchesType && matchesQuery;
  }), [files, galleryFilter, galleryQuery]);

  const visibleProjects = projects.filter((project) => includeArchived || !project.archived);

  return (
    <div className="space-y-1 border-b border-border/30 px-2 pb-2 pt-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setExpanded(expanded === 'projects' ? null : 'projects'); setGalleryOpen(false); }}
          className={`flex-1 flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium transition-colors ${expanded === 'projects' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}`}
        >
          <Folder className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">{t('projectGallery.title')}</span>
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded === 'projects' ? 'rotate-180' : ''}`} />
        </button>
        <button type="button" onClick={() => setGalleryOpen(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground" title={t('projectGallery.openGallery')} aria-label={t('projectGallery.openGallery')}>
          <Library className="h-3.5 w-3.5" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded === 'projects' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="space-y-2 px-2 pb-2">
              <div className="flex gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                  <input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder={t('projectGallery.searchPlaceholder')} className="w-full rounded-lg bg-secondary/50 py-1.5 pl-7 pr-2 text-[11px] outline-none focus:ring-1 focus:ring-primary/40" />
                </div>
                <select value={projectSort} onChange={(event) => setProjectSort(event.target.value as ProjectSort)} className="max-w-[92px] rounded-lg bg-secondary/50 px-1.5 text-[10px] text-muted-foreground outline-none" aria-label={t('projectGallery.sortLabel')}>
                  <option value="updated">{t('projectGallery.sortUpdated')}</option>
                  <option value="recently-used">{t('projectGallery.sortRecent')}</option>
                  <option value="created">{t('projectGallery.sortCreated')}</option>
                  <option value="name">{t('projectGallery.sortName')}</option>
                </select>
              </div>

              <div className="flex gap-1.5">
                <input value={projectDraft} onChange={(event) => setProjectDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createProject()} placeholder={t('projectGallery.newProjectPlaceholder')} className="min-w-0 flex-1 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-[11px] outline-none focus:ring-1 focus:ring-primary/40" />
                <button type="button" onClick={() => void createProject()} disabled={!projectDraft.trim() || busy} className="rounded-lg bg-primary/10 p-1.5 text-primary disabled:opacity-40" title={t('projectGallery.createProject')} aria-label={t('projectGallery.createProject')}><FolderPlus className="h-3.5 w-3.5" /></button>
              </div>

              <div className="flex items-center justify-between gap-2">
                {activeConversationId && (
                  <button type="button" onClick={() => void createProject(true)} disabled={busy} className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-primary transition hover:bg-primary/10 disabled:opacity-40" title={t('projectGallery.createFromConversation')}>
                    <MessageSquarePlus className="h-3 w-3 shrink-0" />
                    <span className="truncate">{t('projectGallery.createFromConversation')}</span>
                  </button>
                )}
                <button type="button" onClick={() => setIncludeArchived((current) => !current)} className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-secondary hover:text-foreground" title={includeArchived ? t('projectGallery.hideArchived') : t('projectGallery.showArchived')}>
                  <Archive className="h-3 w-3" />
                  {includeArchived ? t('projectGallery.hideArchived') : t('projectGallery.showArchived')}
                </button>
              </div>

              <div className="space-y-1">
                {visibleProjects.map((project) => {
                  const isSelected = selectedProjectId === project.id;
                  const isEditing = editingProjectId === project.id;
                  const isBusy = busyProjectId === project.id;
                  const chats = projectChats[project.id] ?? [];
                  return (
                    <div key={project.id}>
                      <div className={`group rounded-xl border px-2 py-1.5 transition ${isSelected ? 'border-primary/20 bg-primary/10' : 'border-transparent hover:border-border/30 hover:bg-secondary/50'} ${project.archived ? 'opacity-65' : ''}`}>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => void selectProject(project.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={t('projectGallery.openProject', { name: project.name })}>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingProjectName}
                                onChange={(event) => setEditingProjectName(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') { event.preventDefault(); void saveProjectName(project.id); }
                                  if (event.key === 'Escape') { setEditingProjectId(null); setEditingProjectName(''); }
                                }}
                                className="min-w-0 flex-1 rounded bg-background/80 px-1.5 py-0.5 text-[11px] text-foreground outline-none ring-1 ring-primary/40"
                              />
                            ) : (
                              <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/90">{project.name}</span>
                            )}
                            {project.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
                            {project.archived && <Archive className="h-3 w-3 shrink-0 text-muted-foreground" />}
                          </button>
                          {isEditing ? (
                            <button type="button" onClick={() => void saveProjectName(project.id)} disabled={isBusy || !editingProjectName.trim()} className="rounded p-1 text-primary disabled:opacity-40" title={t('projectGallery.saveRename')} aria-label={t('projectGallery.saveRename')}><Check className="h-3 w-3" /></button>
                          ) : (
                            <>
                              <button type="button" onClick={() => void togglePin(project)} disabled={isBusy} className={`rounded p-1 text-muted-foreground/40 transition hover:bg-secondary hover:text-primary ${project.pinned ? 'opacity-100 text-primary/70' : 'opacity-0 group-hover:opacity-100'}`} title={project.pinned ? t('projectGallery.unpin') : t('projectGallery.pin')} aria-label={project.pinned ? t('projectGallery.unpin') : t('projectGallery.pin')}>
                                {project.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                              </button>
                              <button type="button" onClick={() => setProjectMenuId(projectMenuId === project.id ? null : project.id)} className={`rounded p-1 text-muted-foreground/50 transition hover:bg-secondary hover:text-foreground ${projectMenuId === project.id ? 'bg-secondary opacity-100' : 'opacity-0 group-hover:opacity-100'}`} title={t('projectGallery.moreActions')} aria-label={t('projectGallery.moreActions')}>
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                        {project.description && <p className="mt-1 truncate pl-4 text-[9px] text-muted-foreground/55">{project.description}</p>}
                        {projectMenuId === project.id && !isEditing && (
                          <div className="mt-1 flex flex-wrap gap-1 border-t border-border/30 pt-1.5">
                            <button type="button" onClick={() => beginRename(project)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil className="h-3 w-3" />{t('projectGallery.rename')}</button>
                            <button type="button" onClick={() => void toggleArchive(project)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"><Archive className="h-3 w-3" />{project.archived ? t('projectGallery.restore') : t('projectGallery.archive')}</button>
                            {activeConversationId && <button type="button" onClick={() => void moveCurrentConversation(project.id)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-primary hover:bg-primary/10"><ArrowRight className="h-3 w-3" />{t('projectGallery.moveCurrentChat')}</button>}
                            <button type="button" onClick={() => void deleteProject(project)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"><Trash2 className="h-3 w-3" />{t('projectGallery.delete')}</button>
                          </div>
                        )}
                      </div>

                      {isSelected && (
                        <>
                          <div className="mt-1 grid grid-cols-4 gap-1 rounded-xl bg-secondary/25 p-1">
                            {quickAccessItems.slice(0, 4).map(({ section, icon: Icon, labelKey }) => (
                              <button
                                type="button"
                                key={section}
                                onClick={() => {
                                  if (section === 'chat') void onStartProjectChat?.();
                                  else onOpenProjectSection?.(section);
                                }}
                                className="flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[9px] text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                                title={t(labelKey)}
                              >
                                <Icon className="h-3.5 w-3.5" />
                                <span className="truncate">{t(labelKey)}</span>
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary/25 p-1">
                            {quickAccessItems.slice(4).map(({ section, icon: Icon, labelKey }) => (
                              <button type="button" key={section} onClick={() => onOpenProjectSection?.(section)} className="flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[9px] text-muted-foreground transition hover:bg-primary/10 hover:text-primary" title={t(labelKey)}><Icon className="h-3 w-3" /><span className="truncate">{t(labelKey)}</span></button>
                            ))}
                          </div>
                          {activeConversationId && <button type="button" onClick={() => void moveCurrentConversation(project.id)} disabled={isBusy} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/15 bg-primary/[0.04] px-2 py-1.5 text-[10px] font-medium text-primary transition hover:bg-primary/10 disabled:opacity-40"><ArrowRight className="h-3 w-3" />{t('projectGallery.moveCurrentChat')}</button>}
                          {chats.length > 0 && (
                            <div className="ml-3 mt-1 space-y-0.5 border-l border-border/40 pl-2">
                              {chats.slice(0, 5).map((chat) => <button type="button" key={chat.id} onClick={() => onSelectConversation(chat.id)} className={`block w-full truncate rounded px-2 py-1 text-left text-[10px] hover:bg-secondary/60 ${activeConversationId === chat.id ? 'text-primary' : 'text-muted-foreground/70'}`}>{chat.title}</button>)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                {visibleProjects.length === 0 && <p className="px-2 py-3 text-[10px] text-muted-foreground/60">{projectQuery ? t('projectGallery.noSearchResults') : t('projectGallery.noProjects')}</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {galleryOpen && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 backdrop-blur-sm sm:items-center">
            <div className="liquid-glass flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border/50 shadow-apple-xl">
              <div className="flex items-center gap-3 border-b border-border/30 px-5 py-4"><Library className="h-4 w-4 text-primary" /><h2 className="flex-1 text-sm font-semibold">{t('projectGallery.galleryTitle')}</h2><button type="button" onClick={() => setGalleryOpen(false)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary/70" aria-label={t('projectGallery.closeGallery')}><X className="h-4 w-4" /></button></div>
              <div className="flex flex-wrap gap-2 border-b border-border/20 px-5 py-3"><div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full bg-secondary/60 px-3 py-1.5"><Search className="h-3.5 w-3.5 text-muted-foreground/60" /><input value={galleryQuery} onChange={(event) => setGalleryQuery(event.target.value)} placeholder={t('projectGallery.searchFiles')} className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>{['all', 'image', 'document', 'code', 'audio', 'build-app'].map((filter) => <button type="button" key={filter} onClick={() => setGalleryFilter(filter)} className={`rounded-full px-3 py-1.5 text-[10px] capitalize ${galleryFilter === filter ? 'bg-primary/10 text-primary' : 'bg-secondary/50 text-muted-foreground'}`}>{filter === 'all' ? t('projectGallery.allFiles') : filter}</button>)}</div>
              <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3">{filteredFiles.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-2xl border border-border/40 bg-card/60 transition hover:border-primary/40 hover:shadow-lg">{file.mime.startsWith('image/') ? <img src={file.url} alt={file.name} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-secondary/40"><ImageIcon className="h-8 w-8 text-muted-foreground/40" /></div>}<div className="truncate px-3 py-2 text-[10px] text-muted-foreground group-hover:text-foreground">{file.name}</div></a>)}{filteredFiles.length === 0 && <p className="col-span-full py-12 text-center text-xs text-muted-foreground/60">{t('projectGallery.noFiles')}</p>}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
