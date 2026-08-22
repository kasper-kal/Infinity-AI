import { useEffect, useState } from 'react';
import { Copy, Settings2, Users, X } from 'lucide-react';

interface GroupSettingsProps {
  conversationId: string | null;
}

interface Group {
  id: string;
  name: string;
  kind: 'ai' | 'human';
  aiToggle: 'always' | 'mention';
}

interface Member {
  id: string;
  accountId: string | null;
  persona: string | null;
  role: string;
  joinedAt: string;
}

export function GroupSettings({ conversationId }: GroupSettingsProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [aiToggle, setAiToggle] = useState<'always' | 'mention'>('always');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinEmail, setJoinEmail] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinName, setJoinName] = useState('');

  useEffect(() => {
    setGroup(null);
    setMembers([]);
    setCode(null);
    if (!conversationId) return;
    fetch(`/api/jarvis/groups/by-conversation/${conversationId}`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data?.group) return;
        setGroup(data.group);
        setMembers(data.members ?? []);
        setName(data.group.name);
        setAiToggle(data.group.aiToggle === 'mention' ? 'mention' : 'always');
        setCode(data.activeInvite?.code ?? null);
      })
      .catch(() => {});
  }, [conversationId]);

  if (!conversationId) return null;

  const loadGroup = async () => {
    const response = await fetch(`/api/jarvis/groups/by-conversation/${conversationId}`);
    if (!response.ok) return;
    const data = await response.json();
    setGroup(data.group);
    setMembers(data.members ?? []);
    setName(data.group.name);
    setAiToggle(data.group.aiToggle === 'mention' ? 'mention' : 'always');
    setCode(data.activeInvite?.code ?? null);
  };

  const createGroup = async (kind: 'human' | 'ai') => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/jarvis/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, name: name.trim() || 'New group', kind }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not create group');
      await loadGroup();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create group');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jarvis/groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), aiToggle }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save settings');
      setGroup(data.group);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  };

  const joinGroup = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/jarvis/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinCode, email: joinEmail, password: joinPassword, displayName: joinName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not join group');
      setJoinPassword('');
      setJoinCode('');
      await loadGroup();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join group');
    } finally {
      setBusy(false);
    }
  };

  const generateInvite = async () => {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jarvis/groups/${group.id}/invite`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not create invite');
      setCode(data.code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create invite');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        aria-label="Group settings"
        title="Group settings"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card/70 text-foreground shadow-sm transition-colors hover:bg-secondary active:scale-95"
      >
        <Users className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-3 backdrop-blur-sm sm:items-center" onClick={() => setOpen(false)}>
          <div className="liquid-glass max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-border/60 shadow-apple-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-border/30 px-5 py-4">
              <Settings2 className="h-4 w-4 text-primary" />
              <h2 className="flex-1 text-sm font-semibold">Group settings</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary/70" aria-label="Close group settings"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-5 p-5">
              {!group ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Turn this conversation into a shared space. Human groups use a one-time 4-digit invite code. AI groups persist persona members here; autonomous persona turns are the next collaboration slice.</p>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Group name" className="w-full rounded-xl border border-border/50 bg-secondary/40 px-3 py-2.5 text-sm outline-none focus:border-primary/50" />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={busy} onClick={() => void createGroup('human')} className="rounded-xl bg-primary px-3 py-2.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">Human group</button>
                    <button type="button" disabled={busy} onClick={() => void createGroup('ai')} className="rounded-xl border border-border/50 px-3 py-2.5 text-xs font-medium transition hover:bg-secondary/70 disabled:opacity-50">AI group setup</button>
                  </div>
                  <div className="space-y-2 rounded-2xl border border-border/40 bg-secondary/20 p-4">
                    <p className="text-xs font-semibold">Join with an invite</p>
                    <p className="text-[11px] text-muted-foreground">Create an account while joining. The code is single-use and expires after 24 hours.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="4-digit code" className="rounded-xl border border-border/50 bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50" />
                      <input value={joinName} onChange={(event) => setJoinName(event.target.value)} placeholder="Your name" className="rounded-xl border border-border/50 bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50" />
                      <input value={joinEmail} onChange={(event) => setJoinEmail(event.target.value)} type="email" placeholder="Email" className="rounded-xl border border-border/50 bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50" />
                      <input value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} type="password" placeholder="Password" className="rounded-xl border border-border/50 bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50" />
                    </div>
                    <button type="button" disabled={busy || joinCode.length !== 4} onClick={() => void joinGroup()} className="w-full rounded-xl border border-primary/40 px-3 py-2.5 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50">Join group</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Name</label>
                    <div className="flex gap-2"><input value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-border/50 bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-primary/50" /><button type="button" disabled={busy} onClick={() => void saveSettings()} className="rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">Save</button></div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Infinity participation</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['always', 'mention'] as const).map((value) => <button type="button" key={value} onClick={() => setAiToggle(value)} className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${aiToggle === value ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/50 hover:bg-secondary/70'}`}>{value === 'always' ? 'Always responds' : 'Only when @Infinity'}</button>)}
                    </div>
                  </div>
                  {group.kind === 'human' && <div className="space-y-2 rounded-2xl border border-border/40 bg-secondary/20 p-4"><div className="flex items-center gap-2"><div className="flex-1"><p className="text-xs font-semibold">Invite a person</p><p className="text-[11px] text-muted-foreground">Codes expire after 24 hours and are single-use.</p></div><button type="button" disabled={busy} onClick={() => void generateInvite()} className="rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{code ? 'Regenerate' : 'Generate'}</button></div>{code && <div className="flex items-center gap-2 rounded-xl bg-background/70 px-3 py-2.5"><span className="flex-1 font-mono text-lg tracking-[0.35em] text-primary">{code}</span><button type="button" onClick={() => void navigator.clipboard?.writeText(code)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/70" aria-label="Copy invite code"><Copy className="h-4 w-4" /></button></div>}</div>}
                  <div className="space-y-2"><label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Participants</label>{members.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border/30 px-3 py-2.5 text-xs"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">{member.persona?.slice(0, 1) ?? (member.accountId ? 'A' : 'J')}</span><span className="flex-1">{member.persona ?? (member.accountId ? 'Invited account' : 'You')}</span><span className="text-[10px] uppercase text-muted-foreground/60">{member.role}</span></div>)}</div>
                </>
              )}
              {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
