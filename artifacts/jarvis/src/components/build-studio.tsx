import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bug, Camera, Check, ChevronDown, ChevronRight, Code2, Container, Database, Download, FilePlus2, Folder, FolderPlus, GitBranch, GitCommit, Globe, Hammer, History, LayoutTemplate, Loader2, Moon, MoreHorizontal, Package, Play, Plus, RefreshCw, Save, Search, Send, Sparkles, Square, Sun, Terminal, TestTube2, Trash2, Upload, X, Zap } from 'lucide-react';
import type { TerminalResult } from '@/types/widget';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/use-theme';
import CodeEditor from '@/components/code-editor';
import { ParticleSpherePreview } from '@/components/particle-sphere-preview';
import { BuildProgressPanel } from '@/components/build-progress-panel';
import { BuildPlanView, type PlanStep } from '@/components/build-plan-view';
import { BuildTranscript, type ToolCall } from '@/components/build-transcript';
import { BuildDiffPreview, type FileDiff } from '@/components/build-diff-preview';
import { BuildLivePreview, type ConsoleEntry } from '@/components/build-live-preview';
import { BuildProgressRing } from '@/components/build-progress-ring';
import { BuildToaster, useBuildToasts } from '@/components/build-toast';
import { BuildSkeleton, BuildSkeletonPlanView, BuildSkeletonTranscript, BuildSkeletonPreview } from '@/components/build-skeleton';
import { useBuildShortcuts, createDefaultShortcuts, formatShortcut } from '@/hooks/use-build-shortcuts';
import { BuildCommandPalette, createDefaultCommandPaletteItems, type CommandPaletteItem } from '@/components/build-command-palette';
import '@/lib/build-ui-theme.css';

interface WorkspaceFile { path: string; type: 'file' | 'dir'; size: number; }
interface SavedApp { id: string; name: string; description: string; metadata?: { fileCount?: number; envKeys?: string[]; previewPort?: number | null }; }
type StudioTab = 'editor' | 'terminal' | 'preview' | 'packages' | 'env' | 'git' | 'search' | 'quality' | 'history' | 'templates' | 'docker' | 'database' | 'api';
const TAB_ORDER: StudioTab[] = ['editor', 'terminal', 'preview', 'packages', 'env', 'git', 'search', 'quality', 'history', 'templates', 'docker', 'database', 'api'];
interface WizardQuestion { key: string; label: string; options?: string[]; }
interface FeatureInventoryItem { key: string; label: string; selected: boolean; }
interface ActivityBlock { id: string; icon: 'sparkles' | 'terminal' | 'camera' | 'check'; message: string; actionCount?: number; }
type BuildProgressStatus = 'working' | 'waiting' | 'done' | 'error' | 'cancelled';
interface BuildProgressItem { id: string; role: 'user' | 'jarvis'; message: string; status: BuildProgressStatus; createdAt: number; }
interface IterateResponse { ok?: boolean; done?: boolean; summary?: string; fixRequest?: string | null; deferred?: string[]; filesChanged?: string[]; passNumber?: number; error?: string; }
interface PreviewAgentEvent { type: 'inspect' | 'decision' | 'action' | 'error' | 'complete'; message: string; step?: number; }
interface PreviewAgentResponse { completed?: boolean; summary?: string; events?: PreviewAgentEvent[]; consoleErrors?: string[]; error?: string; }
interface PreviewScreenshot { url: string; dataUrl: string; }
interface PreviewScreenshots { desktop?: PreviewScreenshot; mobile?: PreviewScreenshot; }
interface BuildPlan { title: string; summary: string; steps: PlanStep[]; files: string[]; risks: string[]; }
interface PackageItem { name: string; version: string; description?: string; downloads?: number; url?: string; }
interface GitStatus { branch: string; ahead: number; behind: number; modified: string[]; staged: string[]; untracked: string[]; conflicted: string[]; }
interface TestFramework { key: string; name: string; language: string; runCommand: string; }
interface TestResult { framework: string; passed: number; failed: number; skipped: number; total: number; duration: number; output: string; }
interface SearchMatch { file: string; line: number; column: number; preview: string; match: string; }
interface ParsedDebugError { type: string; language: string; message: string; file?: string; line?: number; column?: number; stackTrace: string[]; context?: string; }
interface ErrorFix { title: string; description: string; code: string; confidence: number; }
interface HistorySnapshot { id: string; timestamp: string; label: string; description: string; fileCount: number; totalSize: number; trigger: string; }
interface TemplateItem { id: string; name: string; description: string; category: string; language: string; framework?: string; tags?: string[]; }
interface CommunityTemplate { id: string; name: string; description: string; owner: string; repository: string; url: string; stars: number; language: string; tags?: string[]; }
interface DockerContainer { id: string; image: string; name: string; status: string; ports?: string[]; }
interface DockerImage { id: string; repository: string; tag: string; size: string; }
interface DbColumn { name: string; type: string; nullable: boolean; primaryKey: boolean; }
interface DbTable { name: string; columns: DbColumn[]; rowCount: number; }
interface ApiEndpoint { method: string; path: string; description?: string; }

const waitMs = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const formatProgressTime = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const downloadTextFile = (path: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.split('/').pop() || 'jarvis-file.txt';
  anchor.click();
  URL.revokeObjectURL(url);
};


interface BuildStudioProps {
  open: boolean;
  onClose: () => void;
  title: string;
  initialCommands: TerminalResult[];
  onRefreshFiles?: () => void;
  /** Set via the "@Build <message>" chat shortcut: pre-fills the build prompt. */
  initialPrompt?: string | null;
  /** Increments each time the parent wants initialPrompt to auto-run a build. */
  runKey?: number;
}

/**
 * Mobile transcript bottom sheet — Phase 0 UI Unfuck.
 * Fixed bottom sheet with 50%/90% snap points, drag handle, swipe-to-dismiss.
 */
