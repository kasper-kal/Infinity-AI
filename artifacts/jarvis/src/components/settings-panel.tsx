import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Save,
  Cloud,
  CalendarDays,
  Info,
  Plus,
  Trash2,
  Mail,
  CheckCircle2,
  LogOut,
  Brain,
  Globe,
  Music2,
  Pencil,
  Check,
  User,
  AlertTriangle,
  Smile,
  BookOpen,
  Sun,
  Moon,
  ChevronRight,
  Languages,
  Palette,
  KeyRound,
  Loader2,
  Zap,
  Sparkles,
  MessageCircle,
  Briefcase,
  SlidersHorizontal,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n';
import { haptics } from '@/lib/haptics';
import { applyAccent } from '@/lib/use-accent';

interface Settings {
  weather_location: string;
  calendar_ics_url_1: string;
  calendar_ics_url_2: string;
  calendar_ics_url_3: string;
  calendar_ics_url_4: string;
  calendar_ics_url_5: string;
  calendar_name_1: string;
  calendar_name_2: string;
  calendar_name_3: string;
  calendar_name_4: string;
  calendar_name_5: string;
  web_search_enabled: string;
  google_calendar_enabled: string;
  user_profile: string;
  personality: string;
  custom_personality_prompt: string;
}

const EMPTY: Settings = {
  weather_location: '',
  calendar_ics_url_1: '',
  calendar_ics_url_2: '',
  calendar_ics_url_3: '',
  calendar_ics_url_4: '',
  calendar_ics_url_5: '',
  calendar_name_1: '',
  calendar_name_2: '',
  calendar_name_3: '',
  calendar_name_4: '',
  calendar_name_5: '',
  web_search_enabled: 'false',
  google_calendar_enabled: 'true',
  user_profile: '',
  personality: 'balanced',
  custom_personality_prompt: '',
};

interface LlmKeyItem {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  priority: number;
  source: 'env' | 'db';
  status: 'healthy' | 'cooling' | 'quarantined';
  coolDownUntil: number | null;
  uses: number;
  failures: number;
  maskedKey: string;
}

type View = 'home' | 'personalization' | 'memory' | 'language' | 'gmail' | 'spotify' | 'app' | 'llm' | 'about' | 'accent';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Current theme (from home header), 'auto' follows the system */
  theme?: 'dark' | 'light' | 'auto';
  /** Set theme (from home header), pass a target mode, or toggle dark ↔ light when omitted */
  onToggleTheme?: (next?: 'dark' | 'light' | 'auto') => void;
}

/** Read the display name from localStorage (defaults to the reference profile). */
function getProfile(): { name: string; initials: string } {
  try {
    const stored = localStorage.getItem('jarvis-profile');
    if (stored) {
      const parsed = JSON.parse(stored) as { name?: string };
      if (parsed.name?.trim()) {
        const parts = parsed.name.trim().split(/\s+/);
        const initials = parts
          .slice(0, 2)
          .map(p => p.charAt(0).toUpperCase())
          .join('');
        return { name: parsed.name.trim(), initials: initials || 'J' };
      }
    }
  } catch { /* ignore */ }
  return { name: 'Your profile', initials: 'Y' };
}

/** ChatGPT-style settings row */
function SettingsRow({
  icon,
  title,
  subtitle,
  onClick,
  right,
  danger,
  blue,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  blue?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => { haptics.light(); onClick?.(); }}
      className="w-full flex items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-secondary/40 active:bg-secondary/60"
    >
      <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${danger ? 'text-red-500' : 'text-foreground/70'}`}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[15px] font-medium leading-tight ${danger ? 'text-red-500' : blue ? 'text-primary' : 'text-foreground'}`}>
          {title}
        </span>
        {subtitle && (
          <span className="block text-[12px] text-muted-foreground/70 mt-0.5 truncate">{subtitle}</span>
        )}
      </span>
      {right ?? <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-6 pb-2 text-[12px] font-semibold text-muted-foreground/60 tracking-tight">
      {children}
    </p>
  );
}

/** Accent color options, light/dark HSL triplets + a swatch dot for the picker. */
const ACCENTS: Record<string, { light: string; dark: string; dot: string }> = {
  blue: { light: '211 100% 50%', dark: '211 100% 60%', dot: '#007AFF' },
  green: { light: '152 100% 38%', dark: '152 100% 45%', dot: '#34C759' },
  purple: { light: '271 76% 53%', dark: '271 76% 63%', dot: '#AF52DE' },
  orange: { light: '24 100% 50%', dark: '24 100% 55%', dot: '#FF9500' },
  pink: { light: '330 100% 50%', dark: '330 100% 60%', dot: '#FF2D55' },
};

