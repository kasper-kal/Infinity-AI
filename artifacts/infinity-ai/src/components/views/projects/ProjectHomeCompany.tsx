"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUpRight,
  Brush,
  CheckCircle2,
  Clock3,
  FileText,
  Flame,
  FlaskConical,
  FolderKanban,
  Globe,
  Image,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Video,
  Wand2,
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { getProjectTypeColor, getProjectTypeIcon, getDefaultViewsForProjectType } from '@/lib/project-types';

export type CompanyHomeAction = 'brand' | 'promo' | 'website' | 'chats' | 'files' | 'memory' | 'instructions' | 'activity' | 'palette' | 'fonts';

interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  color: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  type: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface FileSummary {
  id: string;
  fileId: string;
  name: string;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

interface ProjectHomePayload {
  project: ProjectSummary;
  counts: Record<'conversations' | 'files' | 'research' | 'tasks' | 'memory', number>;
  latest: {
    conversations: ConversationSummary[];
    files: FileSummary[];
    research: unknown[];
    tasks: unknown[];
    memory: unknown[];
  };
}

interface ProjectHomeCompanyProps {
  projectId: string;
  onBack: () => void;
  onContinueConversation: (conversationId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onOpenAction?: (action: CompanyHomeAction) => void;
}

const activityLabelKeys: Record<string, TranslationKey> = {
  project_created: 'projectHome.activity.projectCreated',
  conversation: 'projectHome.activity.conversation',
  file: 'projectHome.activity.file',
};

const companyActions: Array<{
  action: CompanyHomeAction;
  icon: typeof Brush;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  accent: string;
}> = [
  { action: 'brand', icon: Brush, labelKey: 'projectHomeCompany.brand', descriptionKey: 'projectHomeCompany.brandDesc', accent: 'text-orange-500 bg-orange-500/10 border-orange-500/20' },
  { action: 'promo', icon: Video, labelKey: 'projectHomeCompany.promo', descriptionKey: 'projectHomeCompany.promoDesc', accent: 'text-rose-500 bg-rose-500/10 border-rose-500/20' },
  { action: 'website', icon: Globe, labelKey: 'projectHomeCompany.website', descriptionKey: 'projectHomeCompany.websiteDesc', accent: 'text-sky-500 bg-sky-500/10 border-sky-500/20' },
  { action: 'palette', icon: Sparkles, labelKey: 'projectHomeCompany.generatePalette', descriptionKey: 'projectHomeCompany.generatePaletteDesc', accent: 'text-violet-500 bg-violet-500/10 border-violet-500/20' },
  { action: 'fonts', icon: Type, labelKey: 'projectHomeCompany.findFonts', descriptionKey: 'projectHomeCompany.findFontsDesc', accent: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20' },
];

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

function formatRelativeDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'day');
  if (days < 7) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day');
  return formatDate(value, locale);
}

export function ProjectHomeCompany({
  projectId,
  onBack,
  onContinueConversation,
  onNewChat,
  onOpenAction,
}: ProjectHomeCompanyProps) {
  const { t, lang } = useI18n();
  const [payload, setPayload] = useState<ProjectHomePayload | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyAction, setBusyAction] = useState<'newChat' | 'continue' | 'generateLogo' | 'generateSlogan' | 'createPromo' | 'generatePalette' | 'findFonts' | null>(null);
  const [logoResult, setLogoResult] = useState<string | null>(null);
  const [sloganResult, setSloganResult] = useState<string | null>(null);
  const [paletteResult, setPaletteResult] = useState<{ primary: string; secondary: string; accent: string; background: string; text: string } | null>(null);
  const [fontsResult, setFontsResult] = useState<{ heading: { name: string; url: string }; body: { name: string; url: string } } | null>(null);
  const [brandKit, setBrandKit] = useState<{ colors: { primary: string; secondary: string; accent: string; background: string; text: string }; fonts: { heading: { name: string; url: string }; body: { name: string; url: string } } } | null>(null);
  const locale = lang === 'nl' ? 'nl-NL' : 'en-GB';

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/home`);
      if (!response.ok) throw new Error('Project home request failed');
      setPayload(await response.json() as ProjectHomePayload);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadActivity = useCallback(async () => {
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/activity?limit=6`);
      if (!response.ok) throw new Error('Project activity request failed');
      const data = await response.json();
      const activity = Array.isArray(data.activity) ? data.activity : [];
      setRecentActivity(activity);
    } catch {
      setRecentActivity([]);
    }
  }, [projectId]);

  useEffect(() => {
    void loadHome();
    void loadActivity();
  }, [loadHome, loadActivity]);

  const runNewChat = async () => {
    if (busyAction) return;
    setBusyAction('newChat');
    try {
      await onNewChat();
    } finally {
      setBusyAction(null);
    }
  };

  const continueConversation = async (conversationId: string) => {
    if (busyAction) return;
    setBusyAction('continue');
    try {
      await onContinueConversation(conversationId);
    } finally {
      setBusyAction(null);
    }
  };

  const generateLogo = async () => {
    if (busyAction || !payload) return;
    setBusyAction('generateLogo');
    try {
      const response = await fetch('/api/jarvis/tools/company.logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: payload.project.name,
          description: payload.project.description,
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setLogoResult(result.logoUrl || result.imageUrl);
      }
    } catch {
      // Error handled by UI
    } finally {
      setBusyAction(null);
    }
  };

  const generateSlogan = async () => {
    if (busyAction || !payload) return;
    setBusyAction('generateSlogan');
    try {
      const response = await fetch('/api/jarvis/tools/company.slogan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: payload.project.name,
          description: payload.project.description,
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setSloganResult(result.slogan);
      }
    } catch {
      // Error handled by UI
    } finally {
      setBusyAction(null);
    }
  };

  const createPromoVideo = async () => {
    if (busyAction || !payload) return;
    setBusyAction('createPromo');
    try {
      const response = await fetch('/api/jarvis/promo/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://${payload.project.name.toLowerCase().replace(/\s+/g, '')}.com`, // placeholder URL
          prompt: `Create a promo video for ${payload.project.name}: ${payload.project.description}`,
          duration: 30,
          style: "professional",
          brandKit: brandKit,
        }),
      });
      if (response.ok) {
        const result = await response.json();
        // Open promo widget with job ID - the widget will be shown via the chat SSE event
        // For now, we can navigate to a modal or show the widget inline
        onOpenAction?.('promo' as CompanyHomeAction);
      }
    } catch {
      // Error handled by UI
    } finally {
      setBusyAction(null);
    }
  };

  const generatePalette = async () => {
    if (busyAction || !payload) return;
    setBusyAction('generatePalette');
    try {
      const response = await fetch('/api/jarvis/tools/company.palette', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: payload.project.name,
          description: payload.project.description,
          mood: 'professional',
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setPaletteResult(result.palette);
        // Update brandKit with colors
        setBrandKit(prev => ({
          colors: {
            primary: result.palette.primary,
            secondary: result.palette.secondary,
            accent: result.palette.accent,
            background: result.palette.background,
            text: result.palette.text,
          },
          fonts: prev?.fonts || { heading: { name: '', url: '' }, body: { name: '', url: '' } },
        }));
      }
    } catch {
      // Error handled by UI
    } finally {
      setBusyAction(null);
    }
  };

  const findFonts = async () => {
    if (busyAction || !payload) return;
    setBusyAction('findFonts');
    try {
      const response = await fetch('/api/jarvis/tools/company.font', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: payload.project.name,
          description: payload.project.description,
          stylePreferences: 'modern, like SF Pro',
          purpose: 'both',
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setFontsResult({
          heading: { name: result.headingFont.name, url: result.headingFont.url },
          body: { name: result.bodyFont.name, url: result.bodyFont.url },
        });
        // Update brandKit with fonts
        setBrandKit(prev => ({
          colors: prev?.colors || { primary: '', secondary: '', accent: '', background: '', text: '' },
          fonts: {
            heading: { name: result.headingFont.name, url: result.headingFont.url },
            body: { name: result.bodyFont.name, url: result.bodyFont.url },
          },
        }));
      }
    } catch {
      // Error handled by UI
    } finally {
      setBusyAction(null);
    }
  };

  const isEmpty = payload
    ? Object.values(payload.counts).every((count) => count === 0) && recentActivity.length <= 1
    : false;

  const projectColor = payload?.project.color ?? '#ea580c';
  const projectType = payload?.project.type ?? 'company';

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-4 sm:px-6 lg:px-10 lg:pt-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('projectHome.back')}
        </button>

        {loading && (
          <div className="flex min-h-[55vh] items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {t('projectHome.loading')}
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="liquid-glass flex min-h-[40vh] flex-col items-center justify-center rounded-3xl border border-border/50 p-8 text-center">
            <FolderKanban className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <h1 className="text-base font-semibold">{t('projectHome.loadError')}</h1>
            <button
              type="button"
              onClick={() => void loadHome()}
              className="mt-4 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {t('projectHome.retry')}
            </button>
          </div>
        )}

        {!loading && !error && payload && (
          <>
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8"
            >
              <div
                className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full opacity-20 blur-3xl"
                style={{ backgroundColor: projectColor }}
              />
              <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: projectColor }} />
                    {t('projectHome.eyebrow')}
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                      {payload.project.name}
                    </h1>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white"
                      style={{ backgroundColor: projectColor }}
                    >
                      {getProjectTypeIcon(projectType)}
                      {t(`projectType.${projectType}` as TranslationKey)}
                    </span>
                  </div>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                    {payload.project.description || t('projectHome.noDescription')}
                  </p>
                  <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                    <Clock3 className="h-3.5 w-3.5" />
                    {t('projectHome.updated')} {formatRelativeDate(payload.project.updatedAt, locale)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const conversation = payload.latest.conversations[0];
                      if (conversation) void continueConversation(conversation.id);
                      else void runNewChat();
                    }}
                    disabled={Boolean(busyAction)}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-4 py-2.5 text-xs font-semibold text-foreground shadow-sm transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                  >
                    {busyAction === 'continue' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                    {t('projectHome.continue')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runNewChat()}
                    disabled={Boolean(busyAction)}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
                  >
                    {busyAction === 'newChat' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    {t('projectHome.newChat')}
                  </button>
                </div>
              </div>
            </motion.section>

            {/* Company-specific Tools Section */}
            <section className="mt-5">
              <div className="mb-3 flex items-center gap-2 px-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('projectHomeCompany.tools')}
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {companyActions.map(({ action, icon: Icon, labelKey, descriptionKey, accent }) => (
                  <button
                    type="button"
                    key={action}
                    onClick={() => onOpenAction?.(action)}
                    className="group liquid-glass rounded-2xl border border-border/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${accent}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                    </div>
                    <p className="mt-4 text-sm font-semibold text-foreground">{t(labelKey)}</p>
                    <p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground/70">{t(descriptionKey)}</p>
                  </button>
                ))}
              </div>
            </section>

            {/* AI Generation Tools */}
            <section className="mt-5">
              <div className="mb-3 flex items-center gap-2 px-1">
                <Wand2 className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('projectHomeCompany.aiTools')}
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <button
                  type="button"
                  onClick={generateLogo}
                  disabled={busyAction === 'generateLogo'}
                  className="group liquid-glass rounded-2xl border border-border/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border text-amber-500 bg-amber-500/10 border-amber-500/20">
                      <Image className="h-4 w-4" />
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">{t('projectHomeCompany.generateLogo')}</p>
                  <p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground/70">{t('projectHomeCompany.generateLogoDesc')}</p>
                  {logoResult && (
                    <div className="mt-3 p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-500">
                      {t('projectHomeCompany.logoGenerated')}
                    </div>
                  )}
                  {busyAction === 'generateLogo' && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('common.running')}
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={generateSlogan}
                  disabled={busyAction === 'generateSlogan'}
                  className="group liquid-glass rounded-2xl border border-border/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border text-purple-500 bg-purple-500/10 border-purple-500/20">
                      <Type className="h-4 w-4" />
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">{t('projectHomeCompany.generateSlogan')}</p>
                  <p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground/70">{t('projectHomeCompany.generateSloganDesc')}</p>
                  {sloganResult && (
                    <div className="mt-3 p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-500">
                      {t('projectHomeCompany.sloganGenerated')}
                    </div>
                  )}
                  {busyAction === 'generateSlogan' && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('common.running')}
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={createPromoVideo}
                  disabled={busyAction === 'createPromo'}
                  className="group liquid-glass rounded-2xl border border-border/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border text-rose-500 bg-rose-500/10 border-rose-500/20">
                      <Video className="h-4 w-4" />
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">{t('projectHomeCompany.createPromo')}</p>
                  <p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground/70">{t('projectHomeCompany.createPromoDesc')}</p>
                  {busyAction === 'createPromo' && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('common.running')}
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={generatePalette}
                  disabled={busyAction === 'generatePalette'}
                  className="group liquid-glass rounded-2xl border border-border/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border text-violet-500 bg-violet-500/10 border-violet-500/20">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">{t('projectHomeCompany.generatePalette')}</p>
                  <p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground/70">{t('projectHomeCompany.generatePaletteDesc')}</p>
                  {paletteResult && (
                    <div className="mt-3 p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-500">
                      {t('projectHomeCompany.paletteGenerated')}
                    </div>
                  )}
                  {busyAction === 'generatePalette' && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('common.running')}
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={findFonts}
                  disabled={busyAction === 'findFonts'}
                  className="group liquid-glass rounded-2xl border border-border/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border text-indigo-500 bg-indigo-500/10 border-indigo-500/20">
                      <Type className="h-4 w-4" />
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">{t('projectHomeCompany.findFonts')}</p>
                  <p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground/70">{t('projectHomeCompany.findFontsDesc')}</p>
                  {fontsResult && (
                    <div className="mt-3 p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-500">
                      {t('projectHomeCompany.fontsFound')}
                    </div>
                  )}
                  {busyAction === 'findFonts' && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('common.running')}
                    </div>
                  )}
                </button>
              </div>
            </section>

            {/* Standard Overview Cards */}
            <section className="mt-5">
              <div className="mb-3 flex items-center gap-2 px-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('projectHome.overview')}
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  { action: 'conversations', icon: MessageSquare, label: t('projectHome.conversations'), description: t('projectHome.conversationsDesc'), count: payload.counts.conversations, accent: 'text-sky-500 bg-sky-500/10 border-sky-500/20' },
                  { action: 'files', icon: FileText, label: t('projectHome.files'), description: t('projectHome.filesDesc'), count: payload.counts.files, accent: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
                  { action: 'research', icon: FlaskConical, label: t('projectHome.research'), description: t('projectHome.researchDesc'), count: payload.counts.research, accent: 'text-violet-500 bg-violet-500/10 border-violet-500/20' },
                  { action: 'memory', icon: Flame, label: t('projectHome.memory'), description: t('projectHome.memoryDesc'), count: payload.counts.memory, accent: 'text-rose-500 bg-rose-500/10 border-rose-500/20' },
                  { action: 'activity', icon: Sparkles, label: t('projectHome.recentActivity'), description: t('projectHome.recentActivityDesc'), count: recentActivity.length, accent: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
                ].map(({ action, icon: Icon, label, description, count, accent }) => (
                  <button
                    type="button"
                    key={action}
                    onClick={() => onOpenAction?.(action as CompanyHomeAction)}
                    className="group liquid-glass rounded-2xl border border-border/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${accent}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                    </div>
                    <p className="mt-4 text-sm font-semibold text-foreground">{label}</p>
                    <p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground/70">{description}</p>
                    <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{count}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/60">{t('projectHome.items')}</p>
                  </button>
                ))}
              </div>
            </section>

            {isEmpty ? (
              <motion.section
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="liquid-glass mt-5 overflow-hidden rounded-3xl border border-primary/15 bg-primary/[0.03] p-6 sm:p-8"
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-xl">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight">{t('projectHome.readyTitle')}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('projectHome.readyDesc')}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => void runNewChat()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {t('projectHome.startConversation')}
                    </button>
                    <button type="button" onClick={() => onOpenAction?.('files')} className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-3.5 py-2.5 text-xs font-medium transition hover:border-primary/30 hover:bg-primary/5">
                      <FileText className="h-3.5 w-3.5 text-amber-500" />
                      {t('projectHome.uploadFiles')}
                    </button>
                    <button type="button" onClick={() => onOpenAction?.('instructions')} className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-3.5 py-2.5 text-xs font-medium transition hover:border-primary/30 hover:bg-primary/5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      {t('projectHome.addInstructions')}
                    </button>
                  </div>
                </div>
              </motion.section>
            ) : (
              <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                <section className="liquid-glass rounded-3xl border border-border/40 p-5 sm:p-6">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{t('projectHome.recentConversations')}</h2>
                      <p className="mt-1 text-xs text-muted-foreground/70">{t('projectHome.recentConversationsDesc')}</p>
                    </div>
                    <MessageSquare className="h-5 w-5 text-primary/70" />
                  </div>
                  {payload.latest.conversations.length > 0 ? (
                    <div className="space-y-2">
                      {payload.latest.conversations.map((conversation) => (
                        <button
                          type="button"
                          key={conversation.id}
                          onClick={() => void continueConversation(conversation.id)}
                          className="group flex w-full items-center gap-3 rounded-2xl border border-transparent bg-secondary/35 px-3.5 py-3 text-left transition hover:border-primary/20 hover:bg-primary/5"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/70 text-primary/80">
                            <MessageSquare className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-foreground">{conversation.title}</span>
                            <span className="mt-1 block text-[10px] text-muted-foreground/60">{formatDate(conversation.updatedAt, locale)}</span>
                          </span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 transition group-hover:text-primary" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-2xl bg-secondary/30 px-4 py-6 text-center text-xs text-muted-foreground/70">{t('projectHome.noConversations')}</p>
                  )}
                </section>

                <section className="liquid-glass rounded-3xl border border-border/40 p-5 sm:p-6">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{t('projectHome.recentActivity')}</h2>
                      <p className="mt-1 text-xs text-muted-foreground/70">{t('projectHome.recentActivityDesc')}</p>
                    </div>
                    <Sparkles className="h-5 w-5 text-primary/70" />
                  </div>
                  {recentActivity.length > 0 ? (
                    <div className="space-y-4">
                      {recentActivity.slice(0, 6).map((item, index) => {
                        const labelKey = activityLabelKeys[item.type] ?? 'projectHome.activity.projectCreated';
                        return (
                          <div className="flex gap-3" key={`${item.id}-${index}`}>
                            <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full bg-primary/70 ring-4 ring-primary/10" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs text-foreground">
                                {t(labelKey)} <span className="font-medium">{item.description}</span>
                              </p>
                              <p className="mt-1 text-[10px] text-muted-foreground/60">{formatRelativeDate(item.createdAt, locale)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-2xl bg-secondary/30 px-4 py-6 text-center text-xs text-muted-foreground/70">{t('projectHome.noActivity')}</p>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ProjectHomeCompany;