function TranscriptBottomSheet({
  toolCalls,
  open,
  snap,
  onSnapChange,
  onClose,
}: {
  toolCalls: ToolCall[];
  open: boolean;
  snap: 'peek' | 'expanded';
  onSnapChange: (snap: 'peek' | 'expanded') => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragCurrentY = useRef<number>(0);
  const [dragging, setDragging] = useState(false);

  const handleDragStart = (clientY: number) => {
    dragStartY.current = clientY;
    dragCurrentY.current = 0;
    setDragging(true);
  };

  const handleDragMove = (clientY: number) => {
    if (dragStartY.current === null) return;
    dragCurrentY.current = clientY - dragStartY.current;
    const sheet = sheetRef.current;
    if (sheet) {
      const clamped = Math.max(-200, Math.min(200, dragCurrentY.current));
      sheet.style.transform = `translateY(${clamped}px)`;
    }
  };

  const handleDragEnd = () => {
    if (dragStartY.current === null) return;
    setDragging(false);
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transform = '';

    const delta = dragCurrentY.current;
    if (delta < -60) {
      // Swipe up → expand
      onSnapChange('expanded');
    } else if (delta > 60) {
      // Swipe down → collapse to peek, or dismiss if already at peek
      if (snap === 'expanded') {
        onSnapChange('peek');
      } else {
        onClose();
      }
    } else if (snap === 'peek') {
      onSnapChange('expanded');
    } else {
      onSnapChange('peek');
    }
    dragStartY.current = null;
  };

  if (!open) return null;

  const height = snap === 'expanded' ? 'var(--build-sheet-expanded)' : 'var(--build-sheet-peek)';

  return (
    <div
      ref={sheetRef}
      className="fixed inset-x-0 bottom-0 z-[85] flex flex-col rounded-t-3xl border-t border-border bg-card shadow-2xl md:hidden"
      style={{
        height: `calc(${height} + var(--build-safe-bottom))`,
        paddingBottom: 'var(--build-safe-bottom)',
        transition: dragging ? 'none' : 'transform var(--build-transition-normal), height var(--build-transition-normal)',
        touchAction: 'none',
      }}
      role="dialog"
      aria-label={t('studio.build.transcriptTitle') || 'Transcript'}
    >
      {/* Drag handle */}
      <div
        className="flex shrink-0 cursor-grab touch-none items-center justify-center py-3 active:cursor-grabbing"
        onTouchStart={(e) => handleDragStart(e.touches[0].clientY)}
        onTouchMove={(e) => handleDragMove(e.touches[0].clientY)}
        onTouchEnd={handleDragEnd}
        onMouseDown={(e) => handleDragStart(e.clientY)}
        onMouseMove={(e) => dragging && handleDragMove(e.clientY)}
        onMouseUp={handleDragEnd}
        onMouseLeave={() => dragging && handleDragEnd()}
        aria-label="Drag to resize transcript"
      >
        <span
          className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
          style={{ height: 'var(--build-sheet-handle-height)' }}
        />
      </div>

      {/* Header with snap toggle */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t('studio.build.transcriptTitle') || 'Transcript'}
        </span>
        <button
          type="button"
          onClick={() => onSnapChange(snap === 'expanded' ? 'peek' : 'expanded')}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          style={{ minHeight: 'var(--build-touch-target)', minWidth: 'var(--build-touch-target)' }}
          aria-label={snap === 'expanded' ? 'Collapse transcript' : 'Expand transcript'}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${snap === 'expanded' ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Transcript feed */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <BuildTranscript toolCalls={toolCalls} autoScroll />
      </div>
    </div>
  );
}

const languageFor = (path: string) => {
  if (/\.(html?|vue|svelte)$/i.test(path)) return 'HTML';
  if (/\.tsx?$/i.test(path)) return 'TypeScript';
  if (/\.jsx?$/i.test(path)) return 'JavaScript';
  if (/\.(css|scss|less)$/i.test(path)) return 'CSS';
  if (/\.json$/i.test(path)) return 'JSON';
  if (/\.(md|markdown)$/i.test(path)) return 'Markdown';
  if (/\.py$/i.test(path)) return 'Python';
  if (/\.go$/i.test(path)) return 'Go';
  if (/\.rs$/i.test(path)) return 'Rust';
  if (/\.java$/i.test(path)) return 'Java';
  if (/\.(c|h|cpp|hpp|cc|cxx)$/i.test(path)) return 'C/C++';
  if (/\.php$/i.test(path)) return 'PHP';
  if (/\.sql$/i.test(path)) return 'SQL';
  if (/\.(xml|svg)$/i.test(path)) return 'XML';
  return 'Text';
};
const apiJson = async <T,>(url: string, init?: RequestInit): Promise<{ response: Response; data: T }> => {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T;
  return { response, data };
};

export function BuildStudio({ open, onClose, title, initialCommands, onRefreshFiles, initialPrompt, runKey }: BuildStudioProps) {
  const { t } = useI18n();
  const { resolved: resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [workspaceId] = useState(() => `build-${crypto.randomUUID()}`);
  const [tab, setTab] = useState<StudioTab>('editor');
  const [moreOpen, setMoreOpen] = useState(false);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalLines, setTerminalLines] = useState<TerminalResult[]>(initialCommands);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [scaffoldPrompt, setScaffoldPrompt] = useState('');
  const [env, setEnv] = useState<Record<string, string>>({});
  const [envDraft, setEnvDraft] = useState('');
  const [previewCommand, setPreviewCommand] = useState('python3 -m http.server ${PORT}');
  const [previewPort, setPreviewPort] = useState(4173);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOutput, setPreviewOutput] = useState('');
  const [savedApps, setSavedApps] = useState<SavedApp[]>([]);
  const [saveName, setSaveName] = useState('');
  const [notice, setNotice] = useState<ReactNode | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const wizardWasOpenRef = useRef(false);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardPrompt, setWizardPrompt] = useState('');
  const [wizardQuestions, setWizardQuestions] = useState<WizardQuestion[]>([]);
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const scaffoldInputRef = useRef<HTMLInputElement | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastAnswers, setLastAnswers] = useState<Record<string, string>>({});
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [mobileScreenshot, setMobileScreenshot] = useState<string | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [featureInventory, setFeatureInventory] = useState<FeatureInventoryItem[]>([]);
  const [activities, setActivities] = useState<ActivityBlock[]>([]);
  const [completion, setCompletion] = useState<{ summary: string; deferred: string[]; files: string[] } | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressStatus, setProgressStatus] = useState<BuildProgressStatus>('done');
  const [progressItems, setProgressItems] = useState<BuildProgressItem[]>([]);
  const progressItemsRef = useRef<BuildProgressItem[]>([]);
  const [progressStartedAt, setProgressStartedAt] = useState<number | null>(null);

  // Transcript / tool calls (for bottom sheet on mobile)
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [transcriptSheetOpen, setTranscriptSheetOpen] = useState(false);
  const [transcriptSheetSnap, setTranscriptSheetSnap] = useState<'peek' | 'expanded'>('peek');
  const [progressClock, setProgressClock] = useState(() => Date.now());
  const buildAbortRef = useRef<AbortController | null>(null);
  const buildCancelRequestedRef = useRef(false);
  const buildCancelRef = useRef<(() => void) | null>(null);
  const progressStartedAtRef = useRef<number | null>(null);
  const [deepSleep, setDeepSleep] = useState(false);
  const [afkMode, setAfkMode] = useState(false);
  const [wakeSensitivity, setWakeSensitivity] = useState<'any' | 'keypress'>('any');
  const [sleepSummary, setSleepSummary] = useState<string | null>(null);
  const [autoFixPass, setAutoFixPass] = useState(0);
  const [agentGoal, setAgentGoal] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentEvents, setAgentEvents] = useState<PreviewAgentEvent[]>([]);
  const [agentConsoleErrors, setAgentConsoleErrors] = useState<string[]>([]);
  const [extraSystemPrompt, setExtraSystemPrompt] = useState('');
  const [packageManager, setPackageManager] = useState<string | null>(null);
  const [installedPackages, setInstalledPackages] = useState<PackageItem[]>([]);
  const [packageQuery, setPackageQuery] = useState('');
  const [packageResults, setPackageResults] = useState<PackageItem[]>([]);
  const [packageBusy, setPackageBusy] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [gitDiff, setGitDiff] = useState('');
  const [gitDiffOpen, setGitDiffOpen] = useState(false);

  // Phase 2.1: Diff preview modal for scaffold confirmation
  const [diffPreviewOpen, setDiffPreviewOpen] = useState(false);
  const [diffPreviewDiffs, setDiffPreviewDiffs] = useState<FileDiff[]>([]);
  const [diffPreviewFiles, setDiffPreviewFiles] = useState<Record<string, string>>({});
  const [diffPreviewPending, setDiffPreviewPending] = useState<{
    prompt: string;
    answers: Record<string, string>;
    approvedPlan: BuildPlan | null;
  } | null>(null);
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [gitCurrentBranch, setGitCurrentBranch] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCase, setSearchCase] = useState(false);

  // Phase 0: Command palette, shortcuts, skeleton loading states
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteItems, setCommandPaletteItems] = useState<CommandPaletteItem[]>([]);
  const { toasts, dismiss: dismissToast } = useBuildToasts();
  const [searchHidden, setSearchHidden] = useState(false);
  const [frameworks, setFrameworks] = useState<TestFramework[]>([]);
  const [selectedFramework, setSelectedFramework] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [debugError, setDebugError] = useState<ParsedDebugError | null>(null);
  const [debugFixes, setDebugFixes] = useState<ErrorFix[]>([]);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugOutput, setDebugOutput] = useState('');
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [communityTemplates, setCommunityTemplates] = useState<CommunityTemplate[]>([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<{ available: boolean; version?: string } | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [dockerImages, setDockerImages] = useState<DockerImage[]>([]);
  const [dbConnectionId, setDbConnectionId] = useState<string | null>(null);
  const [dbTables, setDbTables] = useState<DbTable[]>([]);
  const [dbRows, setDbRows] = useState<Record<string, unknown>[]>([]);
  const [dbQuery, setDbQuery] = useState('');
  const [dbBusy, setDbBusy] = useState(false);
  const [apiFramework, setApiFramework] = useState<string | null>(null);
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);
  const [apiBaseUrl, setApiBaseUrl] = useState('http://localhost:4173');
  const [apiMethod, setApiMethod] = useState('GET');
  const [apiEndpointPath, setApiEndpointPath] = useState('/');
  const [apiBody, setApiBody] = useState('');
  const [apiBusy, setApiBusy] = useState(false);
  const [apiResponse, setApiResponse] = useState('');
  const stopPipelineRef = useRef(false);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number } | null>(null);
  const [hotReload, setHotReload] = useState(false);
  const hotReloadRef = useRef<EventSource | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyFiles, setHistoryFiles] = useState<string[]>([]);
  const [selectedHistoryFile, setSelectedHistoryFile] = useState<string | null>(null);
  const [historyFileContent, setHistoryFileContent] = useState('');
  const [walkthroughBusy, setWalkthroughBusy] = useState(false);
  const [walkthroughErrors, setWalkthroughErrors] = useState<string[]>([]);
  const [walkthroughReportPath, setWalkthroughReportPath] = useState<string | null>(null);
  const [walkthroughVisible, setWalkthroughVisible] = useState(false);

  const addActivity = useCallback((message: string, icon: ActivityBlock['icon'] = 'sparkles', actionCount = 1) => {
    setActivities((current) => [...current, { id: crypto.randomUUID(), icon, message, actionCount }].slice(-12));
  }, []);
  const showProgressPanel = useCallback((items: BuildProgressItem[], status: BuildProgressStatus, startedAt: number | null) => {
    setProgressOpen(true);
    setNotice(<><span className="sr-only">{t('studio.build.progressTitle')}</span><BuildProgressPanel open items={items} status={status} startedAt={startedAt} clock={Date.now()} onOpen={() => setProgressOpen(true)} onClose={() => { setProgressOpen(false); setNotice(null); }} onCancel={() => buildCancelRef.current?.()} /></>);
  }, [t]);
  const startProgress = useCallback((prompt: string) => {
    const now = Date.now();
    buildCancelRequestedRef.current = false;
    stopPipelineRef.current = false;
    progressStartedAtRef.current = now;
    setProgressStartedAt(now);
    setProgressStatus('working');
    const items = [{ id: crypto.randomUUID(), role: 'user' as const, message: prompt, status: 'done' as const, createdAt: now }];
    progressItemsRef.current = items;
    setProgressItems(items);
    showProgressPanel(items, 'working', now);
    setCompletion(null);
  }, [showProgressPanel]);
  const addProgressMessage = useCallback((message: string, status: BuildProgressStatus = 'working') => {
    const next = [...progressItemsRef.current, { id: crypto.randomUUID(), role: 'jarvis' as const, message, status, createdAt: Date.now() }].slice(-40);
    progressItemsRef.current = next;
    setProgressItems(next);
    showProgressPanel(next, status, progressStartedAtRef.current);
  }, [showProgressPanel]);
  const setProgressResult = useCallback((message: string, status: Extract<BuildProgressStatus, 'done' | 'error' | 'cancelled'> = 'done') => {
    addProgressMessage(message, status);
    setProgressStatus(status);
    setProgressClock(Date.now());
  }, [addProgressMessage]);
  const beginBuildRequest = useCallback(() => {
    buildAbortRef.current?.abort();
    const controller = new AbortController();
    buildAbortRef.current = controller;
    buildCancelRequestedRef.current = false;
    return controller;
  }, []);
  const releaseBuildRequest = useCallback((controller: AbortController) => {
    if (buildAbortRef.current === controller) buildAbortRef.current = null;
  }, []);
  const wasBuildCancelled = (error: unknown) => buildCancelRequestedRef.current || (error instanceof Error && error.name === 'AbortError');
  const cancelBuild = useCallback(() => {
    if (progressStatus !== 'working' && progressStatus !== 'waiting') return;
    buildCancelRequestedRef.current = true;
    stopPipelineRef.current = true;
    buildAbortRef.current?.abort();
    setBusy(false);
    setWizardBusy(false);
    setPlanBusy(false);
    setAutoFixPass(0);
    setWizardOpen(false);
    setPlan(null);
    setProgressStatus('cancelled');
    addProgressMessage(t('studio.build.progressCancelled'), 'cancelled');
  }, [addProgressMessage, progressStatus, t]);
  buildCancelRef.current = cancelBuild;

  useEffect(() => {
    if (!progressOpen || (progressStatus !== 'working' && progressStatus !== 'waiting')) return;
    const timer = window.setInterval(() => setProgressClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [progressOpen, progressStatus]);
  useEffect(() => {
    const wasOpen = wizardWasOpenRef.current;
    wizardWasOpenRef.current = wizardOpen;
    if (!wasOpen || wizardOpen || progressStatus !== 'waiting' || plan) return;
    setProgressStatus('cancelled');
    addProgressMessage(t('studio.build.progressCancelled'), 'cancelled');
  }, [addProgressMessage, plan, progressStatus, t, wizardOpen]);
  const visibleFiles = useMemo(() => files.filter((file) => {
    const parts = file.path.replace(/\/$/, '').split('/');
    return parts.slice(0, -1).every((_, index) => expanded.has(parts.slice(0, index + 1).join('/')));
  }), [expanded, files]);

  const loadFiles = useCallback(async () => {
    const { response, data } = await apiJson<{ files?: WorkspaceFile[] }>(`/api/jarvis/workspace?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!response.ok) return;
    setFiles(data.files ?? []);
    onRefreshFiles?.();
  }, [onRefreshFiles, workspaceId]);

  const loadSavedApps = useCallback(async () => {
    const { response, data } = await apiJson<SavedApp[]>('/api/jarvis/build/apps');
    if (response.ok) setSavedApps(data);
  }, []);

  const loadEnvironment = useCallback(async () => {
    const { response, data } = await apiJson<{ env?: Record<string, string> }>(`/api/jarvis/build/env?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok) {
      const next = data.env ?? {};
      setEnv(next);
      setEnvDraft(Object.entries(next).map(([key, value]) => `${key}=${value}`).join('\n'));
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    void loadFiles(); void loadSavedApps(); void loadEnvironment(); void loadPackages(); void refreshGit(); void loadQuality();
    return () => { streamRef.current?.close(); streamRef.current = null; hotReloadRef.current?.close(); hotReloadRef.current = null; };
  }, [loadEnvironment, loadFiles, loadSavedApps, open]);

  useEffect(() => {
    if (!open) return;
    if (tab === 'packages') void loadPackages();
    if (tab === 'git') { void refreshGit(); void loadGitBranches(); }
    if (tab === 'quality') void loadQuality();
    if (tab === 'history') void loadSnapshots();
    if (tab === 'templates') { void loadTemplates(); void loadCommunityTemplates(); }
    if (tab === 'docker') void refreshDocker();
    if (tab === 'database') void detectDatabases();
    if (tab === 'api') void loadApiExplorer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, open]);

  const loadPackages = useCallback(async () => {
    const { response, data } = await apiJson<{ packages?: PackageItem[]; manager?: string | null }>(`/api/jarvis/packages?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok) { setInstalledPackages(data.packages ?? []); setPackageManager(data.manager ?? null); }
  }, [workspaceId]);

  const searchPackages = async () => {
    if (!packageQuery.trim()) return;
    setPackageBusy(true);
    const manager = packageManager ?? 'npm';
    const { response, data } = await apiJson<{ results?: PackageItem[]; error?: string }>(`/api/jarvis/packages/search?q=${encodeURIComponent(packageQuery.trim())}&manager=${encodeURIComponent(manager)}`);
    setPackageBusy(false);
    if (response.ok) setPackageResults(data.results ?? []); else setNotice(data.error ?? 'Package search failed');
  };

  const installPackage = async (pkg: PackageItem) => {
    setPackageBusy(true);
    const { response, data } = await apiJson<{ error?: string }>('/api/jarvis/packages/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, package: pkg.name, version: pkg.version || undefined, manager: packageManager ?? 'npm' }) });
    setPackageBusy(false);
    setNotice(response.ok ? `${pkg.name} installed` : (data.error ?? 'Package installation failed'));
    if (response.ok) { await loadPackages(); setPackageResults((current) => current.filter((item) => item.name !== pkg.name)); }
  };

  const refreshGit = useCallback(async () => {
    const { response, data } = await apiJson<GitStatus | { error?: string }>(`/api/jarvis/git/status?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok && 'branch' in data) setGitStatus(data);
  }, [workspaceId]);

  const gitAction = async (url: string, body: Record<string, unknown>) => {
    setGitBusy(true);
    const { response, data } = await apiJson<{ status?: GitStatus; error?: string }>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, ...body }) });
    setGitBusy(false);
    setNotice(response.ok ? 'Git workspace updated' : (data.error ?? 'Git action failed'));
    if (response.ok && data.status) setGitStatus(data.status); else await refreshGit();
  };

  const loadGitDiff = async (file: string) => {
    const { response, data } = await apiJson<{ diff?: string; error?: string }>(`/api/jarvis/git/diff?workspaceId=${encodeURIComponent(workspaceId)}&file=${encodeURIComponent(file)}`);
    setGitDiff(response.ok ? (data.diff ?? '') : (data.error ?? 'No diff available'));
  };

  const commitChanges = async () => {
    if (!commitMessage.trim()) return;
    setGitBusy(true);
    const { response, data } = await apiJson<{ error?: string }>('/api/jarvis/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, message: commitMessage }) });
    setGitBusy(false);
    if (response.ok) { setCommitMessage(''); setNotice('Committed'); await refreshGit(); } else setNotice(data.error ?? 'Commit failed');
  };

  const loadGitBranches = async () => {
    const { response, data } = await apiJson<{ branches?: string[]; current?: string | null }>(`/api/jarvis/git/branches?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok) { setGitBranches(data.branches ?? []); setGitCurrentBranch(data.current ?? null); }
  };

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    await gitAction('/api/jarvis/git/branch', { branch: newBranchName.trim(), action: 'create' });
    setNewBranchName(''); await loadGitBranches();
  };

  const switchBranch = async (branch: string) => { await gitAction('/api/jarvis/git/branch', { branch, action: 'switch' }); await loadGitBranches(); };
  const initGit = async () => { await runCommand('git init && git config user.email jarvis@local && git config user.name Jarvis'); await refreshGit(); await loadGitBranches(); };

  const runWorkspaceSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchBusy(true);
    const { response, data } = await apiJson<{ matches?: SearchMatch[]; error?: string }>(`/api/jarvis/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(searchQuery.trim())}&max=500&regex=${searchRegex}&case=${searchCase}&hidden=${searchHidden}`);
    setSearchBusy(false);
    if (response.ok) setSearchResults(data.matches ?? []); else setNotice(data.error ?? 'Search failed');
  };

  const replaceWorkspaceText = async () => {
    if (!searchQuery.trim()) return;
    setSearchBusy(true);
    const { response, data } = await apiJson<{ totalReplaced?: number; error?: string }>('/api/jarvis/search/replace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, query: searchQuery, replacement: replaceText, regex: searchRegex, case: searchCase, files: [...new Set(searchResults.map((match) => match.file))] }) });
    setSearchBusy(false);
    setNotice(response.ok ? `Replaced ${data.totalReplaced ?? 0} matches` : (data.error ?? 'Replace failed'));
    if (response.ok) { await loadFiles(); await runWorkspaceSearch(); }
  };

  const loadQuality = useCallback(async () => {
    const { response, data } = await apiJson<{ frameworks?: TestFramework[] }>(`/api/jarvis/test/frameworks?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok) { setFrameworks(data.frameworks ?? []); setSelectedFramework((current) => current || data.frameworks?.[0]?.key || ''); }
  }, [workspaceId]);

  const runTests = async () => {
    if (!selectedFramework) return;
    setQualityBusy(true);
    const { response, data } = await apiJson<{ result?: TestResult; error?: string }>('/api/jarvis/test/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, framework: selectedFramework }) });
    setQualityBusy(false);
    if (response.ok) setTestResult(data.result ?? null); else setNotice(data.error ?? 'Tests failed to run');
  };

  const analyzePreviewErrors = async () => {
    if (!previewOutput.trim()) return;
    const { response, data } = await apiJson<{ error?: ParsedDebugError | string }>('/api/jarvis/debug/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ output: previewOutput }) });
    setDebugFixes([]);
    if (response.ok && data.error && typeof data.error === 'object') {
      setDebugError(data.error);
      setDebugOutput(`${data.error.message}${data.error.file ? `\nFile: ${data.error.file}` : ''}${data.error.line ? `:${data.error.line}` : ''}${data.error.language ? `\nLanguage: ${data.error.language}` : ''}`);
    } else if (response.ok) {
      setDebugError(null);
      setDebugOutput('No structured error found — check the terminal output below.');
    } else {
      setDebugError(null);
      setDebugOutput(typeof data.error === 'string' ? data.error : 'No structured error found');
    }
  };

  const suggestFixes = async () => {
    if (!debugError || debugBusy) return;
    setDebugBusy(true);
    const { response, data } = await apiJson<{ fixes?: ErrorFix[]; error?: string }>('/api/jarvis/debug/suggest-fixes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: debugError }) });
    setDebugBusy(false);
    if (response.ok) setDebugFixes(data.fixes ?? []);
    else setNotice(data.error ?? 'Could not generate fix suggestions');
  };

  const loadSnapshots = useCallback(async () => {
    const { response, data } = await apiJson<{ snapshots?: HistorySnapshot[] }>(`/api/jarvis/history/snapshots?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok) setSnapshots(data.snapshots ?? []);
  }, [workspaceId]);

  const createSnapshot = async () => {
    setHistoryBusy(true);
    const label = window.prompt('Snapshot label') ?? `Snapshot ${new Date().toLocaleTimeString()}`;
    const { response } = await apiJson('/api/jarvis/history/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, label, description: 'Manual snapshot from Jarvis Build' }) });
    setHistoryBusy(false);
    if (response.ok) { await loadSnapshots(); setNotice('Snapshot created'); }
  };

  const selectSnapshot = async (snapshot: HistorySnapshot) => {
    setSelectedHistoryId(snapshot.id);
    setSelectedHistoryFile(null);
    setHistoryFileContent('');
    const { response, data } = await apiJson<{ snapshot?: { files?: string[] }; error?: string }>(`/api/jarvis/history/snapshots/${encodeURIComponent(snapshot.id)}?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok) setHistoryFiles(data.snapshot?.files ?? []);
    else setNotice(data.error ?? 'Could not load snapshot details');
  };

  const previewSnapshotFile = async (filePath: string) => {
    if (!selectedHistoryId) return;
    const { response, data } = await apiJson<{ content?: string; error?: string }>(`/api/jarvis/history/snapshots/${encodeURIComponent(selectedHistoryId)}/file?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(filePath)}`);
    if (response.ok) { setSelectedHistoryFile(filePath); setHistoryFileContent(data.content ?? ''); }
    else setNotice(data.error ?? 'Could not read snapshot file');
  };

  const restoreSnapshot = async (id: string) => {
    if (!window.confirm('Restore the workspace from this snapshot? The current state is kept as a backup snapshot first.')) return;
    const { response, data } = await apiJson<{ message?: string; error?: string }>('/api/jarvis/history/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, snapshotId: id }) });
    if (response.ok) { await loadFiles(); setNotice(data.message ?? 'Workspace restored'); } else setNotice(data.error ?? 'Restore failed');
  };

  const loadTemplates = useCallback(async () => {
    const { response, data } = await apiJson<{ templates?: TemplateItem[] }>('/api/jarvis/templates/list');
    if (response.ok) setTemplates(data.templates ?? []);
  }, []);

  const loadCommunityTemplates = useCallback(async () => {
    const { response, data } = await apiJson<{ templates?: CommunityTemplate[] }>('/api/jarvis/community-templates/trending?limit=12');
    if (response.ok) setCommunityTemplates(data.templates ?? []);
  }, []);

  const applyTemplate = async (id: string) => {
    setTemplateBusy(true);
    const { response } = await apiJson('/api/jarvis/templates/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: id, workspaceId, projectName: 'app' }) });
    setTemplateBusy(false);
    if (response.ok) { setNotice('Template applied — files written to the workspace'); await loadFiles(); }
  };

  const refreshDocker = useCallback(async () => {
    const { response, data } = await apiJson<{ available?: boolean; version?: string }>('/api/jarvis/docker/status');
    if (response.ok) setDockerStatus({ available: Boolean(data.available), version: data.version });
    if (response.ok && data.available) {
      const containersRes = await apiJson<{ containers?: DockerContainer[] }>('/api/jarvis/docker/containers');
      if (containersRes.response.ok) setContainers(containersRes.data.containers ?? []);
      const imagesRes = await apiJson<{ images?: DockerImage[] }>('/api/jarvis/docker/images');
      if (imagesRes.response.ok) setDockerImages(imagesRes.data.images ?? []);
    }
  }, []);

  const stopContainer = async (id: string) => { await fetch('/api/jarvis/docker/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ containerId: id }) }); await refreshDocker(); };

  const detectDatabases = useCallback(async () => {
    const { response, data } = await apiJson<{ databases?: string[] }>(`/api/jarvis/database/detect?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!response.ok || !data.databases?.length) { setDbTables([]); setDbRows([]); setDbConnectionId(null); setNotice('No SQLite databases found in the workspace'); return; }
    const conn = await apiJson<{ connectionId?: string; error?: string }>('/api/jarvis/database/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'sqlite', path: data.databases[0] }) });
    if (!conn.response.ok || !conn.data.connectionId) { setNotice(conn.data.error ?? 'Could not connect to database'); return; }
    setDbConnectionId(conn.data.connectionId);
    const schema = await apiJson<{ schema?: DbTable[] }>(`/api/jarvis/database/${conn.data.connectionId}/schema`);
    if (schema.response.ok) setDbTables(schema.data.schema ?? []);
  }, [workspaceId]);

  const browseTable = async (name: string) => {
    if (!dbConnectionId) return;
    const { response, data } = await apiJson<{ rows?: Record<string, unknown>[] }>(`/api/jarvis/database/${dbConnectionId}/table/${encodeURIComponent(name)}`);
    if (response.ok) setDbRows(data.rows ?? []);
  };

  const runDbQuery = async () => {
    if (!dbConnectionId || !dbQuery.trim()) return;
    setDbBusy(true);
    const { response, data } = await apiJson<{ results?: Record<string, unknown>[]; error?: string }>(`/api/jarvis/database/${dbConnectionId}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: dbQuery }) });
    setDbBusy(false);
    if (response.ok) setDbRows(data.results ?? []); else setNotice(data.error ?? 'Query failed');
  };

  const loadApiExplorer = useCallback(async () => {
    const { response, data } = await apiJson<{ framework?: string | null; endpoints?: ApiEndpoint[] }>(`/api/jarvis/api-explorer/endpoints?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (response.ok) { setApiFramework(data.framework ?? null); setApiEndpoints(data.endpoints ?? []); }
  }, [workspaceId]);

  const sendApiRequest = async () => {
    setApiBusy(true);
    let body: unknown;
    try { body = apiBody.trim() ? JSON.parse(apiBody) : undefined; } catch { setApiBusy(false); setApiResponse('Invalid JSON body'); return; }
    const { response, data } = await apiJson<{ response?: unknown; error?: string }>('/api/jarvis/api-explorer/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: apiBaseUrl, method: apiMethod, endpoint: apiEndpointPath, headers: {}, body }) });
    setApiBusy(false);
    setApiResponse(response.ok ? JSON.stringify(data.response ?? '', null, 2) : (data.error ?? 'Request failed'));
  };

  const openFile = async (path: string) => {
    const { response, data } = await apiJson<{ content?: string }>(`/api/jarvis/workspace?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`);
    if (!response.ok) return;
    setSelectedPath(path); setContent(data.content ?? ''); setDirty(false); setTab('editor');
    setOpenPaths((current) => current.includes(path) ? current : [...current, path]);
  };

  const saveFile = async () => {
    if (!selectedPath) return;
    setBusy(true);
    const { response } = await apiJson('/api/jarvis/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, path: selectedPath, content }) });
    setBusy(false); setNotice(response.ok ? 'File saved' : 'Could not save file');
    if (response.ok) { setDirty(false); void loadFiles(); }
  };

  const runCommand = async (command = terminalInput) => {
    const trimmed = command.trim();
    if (!trimmed || terminalRunning) return;
    setTerminalInput(''); setTerminalRunning(true); setTab('terminal');
    try {
      const { response, data } = await apiJson<TerminalResult & { stdout?: string; stderr?: string; timedOut?: boolean; error?: string }>('/api/jarvis/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, sessionId: 'studio', command: trimmed }) });
      const output = data.output ?? ([data.stdout, data.stderr].filter(Boolean).join('\n') || data.error || (data.timedOut ? 'Command timed out' : !response.ok ? 'Command failed' : ''));
      setTerminalLines((current) => [...current, { command: trimmed, exitCode: data.exitCode ?? (response.ok ? 0 : 1), output }]);
      await loadFiles();
    } finally { setTerminalRunning(false); }
  };

  const startStreamingCommand = async () => {
    const command = terminalInput.trim();
    if (!command || terminalRunning) return;
    setTerminalInput(''); setTerminalRunning(true); setTab('terminal');
    const { response, data } = await apiJson<{ id?: string; error?: string }>('/api/jarvis/terminal/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, sessionId: 'studio-live', command }) });
    if (!response.ok || !data.id) { setNotice(data.error ?? 'Could not start terminal'); setTerminalRunning(false); return; }
    setTerminalId(data.id);
    const stream = new EventSource(`/api/jarvis/terminal/stream?id=${encodeURIComponent(data.id)}`);
    streamRef.current = stream;
    let output = '';
    stream.onmessage = (event) => {
      const next = JSON.parse(event.data) as { type: string; data?: string; exitCode?: number };
      if (next.type === 'snapshot' || next.type === 'output') { output += next.data ?? ''; setTerminalLines((current) => [...current.filter((line) => line.command !== command), { command, exitCode: null as unknown as number, output }]); }
      if (next.type === 'exit') { setTerminalLines((current) => [...current.filter((line) => line.command !== command), { command, exitCode: next.exitCode ?? 1, output }]); setTerminalRunning(false); setTerminalId(null); stream.close(); streamRef.current = null; void loadFiles(); }
    };
    stream.onerror = () => { setTerminalRunning(false); stream.close(); streamRef.current = null; };
  };

  const stopTerminal = async () => {
    if (!terminalId) return;
    await fetch('/api/jarvis/terminal/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: terminalId }) });
    streamRef.current?.close(); streamRef.current = null; setTerminalRunning(false); setTerminalId(null);
  };

  const createFile = async () => { const name = window.prompt(t('studio.build.newFile')); if (name) { await fetch('/api/jarvis/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, path: name, content: '' }) }); void loadFiles(); } };
  const createFolder = async () => { const name = window.prompt('Folder path'); if (name) { await fetch('/api/jarvis/workspace/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, path: name }) }); void loadFiles(); } };
  const renamePath = async (path: string) => { const next = window.prompt('Rename to', path.replace(/\/$/, '')); if (next && next !== path.replace(/\/$/, '')) { await fetch('/api/jarvis/workspace', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, from: path, to: next }) }); void loadFiles(); } };
  const deletePath = async (path: string) => { if (window.confirm(`Delete ${path}?`)) { await fetch(`/api/jarvis/workspace?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`, { method: 'DELETE' }); if (selectedPath === path) { setSelectedPath(null); setContent(''); } void loadFiles(); } };

  // Phase 2.1: Helpers for diff preview parsing
  const parseDiffHunks = (diffText: string): FileDiff['hunks'] => {
    const hunks: FileDiff['hunks'] = [];
    const lines = diffText.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('@@ ')) {
        const match = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match) {
          const oldStart = parseInt(match[1], 10);
          const oldLines = match[2] ? parseInt(match[2], 10) : 1;
          const newStart = parseInt(match[3], 10);
          const newLines = match[4] ? parseInt(match[4], 10) : 1;
          const hunkLines: FileDiff['hunks'][0]['lines'] = [];
          let oldLineNum = oldStart;
          let newLineNum = newStart;
          let j = i + 1;
          while (j < lines.length && !lines[j].startsWith('@@ ')) {
            const l = lines[j];
            if (l.startsWith('+')) {
              hunkLines.push({ type: 'add', newLineNumber: newLineNum++, content: l.slice(1) });
            } else if (l.startsWith('-')) {
              hunkLines.push({ type: 'remove', oldLineNumber: oldLineNum++, content: l.slice(1) });
            } else {
              hunkLines.push({ type: 'context', oldLineNumber: oldLineNum, newLineNumber: newLineNum, content: l.slice(1) });
              oldLineNum++;
              newLineNum++;
            }
            j++;
          }
          hunks.push({ oldStart, oldLines, newStart, newLines, lines: hunkLines });
          i = j - 1;
        }
      }
      i++;
    }
    return hunks;
  };

  const countAdditions = (diffText: string): number => diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const countDeletions = (diffText: string): number => diffText.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length;

  const writeScaffoldFiles = async (files: Record<string, string>): Promise<string[]> => {
    const createdFiles = Object.keys(files);
    for (const [relPath, content] of Object.entries(files)) {
      await fetch('/api/jarvis/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, path: relPath, content }) });
    }
    return createdFiles;
  };

  const doScaffold = async (prompt: string, answers: Record<string, string>, feedbackText: string | null, approvedPlan: BuildPlan | null = plan) => {
    const controller = beginBuildRequest();
    setBusy(true);
    setCompletion(null);
    setProgressStatus('working');
    addActivity(feedbackText ? t('studio.build.activityApplying') : t('studio.build.activityScaffolding'), 'sparkles', 2);
    addProgressMessage(feedbackText ? t('studio.build.progressApplyingChanges') : t('studio.build.progressScaffolding'));
    try {
      // Phase 2.1: Generate in dry-run mode so we can preview the diff before writing.
      const { response, data } = await apiJson<{ files?: Record<string, string>; previewCommand?: string; error?: string }>('/api/jarvis/build/scaffold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, prompt, answers, feedback: feedbackText, extraSystemPrompt, plan: approvedPlan, dryRun: true }), signal: controller.signal });
      if (!response.ok) {
        const message = data.error ?? t('studio.build.scaffoldFailed');
        addActivity(t('studio.build.activityScaffoldFailed'), 'check', 1);
        setCompletion({ summary: message, deferred: [], files: [] });
        setProgressResult(message, 'error');
        return;
      }
      const proposedFiles = data.files ?? {};
      addProgressMessage(t('studio.build.progressFilesGenerated', { n: Object.keys(proposedFiles).length }));
      setScaffoldPrompt(''); setLastPrompt(prompt); setLastAnswers(answers); setFeedback(''); setPlan(null);
      if (data.previewCommand) setPreviewCommand(data.previewCommand);

      // Fetch unified diff for the proposed files.
      const diffRes = await apiJson<{ diffs?: Array<{ filePath: string; diff: string; oldContent: string; newContent: string }> }>('/api/jarvis/build/diff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, files: proposedFiles }), signal: controller.signal });
      if (diffRes.response.ok && (diffRes.data.diffs ?? []).length > 0) {
        const fileDiffs: FileDiff[] = diffRes.data.diffs!.map((d) => ({
          filePath: d.filePath,
          isNew: d.oldContent.length === 0,
          isDeleted: d.newContent.length === 0,
          isBinary: false,
          hunks: parseDiffHunks(d.diff),
          additions: countAdditions(d.diff),
          deletions: countDeletions(d.diff),
        }));
        setDiffPreviewDiffs(fileDiffs);
        setDiffPreviewFiles(proposedFiles);
        setDiffPreviewPending({ prompt, answers, approvedPlan });
        setDiffPreviewOpen(true);
        addActivity(t('studio.build.activityDiffPreview'), 'terminal', fileDiffs.length);
        return; // wait for user to Apply/Reject via modal
      }

      // No diff available — write directly and continue.
      const createdFiles = await writeScaffoldFiles(proposedFiles);
      addProgressMessage(t('studio.build.progressFilesWritten', { n: createdFiles.length }));
      await loadFiles();
      let allFiles = [...createdFiles];
      if (approvedPlan?.steps?.length) {
        addProgressMessage(t('studio.build.progressExecutingPlan', { n: approvedPlan.steps.length }));
        const planFiles = await executePlan(prompt, answers, approvedPlan, controller.signal);
        allFiles = [...new Set([...allFiles, ...planFiles])];
      }
      await runAutoPipeline(prompt, answers, allFiles, approvedPlan, controller.signal);
    } catch (error) {
      if (!wasBuildCancelled(error)) {
        const message = t('studio.build.scaffoldFailed');
        addActivity(t('studio.build.activityScaffoldFailed'), 'check', 1);
        setCompletion({ summary: message, deferred: [], files: [] });
        setProgressResult(message, 'error');
      }
    } finally {
      setBusy(false);
      releaseBuildRequest(controller);
    }
  };

  const applyDiffPreview = async () => {
    if (!diffPreviewPending) return;
    const { prompt, answers, approvedPlan } = diffPreviewPending;
    setDiffPreviewOpen(false);
    const controller = beginBuildRequest();
    setBusy(true);
    try {
      const createdFiles = await writeScaffoldFiles(diffPreviewFiles);
      addProgressMessage(t('studio.build.progressFilesWritten', { n: createdFiles.length }));
      await loadFiles();
      let allFiles = [...createdFiles];
      if (approvedPlan?.steps?.length) {
        addProgressMessage(t('studio.build.progressExecutingPlan', { n: approvedPlan.steps.length }));
        const planFiles = await executePlan(prompt, answers, approvedPlan, controller.signal);
        allFiles = [...new Set([...allFiles, ...planFiles])];
      }
      await runAutoPipeline(prompt, answers, allFiles, approvedPlan, controller.signal);
    } catch (error) {
      if (!wasBuildCancelled(error)) {
        setNotice(t('studio.build.scaffoldFailed'));
      }
    } finally {
      setBusy(false);
      setDiffPreviewPending(null);
      releaseBuildRequest(controller);
    }
  };

  const rejectDiffPreview = () => {
    setDiffPreviewOpen(false);
    setDiffPreviewPending(null);
    setDiffPreviewDiffs([]);
    setDiffPreviewFiles({});
    addActivity(t('studio.build.activityDiffRejected'), 'check', 1);
    setNotice(t('studio.build.diffRejected'));
  };

  /**
   * Phase 2.3: Wire /build/execute-plan into build-studio plan execution.
   * Calls the server-side parallel step fan-out with topological batches and
   * working-context injection. Returns the list of files changed.
   */
  const executePlan = async (
    prompt: string,
    answers: Record<string, string>,
    approvedPlan: BuildPlan,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    const { response, data } = await apiJson<{ ok?: boolean; results?: Array<{ stepId: string; ok: boolean; filesChanged: string[] }>; error?: string }>(
      '/api/jarvis/build/execute-plan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          projectId: workspaceId,
          prompt,
          answers,
          plan: {
            title: approvedPlan.title,
            summary: approvedPlan.summary,
            steps: approvedPlan.steps.map((s) => ({
              id: s.id,
              description: s.description ?? s.title,
              dependsOn: [],
              parallel: false,
            })),
            files: approvedPlan.files ?? [],
            risks: approvedPlan.risks ?? [],
          },
          extraSystemPrompt,
        }),
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(data.error ?? t('studio.build.scaffoldFailed'));
    }
    const filesChanged = (data.results ?? []).flatMap((r) => r.filesChanged);
    return [...new Set(filesChanged)];
  };

  const isSmallBuildRequest = (prompt: string): boolean => {
    const normalized = prompt.trim().toLowerCase();
    return normalized.length <= 100 && /^(please\s+)?(change|update|replace|rename|fix)\b/.test(normalized) &&
      /\b(font|text|copy|label|title|wording|color|colour|background|padding|margin|spacing|radius|border)\b/.test(normalized);
  };

  const requestPlan = async (prompt: string, answers: Record<string, string>): Promise<BuildPlan | null> => {
    const controller = beginBuildRequest();
    setPlanBusy(true);
    setProgressStatus('working');
    addProgressMessage(t('studio.build.progressPlanning'));
    try {
      const { response, data } = await apiJson<{ plan?: BuildPlan; error?: string }>('/api/jarvis/build/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, prompt, answers, extraSystemPrompt }),
        signal: controller.signal,
      });
      if (!response.ok || !data.plan) {
        const message = data.error ?? t('studio.build.planFailed');
        setProgressResult(message, 'error');
        return null;
      }
      setPlan(data.plan);
      setWizardOpen(false);
      addProgressMessage(t('studio.build.progressPlanReady'), 'waiting');
      setProgressStatus('waiting');
      return data.plan;
    } catch (error) {
      if (!wasBuildCancelled(error)) {
        const message = t('studio.build.planFailed');
        setProgressResult(message, 'error');
      }
      return null;
    } finally {
      setPlanBusy(false);
      releaseBuildRequest(controller);
    }
  };

  const continueBuild = async (prompt: string, answers: Record<string, string>, feedbackText: string | null = null) => {
    if (isSmallBuildRequest(prompt)) {
      addProgressMessage(t('studio.build.progressSmallChange'));
      await doScaffold(prompt, answers, feedbackText, null);
      return;
    }
    const nextPlan = await requestPlan(prompt, answers);
    if (!nextPlan) return;
  };

  const beginScaffold = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? scaffoldPrompt).trim();
    if (!prompt) return;
    startProgress(prompt);
    const controller = beginBuildRequest();
    setWizardBusy(true);
    addProgressMessage(t('studio.build.progressUnderstanding'));
    try {
      const { response, data } = await apiJson<{ questions?: WizardQuestion[]; inventory?: FeatureInventoryItem[]; error?: string }>('/api/jarvis/build/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal: controller.signal });
      if (!response.ok) {
        addProgressMessage(t('studio.build.progressQuestionsSkipped'));
        setWizardBusy(false);
        await continueBuild(prompt, {}, null);
        return;
      }
      setWizardPrompt(prompt);
      setWizardQuestions(data.questions ?? []);
      setFeatureInventory(data.inventory ?? []);
      setWizardAnswers({});
      setWizardOpen(true);
      addProgressMessage(t('studio.build.progressWaitingForAnswers'), 'waiting');
      setProgressStatus('waiting');
    } catch (error) {
      if (!wasBuildCancelled(error)) {
        const message = t('studio.build.questionsFailed');
        setProgressResult(message, 'error');
      }
    } finally {
      setWizardBusy(false);
      releaseBuildRequest(controller);
    }
  };

  // Auto-start a build from the "@Build <message>" chat shortcut. Each new
  // runKey from the parent triggers one scaffold run, prefilled with the prompt.
  const beginScaffoldRef = useRef(beginScaffold);
  beginScaffoldRef.current = beginScaffold;
  const lastInitialRunRef = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !initialPrompt || !runKey) return;
    if (lastInitialRunRef.current === runKey) return;
    lastInitialRunRef.current = runKey;
    setScaffoldPrompt(initialPrompt);
    void beginScaffoldRef.current(initialPrompt);
  }, [open, initialPrompt, runKey]);

  const acceptPlan = async () => {
    if (!plan || busy || planBusy) return;
    const approvedPlan = plan;
    const prompt = lastPrompt || wizardPrompt || scaffoldPrompt.trim();
    const answers = lastPrompt ? lastAnswers : wizardAnswers;
    if (!prompt) {
      setProgressResult(t('studio.build.scaffoldFailed'), 'error');
      return;
    }
    setPlan(null);
    setWizardOpen(false);
    setLastPrompt(prompt);
    setLastAnswers(answers);
    setScaffoldPrompt('');
    setFeedback('');
    if (approvedPlan?.steps?.length) {
      // Phase 2.3: Execute structured plan via /build/execute-plan parallel fan-out
      const controller = beginBuildRequest();
      setBusy(true);
      try {
        addProgressMessage(t('studio.build.progressExecutingPlan', { n: approvedPlan.steps.length }));
        addActivity(t('studio.build.activityApplying'), 'sparkles', 2);
        const createdFiles = await executePlan(prompt, answers, approvedPlan, controller.signal);
        addProgressMessage(t('studio.build.progressFilesWritten', { n: createdFiles.length }));
        await loadFiles();
        await runAutoPipeline(prompt, answers, createdFiles, approvedPlan, controller.signal);
      } catch (error) {
        if (!wasBuildCancelled(error)) {
          const message = error instanceof Error ? error.message : t('studio.build.scaffoldFailed');
          addActivity(t('studio.build.activityScaffoldFailed'), 'check', 1);
          setCompletion({ summary: message, deferred: [], files: [] });
          setProgressResult(message, 'error');
        }
      } finally {
        setBusy(false);
        releaseBuildRequest(controller);
      }
    } else {
      await doScaffold(prompt, answers, null, approvedPlan);
    }
  };

  const changePlan = () => {
    setPlan(null);
    setWizardOpen(false);
    addProgressMessage(t('studio.build.progressPlanChange'), 'waiting');
    setProgressStatus('waiting');
    window.requestAnimationFrame(() => scaffoldInputRef.current?.focus());
  };

  const applyFeedback = async () => {
    if (!feedback.trim() || busy) return;
    const feedbackText = feedback.trim();
    const prompt = lastPrompt || scaffoldPrompt.trim() || t('studio.build.defaultApp');
    startProgress(`${prompt}\n${feedbackText}`);
    addProgressMessage(t('studio.build.progressFeedbackReceived'));
    await continueBuild(prompt, lastAnswers, feedbackText);
  };

  const captureScreenshot = async (signal?: AbortSignal): Promise<boolean> => {
    if (screenshotBusy) return Boolean(screenshot || mobileScreenshot);
    setScreenshotBusy(true);
    try {
      const { response, data } = await apiJson<{ dataUrl?: string; error?: string; screenshots?: PreviewScreenshots }>('/api/jarvis/build/screenshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, sessionId: 'studio-preview', port: previewPort, viewports: ['desktop', 'mobile'] }), signal });
      if (response.ok && (data.screenshots?.desktop || data.screenshots?.mobile || data.dataUrl)) {
        setScreenshot(data.screenshots?.desktop?.dataUrl ?? data.dataUrl ?? null);
        setMobileScreenshot(data.screenshots?.mobile?.dataUrl ?? null);
        return true;
      }
      if (!signal?.aborted) setNotice(data.error ?? t('studio.build.screenshotFailed'));
      return false;
    } catch (error) {
      if (!signal && !wasBuildCancelled(error)) setNotice(t('studio.build.screenshotFailed'));
      return false;
    } finally {
      setScreenshotBusy(false);
    }
  };

  const runPreviewAgent = async () => {
    const goal = agentGoal.trim();
    if (!goal || agentBusy || !previewRunning) return;
    setAgentBusy(true);
    setAgentEvents([{ type: 'inspect', message: 'Jarvis is inspecting the running preview...' }]);
    setAgentConsoleErrors([]);
    const { response, data } = await apiJson<PreviewAgentResponse>('/api/jarvis/build/preview/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, sessionId: 'studio-preview', port: previewPort, goal, maxSteps: 8, extraSystemPrompt }),
    });
    setAgentEvents(data.events ?? []);
    setAgentConsoleErrors(data.consoleErrors ?? []);
    setNotice(response.ok ? (data.summary ?? (data.completed ? 'Browser goal completed' : 'Browser agent stopped')) : (data.error ?? 'Browser agent failed'));
    setAgentBusy(false);
  };

  const saveEnv = async () => {
    const next = Object.fromEntries(envDraft.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const index = line.indexOf('='); return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : ['', '']; }).filter(([key]) => key));
    const { response } = await apiJson('/api/jarvis/build/env', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, env: next }) });
    if (response.ok) { setEnv(next); setNotice('Environment saved'); }
  };

  const launchPreview = async (signal?: AbortSignal): Promise<boolean> => {
    const { response, data } = await apiJson<{ url?: string; error?: string }>('/api/jarvis/build/preview/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, sessionId: 'studio-preview', command: previewCommand.replace('${PORT}', String(previewPort)), port: previewPort }), signal });
    if (response.ok) { setPreviewRunning(true); setPreviewUrl(data.url ?? `http://localhost:${previewPort}`); setPreviewOutput('Starting preview...'); return true; }
    if (!signal?.aborted) setNotice(data.error ?? 'Preview failed to start');
    return false;
  };
  const startPreview = async () => { setBusy(true); await launchPreview(); setBusy(false); };
  const stopPreview = async () => { await fetch('/api/jarvis/build/preview/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, sessionId: 'studio-preview' }) }); setPreviewRunning(false); setPreviewOutput('Preview stopped'); };
  useEffect(() => {
    if (!previewRunning) return;
    const timer = window.setInterval(() => { void apiJson<{ running?: boolean; output?: string }>(`/api/jarvis/build/preview/status?workspaceId=${encodeURIComponent(workspaceId)}&sessionId=studio-preview`).then(({ data }) => { setPreviewRunning(Boolean(data.running)); setPreviewOutput(data.output ?? ''); }); }, 2000);
    return () => window.clearInterval(timer);
  }, [previewRunning, workspaceId]);

  const runAutoPipeline = async (prompt: string, answers: Record<string, string>, createdFiles: string[], approvedPlan: BuildPlan | null = plan, signal?: AbortSignal) => {
    const ownController = signal ? null : beginBuildRequest();
    const activeSignal = signal ?? ownController?.signal;
    const maxReviewPasses = 8; // bounded self-review
    let allFiles = [...createdFiles];
    try {
      addActivity(t('studio.build.activityStartingPreview'), 'terminal', 1);
      addProgressMessage(t('studio.build.progressStartingPreview'));
      const started = await launchPreview(activeSignal);
      if (!started) {
        const message = t('studio.build.previewFailed');
        setCompletion({ summary: message, deferred: [], files: allFiles });
        setProgressResult(message, 'error');
        return;
      }
      if (activeSignal?.aborted || buildCancelRequestedRef.current || stopPipelineRef.current) return;
      await waitMs(1400);
      addProgressMessage(t('studio.build.progressCapturingPreview'));
      let captured = await captureScreenshot(activeSignal);
      if (!captured && !activeSignal?.aborted) { await waitMs(1400); captured = await captureScreenshot(activeSignal); }
      if (captured) {
        addActivity(t('studio.build.activityScreenshot'), 'camera', 1);
        addProgressMessage(t('studio.build.progressScreenshotReady'));
      } else if (!activeSignal?.aborted) {
        addActivity(t('studio.build.activityScreenshotFailed'), 'camera', 1);
        addProgressMessage(t('studio.build.activityScreenshotFailed'));
      }

      let summary = captured ? t('studio.build.activityReviewing') : t('studio.build.previewNeedsReview');
      let deferred: string[] = [];
      stopPipelineRef.current = false;
      let pass = 1;
      while (!stopPipelineRef.current && !activeSignal?.aborted) {
        setAutoFixPass(pass);
        addActivity(t('studio.build.activityReviewPass', { n: pass }), 'sparkles', 2);
        addProgressMessage(t('studio.build.progressReviewPass', { n: pass }));
        const status = await apiJson<{ output?: string }>(`/api/jarvis/build/preview/status?workspaceId=${encodeURIComponent(workspaceId)}&sessionId=studio-preview`, { signal: activeSignal });
        const output = status.data.output ?? previewOutput;
        setPreviewOutput(output);
        const { response, data } = await apiJson<IterateResponse>('/api/jarvis/build/iterate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, prompt, answers, previewOutput: output, passNumber: pass, extraSystemPrompt, plan: approvedPlan }), signal: activeSignal });
        if (!response.ok) {
          summary = data.error ?? t('studio.build.reviewFailed');
          setCompletion({ summary, deferred, files: [...new Set(allFiles)] });
          setProgressResult(summary, 'error');
          return;
        }
        summary = data.summary ?? summary;
        deferred = data.deferred ?? deferred;
        allFiles = [...new Set([...allFiles, ...(data.filesChanged ?? [])])];
        if (data.filesChanged?.length) {
          addActivity(t('studio.build.activityFixed', { files: data.filesChanged.length }), 'terminal', data.filesChanged.length);
          addProgressMessage(t('studio.build.progressFilesFixed', { n: data.filesChanged.length }));
          await loadFiles();
          if (!stopPipelineRef.current && !activeSignal?.aborted) {
            await launchPreview(activeSignal);
            await waitMs(1200);
            captured = await captureScreenshot(activeSignal);
            if (captured) {
              addActivity(t('studio.build.activityScreenshot'), 'camera', 1);
              addProgressMessage(t('studio.build.progressScreenshotReady'));
            }
          }
        }
        if (data.done || !data.fixRequest) break;
        if (pass >= maxReviewPasses) {
          summary = t('studio.build.maxPasses', { summary });
          addProgressMessage(t('studio.build.progressMaxPasses'), 'waiting');
          break;
        }
        pass += 1;
      }
      if (activeSignal?.aborted || buildCancelRequestedRef.current) return;
      if (stopPipelineRef.current) {
        const message = t('studio.build.progressCancelled');
        setCompletion({ summary: message, deferred, files: [...new Set(allFiles)] });
        setProgressResult(message, 'cancelled');
        return;
      }
      addActivity(t('studio.build.activityComplete'), 'check', 1);
      addProgressMessage(t('studio.build.progressComplete'), 'done');
      setCompletion({ summary, deferred, files: [...new Set(allFiles)] });
      setProgressStatus('done');
    } catch (error) {
      if (!wasBuildCancelled(error)) {
        const message = t('studio.build.pipelineFailed');
        setCompletion({ summary: message, deferred: [], files: [...new Set(allFiles)] });
        setProgressResult(message, 'error');
      }
    } finally {
      setAutoFixPass(0);
      if (ownController) releaseBuildRequest(ownController);
    }
  };



  const saveApp = async () => { setBusy(true); const { response } = await apiJson('/api/jarvis/build/apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, name: saveName.trim() || 'Untitled build', runCommand: previewCommand, previewPort }) }); setBusy(false); if (response.ok) { setSaveName(''); setNotice('Build app saved to Gallery'); await loadSavedApps(); } };
  const restoreApp = async (id: string) => { setBusy(true); const { response } = await apiJson(`/api/jarvis/build/apps/${id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId }) }); setBusy(false); if (response.ok) { setNotice('Build restored'); await loadFiles(); await loadEnvironment(); } };

  const runWalkthrough = async () => {
    if (!previewRunning || walkthroughBusy) return;
    setWalkthroughBusy(true);
    setWalkthroughErrors([]);
    const { response, data } = await apiJson<{ errors?: string[]; reportPath?: string; error?: string }>('/api/jarvis/build/walkthrough', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, sessionId: 'studio-preview', port: previewPort }) });
    setWalkthroughBusy(false);
    if (response.ok) {
      setWalkthroughErrors(data.errors ?? []);
      setWalkthroughReportPath(data.reportPath ?? 'full-walktrough.md');
      setNotice(data.errors?.length ? `${data.errors.length} issue(s) appended to full-walktrough.md` : 'Walkthrough complete: no unexpected errors found');
    } else setNotice(data.error ?? 'Walkthrough could not run');
  };

  const createCheckpoint = async () => {
    setHistoryBusy(true);
    const { response } = await apiJson('/api/jarvis/history/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, label: 'AFK checkpoint', description: 'Safety checkpoint created before autonomous work' }) });
    setHistoryBusy(false);
    if (response.ok) { await loadSnapshots(); setNotice('Checkpoint created'); }
  };

  const toggleAfkMode = async () => {
    const enabling = !afkMode;
    if (enabling) await createCheckpoint();
    setAfkMode(enabling);
    setNotice(enabling
      ? (previewRunning && lastPrompt ? 'AFK mode enabled. Jarvis is continuing the local build review.' : 'AFK mode enabled. Start a preview to let Jarvis continue autonomously.')
      : 'AFK mode disabled');
    if (enabling && previewRunning && lastPrompt) {
      void runAutoPipeline(lastPrompt, lastAnswers, [], plan);
    }
  };

  useEffect(() => {
    if (!deepSleep) return;
    const wake = (event: Event) => {
      if (wakeSensitivity === 'keypress' && event.type !== 'keydown') return;
      setDeepSleep(false);
      setSleepSummary(afkMode ? 'Jarvis woke from AFK mode. Review the activity feed and checkpoint before continuing.' : 'Sleep screen dismissed.');
    };
    const options = { once: true } as AddEventListenerOptions;
    window.addEventListener('mousemove', wake, options);
    window.addEventListener('click', wake, options);
    window.addEventListener('scroll', wake, { ...options, passive: true });
    window.addEventListener('keydown', wake, options);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('click', wake);
      window.removeEventListener('scroll', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [afkMode, deepSleep, wakeSensitivity]);

  const toggleHotReload = async () => {
    if (hotReload) {
      await fetch('/api/jarvis/hot-reload/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId }) });
      hotReloadRef.current?.close();
      hotReloadRef.current = null;
      setHotReload(false);
      setNotice('Auto-reload disabled');
      return;
    }
    const { response } = await apiJson('/api/jarvis/hot-reload/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId }) });
    if (!response.ok) { setNotice('Could not enable auto-reload'); return; }
    setHotReload(true);
    setNotice('Auto-reload enabled — the preview restarts when files change');
    const stream = new EventSource(`/api/jarvis/hot-reload/events?workspaceId=${encodeURIComponent(workspaceId)}`);
    hotReloadRef.current = stream;
    stream.onmessage = (event) => {
      try {
        const nextEvent = JSON.parse(event.data) as { type: string; file: string };
        setNotice(`File changed (${nextEvent.file}) — reloading preview…`);
      } catch { /* malformed SSE frame */ }
    };
  };

  // Phase 0: Keyboard shortcuts
  const shortcuts = createDefaultShortcuts({
    runBuild: () => void beginScaffold(),
    cancelBuild: cancelBuild,
    toggleDiff: () => {
      // Toggle diff preview - for now just open it if there's a completion
      if (completion) {
        // We'd open diff preview here if we had a diff
      }
    },
    openCommandPalette: () => setCommandPaletteOpen(true),
    closeDialogs: () => {
      setCommandPaletteOpen(false);
      setWizardOpen(false);
      setTranscriptSheetOpen(false);
    },
  });
  useBuildShortcuts(shortcuts, true);

  // Phase 0: Build command palette items
  const paletteItems = useMemo(() =>
    createDefaultCommandPaletteItems({
      runBuild: () => void beginScaffold(),
      cancelBuild: cancelBuild,
      toggleDiff: () => { /* diff toggle */ },
      openPreview: () => {
        if (previewUrl) window.open(previewUrl, '_blank');
      },
      openConsole: () => setTab('terminal'),
      openHistory: () => setTab('history'),
      createCheckpoint: createCheckpoint,
      rollback: () => { /* rollback */ },
      exportWorkspace: () => { /* export */ },
      toggleConfirmation: () => { /* toggle */ },
      toggleParallel: () => { /* toggle */ },
      modelSettings: () => { /* settings */ },
      refreshFiles: loadFiles,
      openSettings: () => { /* settings */ },
    }), [beginScaffold, cancelBuild, previewUrl, createCheckpoint, loadFiles]);

  useEffect(() => {
    setCommandPaletteItems(paletteItems);
  }, [paletteItems]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 's') { if (selectedPath && !busy) { event.preventDefault(); void saveFile(); } return; }
      if (key === 'j') { event.preventDefault(); setTab((current) => (current === 'terminal' ? 'editor' : 'terminal')); return; }
      const index = Number(key);
      if (index >= 1 && index <= 9 && index <= TAB_ORDER.length) { event.preventDefault(); setTab(TAB_ORDER[index - 1]); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedPath, content, busy, workspaceId]);

  if (!open) return null;
  const renderSleepControlsLegacy = () => <div data-build-sleep-controls="true" aria-label="AFK and sleep controls" className="flex items-center gap-1.5"><button type="button" onClick={() => void toggleAfkMode()} disabled={historyBusy} className={`rounded-lg border px-2.5 py-2 text-[11px] ${afkMode ? 'border-amber-300/50 bg-amber-300/10 text-amber-200' : 'border-border/50 text-muted-foreground hover:bg-secondary/60'}`} title="Let Jarvis continue the local build loop"><Zap className="mr-1 inline h-3.5 w-3.5" />{afkMode ? 'AFK on' : 'AFK mode'}</button><select value={wakeSensitivity} onChange={(event) => setWakeSensitivity(event.target.value as 'any' | 'keypress')} className="hidden rounded-lg border border-border/50 bg-secondary/40 px-2 py-2 text-[11px] outline-none sm:block" aria-label="Sleep wake sensitivity"><option value="any">Wake: any input</option><option value="keypress">Wake: keypress</option></select><button type="button" onClick={() => setDeepSleep(true)} className="rounded-lg border border-border/50 px-2.5 py-2 text-[11px] text-muted-foreground hover:bg-secondary/60" title="Dim the interface while Jarvis works"><Moon className="mr-1 inline h-3.5 w-3.5" />Sleep</button></div>;
  const renderDeepSleepOverlay = deepSleep ? <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black text-white" role="dialog" aria-label="Jarvis sleep screen"><Moon className="h-8 w-8 text-white/30" /><p className="mt-4 text-xs tracking-[0.25em] text-white/40">JARVIS SLEEP SCREEN</p>{afkMode && <p className="mt-3 text-[11px] text-white/25">⚡ Agent working · {autoFixPass > 0 ? `iteration ${autoFixPass}` : 'checkpoint saved'}</p>}</div> : null;
  const renderSleepControls = () => <div data-build-sleep-controls="true" className="flex items-center gap-1.5"><button type="button" onClick={() => void toggleAfkMode()} disabled={historyBusy} className="rounded-lg border border-border/50 px-2 py-2 text-[11px]"><Zap className="mr-1 inline h-3.5 w-3.5" />{afkMode ? 'AFK on' : 'AFK mode'}</button><button type="button" onClick={() => setDeepSleep(true)} className="rounded-lg border border-border/50 px-2 py-2 text-[11px]"><Moon className="mr-1 inline h-3.5 w-3.5" />Sleep</button></div>;
  const tabs: [StudioTab, string, typeof Code2][] = [['editor', t('studio.build.editor'), Code2], ['terminal', t('studio.build.terminal'), Terminal], ['preview', t('studio.build.preview'), Play], ['packages', t('studio.build.packages'), Package], ['env', t('studio.build.env'), Upload], ['git', t('studio.build.git'), GitBranch], ['search', 'Search', Search], ['quality', 'Quality', TestTube2], ['history', 'History', History], ['templates', 'Templates', LayoutTemplate], ['docker', 'Docker', Container], ['database', 'Database', Database], ['api', 'API', Globe]];
  // Keep the studio calm: Editor/Terminal/Preview always visible, the rest
  // tucked behind a "More" toggle so a fresh build isn't a wall of 13 tabs.
  const coreTabs = tabs.slice(0, 3);
  const moreTabs = tabs.slice(3);
  const activeInMore = moreTabs.some(([value]) => value === tab);
  const showMore = moreOpen || activeInMore;
  return <AnimatePresence><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}><motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`${isDark ? 'dark' : ''} flex h-[94vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-t-3xl border border-border shadow-2xl sm:rounded-3xl`} style={{ background: 'var(--build-bg-elevated)' }} onClick={(event) => event.stopPropagation()}>
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3"><Hammer className="h-4 w-4 text-primary" /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-foreground">{title}</h2><p className="text-[10px] text-muted-foreground">{t('studio.build.subtitle')} · project {workspaceId}</p></div><input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder={t('studio.build.appName')} className="hidden w-32 rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground outline-none sm:block" /><button type="button" onClick={() => void saveApp()} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{t('studio.build.saveApp')}</button><button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground" aria-label={t('studio.build.close')}><X className="h-4 w-4" /></button></header>
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* Activity Bar (Replit-style vertical icon strip) */}
      <div className="hidden md:flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-2">
        <button type="button" title="Explorer" className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.08] text-foreground"><Code2 className="h-4 w-4" /></button>
        <button type="button" title="Search" onClick={() => setTab('search')} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"><Search className="h-4 w-4" /></button>
        <button type="button" title="Git" onClick={() => setTab('git')} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"><GitBranch className="h-4 w-4" /></button>
        <button type="button" title="Templates" onClick={() => setTab('templates')} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"><LayoutTemplate className="h-4 w-4" /></button>
        <button type="button" title="Docker" onClick={() => setTab('docker')} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"><Container className="h-4 w-4" /></button>
        <div className="mt-auto" />
        <button type="button" title="Settings" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"><Database className="h-4 w-4" /></button>
      </div>
      <aside className="flex w-full shrink-0 gap-1 overflow-x-auto border-b border-border bg-card p-2 md:w-56 md:flex-col md:border-b-0 md:border-r"><div className="mb-1 flex items-center justify-between px-2"><span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Explorer</span><div className="flex gap-1"><button type="button" onClick={() => void createFile()} title="New file" className="rounded p-1 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"><FilePlus2 className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void createFolder()} title="New folder" className="rounded p-1 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"><FolderPlus className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void loadFiles()} title="Refresh" className="rounded p-1 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button></div></div><div className="min-h-0 flex-1 overflow-auto">{visibleFiles.map((file) => { const clean = file.path.replace(/\/$/, ''); const depth = clean.split('/').length - 1; const isDir = file.type === 'dir'; return <div key={file.path} className="group flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-foreground hover:bg-white/[0.08]" style={{ paddingLeft: `${8 + depth * 12}px` }}><button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => isDir ? setExpanded((current) => { const next = new Set(current); next.has(clean) ? next.delete(clean) : next.add(clean); return next; }) : void openFile(file.path)}>{isDir ? (expanded.has(clean) ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />) : <span className="w-3" />}{isDir ? <Folder className="h-3.5 w-3.5 text-amber-400" /> : <Code2 className="h-3.5 w-3.5 text-primary" />}<span className="truncate">{clean.split('/').pop()}</span></button><button type="button" onClick={() => void renamePath(file.path)} className="hidden rounded p-1 text-muted-foreground hover:text-foreground group-hover:block" title="Rename">···</button><button type="button" onClick={() => void deletePath(file.path)} className="hidden rounded p-1 text-muted-foreground hover:text-rose-400 group-hover:block" title="Delete"><Trash2 className="h-3 w-3" /></button></div>; })}</div><div className="hidden border-t border-border pt-3 md:block"><p className="mb-2 text-[9px] uppercase tracking-widest text-muted-foreground/60">{t('studio.build.savedApps')}</p>{savedApps.slice(0, 5).map((app) => <button type="button" key={app.id} onClick={() => void restoreApp(app.id)} className="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[10px] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"><ChevronRight className="h-3 w-3" />{app.name}</button>)}</div></aside>
      <main className="min-h-0 flex-1 overflow-hidden bg-background"><div className="max-h-44 shrink-0 overflow-auto border-b border-border bg-card px-3 py-2">{activities.map((activity) => <div key={activity.id} className="flex items-start gap-2 py-1.5 text-[11px]"><span className="mt-0.5 rounded-md border border-border bg-secondary p-1 text-primary">{activity.icon === 'camera' ? <Camera className="h-3 w-3" /> : activity.icon === 'terminal' ? <Terminal className="h-3 w-3" /> : activity.icon === 'check' ? <Check className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}</span><span className="min-w-0 flex-1 text-muted-foreground">{activity.message}</span>{activity.actionCount ? <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[9px] text-muted-foreground">{activity.actionCount} {t('studio.build.actions')}</span> : null}</div>)}{completion && <div className="mt-2 rounded-xl border" style={{ borderColor: 'var(--build-completion-border)', backgroundColor: 'var(--build-completion-bg)', color: 'var(--build-completion-text)' }}><p className="font-semibold">{t('studio.build.completionTitle')}</p><p className="mt-1 text-muted-foreground">{completion.summary}</p>{completion.files.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{completion.files.length} {t('studio.build.filesChanged')}</p>}{completion.deferred.length > 0 && <p className="mt-2 text-[10px]" style={{ color: 'var(--build-warning-text)' }}>{completion.deferred.join(', ')}</p>}</div>}{autoFixPass > 0 && <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'var(--build-primary-border)', backgroundColor: 'var(--build-primary-bg)' }}><span style={{ color: 'var(--build-primary-text)' }}>Iteration {autoFixPass} running…</span><button type="button" onClick={() => { stopPipelineRef.current = true; }} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-white" style={{ backgroundColor: 'var(--build-error-bg)' }}><Square className="h-3 w-3" />Stop iterating</button></div>}</div><div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2">{coreTabs.map(([value, label, Icon]) => <button type="button" key={value} onClick={() => setTab(value)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${tab === value ? 'bg-background text-white' : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'}`} style={tab === value ? { borderBottom: '2px solid var(--build-accent-read)' } : undefined}><Icon className="h-3.5 w-3.5" />{label}</button>)}<button type="button" onClick={() => setMoreOpen((current) => !current)} aria-expanded={showMore} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${activeInMore ? 'bg-background text-white' : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'}`} style={activeInMore ? { borderBottom: '2px solid var(--build-accent-read)' } : undefined}><MoreHorizontal className="h-3.5 w-3.5" />More{activeInMore && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}<ChevronDown className={`h-3 w-3 transition-transform ${showMore ? 'rotate-180' : ''}`} /></button>{showMore && moreTabs.map(([value, label, Icon]) => <button type="button" key={value} onClick={() => setTab(value)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${tab === value ? 'bg-background text-white' : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'}`} style={tab === value ? { borderBottom: '2px solid var(--build-accent-read)' } : undefined}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>
        {tab === 'editor' && <div className="flex h-[calc(100%-49px)] min-h-0 flex-col"><div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2">{openPaths.map((path) => <button type="button" key={path} onClick={() => void openFile(path)} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] ${selectedPath === path ? 'bg-background text-white' : 'text-muted-foreground'}`}>{path}{selectedPath === path && dirty ? ' ·' : ''}</button>)}<button type="button" onClick={() => void createFile()} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button></div>{selectedPath ? <><div className="flex items-center justify-between border-b border-border bg-background px-3 py-2 text-[10px] text-muted-foreground"><span className="text-foreground">{selectedPath} <span className="text-muted-foreground">{languageFor(selectedPath)}{dirty ? ' · unsaved' : ''}</span></span><button type="button" disabled={!dirty || busy} onClick={() => void saveFile()} className="flex items-center gap-1 rounded-lg bg-primary/20 px-2.5 py-1.5 text-primary disabled:opacity-40"><Save className="h-3 w-3" />Save</button></div><div className="min-h-0 flex-1 overflow-hidden"><CodeEditor value={content} path={selectedPath} onChange={(value) => { setContent(value); setDirty(true); }} onCursorChange={(line, col) => setCursorPos({ line, col })} onSave={() => void saveFile()} /></div><div className="flex shrink-0 items-center gap-3 border-t border-border bg-primary px-3 py-1.5 text-[10px] text-white/80"><span className="font-medium text-white">{languageFor(selectedPath)}</span><span className="font-mono">{cursorPos ? `Ln ${cursorPos.line}, Col ${cursorPos.col}` : '—'}</span><span className="font-mono">{new Blob([content]).size.toLocaleString()} B</span><span className={dirty ? 'text-amber-300' : 'text-white'}>{dirty ? 'unsaved' : 'saved'}</span><span className="ml-auto hidden gap-2 sm:flex text-white/60">Ctrl+S save · Ctrl+J terminal · Ctrl+1–9 tabs</span></div></> : <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"><Code2 className="h-10 w-10 text-primary/50" /><div><p className="text-sm font-semibold text-foreground">{t('studio.build.openFile')}</p><p className="mt-1 max-w-md text-xs text-muted-foreground">{t('studio.build.openFileDesc')}</p></div><div className="w-full max-w-md space-y-2"><input ref={scaffoldInputRef} value={scaffoldPrompt} onChange={(event) => setScaffoldPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void beginScaffold(); }} placeholder={t('studio.build.scaffoldPlaceholder')} className="min-w-0 w-full rounded-xl border border-white/[0.12] bg-input px-3 py-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground" /><textarea value={extraSystemPrompt} onChange={(event) => setExtraSystemPrompt(event.target.value)} placeholder="Optional extra instructions for Jarvis Build. These are added to, not a replacement for, the built-in Jarvis Build rules." rows={3} className="w-full resize-y rounded-xl border border-white/[0.12] bg-secondary px-3 py-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" onClick={() => void beginScaffold()} disabled={wizardBusy || !scaffoldPrompt.trim()} className="rounded-xl bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{t('studio.build.scaffold')}</button></div></div>}</div>}
        {tab === 'terminal' && <div className="flex h-[calc(100%-49px)] flex-col" style={{ background: 'var(--build-bg)' }}><div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><Terminal className="h-4 w-4" />{t('studio.build.terminalHint')} · {workspaceId}</div><div className="min-h-0 flex-1 space-y-2 overflow-auto font-mono text-xs p-4">{terminalLines.map((line, index) => <div key={index} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2"><div className="text-primary">$ {line.command}</div><pre className="mt-1 whitespace-pre-wrap text-foreground">{line.output || '(no output)'}</pre><div className={line.exitCode === 0 ? 'text-emerald-400' : line.exitCode == null ? 'text-amber-300' : 'text-rose-400'}>{line.exitCode == null ? 'running…' : `exit ${line.exitCode}`}</div></div>)}</div><form onSubmit={(event) => { event.preventDefault(); void runCommand(); }} className="mt-3 flex gap-2 p-4"><span className="py-2 font-mono text-primary">$</span><input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder={t('studio.build.commandPlaceholder')} className="min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-muted-foreground focus:border-primary" /><button type="button" disabled={terminalRunning} onClick={() => void startStreamingCommand()} className="rounded-lg border border-primary px-3 py-2 text-xs text-primary disabled:opacity-50">{terminalRunning ? 'Running' : 'Stream'}</button>{terminalRunning ? <button type="button" onClick={() => void stopTerminal()} className="rounded-lg bg-rose-500 px-3 py-2 text-xs font-medium text-white"><Square className="h-3 w-3" /></button> : <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white">{t('studio.build.run')}</button>}</form></div>}
        {tab === 'preview' && <div className="flex h-[calc(100%-49px)] flex-col p-4"><div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-secondary p-3"><label className="flex-1 text-[10px] text-muted-foreground">{t('studio.build.runCommand')}<input value={previewCommand} onChange={(event) => setPreviewCommand(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-input px-2.5 py-2 font-mono text-xs text-foreground outline-none" /></label><label className="w-24 text-[10px] text-muted-foreground">{t('studio.build.port')}<input type="number" min={1024} max={65535} value={previewPort} onChange={(event) => setPreviewPort(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-border bg-input px-2.5 py-2 font-mono text-xs text-foreground outline-none" /></label><button type="button" disabled={screenshotBusy} onClick={() => void captureScreenshot()} title={t('studio.build.screenshotHint')} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-foreground disabled:opacity-50">{screenshotBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}{t('studio.build.screenshot')}</button><button type="button" onClick={() => void toggleHotReload()} title="Auto-reload preview when files change" className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${hotReload ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-400' : 'border-border text-muted-foreground'}`}><RefreshCw className={`h-3 w-3 ${hotReload ? '' : 'opacity-50'}`} />Auto-reload</button>{previewRunning ? <button type="button" onClick={() => void stopPreview()} className="flex items-center gap-1.5 rounded-lg border border-rose-400/40 px-3 py-2 text-xs text-rose-400"><Square className="h-3 w-3" />Stop</button> : <button type="button" disabled={busy} onClick={() => void startPreview()} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Play className="h-3 w-3" />{t('studio.build.runPreview')}</button>}</div><div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--build-primary-border)', backgroundColor: 'var(--build-primary-bg)' }}><div className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-primary" /><p className="text-[11px] font-semibold text-foreground">Jarvis browser agent</p><span className="text-[10px] text-muted-foreground">local preview only</span></div><div className="mt-2 flex gap-2"><input value={agentGoal} onChange={(event) => setAgentGoal(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runPreviewAgent(); }} placeholder="Tell Jarvis what to do in the website, for example: submit the signup form" className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" disabled={!previewRunning || agentBusy || !agentGoal.trim()} onClick={() => void runPreviewAgent()} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-white disabled:opacity-40">{agentBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Run goal</button></div>{agentEvents.length > 0 && <div className="mt-2 max-h-24 space-y-1 overflow-auto text-[10px] text-muted-foreground">{agentEvents.map((event, index) => <p key={`${event.type}-${index}`} className={event.type === 'error' ? 'text-rose-400' : event.type === 'complete' ? 'text-emerald-400' : ''}>{event.step ? `Step ${event.step}: ` : ''}{event.message}</p>)}</div>}{agentConsoleErrors.length > 0 && <p className="mt-2 text-[10px] text-amber-300">{agentConsoleErrors.length} browser console error{agentConsoleErrors.length === 1 ? '' : 's'} observed</p>}</div>{previewUrl ? <iframe title="Build preview" src={`${previewUrl}?workspace=${encodeURIComponent(workspaceId)}`} className="mt-3 min-h-0 flex-1 rounded-xl border border-border bg-background" /> : <div className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground">{t('studio.build.previewEmpty')}</div>}{(screenshot || mobileScreenshot) && <div className="mt-2 flex shrink-0 items-stretch gap-3 rounded-xl border border-border bg-secondary p-3"><div className="flex shrink-0 gap-2">{screenshot && <div><p className="mb-1 text-[9px] uppercase tracking-widest text-muted-foreground">Desktop</p><img src={screenshot} alt="Desktop preview screenshot" className="h-28 w-44 rounded-lg border border-border object-cover object-top" /></div>}{mobileScreenshot && <div><p className="mb-1 text-[9px] uppercase tracking-widest text-muted-foreground">Mobile</p><img src={mobileScreenshot} alt="Mobile preview screenshot" className="h-28 w-16 rounded-lg border border-border object-cover object-top" /></div>}</div><div className="flex min-w-0 flex-1 flex-col gap-2"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('studio.build.screenshot')}</p><input value={feedback} onChange={(event) => setFeedback(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void applyFeedback(); }} placeholder={t('studio.build.feedbackPlaceholder')} className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground" /><div className="flex items-center gap-2"><button type="button" disabled={busy || !feedback.trim()} onClick={() => void applyFeedback()} className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}{t('studio.build.applyChanges')}</button><button type="button" onClick={() => { setScreenshot(null); setMobileScreenshot(null); }} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button></div></div></div>}<pre className="mt-2 max-h-24 overflow-auto rounded-xl p-2 font-mono text-[10px] text-muted-foreground" style={{ background: 'var(--build-bg)' }}>{previewOutput}</pre></div>}
        {tab === 'packages' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><Package className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">{t('studio.build.packagesTitle')}</h3><p className="mt-0.5 text-xs text-muted-foreground">{t('studio.build.packagesDesc')}</p></div></div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={packageManager ?? 'npm'} onChange={(event) => setPackageManager(event.target.value)} className="rounded-lg border border-border bg-input px-2 py-2 text-xs text-foreground outline-none">{['npm', 'pip', 'cargo', 'go'].map((manager) => <option key={manager} value={manager}>{manager}</option>)}</select>
            <input value={packageQuery} onChange={(event) => setPackageQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchPackages(); }} placeholder="Search npm / PyPI / crates.io…" className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground" />
            <button type="button" disabled={packageBusy || !packageQuery.trim()} onClick={() => void searchPackages()} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{packageBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}Search</button>
            <button type="button" onClick={() => void loadPackages()} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground">Refresh</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-secondary p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Installed ({installedPackages.length})</p>
              {installedPackages.length === 0 ? <p className="text-xs text-muted-foreground">No packages detected. Add a package.json, requirements.txt or Cargo.toml, then refresh.</p> : <ul className="space-y-1">{installedPackages.map((pkg) => <li key={pkg.name} className="flex items-center justify-between rounded-lg bg-input/50 px-2.5 py-1.5 text-xs text-foreground"><span className="min-w-0 truncate font-mono">{pkg.name}</span><span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{pkg.version}</span></li>)}</ul>}
            </div>
            <div className="rounded-xl border border-border bg-secondary p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Search results</p>
              {packageResults.length === 0 ? <p className="text-xs text-muted-foreground">Search a registry to find packages to install.</p> : <ul className="space-y-1.5">{packageResults.map((pkg) => <li key={pkg.name + '-' + pkg.version} className="flex items-start justify-between gap-2 rounded-lg bg-input/50 px-2.5 py-1.5 text-xs text-foreground"><span className="min-w-0 flex-1"><span className="block truncate font-mono">{pkg.name}</span>{pkg.description && <span className="mt-0.5 line-clamp-2 block text-[10px] text-muted-foreground">{pkg.description}</span>}</span><button type="button" disabled={packageBusy} onClick={() => void installPackage(pkg)} className="shrink-0 rounded-lg bg-primary/20 px-2 py-1 text-[10px] font-medium text-primary disabled:opacity-40">Add</button></li>)}</ul>}
            </div>
          </div>
        </div>}
        {tab === 'env' && <div className="space-y-4 p-5"><Upload className="h-7 w-7 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">{t('studio.build.environmentTitle')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('studio.build.environmentDesc')}</p></div><textarea value={envDraft} onChange={(event) => setEnvDraft(event.target.value)} placeholder={t('studio.build.environmentPlaceholder')} spellCheck={false} className="min-h-48 w-full rounded-xl border border-border bg-secondary p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" onClick={() => void saveEnv()} className="rounded-xl bg-primary px-3 py-2 text-xs font-medium text-white">{t('studio.build.saveEnvironment')}</button><p className="text-[10px] text-muted-foreground">{Object.keys(env).length} {t('studio.build.savedVariables')}</p></div>}
        {tab === 'git' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><GitBranch className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">{t('studio.build.gitTitle')}</h3><p className="mt-0.5 text-xs text-muted-foreground">{t('studio.build.gitDesc')}</p></div><button type="button" disabled={gitBusy} onClick={() => void refreshGit()} className="ml-auto flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground disabled:opacity-50"><RefreshCw className="h-3 w-3" />Refresh</button></div>
          {gitStatus ? <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-secondary p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Branch · {gitStatus.branch || 'none'}{gitStatus.ahead > 0 || gitStatus.behind > 0 ? ' · ' + gitStatus.ahead + ' ahead ' + gitStatus.behind + ' behind' : ''}</p>
              {gitStatus.staged.length > 0 && <div className="mt-2"><p className="text-[10px] text-emerald-400">Staged</p><ul className="mt-1 space-y-1">{gitStatus.staged.map((file) => <li key={file} className="flex items-center justify-between rounded-lg bg-input/50 px-2.5 py-1 font-mono text-[11px] text-foreground"><span className="min-w-0 truncate">{file}</span><button type="button" onClick={() => void gitAction('/api/jarvis/git/unstage', { files: [file] })} className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground">unstage</button></li>)}</ul></div>}
              {gitStatus.modified.length > 0 && <div className="mt-2"><p className="text-[10px] text-amber-300">Modified</p><ul className="mt-1 space-y-1">{gitStatus.modified.map((file) => <li key={file} className="flex items-center justify-between gap-2 rounded-lg bg-input/50 px-2.5 py-1 font-mono text-[11px] text-foreground"><span className="min-w-0 truncate">{file}</span><div className="flex shrink-0 gap-1.5"><button type="button" onClick={() => void gitAction('/api/jarvis/git/stage', { files: [file] })} className="text-[10px] text-primary">stage</button><button type="button" onClick={() => void loadGitDiff(file)} className="text-[10px] text-muted-foreground hover:text-foreground">diff</button></div></li>)}</ul></div>}
              {gitStatus.untracked.length > 0 && <div className="mt-2"><p className="text-[10px] text-sky-400">Untracked</p><ul className="mt-1 space-y-1">{gitStatus.untracked.map((file) => <li key={file} className="flex items-center justify-between rounded-lg bg-input/50 px-2.5 py-1 font-mono text-[11px] text-foreground"><span className="min-w-0 truncate">{file}</span><button type="button" onClick={() => void gitAction('/api/jarvis/git/stage', { files: [file] })} className="shrink-0 text-[10px] text-primary">stage</button></li>)}</ul></div>}
              {gitStatus.modified.length + gitStatus.staged.length + gitStatus.untracked.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Working tree clean.</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={gitBusy || (gitStatus.modified.length === 0 && gitStatus.untracked.length === 0)} onClick={() => void gitAction('/api/jarvis/git/stage', { all: true })} className="rounded-lg bg-primary/20 px-2.5 py-1.5 text-[11px] font-medium text-primary disabled:opacity-40">Stage all</button>
                <button type="button" disabled={gitBusy || gitStatus.modified.length === 0} onClick={() => void gitAction('/api/jarvis/git/discard', { files: gitStatus.modified })} className="rounded-lg border px-2.5 py-1.5 text-[11px] disabled:opacity-40" style={{ borderColor: 'var(--build-error-border)', color: 'var(--build-error-text)' }}>Discard</button>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-secondary p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Commit</p>
                <div className="flex gap-2"><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void commitChanges(); }} placeholder="Commit message" className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" disabled={gitBusy || !commitMessage.trim()} onClick={() => void commitChanges()} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-white disabled:opacity-50"><GitCommit className="h-3 w-3" />Commit</button></div>
              </div>
              {gitDiff && <div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"><span>Diff</span><button type="button" onClick={() => setGitDiff('')} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button></p><pre className="max-h-40 overflow-auto rounded-lg p-2 font-mono text-[10px] text-foreground" style={{ backgroundColor: 'var(--build-code-bg)' }}>{gitDiff}</pre></div>}
              {gitBranches.length > 0 && <div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Branches</p><div className="flex flex-wrap gap-1.5">{gitBranches.map((branch) => <button key={branch} type="button" onClick={() => void switchBranch(branch)} className={'rounded-lg px-2 py-1 text-[10px] font-mono ' + (branch === gitCurrentBranch ? 'bg-primary/20 text-primary' : 'bg-input/50 text-muted-foreground hover:text-foreground')}>{branch}</button>)}</div><div className="mt-2 flex gap-2"><input value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createBranch(); }} placeholder="New branch name" className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" disabled={!newBranchName.trim()} onClick={() => void createBranch()} className="shrink-0 rounded-lg bg-primary/20 px-2.5 py-1.5 text-[11px] font-medium text-primary">Create</button></div></div>}
            </div>
          </div> : <div className="rounded-xl border border-border bg-secondary p-4 text-xs text-muted-foreground">No git repository yet. <button type="button" onClick={() => void initGit()} className="font-medium text-primary">Initialize one</button> — commits stay local to the workspace.</div>}
        </div>}
        {tab === 'search' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><Search className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">Search & replace</h3><p className="mt-0.5 text-xs text-muted-foreground">Search every file in the workspace, then replace across matching files.</p></div></div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runWorkspaceSearch(); }} placeholder="Search query (supports regex)" className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground" />
            <input value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder="Replace with…" className="w-44 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground" />
            <button type="button" disabled={searchBusy || !searchQuery.trim()} onClick={() => void runWorkspaceSearch()} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{searchBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}Search</button>
            <button type="button" disabled={searchBusy || searchResults.length === 0 || !replaceText} onClick={() => void replaceWorkspaceText()} className="rounded-lg border border-amber-400/40 px-3 py-2 text-xs text-amber-300 disabled:opacity-40">Replace all</button>
            <div className="flex items-center gap-0.5 rounded-lg border border-border px-1 py-1 text-[10px]">
              <button type="button" onClick={() => setSearchRegex((current) => !current)} title="Regex search" className={'rounded-md px-2 py-1 ' + (searchRegex ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-white/[0.06]')}>.*</button>
              <button type="button" onClick={() => setSearchCase((current) => !current)} title="Case sensitive" className={'rounded-md px-2 py-1 ' + (searchCase ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-white/[0.06]')}>Aa</button>
              <button type="button" onClick={() => setSearchHidden((current) => !current)} title="Include hidden files" className={'rounded-md px-2 py-1 ' + (searchHidden ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-white/[0.06]')}>Hidden</button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">{searchResults.length} match{searchResults.length === 1 ? '' : 'es'}{searchResults.length > 0 && ' across ' + new Set(searchResults.map((m) => m.file)).size + ' file' + (new Set(searchResults.map((m) => m.file)).size === 1 ? '' : 's')}</p>
          <ul className="space-y-2">{searchResults.map((match, index) => <li key={match.file + ':' + match.line + ':' + index} className="rounded-xl border border-border bg-secondary p-3">
            <div className="flex items-center justify-between gap-2"><button type="button" onClick={() => void openFile(match.file)} className="min-w-0 truncate font-mono text-[11px] text-primary hover:underline">{match.file}:{match.line}:{match.column}</button><span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 font-mono text-[9px] text-primary">{match.match}</span></div>
            <pre className="mt-1 overflow-auto rounded-lg style={{ backgroundColor: 'var(--build-code-bg)' }} p-2 font-mono text-[10px] text-foreground">{match.preview}</pre>
          </li>)}</ul>
        </div>}
        {tab === 'quality' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><TestTube2 className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">Quality: tests & debugging</h3><p className="mt-0.5 text-xs text-muted-foreground">Run detected test frameworks and analyze preview errors with Jarvis.</p></div></div>
          <div className="rounded-xl border border-border bg-secondary p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Test runner</p>
            {frameworks.length === 0 ? <p className="text-xs text-muted-foreground">No test frameworks detected (looks for Jest, Vitest, pytest, cargo test, go test…).</p> : <div className="flex flex-wrap items-center gap-2">
              <select value={selectedFramework} onChange={(event) => setSelectedFramework(event.target.value)} className="rounded-lg border border-border bg-input px-2 py-2 text-xs text-foreground outline-none">{frameworks.map((fw) => <option key={fw.key} value={fw.key}>{fw.name}</option>)}</select>
              <button type="button" disabled={qualityBusy} onClick={() => void runTests()} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{qualityBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Run tests</button>
              <button type="button" onClick={() => void loadQuality()} className="rounded-lg border border-border px-2.5 py-2 text-xs text-foreground">Detect</button>
            </div>}
            {testResult && <div className="mt-3 rounded-xl border border-border bg-background p-3">
              <div className="flex flex-wrap gap-3 text-xs"><span className="text-emerald-400">{testResult.passed} passed</span><span className="text-rose-400">{testResult.failed} failed</span>{testResult.skipped > 0 && <span className="text-muted-foreground">{testResult.skipped} skipped</span>}<span className="text-muted-foreground">{testResult.total} total · {(testResult.duration / 1000).toFixed(2)}s</span></div>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg style={{ backgroundColor: 'var(--build-code-bg)' }} p-2 font-mono text-[10px] text-foreground">{testResult.output || '(no output)'}</pre>
            </div>}
          </div>
          <div className="rounded-xl border border-border bg-secondary p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">AI debugging</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={!previewOutput.trim()} onClick={() => void analyzePreviewErrors()} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-foreground disabled:opacity-40"><Bug className="h-3 w-3" />Analyze preview errors</button>
              <button type="button" disabled={!debugError || debugBusy} onClick={() => void suggestFixes()} className="flex items-center gap-1.5 rounded-lg bg-primary/20 px-3 py-2 text-xs font-medium text-primary disabled:opacity-40">{debugBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}Suggest fixes</button>
            </div>
            {debugOutput && <pre className="mt-2 max-h-32 overflow-auto rounded-lg style={{ backgroundColor: 'var(--build-code-bg)' }} p-2 font-mono text-[10px] text-foreground">{debugOutput}</pre>}
            {debugFixes.length > 0 && <div className="mt-3 space-y-2">{debugFixes.map((fix, index) => <div key={fix.title + '-' + index} className="rounded-xl border border-border bg-background p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-foreground">{fix.title}</p><span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[9px] text-primary">{fix.confidence}%</span></div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{fix.description}</p><pre className="mt-2 max-h-40 overflow-auto rounded-lg style={{ backgroundColor: 'var(--build-code-bg)' }} p-2 font-mono text-[10px] text-foreground">{fix.code}</pre></div>)}</div>}
          </div>
        </div>}
        {tab === 'history' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><History className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">Snapshots & history</h3><p className="mt-0.5 text-xs text-muted-foreground">Snapshot the workspace and restore any point in time. Snapshots live in the current server session.</p></div><button type="button" disabled={historyBusy} onClick={() => void createSnapshot()} className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{historyBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}Snapshot now</button></div>
          {snapshots.length === 0 ? <p className="rounded-xl border border-border bg-secondary p-4 text-xs text-muted-foreground">No snapshots yet. Take one before big changes so you can roll back.</p> : <ul className="space-y-2">{snapshots.slice().reverse().map((snap) => <li key={snap.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-secondary p-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-foreground">{snap.label}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{new Date(snap.timestamp).toLocaleString()} · {snap.fileCount} files · {Math.round(snap.totalSize / 1024)} KB · {snap.trigger}</p></div><button type="button" onClick={() => void restoreSnapshot(snap.id)} className="shrink-0 rounded-lg bg-primary/20 px-2.5 py-1.5 text-[11px] font-medium text-primary">Restore</button></li>)}</ul>}
        </div>}
        {tab === 'templates' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><LayoutTemplate className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">Project templates</h3><p className="mt-0.5 text-xs text-muted-foreground">Start from a production-grade starter instead of a blank workspace.</p></div><button type="button" onClick={() => { void loadTemplates(); void loadCommunityTemplates(); }} className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground">Refresh</button></div>
          <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Built-in starters</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{templates.map((tmpl) => <div key={tmpl.id} className="rounded-xl border border-border bg-secondary p-3"><p className="text-xs font-semibold text-foreground">{tmpl.name}</p><p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{tmpl.description}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] text-primary">{tmpl.language}</span><button type="button" disabled={templateBusy} onClick={() => void applyTemplate(tmpl.id)} className="rounded-lg bg-primary px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-40">Use template</button></div></div>)}</div></div>
          <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Community (GitHub)</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{communityTemplates.map((tmpl) => <div key={tmpl.id} className="rounded-xl border border-border bg-secondary p-3"><p className="text-xs font-semibold text-foreground">{tmpl.name}</p><p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{tmpl.description}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[9px] text-muted-foreground">★ {tmpl.stars.toLocaleString()} · {tmpl.language}</span><a href={tmpl.url} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground">View</a></div></div>)}</div></div>
        </div>}
        {tab === 'docker' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><Container className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">Docker</h3><p className="mt-0.5 text-xs text-muted-foreground">{dockerStatus ? (dockerStatus.available ? 'Docker available' + (dockerStatus.version ? ' · ' + dockerStatus.version : '') : 'Docker is not installed or not running in this sandbox.') : 'Checking Docker…'}</p></div><button type="button" onClick={() => void refreshDocker()} className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground">Refresh</button></div>
          {dockerStatus && dockerStatus.available && <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Containers ({containers.length})</p>{containers.length === 0 ? <p className="text-xs text-muted-foreground">No running containers.</p> : <ul className="space-y-1.5">{containers.map((container) => <li key={container.id} className="flex items-center justify-between gap-2 rounded-lg bg-background px-2.5 py-1.5 text-xs"><span className="min-w-0 truncate font-mono text-foreground">{container.name}</span><span className="shrink-0 text-[10px] text-muted-foreground">{container.status}</span><button type="button" onClick={() => void stopContainer(container.id)} className="shrink-0 rounded-lg border border-rose-400/30 px-2 py-1 text-[10px] text-rose-400">Stop</button></li>)}</ul>}</div><div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Images ({dockerImages.length})</p>{dockerImages.length === 0 ? <p className="text-xs text-muted-foreground">No images found.</p> : <ul className="space-y-1.5">{dockerImages.map((image) => <li key={image.id} className="flex items-center justify-between gap-2 rounded-lg bg-background px-2.5 py-1.5 text-xs"><span className="min-w-0 truncate font-mono text-foreground">{image.repository}:{image.tag}</span><span className="shrink-0 text-[10px] text-muted-foreground">{image.size}</span></li>)}</ul>}</div></div>}
        </div>}
        {tab === 'database' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><Database className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">Database browser</h3><p className="mt-0.5 text-xs text-muted-foreground">Detects SQLite files in the workspace. Browse tables or run raw SQL.</p></div><button type="button" onClick={() => void detectDatabases()} className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground">Detect</button></div>
          {dbTables.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{dbTables.map((table) => <div key={table.name} className="rounded-xl border border-border bg-secondary p-3"><p className="flex items-center justify-between text-xs font-semibold text-foreground"><span className="truncate font-mono">{table.name}</span><span className="text-[10px] text-muted-foreground">{table.rowCount} rows</span></p><ul className="mt-2 space-y-0.5">{table.columns.slice(0, 8).map((column) => <li key={column.name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="rounded bg-background px-1 py-0.5 font-mono text-foreground">{column.name}</span><span className="text-muted-foreground/60">{column.type}</span>{column.primaryKey && <span className="text-amber-300">PK</span>}</li>)}</ul><button type="button" onClick={() => void browseTable(table.name)} className="mt-2 rounded-lg bg-primary/20 px-2 py-1 text-[10px] font-medium text-primary">Browse</button></div>)}</div>}
          <div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">SQL</p><div className="flex gap-2"><input value={dbQuery} onChange={(event) => setDbQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runDbQuery(); }} placeholder="SELECT * FROM table LIMIT 50" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" disabled={dbBusy || !dbQuery.trim()} onClick={() => void runDbQuery()} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{dbBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Run</button></div></div>
          {dbRows.length > 0 && <div className="overflow-auto rounded-xl border border-border bg-secondary p-3"><table className="w-full text-left text-[10px]"><thead><tr className="text-muted-foreground">{Object.keys(dbRows[0] ?? {}).map((key) => <th key={key} className="whitespace-nowrap px-2 py-1 font-mono">{key}</th>)}</tr></thead><tbody>{dbRows.map((row, index) => <tr key={index} className="border-t border-border">{Object.values(row).map((value, i) => <td key={i} className="whitespace-nowrap px-2 py-1 font-mono text-foreground/80">{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</td>)}</tr>)}</tbody></table></div>}
        </div>}
        {tab === 'api' && <div className="h-[calc(100%-49px)] space-y-4 overflow-auto p-5">
          <div className="flex items-center gap-3"><Globe className="h-6 w-6 text-primary" /><div><h3 className="text-sm font-semibold text-foreground">API explorer</h3><p className="mt-0.5 text-xs text-muted-foreground">{apiFramework ? 'Detected framework: ' + apiFramework : 'No API framework detected in the workspace.'}</p></div><button type="button" onClick={() => void loadApiExplorer()} className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground">Refresh</button></div>
          {apiEndpoints.length > 0 && <div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Endpoints ({apiEndpoints.length})</p><ul className="space-y-1">{apiEndpoints.map((endpoint, index) => <li key={endpoint.method + '-' + endpoint.path + '-' + index} className="flex items-center gap-2 rounded-lg bg-background px-2.5 py-1.5 text-xs"><span className={'w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold ' + (endpoint.method === 'GET' ? 'bg-emerald-400/15 text-emerald-400' : 'bg-amber-400/15 text-amber-300')}>{endpoint.method}</span><span className="min-w-0 truncate font-mono text-foreground">{endpoint.path}</span><button type="button" onClick={() => { setApiEndpointPath(endpoint.path); setApiMethod(endpoint.method); }} className="ml-auto shrink-0 text-[10px] text-primary">Use</button></li>)}</ul></div>}
          <div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Request</p><div className="flex flex-wrap gap-2"><select value={apiMethod} onChange={(event) => setApiMethod(event.target.value)} className="rounded-lg border border-border bg-input px-2 py-2 text-xs text-foreground outline-none">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select><input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="Base URL (http://localhost:PORT)" className="w-52 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground" /><input value={apiEndpointPath} onChange={(event) => setApiEndpointPath(event.target.value)} placeholder="/api/items" className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" disabled={apiBusy} onClick={() => void sendApiRequest()} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{apiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}Send</button></div><textarea value={apiBody} onChange={(event) => setApiBody(event.target.value)} placeholder="JSON body (for POST / PUT / PATCH)" rows={2} className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground" /></div>
          {apiResponse && <div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Response</p><pre className="max-h-64 overflow-auto rounded-lg style={{ backgroundColor: 'var(--build-code-bg)' }} p-2 font-mono text-[10px] text-foreground">{apiResponse}</pre></div>}
        </div>}
      </main></div>{plan && <BuildPlanView plan={plan} activeStepId={activeStepId} onClose={changePlan} onStepClick={setActiveStepId} />}{wizardOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setWizardOpen(false)}><div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">{t('studio.build.askTitle')}</h3></div><p className="mt-1 text-xs text-muted-foreground">{t('studio.build.askDesc')}</p><div className="mt-4 space-y-4">{featureInventory.length > 0 && <div className="rounded-xl border border-border bg-secondary p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('studio.build.inventoryTitle')}</p><div className="flex flex-wrap gap-1.5">{featureInventory.map((item) => <span key={item.key} className={`rounded-full border px-2 py-1 text-[10px] ${item.selected ? 'border-[var(--build-accent-read)]/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground/50 line-through'}`}>{item.label}</span>)}</div></div>}{wizardQuestions.map((question) => <div key={question.key}><p className="mb-1.5 text-xs font-medium text-foreground">{question.label}</p><div className="flex flex-wrap gap-1.5">{question.options?.map((option) => { const selected = wizardAnswers[question.key] === option; return <button type="button" key={option} onClick={() => setWizardAnswers((current) => ({ ...current, [question.key]: option }))} className={`rounded-full border px-2.5 py-1 text-[11px] transition ${selected ? 'border-[var(--build-accent-read)] bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:border-[var(--build-accent-read)]/40 hover:text-foreground'}`}>{option}</button>; })}<button type="button" onClick={() => setWizardAnswers((current) => { const next = { ...current }; delete next[question.key]; return next; })} className="rounded-full px-2 py-1 text-[11px] text-muted-foreground/60 hover:text-foreground">{t('studio.build.skip')}</button></div></div>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setWizardOpen(false); void continueBuild(wizardPrompt, {}, null); }} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground">{t('studio.build.skipAll')}</button><button type="button" disabled={wizardBusy || planBusy} onClick={() => { setWizardOpen(false); void continueBuild(wizardPrompt, wizardAnswers, null); }} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Hammer className="h-3.5 w-3.5" />{t('studio.build.buildIt')}</button></div></div></div>}{notice && <button type="button" onClick={() => setNotice(null)} className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-border/50 bg-background/95 px-4 py-2 text-xs shadow-lg">{notice} <Check className="ml-1 inline h-3 w-3 text-emerald-400" /></button>}{busy && <Loader2 className="absolute bottom-5 right-5 h-4 w-4 animate-spin text-primary" />}

        {/* Phase 0: Build Progress Ring - Top center on mobile */}
        {(progressStatus === 'working' || progressStatus === 'waiting') && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[75] md:hidden pointer-events-none">
            <BuildProgressRing
              total={progressItems.length || 1}
              completed={progressItems.filter(i => i.status === 'done').length}
              currentLabel={progressItems[progressItems.length - 1]?.message}
              status={progressStatus}
              elapsedMs={progressStartedAt ? Date.now() - progressStartedAt : 0}
              pulse={progressStatus === 'working'}
            />
          </div>
        )}

        {/* Phase 0: Portal-mounted Toaster (global toast system) */}
        <BuildToaster />

        {/* Phase 0: Command Palette */}
        <BuildCommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          items={commandPaletteItems}
          placeholder={t('studio.build.commandPalettePlaceholder') || 'Type a command…'}
        />

        {/* Phase 2.1: Diff Preview Modal */}
        <BuildDiffPreview
          diffs={diffPreviewDiffs}
          open={diffPreviewOpen}
          onClose={rejectDiffPreview}
          onApply={() => void applyDiffPreview()}
          onReject={() => void rejectDiffPreview()}
          title={t('studio.build.diffPreviewTitle') || 'Review proposed changes'}
        />

        {/* Transcript Bottom Sheet - Mobile */}
        {toolCalls.length > 0 && (
          <TranscriptBottomSheet
            toolCalls={toolCalls}
            open={transcriptSheetOpen}
            snap={transcriptSheetSnap}
            onSnapChange={setTranscriptSheetSnap}
            onClose={() => setTranscriptSheetOpen(false)}
          />
        )}</motion.div></motion.div></AnimatePresence>;
}