export function SettingsPanel({ open, onClose, theme = 'dark', onToggleTheme }: SettingsPanelProps) {
  const { t, lang, setLang } = useI18n();
  const { toast } = useToast();
  const [view, setView] = useState<View>('home');
  const [form, setForm] = useState<Settings>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email?: string } | null>(null);
  const [spotifyStatus, setSpotifyStatus] = useState<{ connected: boolean; displayName?: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectingSpotify, setDisconnectingSpotify] = useState(false);
  const [memories, setMemories] = useState<{ topic: string; value: string; updatedAt: string }[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [deletingMemory, setDeletingMemory] = useState<string | null>(null);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [visibleSlots, setVisibleSlots] = useState(1);
  const [llmKeys, setLlmKeys] = useState<LlmKeyItem[]>([]);
  const [llmForm, setLlmForm] = useState({ name: '', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: '', priority: 0 });
  // In-app API Keys (secrets), the Freebuff-Keys-tab-free secret store.
  const [secretItems, setSecretItems] = useState<{ env: string; label: string; description: string; prefix: string | null; configured: boolean; masked: string | null; source: string }[]>([]);
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [secretSaving, setSecretSaving] = useState<string | null>(null);
  const [secretLoading, setSecretLoading] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmTesting, setLlmTesting] = useState<string | null>(null);
  const profile = getProfile();

  // Accent color, persisted, applied as theme-aware CSS variables
  const [accent, setAccent] = useState<string>(() => {
    try { return localStorage.getItem('jarvis-accent') || 'blue'; } catch { return 'blue'; }
  });

  const resolvedTheme: 'dark' | 'light' =
    theme === 'auto'
      ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark' : 'light')
      : theme;


  // ── In-app API Keys ────────────────────────────────────────────
  const loadSecrets = useCallback(async () => {
    setSecretLoading(true);
    setSecretError(null);
    try {
      const res = await fetch('/api/jarvis/secrets');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSecretItems(data.items ?? []);
      if (data.databaseConfigured === false) {
        setSecretDrafts(d => ({ ...d, __dbHint: 'true' }));
      }
    } catch (err) {
      setSecretError(err instanceof Error ? err.message : 'Could not load API keys');
    } finally {
      setSecretLoading(false);
    }
  }, []);

  const saveSecret = useCallback(async (env: string) => {
    const value = (secretDrafts[env] ?? '').trim();
    if (!value) return;
    setSecretSaving(env);
    try {
      const res = await fetch(`/api/jarvis/secrets/${env}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error ?? 'Failed to save key', variant: 'destructive' });
        return;
      }
      toast({ title: `${env} saved` });
      setSecretDrafts(d => { const n = { ...d }; delete n[env]; return n; });
      loadSecrets();
    } finally {
      setSecretSaving(null);
    }
  }, [secretDrafts, loadSecrets, toast]);

  const clearSecret = useCallback(async (env: string) => {
    try {
      await fetch(`/api/jarvis/secrets/${env}`, { method: 'DELETE' });
      toast({ title: `${env} removed` });
      loadSecrets();
    } catch { /* ignore */ }
  }, [loadSecrets, toast]);

  useEffect(() => {
    try { localStorage.setItem('jarvis-accent', accent); } catch { /* ignore */ }
    applyAccent(accent, resolvedTheme);
  }, [accent, resolvedTheme]);

  const fetchGmailStatus = useCallback(() => {
    fetch('/api/jarvis/gmail/status')
      .then(r => r.json())
      .then(setGmailStatus)
      .catch(() => setGmailStatus({ connected: false }));
  }, []);

  const fetchSpotifyStatus = useCallback(() => {
    fetch('/api/jarvis/spotify/status')
      .then(r => r.json())
      .then(setSpotifyStatus)
      .catch(() => setSpotifyStatus({ connected: false }));
  }, []);

  const fetchMemories = useCallback(async () => {
    setLoadingMemories(true);
    try {
      const res = await fetch('/api/jarvis/memories');
      if (res.ok) setMemories(await res.json());
    } catch {
      setMemories([]);
    } finally {
      setLoadingMemories(false);
    }
  }, []);

  const handleDeleteMemory = async (topic: string) => {
    setDeletingMemory(topic);
    try {
      const res = await fetch(`/api/jarvis/memories/${encodeURIComponent(topic)}`, { method: 'DELETE' });
      if (res.ok) {
        setMemories(prev => prev.filter(m => m.topic !== topic));
        toast({ title: t('settings.memoryDeleted'), description: t('settings.forgot', { topic }) });
      } else {
        toast({ title: t('settings.couldNotDelete'), variant: 'destructive' });
      }
    } finally {
      setDeletingMemory(null);
    }
  };

  const startEditMemory = (topic: string, currentValue: string) => {
    setEditingMemory(topic);
    setEditDraft(currentValue);
  };

  const handleSaveMemoryEdit = async (topic: string) => {
    const value = editDraft.trim();
    if (!value) return;
    try {
      const res = await fetch(`/api/jarvis/memories/${encodeURIComponent(topic)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        setMemories(prev => prev.map(m => m.topic === topic ? { ...m, value } : m));
        toast({ title: t('settings.memoryUpdated') });
      } else {
        toast({ title: t('settings.couldNotUpdate'), variant: 'destructive' });
      }
    } finally {
      setEditingMemory(null);
      setEditDraft('');
    }
  };

  const fetchLlmKeys = useCallback(async () => {
    setLlmLoading(true);
    setLlmError(null);
    try {
      const res = await fetch('/api/jarvis/llm-keys');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setLlmKeys(Array.isArray(data) ? data : []);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : 'Could not load LLM keys');
    } finally {
      setLlmLoading(false);
    }
  }, []);

  const addLlmKey = async () => {
    if (!llmForm.name.trim() || !llmForm.apiKey.trim() || !llmForm.baseUrl.trim()) {
      toast({ title: t('settings.llmKeysMissing'), variant: 'destructive' });
      return;
    }
    setLlmBusy(true);
    try {
      const res = await fetch('/api/jarvis/llm-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: llmForm.name,
          baseUrl: llmForm.baseUrl,
          apiKey: llmForm.apiKey,
          model: llmForm.model || undefined,
          priority: llmForm.priority,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast({ title: t('settings.couldNotAddKey'), description: d?.error, variant: 'destructive' });
        return;
      }
      setLlmForm(f => ({ ...f, name: '', apiKey: '', model: '' }));
      haptics.light();
      toast({ title: t('settings.keyAdded') });
      fetchLlmKeys();
    } catch {
      toast({ title: t('settings.couldNotAddKey'), variant: 'destructive' });
    } finally {
      setLlmBusy(false);
    }
  };

  const toggleLlmKey = async (item: LlmKeyItem) => {
    if (item.source !== 'db') return;
    await fetch(`/api/jarvis/llm-keys/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !item.enabled }),
    }).catch(() => {});
    fetchLlmKeys();
  };

  const deleteLlmKey = async (item: LlmKeyItem) => {
    if (item.source !== 'db') return;
    await fetch(`/api/jarvis/llm-keys/${item.id}`, { method: 'DELETE' }).catch(() => {});
    fetchLlmKeys();
  };

  const testLlmKey = async (item: LlmKeyItem) => {
    setLlmTesting(item.id);
    try {
      const res = await fetch(`/api/jarvis/llm-keys/${item.id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        haptics.light();
        toast({ title: t('settings.keyOk'), description: `${data.model} · ${data.latencyMs}ms` });
      } else {
        toast({ title: t('settings.keyTestFailed'), description: data?.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: t('settings.keyTestFailed'), variant: 'destructive' });
    } finally {
      setLlmTesting(null);
    }
    fetchLlmKeys();
  };

  useEffect(() => {
    if (!open) return;
    fetch('/api/jarvis/settings')
      .then(r => r.json())
      .then(data => {
        const loaded: Settings = { ...EMPTY, ...data };
        setForm(loaded);
        const filled = [1,2,3,4,5].filter(n => loaded[`calendar_ics_url_${n}` as keyof Settings]);
        setVisibleSlots(Math.max(1, filled.length));
        setDirty(false);
      })
      .catch(() => {});
    fetchGmailStatus();
    fetchSpotifyStatus();
    fetchMemories();
    fetchLlmKeys();
  }, [open, fetchGmailStatus, fetchSpotifyStatus, fetchMemories, fetchLlmKeys]);

  useEffect(() => {
    if (!open) { setView('home'); return; }
  }, [open]);

  // Track unsaved changes, activate after initial load
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current && open) setDirty(true);
    if (!initializedRef.current && open) initializedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const handleCloseWithCheck = useCallback(() => {
    if (dirty) { setConfirmClose(true); return; }
    onClose();
  }, [dirty, onClose]);

  const handleConfirmClose = useCallback(() => {
    setConfirmClose(false);
    setDirty(false);
    initializedRef.current = false;
    onClose();
  }, [onClose]);

  const handleConnectGmail = () => {
    const popup = window.open('/api/jarvis/gmail/auth', 'gmail_auth', 'width=500,height=650,left=200,top=100');
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'gmail_connected') {
        fetchGmailStatus();
        window.removeEventListener('message', onMessage);
        popup?.close();
        toast({
          title: 'Gmail + Calendar linked',
          description: 'Infinity now has access to your inbox and calendar.',
          className: 'border-primary/40 bg-background text-foreground font-sans',
          duration: 4000,
        });
      }
    };
    window.addEventListener('message', onMessage);
    const poll = setInterval(() => {
      if (popup?.closed) { clearInterval(poll); fetchGmailStatus(); window.removeEventListener('message', onMessage); }
    }, 800);
  };

  const handleConnectSpotify = () => {
    const popup = window.open('/api/jarvis/spotify/auth', 'spotify_auth', 'width=500,height=700,left=200,top=100');
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'spotify_connected') {
        fetchSpotifyStatus();
        window.removeEventListener('message', onMessage);
        popup?.close();
        toast({ title: 'Spotify connected', duration: 4000 });
      }
    };
    window.addEventListener('message', onMessage);
    const poll = setInterval(() => {
      if (popup?.closed) { clearInterval(poll); fetchSpotifyStatus(); window.removeEventListener('message', onMessage); }
    }, 800);
  };

  const handleDisconnectGmail = async () => {
    setDisconnecting(true);
    try {
      await fetch('/api/jarvis/gmail/disconnect', { method: 'DELETE' });
      setGmailStatus({ connected: false });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleDisconnectSpotify = async () => {
    setDisconnectingSpotify(true);
    try {
      await fetch('/api/jarvis/spotify/disconnect', { method: 'DELETE' });
      setSpotifyStatus({ connected: false });
    } finally {
      setDisconnectingSpotify(false);
    }
  };

  const calendarKeys = Array.from({ length: visibleSlots }, (_, i) => `calendar_ics_url_${i + 1}` as keyof Settings);

  // Auto-save settings with debounce (800ms)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !open) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch('/api/jarvis/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        setSaved(true);
        setDirty(false);
        setTimeout(() => setSaved(false), 2000);
      } catch {
        toast({ title: t('settings.autosaveFailed'), description: t('settings.autosaveFailedDesc'), variant: 'destructive' });
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, open]);

  const handleManualSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/jarvis/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const removeCalendar = (index: number) => {
    const newForm = { ...form };
    for (let i = index; i < 4; i++) {
      const n = i + 1;
      newForm[`calendar_ics_url_${n}` as keyof Settings] = newForm[`calendar_ics_url_${n + 1}` as keyof Settings];
      newForm[`calendar_name_${n}` as keyof Settings] = newForm[`calendar_name_${n + 1}` as keyof Settings];
    }
    newForm['calendar_ics_url_5'] = '';
    newForm['calendar_name_5'] = '';
    setForm(newForm);
    setVisibleSlots(v => Math.max(1, v - 1));
  };

  const accentLabels: Record<string, string> = {
    blue: t('settings.accent.blue'),
    green: t('settings.accent.green'),
    purple: t('settings.accent.purple'),
    orange: t('settings.accent.orange'),
    pink: t('settings.accent.pink'),
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { haptics.light(); handleCloseWithCheck(); }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="fixed inset-0 z-50 bg-background overflow-hidden flex flex-col"
          >
            {/* Top bar, ChatGPT style: title left, circular close right */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/30 flex-shrink-0">
              <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
                {view === 'home' ? t('settings.title') : ''}
              </h2>
              <button
                onClick={() => { haptics.light(); handleCloseWithCheck(); }}
                className="w-8 h-8 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
                aria-label={t('settings.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-3 pb-8 max-w-xl w-full mx-auto">
              <AnimatePresence mode="wait">
                {/* ── HOME VIEW ── */}
                {view === 'home' && (
                  <motion.div
                    key="home"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18 }}
                  >
                    {/* Profile header */}
                    <div className="flex flex-col items-center pt-8 pb-2">
                      <div className="relative">
                        <div
                          className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg"
                          style={{ background: 'linear-gradient(135deg, #FF5F6D, #FF8A5C)' }}
                        >
                          {profile.initials}
                        </div>
                        <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-card border border-border/40 flex items-center justify-center shadow-sm">
                          <Pencil className="w-3 h-3 text-foreground/70" />
                        </span>
                      </div>
                      <h3 className="mt-3 text-lg font-bold tracking-tight text-foreground">{profile.name}</h3>
                      {gmailStatus?.connected && gmailStatus.email && (
                        <p className="text-[12px] text-muted-foreground/70">{gmailStatus.email}</p>
                      )}
                    </div>

                    {/* Customize */}
                    <SectionLabel>{t('settings.section.customize')}</SectionLabel>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30">
                      <SettingsRow
                        icon={<Smile className="w-4 h-4" />}
                        title={t('settings.personalization')}
                        subtitle={t('settings.personalizationDesc')}
                        onClick={() => setView('personalization')}
                      />
                      <SettingsRow
                        icon={<BookOpen className="w-4 h-4" />}
                        title={t('settings.memory')}
                        subtitle={t('settings.memoryDesc')}
                        right={
                          <span className="flex items-center gap-1.5">
                            {memories.length > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
                                {memories.length}
                              </span>
                            )}
                            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                          </span>
                        }
                        onClick={() => setView('memory')}
                      />
                      <SettingsRow
                        icon={<Languages className="w-4 h-4" />}
                        title={t('settings.language')}
                        subtitle={t('settings.languageDesc')}
                        right={
                          <span className="flex items-center gap-1.5">
                            <span className="text-[13px] text-muted-foreground">
                              {lang === 'en' ? t('settings.language.en') : t('settings.language.nl')}
                            </span>
                            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                          </span>
                        }
                        onClick={() => setView('language')}
                      />

                    </div>

                    {/* Account */}
                    <SectionLabel>{t('settings.section.account')}</SectionLabel>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30">
                      <SettingsRow
                        icon={<Mail className="w-4 h-4" />}
                        title={t('settings.email')}
                        subtitle={gmailStatus?.connected ? gmailStatus.email : t('settings.connectGmail')}
                        onClick={() => setView('gmail')}
                      />
                      <SettingsRow
                        icon={<Music2 className="w-4 h-4" />}
                        title={t('settings.spotify')}
                        subtitle={spotifyStatus?.connected ? (spotifyStatus.displayName ?? t('settings.connected')) : t('settings.connectSpotify')}
                        onClick={() => setView('spotify')}
                      />
                    </div>

                    {/* Theme */}
                    <SectionLabel>{t('settings.section.theme')}</SectionLabel>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30">
                      <div className="flex items-center gap-3.5 px-4 py-3">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-foreground/70">
                          {resolvedTheme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                        </span>
                        <span className="flex-1 text-[15px] font-medium text-foreground">{t('settings.appearance')}</span>
                        {/* Auto / Light / Dark segmented control */}
                        <div className="flex items-center p-0.5 rounded-lg bg-secondary/70">
                          {(['auto', 'light', 'dark'] as const).map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => { haptics.light(); if (onToggleTheme && theme !== m) onToggleTheme(m); }}
                              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all ${
                                theme === m ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                              }`}
                            >
                              {m === 'auto' ? t('settings.appearance.system') : m === 'light' ? t('settings.appearance.light') : t('settings.appearance.dark')}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Accent color, ChatGPT style */}
                    <SectionLabel>{t('settings.accentColor')}</SectionLabel>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30">
                      <SettingsRow
                        icon={
                          <span
                            className="w-4 h-4 rounded-full"
                            style={{ background: (ACCENTS[accent] ?? ACCENTS.blue).dot }}
                          />
                        }
                        title={t('settings.accentColor')}
                        subtitle={t('settings.accentColorDesc')}
                        right={
                          <span className="flex items-center gap-1.5">
                            <span className="text-[13px] text-muted-foreground">{accentLabels[accent] ?? accentLabels.blue}</span>
                            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                          </span>
                        }
                        onClick={() => setView('accent')}
                      />
                    </div>

                    {/* Web Search & Data, the only real "app settings" page */}
                    <SectionLabel>{t('settings.section.app')}</SectionLabel>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30">
                      <SettingsRow
                        icon={<Globe className="w-4 h-4" />}
                        title={t('settings.webSearchData')}
                        subtitle={t('settings.webSearchDataDesc')}
                        right={<ChevronRight className="w-4 h-4 text-muted-foreground/40" />}
                        onClick={() => setView('app')}
                      />
                      <SettingsRow
                        icon={<KeyRound className="w-4 h-4" />}
                        title="API Keys"
                        subtitle="API credentials and LLM rotation keys"
                        right={<ChevronRight className="w-4 h-4 text-muted-foreground/40" />}
                        onClick={() => { setView('llm'); loadSecrets(); fetchLlmKeys(); }}
                      />
                    </div>

                    {/* Help */}
                    <SectionLabel>{t('settings.section.help')}</SectionLabel>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30">
                      <SettingsRow
                        icon={<Info className="w-4 h-4" />}
                        title={t('settings.about')}
                        onClick={() => setView('about')}
                      />
                    </div>

                  </motion.div>
                )}

                {/* ── LANGUAGE VIEW ── */}
                {view === 'language' && (
                  <motion.div
                    key="language"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="flex flex-col items-center pt-6 pb-4">
                      <span className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                        <Languages className="w-6 h-6 text-primary" />
                      </span>
                      <h3 className="mt-3 text-lg font-bold tracking-tight text-foreground">{t('settings.language')}</h3>
                      <p className="mt-1 text-[13px] text-muted-foreground/70">{t('settings.languageDesc')}</p>
                    </div>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30 mt-4">
                      {(['en', 'nl'] as const).map(code => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => { haptics.light(); setLang(code); }}
                          className="w-full flex items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-secondary/40"
                        >
                          <span className="w-9 h-9 rounded-full border border-border/50 flex items-center justify-center text-[13px] font-bold flex-shrink-0">
                            {code === 'en' ? 'EN' : 'NL'}
                          </span>
                          <span className="flex-1 text-[15px] font-medium text-foreground">
                            {code === 'en' ? t('settings.language.en') : t('settings.language.nl')}
                          </span>
                          {lang === code && (
                            <motion.span
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="w-6 h-6 rounded-full bg-primary flex items-center justify-center"
                            >
                              <Check className="w-3.5 h-3.5 text-primary-foreground" strokeWidth={3} />
                            </motion.span>
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* ── PERSONALIZATION VIEW ── */}
                {/* ── ACCENT COLOR VIEW ── */}
                {view === 'accent' && (
                  <motion.div
                    key="accent"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="flex flex-col items-center pt-6 pb-4">
                      <span className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                        <Palette className="w-6 h-6 text-primary" />
                      </span>
                      <h3 className="mt-3 text-lg font-bold tracking-tight text-foreground">{t('settings.accentColor')}</h3>
                      <p className="mt-1 text-[13px] text-muted-foreground/70">{t('settings.accentColorDesc')}</p>
                    </div>
                    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30 mt-4">
                      {Object.keys(ACCENTS).map(code => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => { haptics.light(); setAccent(code); }}
                          className="w-full flex items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-secondary/40"
                        >
                          <span
                            className="w-9 h-9 rounded-full border border-border/50 flex items-center justify-center flex-shrink-0"
                            style={{ background: ACCENTS[code].dot }}
                          />
                          <span className="flex-1 text-[15px] font-medium text-foreground">
                            {accentLabels[code] ?? code}
                          </span>
                          {accent === code && (
                            <motion.span
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="w-6 h-6 rounded-full bg-primary flex items-center justify-center"
                            >
                              <Check className="w-3.5 h-3.5 text-primary-foreground" strokeWidth={3} />
                            </motion.span>
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {view === 'personalization' && (
                  <motion.div
                    key="personalization"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="pt-5 pb-3">
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-primary/70" />
                        <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.userProfile')}</label>
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 mt-1">{t('settings.userProfileHint')}</p>
                      <textarea
                        value={form.user_profile}
                        onChange={e => setForm(f => ({ ...f, user_profile: e.target.value }))}
                        placeholder={t('settings.userProfilePlaceholder')}
                        rows={4}
                        maxLength={2000}
                        className="w-full bg-card border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[12px] px-4 py-3 rounded-xl outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all resize-none leading-relaxed mt-3"
                      />
                      <p className="text-[10px] font-mono text-muted-foreground/40 text-right mt-1">
                        {form.user_profile.length}/2000
                      </p>
                    </div>

                    {/* Personality, how Infinity talks to you */}
                    <div className="pt-5 pb-1 border-t border-border/20">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-primary/70" />
                        <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.personality')}</label>
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 mt-1">{t('settings.personalityDesc')}</p>
                      <div className="mt-3 rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/30">
                        {([
                          { value: 'auto', label: t('settings.personality.auto'), icon: Sparkles },
                          { value: 'balanced', label: t('settings.personality.balanced'), icon: MessageCircle },
                          { value: 'talkative', label: t('settings.personality.talkative'), icon: Sparkles },
                          { value: 'helpful', label: t('settings.personality.helpful'), icon: Briefcase },
                          { value: 'concise', label: t('settings.personality.concise'), icon: Zap },
                          { value: 'custom', label: t('settings.personality.custom'), icon: SlidersHorizontal },
                        ]).map(({ value, label, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => { haptics.light(); setForm(f => ({ ...f, personality: value })); }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40 ${form.personality === value ? 'bg-primary/5' : ''}`}
                          >
                            <Icon className={`w-4 h-4 flex-shrink-0 ${form.personality === value ? 'text-primary' : 'text-muted-foreground/50'}`} />
                            <span className={`flex-1 text-[14px] font-medium ${form.personality === value ? 'text-primary' : 'text-foreground'}`}>{label}</span>
                            {form.personality === value && <Check className="w-4 h-4 text-primary" />}
                          </button>
                        ))}
                      </div>
                      {form.personality === 'custom' && (
                        <div className="mt-3">
                          <label className="text-[12px] font-medium text-foreground tracking-tight">{t('settings.customPromptLabel')}</label>
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{t('settings.customPromptHint')}</p>
                          <textarea
                            value={form.custom_personality_prompt}
                            onChange={e => setForm(f => ({ ...f, custom_personality_prompt: e.target.value }))}
                            placeholder={t('settings.customPromptPlaceholder')}
                            rows={4}
                            maxLength={4000}
                            className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[12px] px-3 py-2.5 rounded-xl outline-none focus:border-primary/60 transition-all resize-none mt-2 leading-relaxed"
                          />
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ── MEMORY VIEW ── */}
                {view === 'memory' && (
                  <motion.div
                    key="memory"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="pt-5 pb-3">
                      <div className="flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-primary/70" />
                        <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.memories')}</label>
                        {memories.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                            {memories.length}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 mt-1">{t('settings.memoriesHint')}</p>

                      {loadingMemories ? (
                        <p className="text-[12px] text-muted-foreground/50 mt-4">{t('settings.loading')}</p>
                      ) : memories.length === 0 ? (
                        <div className="p-5 border border-border/30 rounded-xl bg-card/30 text-center mt-4">
                          <Brain className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                          <p className="text-[12px] text-muted-foreground/50">{t('settings.noMemories')}</p>
                        </div>
                      ) : (
                        <div className="space-y-2 mt-4">
                          {memories.map(m => (
                            <div key={m.topic} className="border border-border/40 rounded-xl bg-card/30 overflow-hidden">
                              <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-1">
                                <p className="text-[10px] font-medium text-primary/70 uppercase tracking-widest truncate">
                                  {m.topic.replace(/_/g, ' ')}
                                </p>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  {editingMemory === m.topic ? (
                                    <>
                                      <button onClick={() => handleSaveMemoryEdit(m.topic)} className="p-1.5 text-primary hover:text-primary/80 transition-colors">
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={() => { setEditingMemory(null); setEditDraft(''); }} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                                        <X className="w-3 h-3" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => startEditMemory(m.topic, m.value)}
                                      disabled={!!deletingMemory}
                                      className="p-1.5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                                      title={t('settings.edit')}
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteMemory(m.topic)}
                                    disabled={deletingMemory === m.topic || editingMemory === m.topic}
                                    className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                                    title={t('settings.delete')}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              {editingMemory === m.topic ? (
                                <div className="px-3.5 pb-2.5">
                                  <input
                                    type="text"
                                    value={editDraft}
                                    onChange={e => setEditDraft(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleSaveMemoryEdit(m.topic);
                                      if (e.key === 'Escape') { setEditingMemory(null); setEditDraft(''); }
                                    }}
                                    autoFocus
                                    className="w-full bg-background border border-primary/40 text-foreground font-mono text-[11px] px-2.5 py-1.5 rounded-lg outline-none focus:ring-1 focus:ring-primary/30"
                                  />
                                </div>
                              ) : (
                                <p className="px-3.5 pb-2.5 text-[12px] text-foreground/80 leading-snug">{m.value}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ── GMAIL VIEW ── */}
                {view === 'gmail' && (
                  <motion.div
                    key="gmail"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="pt-5 pb-3">
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-primary/70" />
                        <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.gmail')}</label>
                      </div>
                      <div className="mt-4">
                        {gmailStatus?.connected ? (
                          <div className="flex items-center justify-between p-4 border border-primary/30 bg-primary/5 rounded-xl">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-primary">{t('settings.connected')}</p>
                                <p className="text-[11px] text-muted-foreground/70 truncate">{gmailStatus.email}</p>
                              </div>
                            </div>
                            <button
                              onClick={handleDisconnectGmail}
                              disabled={disconnecting}
                              className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0 ml-2"
                            >
                              <LogOut className="w-3 h-3" />
                              {disconnecting ? t('settings.disconnecting') : t('settings.disconnect')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={handleConnectGmail}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border/50 text-[13px] font-medium text-foreground hover:border-primary/40 hover:text-primary transition-all"
                          >
                            <Mail className="w-4 h-4" />
                            {t('settings.connectGmail')}
                          </button>
                        )}
                        <p className="text-[11px] text-muted-foreground/60 mt-2">
                          {gmailStatus?.connected
                            ? t('settings.gmailSynced', { email: gmailStatus.email ?? '' })
                            : t('settings.gmailHint')}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ── SPOTIFY VIEW ── */}
                {view === 'spotify' && (
                  <motion.div
                    key="spotify"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="pt-5 pb-3">
                      <div className="flex items-center gap-2">
                        <Music2 className="w-3.5 h-3.5 text-primary/70" />
                        <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.spotify')}</label>
                      </div>
                      <div className="mt-4">
                        {spotifyStatus?.connected ? (
                          <div className="flex items-center justify-between p-4 border border-green-500/30 bg-green-500/5 rounded-xl">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-green-500">{t('settings.connected')}</p>
                                {spotifyStatus.displayName && (
                                  <p className="text-[11px] text-muted-foreground/70 truncate">{spotifyStatus.displayName}</p>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={handleDisconnectSpotify}
                              disabled={disconnectingSpotify}
                              className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0 ml-2"
                            >
                              <LogOut className="w-3 h-3" />
                              {disconnectingSpotify ? t('settings.disconnecting') : t('settings.disconnect')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={handleConnectSpotify}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-green-500/30 text-[13px] font-medium text-green-500 hover:border-green-500/60 transition-all"
                          >
                            <Music2 className="w-4 h-4" />
                            {t('settings.connectSpotify')}
                          </button>
                        )}
                        <p className="text-[11px] text-muted-foreground/60 mt-2">{t('settings.spotifyHint')}</p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ── API KEYS VIEW (service secrets + multi-provider LLM rotation) ── */}
                {view === 'llm' && (
                  <motion.div
                    key="api-keys"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="flex flex-col items-center pt-6 pb-4">
                      <span className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                        <KeyRound className="w-6 h-6 text-primary" />
                      </span>
                      <h3 className="mt-3 text-lg font-bold tracking-tight text-foreground">API Keys</h3>
                      <p className="mt-1 text-[13px] text-muted-foreground/70 text-center px-6">
                        Service credentials and LLM keys, stored in Infinity and applied instantly.
                      </p>
                    </div>

                    {llmError && (
                      <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-red-400/30 bg-red-400/10 text-red-400 text-[11px]">
                        <span>Could not load LLM keys: {llmError}</span>
                        <button type="button" onClick={fetchLlmKeys} className="font-semibold underline flex-shrink-0">Retry</button>
                      </div>
                    )}

                    {/* Add a key */}
                    <div className="p-4 border border-border/40 rounded-xl bg-card space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Plus className="w-3.5 h-3.5 text-primary/70" />
                        <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.llmKeysAdd')}</label>
                      </div>
                      <input
                        type="text"
                        value={llmForm.name}
                        onChange={e => setLlmForm(f => ({ ...f, name: e.target.value }))}
                        placeholder={t('settings.llmKeysName')}
                        className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground/40 text-[12px] px-3 py-2 rounded-md outline-none focus:border-primary/60 transition-all"
                      />
                      <input
                        type="password"
                        value={llmForm.apiKey}
                        onChange={e => setLlmForm(f => ({ ...f, apiKey: e.target.value }))}
                        placeholder={t('settings.llmKeysSecret')}
                        className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[11px] px-3 py-2 rounded-md outline-none focus:border-primary/60 transition-all"
                      />
                      <input
                        type="text"
                        value={llmForm.baseUrl}
                        onChange={e => setLlmForm(f => ({ ...f, baseUrl: e.target.value }))}
                        placeholder={t('settings.llmKeysBaseUrl')}
                        className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[11px] px-3 py-2 rounded-md outline-none focus:border-primary/60 transition-all"
                      />
                      <input
                        type="text"
                        value={llmForm.model}
                        onChange={e => setLlmForm(f => ({ ...f, model: e.target.value }))}
                        placeholder={t('settings.llmKeysModel')}
                        className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[11px] px-3 py-2 rounded-md outline-none focus:border-primary/60 transition-all"
                      />
                      <button
                        type="button"
                        disabled={llmBusy}
                        onClick={addLlmKey}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-[12px] font-semibold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50"
                      >
                        {llmBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {t('settings.llmKeysAddBtn')}
                      </button>
                    </div>

                    {/* Key list */}
                    <div className="mt-3 space-y-2">
                      {llmLoading ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground/60">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Loading LLM keys…
                        </div>
                      ) : !llmError && llmKeys.length === 0 ? (
                        <p className="text-center text-[12px] text-muted-foreground/60 py-6">{t('settings.llmKeysNone')}</p>
                      ) : null}
                      {llmKeys.map(item => {
                        let host = item.baseUrl;
                        try { host = new URL(item.baseUrl).host; } catch { /* keep raw */ }
                        const statusColor =
                          item.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-500' :
                          item.status === 'cooling' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500';
                        return (
                          <div key={item.id} className="p-3 border border-border/40 rounded-xl bg-card space-y-2">
                            <div className="flex items-start gap-2.5">
                              <span className="w-7 h-7 rounded-full bg-secondary/70 flex items-center justify-center flex-shrink-0 text-foreground/60">
                                <KeyRound className="w-3.5 h-3.5" />
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-[13px] font-semibold text-foreground truncate">{item.name}</p>
                                  {item.source === 'env' && (
                                    <span className="px-1.5 py-0.5 rounded bg-secondary text-[9px] font-medium text-muted-foreground uppercase tracking-wide">env</span>
                                  )}
                                </div>
                                <p className="text-[10px] font-mono text-muted-foreground/60 truncate">{host} · {item.model}</p>
                                <p className="text-[10px] font-mono text-muted-foreground/40 truncate">{item.maskedKey}</p>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${statusColor}`}>
                                {t(`settings.llmStatus.${item.status}`)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-border/20">
                              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                                <span>{item.uses} {t('settings.llmUses')}</span>
                                <span>{item.failures} {t('settings.llmFailures')}</span>
                                {item.coolDownUntil && item.coolDownUntil > Date.now() && (
                                  <span className="text-amber-500/80">{Math.max(1, Math.round((item.coolDownUntil - Date.now()) / 60000))}m</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {item.source === 'db' && (
                                  <button
                                    type="button"
                                    onClick={() => toggleLlmKey(item)}
                                    aria-label={t('settings.llmToggle')}
                                    className={`w-9 h-5 rounded-full relative transition-colors ${item.enabled ? 'bg-primary' : 'bg-secondary'}`}
                                  >
                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${item.enabled ? 'left-5' : 'left-0.5'}`} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => testLlmKey(item)}
                                  disabled={llmTesting === item.id}
                                  title={t('settings.llmTest')}
                                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                                >
                                  {llmTesting === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                </button>
                                {item.source === 'db' && (
                                  <button
                                    type="button"
                                    onClick={() => deleteLlmKey(item)}
                                    title={t('settings.llmDelete')}
                                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/5 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {secretDrafts.__dbHint && (
                      <div className="mt-6 mb-3 px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-300 text-[11px]">
                        No database connection yet, add <span className="font-mono">DATABASE_URL</span> below to enable chat history and make saved keys persist.
                      </div>
                    )}

                    <div className="mt-6 pt-5 border-t border-border/30">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-[14px] font-semibold text-foreground">Service API keys</h4>
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5">OpenRouter, voice, search, integrations, and database</p>
                        </div>
                        <button
                          type="button"
                          onClick={loadSecrets}
                          disabled={secretLoading}
                          className="p-1.5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                          title="Refresh API keys"
                        >
                          <Loader2 className={`w-3.5 h-3.5 ${secretLoading ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                      {secretError && (
                        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-red-400/30 bg-red-400/10 text-red-400 text-[11px]">
                          <span>Could not load service keys: {secretError}</span>
                          <button type="button" onClick={loadSecrets} className="font-semibold underline flex-shrink-0">Retry</button>
                        </div>
                      )}
                      {secretLoading ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground/60">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Loading service keys…
                        </div>
                      ) : !secretError && secretItems.length === 0 ? (
                        <p className="text-center text-[12px] text-muted-foreground/60 py-6">No service keys are configured.</p>
                      ) : (
                        <div className="space-y-2">
                          {secretItems.map(item => (
                            <div key={item.env} className="p-3 border border-border/40 rounded-xl bg-card space-y-2">
                              <div className="flex items-start gap-2.5">
                                <span className="w-7 h-7 rounded-full bg-secondary/70 flex items-center justify-center flex-shrink-0 text-foreground/60">
                                  <KeyRound className="w-3.5 h-3.5" />
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-[13px] font-semibold text-foreground tracking-tight">{item.label}</p>
                                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                                      item.configured
                                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                                        : 'bg-red-500/10 text-red-500 border-red-500/30'
                                    }`}>
                                      {item.configured ? 'SET' : 'MISSING'}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground/60">{item.description}</p>
                                  <p className="mt-0.5 text-[10px] font-mono text-muted-foreground/50 break-all">
                                    {item.env}{item.configured ? `, ${item.masked}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <input
                                  type="password"
                                  value={secretDrafts[item.env] ?? ''}
                                  onChange={e => setSecretDrafts(d => ({ ...d, [item.env]: e.target.value }))}
                                  placeholder={item.configured ? t('settings.apiKeyPlaceholderReplace') : t('settings.apiKeyPlaceholderNew')}
                                  className="flex-1 min-w-0 bg-background border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[11px] px-3 py-2 rounded-md outline-none focus:border-primary/60 transition-all"
                                />
                                <button
                                  type="button"
                                  disabled={secretSaving === item.env || !(secretDrafts[item.env] ?? '').trim()}
                                  onClick={() => saveSecret(item.env)}
                                  className="px-3 py-2 rounded-lg bg-primary text-white text-[11px] font-semibold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40"
                                >
                                  {secretSaving === item.env ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                                </button>
                                {item.configured && (
                                  <button
                                    type="button"
                                    onClick={() => clearSecret(item.env)}
                                    className="px-3 py-2 rounded-lg border border-red-400/30 bg-red-400/10 text-red-400 text-[11px] font-semibold hover:bg-red-400/20 transition-all"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ── APP SETTINGS VIEW (functional toggles + feeds) ── */}
                {view === 'app' && (
                  <motion.div
                    key="app"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>

                    {/* Web search */}
                    <div className="pt-5 pb-3 space-y-3">
                      <div className="flex items-center justify-between p-4 border border-border/40 rounded-xl bg-card">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-foreground">{t('settings.webSearchHint')}</p>
                          <p className="text-[11px] text-muted-foreground/60">{t('settings.webSearchPowered')}</p>
                        </div>
                        <button
                          onClick={() => setForm(f => ({ ...f, web_search_enabled: f.web_search_enabled === 'true' ? 'false' : 'true' }))}
                          className={`relative w-12 h-7 rounded-full transition-colors ${form.web_search_enabled === 'true' ? 'bg-primary' : 'bg-secondary'}`}
                          aria-label={t('settings.webSearch')}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-sm transition-transform ${form.web_search_enabled === 'true' ? 'translate-x-5' : ''}`} />
                        </button>
                      </div>

                      {/* Weather */}
                      <div className="p-4 border border-border/40 rounded-xl bg-card space-y-2">
                        <div className="flex items-center gap-2">
                          <Cloud className="w-3.5 h-3.5 text-primary/70" />
                          <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.weather')}</label>
                        </div>
                        <input
                          type="text"
                          value={form.weather_location}
                          onChange={e => setForm(f => ({ ...f, weather_location: e.target.value }))}
                          placeholder={t('settings.weatherPlaceholder')}
                          className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground/50 font-mono text-[12px] px-3.5 py-2.5 rounded-lg outline-none focus:border-primary/60 transition-all"
                        />
                        <p className="text-[11px] text-muted-foreground/60">{t('settings.weatherHint')}</p>
                      </div>

                      {/* Calendar feeds */}
                      <div className="p-4 border border-border/40 rounded-xl bg-card space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CalendarDays className="w-3.5 h-3.5 text-primary/70" />
                            <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.calendarFeeds')}</label>
                          </div>
                          {visibleSlots < 5 && (
                            <button
                              onClick={() => setVisibleSlots(v => Math.min(5, v + 1))}
                              className="flex items-center gap-1 text-[12px] text-primary hover:text-primary/80 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> {t('settings.addFeed')}
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground/60">{t('settings.calendarHint')}</p>
                        <AnimatePresence>
                          {calendarKeys.map((urlKey, i) => {
                            const nameKey = `calendar_name_${i + 1}` as keyof Settings;
                            return (
                              <motion.div
                                key={urlKey}
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-1.5 border border-border/30 rounded-lg p-3 bg-background/40"
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={form[nameKey]}
                                    onChange={e => setForm(f => ({ ...f, [nameKey]: e.target.value }))}
                                    placeholder={t('settings.feedNamePlaceholder')}
                                    className="flex-1 bg-background border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[11px] px-3 py-2 rounded-md outline-none focus:border-primary/60 transition-all"
                                  />
                                  {visibleSlots > 1 && (
                                    <button
                                      onClick={() => removeCalendar(i)}
                                      className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                                      title={t('settings.removeFeed')}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                                <input
                                  type="url"
                                  value={form[urlKey]}
                                  onChange={e => setForm(f => ({ ...f, [urlKey]: e.target.value }))}
                                  placeholder={t('settings.icalPlaceholder')}
                                  className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground/40 font-mono text-[11px] px-3 py-2 rounded-md outline-none focus:border-primary/60 transition-all"
                                />
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </div>

                      {/* System prompt */}
                      <div className="p-4 border border-border/40 rounded-xl bg-card space-y-2">
                        <div className="flex items-center gap-2">
                          <Brain className="w-3.5 h-3.5 text-primary/70" />
                          <label className="text-[13px] font-semibold text-foreground tracking-tight">{t('settings.systemPrompt')}</label>
                        </div>
                        <p className="text-[11px] text-muted-foreground/60">{t('settings.promptHint')}</p>
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/jarvis/system-prompt');
                              const data = await res.json();
                              toast({
                                title: t('settings.promptPreview'),
                                description: (
                                  <div className="max-h-40 overflow-y-auto text-[10px] font-mono leading-relaxed whitespace-pre-wrap">
                                    {data.prompt?.slice(0, 2000)}
                                  </div>
                                ),
                                duration: 6000,
                              });
                            } catch {
                              toast({ title: t('settings.couldNotLoad'), variant: 'destructive' });
                            }
                          }}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-border/50 rounded-lg text-[12px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
                        >
                          <Info className="w-3 h-3" />
                          {t('settings.previewPrompt')}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ── ABOUT VIEW ── */}
                {view === 'about' && (
                  <motion.div
                    key="about"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="flex items-center gap-1.5 text-[13px] text-primary hover:opacity-80 transition-opacity mt-2"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180" />
                      {t('settings.title')}
                    </button>
                    <div className="flex flex-col items-center pt-10 pb-4">
                      <div
                        className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-lg"
                        style={{ background: 'linear-gradient(135deg, #007AFF, #5856D6)' }}
                      >
                        J
                      </div>
                      <h3 className="mt-4 text-xl font-bold tracking-tight text-foreground">{t('header.title')}</h3>
                      <p className="text-[13px] text-muted-foreground/70 mt-1">Infinity AI · 2026</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Save status footer, functional views only */}
            {view !== 'home' && view !== 'language' && view !== 'memory' && view !== 'about' && view !== 'accent' && (
              <div className="px-5 py-3 border-t border-border/30 flex-shrink-0">
                <div className="flex items-center justify-between max-w-xl w-full mx-auto">
                  <div className="flex items-center gap-2">
                    {saving ? (
                      <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                    ) : saved ? (
                      <span className="w-2 h-2 rounded-full bg-green-400" />
                    ) : dirty ? (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-green-400/50" />
                    )}
                    <span className="text-[10px] font-medium text-muted-foreground/60 tracking-widest">
                      {saving ? t('settings.saving') : saved ? t('settings.saved') : dirty ? t('settings.unsaved') : t('settings.autosave')}
                    </span>
                  </div>
                  <button
                    onClick={() => { haptics.medium(); handleManualSave(); }}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                  >
                    <Save className="w-3 h-3" />
                    {t('settings.saveNow')}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}

      {/* Unsaved changes confirmation dialog */}
      <AnimatePresence>
        {confirmClose && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setConfirmClose(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border/60 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[15px] font-semibold text-foreground">{t('settings.unsaved')}</p>
                  <p className="text-[12px] text-muted-foreground/70 mt-1 leading-relaxed">{t('settings.unsavedDesc')}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmClose(false)}
                  className="px-4 py-2 rounded-lg border border-border/50 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  {t('settings.keepEditing')}
                </button>
                <button
                  onClick={handleConfirmClose}
                  className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-[12px] font-medium hover:opacity-90 transition-opacity"
                >
                  {t('settings.discard')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
