import { useEffect, useState } from 'react';
import { Download, FileText, FolderPlus, Link2, MoreHorizontal, Pin, Search, Users, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface ConversationActionsProps {
  conversationId: string | null;
}

interface Project { id: string; name: string; color: string; }
interface ChatMessage { role: string; content: string; }

export function ConversationActions({ conversationId }: ConversationActionsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'share' | 'files' | 'search' | 'project' | null>(null);
  const [pinned, setPinned] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<{ id: string; name: string; mime: string; url: string }[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    fetch(`/api/infinity/conversations/${conversationId}/pin`).then((res) => res.ok ? res.json() : null).then((data) => data && setPinned(Boolean(data.pinned))).catch(() => {});
  }, [conversationId]);

  if (!conversationId) return null;

  const toggleMenu = () => { setOpen((value) => !value); if (open) setPanel(null); };

  const exportChat = async () => {
    const response = await fetch(`/api/infinity/conversations/${conversationId}`);
    if (!response.ok) return;
    const data = await response.json();
    const text = [`# ${data.title}`, '', ...(data.messages ?? []).map((message: ChatMessage) => `${message.role.toUpperCase()}\n${message.content}`)].join('\n\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = `${(data.title || 'conversation').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    setOpen(false);
  };

  const shareChat = async () => {
    const response = await fetch(`/api/infinity/conversations/${conversationId}/share`, { method: 'POST' });
    if (!response.ok) return;
    const data = await response.json();
    const url = `${window.location.origin}${data.url}`;
    setShareUrl(url);
    await navigator.clipboard?.writeText(url).catch(() => {});
    setPanel('share');
  };

  const togglePin = async () => {
    const response = await fetch(`/api/infinity/conversations/${conversationId}/pin`, { method: 'POST' });
    if (response.ok) setPinned(Boolean((await response.json()).pinned));
    setOpen(false);
  };

  const showFiles = async () => {
    const response = await fetch(`/api/files?conversation_id=${encodeURIComponent(conversationId)}`);
    if (response.ok) setFiles((await response.json()).files ?? []);
    setPanel('files');
  };

  const showSearch = async () => {
    const response = await fetch(`/api/infinity/conversations/${conversationId}`);
    if (response.ok) setMessages((await response.json()).messages ?? []);
    setPanel('search');
  };

  const showProjects = async () => {
    const response = await fetch('/api/infinity/projects');
    if (response.ok) setProjects(await response.json());
    setPanel('project');
  };

  const addToProject = async (projectId: string) => {
    await fetch(`/api/infinity/projects/${projectId}/chats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId }) });
    setOpen(false);
    setPanel(null);
  };

  return (
    <div className="relative">
      <button type="button" onClick={toggleMenu} aria-label="Conversation actions" title="Conversation actions" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card/70 text-foreground shadow-sm transition-colors hover:bg-secondary active:scale-95"><MoreHorizontal className="h-[18px] w-[18px]" /></button>
      {open && (
        <>
          <button type="button" aria-label="Close conversation actions" onClick={() => { setOpen(false); setPanel(null); }} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 top-11 z-50 w-56 rounded-2xl border border-border/60 bg-card/95 p-1.5 shadow-apple-xl backdrop-blur-xl">
            <button type="button" onClick={shareChat} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"><Link2 />Share chat</button>
            <button type="button" onClick={() => void exportChat()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"><Download />Export as .txt</button>
            <button type="button" onClick={() => { setOpen(false); document.querySelector<HTMLButtonElement>('[aria-label="Group settings"]')?.click(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"><Users />Groupchat</button>
            <button type="button" onClick={() => void togglePin()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"><Pin />{pinned ? 'Unpin chat' : 'Pin chat'}</button>
            <button type="button" onClick={() => void showFiles()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"><FileText />Files</button>
            <button type="button" onClick={() => void showSearch()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"><Search />Search in chat</button>
            <button type="button" onClick={() => void showProjects()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"><FolderPlus />Add to project</button>
          </div>
        </>
      )}
      {panel && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-3 backdrop-blur-sm sm:items-center" onClick={() => setPanel(null)}>
          <div className="liquid-glass max-h-[72vh] w-full max-w-lg overflow-hidden rounded-3xl border border-border/60 shadow-apple-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-border/30 px-5 py-4"><h2 className="flex-1 text-sm font-semibold">{panel === 'share' ? 'Share chat' : panel === 'files' ? 'Files in this chat' : panel === 'search' ? 'Search in chat' : 'Add to project'}</h2><button type="button" onClick={() => setPanel(null)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary/70"><X className="h-4 w-4" /></button></div>
            <div className="max-h-[55vh] overflow-y-auto p-5">
              {panel === 'share' && <div className="space-y-4"><p className="text-sm leading-relaxed text-muted-foreground">Anyone with this link can view this entire conversation, including any personal context in it.</p>{shareUrl && <div className="break-all rounded-xl bg-secondary/60 p-3 font-mono text-xs">{shareUrl}</div>}<button type="button" onClick={() => shareUrl && navigator.clipboard?.writeText(shareUrl)} className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">Copy link</button></div>}
              {panel === 'files' && <div className="space-y-2">{files.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border/40 p-3 text-xs hover:border-primary/40"><FileText className="h-4 w-4 text-primary" /><span className="truncate">{file.name}</span></a>)}{files.length === 0 && <p className="text-xs text-muted-foreground/60">No files are attached to this conversation.</p>}</div>}
              {panel === 'search' && <div className="space-y-3"><div className="flex items-center gap-2 rounded-full bg-secondary/60 px-3 py-2"><Search className="h-3.5 w-3.5 text-muted-foreground/60" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('chat.searchPlaceholder')} className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>{messages.filter((message) => !query.trim() || message.content.toLowerCase().includes(query.toLowerCase())).map((message, index) => <div key={index} className="rounded-xl border border-border/30 p-3 text-xs"><span className="mr-2 text-[10px] font-semibold uppercase text-primary">{message.role}</span>{message.content}</div>)}</div>}
              {panel === 'project' && <div className="space-y-2">{projects.map((project) => <button type="button" key={project.id} onClick={() => void addToProject(project.id)} className="flex w-full items-center gap-3 rounded-xl border border-border/40 p-3 text-left text-xs hover:border-primary/40"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />{project.name}</button>)}{projects.length === 0 && <p className="text-xs text-muted-foreground/60">Create a project in the sidebar first.</p>}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
