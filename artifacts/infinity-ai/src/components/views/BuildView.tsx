/**
 * Build View — iOS-like UX: Preview + Overview tabs only
 * Preview: Live preview with iPhone 16 Pro frame, Desktop frame, Freeform mode
 * Overview: Build progress, transcript, plan, terminal, security, deploy - all visual
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AppShell, AppShellSidebarSection, AppShellSidebarNavItem } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Panel, PanelGroup, SplitPanel } from "@/components/layout/Panel";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Terminal } from "@/components/ui/Terminal";
import { CodeEditor, DiffEditor } from "@/components/ui/CodeEditor";
import { DiffView, InlineDiff, FileDiff } from "@/components/ui/DiffView";
import { Table, VirtualizedTable, Column } from "@/components/ui/Table";
import { Tree, FileTree } from "@/components/ui/Tree";
import { Dialog, AlertDialog, Drawer } from "@/components/ui/Dialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";
import { BuildPlanView } from "@/components/build-plan-view";
import { BuildTranscript } from "@/components/build-transcript";
import { BuildDiffPreview } from "@/components/build-diff-preview";
import { BuildDebugPanel } from "@/components/build-debug-panel";
import { BuildProgressPanel } from "@/components/build-progress-panel";
import { BuildProgressRing } from "@/components/build-progress-ring";
import { useTaskProvider } from "@/hooks/useLiveTaskDisplay";
import { AgentPanel, type ParallelTask, type AgentProgressEvent, type Workstream } from "@/components/build/AgentPanel";
import { PlusMenu, type PlusAction } from "@/components/plus-menu";
import { BuildCommandPalette, type CommandPaletteItem } from "@/components/build-command-palette";
import { BottomNav, type BottomNavItem } from "@/components/mobile/BottomNav";
import { SheetModal } from "@/components/mobile/SheetModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { AutomationList } from "@/components/automation";
import { useTheme } from "@/lib/use-theme";
import { haptics } from "@/lib/haptics";
import { MobileAppsView } from "@/components/mobile/MobileAppsView";
import { SecurityDashboard } from "@/components/security/SecurityDashboard";
import { ArtifactTemplateSelector } from "@/components/artifact-template-selector";
import { ChatView } from "@/components/views/ChatView";
import { AnalyticsDashboard } from "@/components/ui-builder/AnalyticsDashboard";
import { UIBuilderView } from "@/components/ui-builder/UIBuilderView";
import { LivePreview } from "@/components/ui-builder/LivePreview";
import { CodebaseIndexPanel } from "@/components/build/CodebaseIndexPanel";
import { ShadowWorkspacePanel } from "@/components/cursor/ShadowWorkspacePanel";
import { AgentReviewPanel } from "@/components/cursor/AgentReviewPanel";
import { PlanningPanel } from "@/components/cursor/PlanningPanel";
import { DebugPanel } from "@/components/cursor/DebugPanel";
import { DesignMode } from "@/components/design/DesignMode";
import { GitBranch, MessageSquare, Monitor, Smartphone, RotateCcw, Wrench, Shield, Zap, Globe, Terminal as TerminalIcon, LayoutDashboard, Database, Server, GitPullRequest, MousePointer2, Zap as ZapIcon } from "lucide-react";
import type { ArtifactTemplate, ArtifactTypeId } from "@/components/artifact-template-selector";

export interface BuildViewProps {
  /** Active project ID */
  projectId?: string | null;
  /** On project change */
  onProjectChange?: (projectId: string | null) => void;
  /** On navigate away */
  onBack?: () => void;
  /** Initial build prompt */
  initialPrompt?: string;
  /** Build run key for remounting */
  buildRunKey?: number;
  /** Parallel task for agent panel */
  parallelTask?: ParallelTask | null;
  /** SSE event stream for progress updates */
  onProgressEvent?: (event: AgentProgressEvent) => void;
  /** Start parallel execution */
  onStartParallel?: (goal: string) => void;
  /** Cancel parallel execution */
  onCancelParallel?: () => void;
  /** Create checkpoint */
  onCreateCheckpoint?: (workstreamId: string, description: string) => void;
  /** Rollback to checkpoint */
  onRollback?: (checkpointId: string) => void;
}

export const BuildView: React.FC<BuildViewProps> = ({
  projectId,
  onProjectChange,
  onBack,
  initialPrompt,
  buildRunKey,
  parallelTask,
  onProgressEvent,
  onStartParallel,
  onCancelParallel,
  onCreateCheckpoint,
  onRollback,
}) => {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const { theme, resolved, toggle: toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // TABS: Preview + Overview + Advanced Agent
  const [buildTab, setBuildTab] = useState<'preview' | 'overview' | 'advancedAgent'>('preview');
  const [commandInput, setCommandInput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusMenuCoords, setPlusMenuCoords] = useState<{ top: number; left: number } | null>(null);

  // Terminal command output (for /terminal slash command)
  const [terminalOutputOpen, setTerminalOutputOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<{ command: string; stdout: string; stderr: string; exitCode: number; timedOut?: boolean } | null>(null);
  const [terminalOutputBusy, setTerminalOutputBusy] = useState(false);

  // Mobile state - simplified
  const [bottomNavTab, setBottomNavTab] = useState<'preview' | 'overview'>('preview');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  // Agent panel state
  const [agentPanelOpen, setAgentPanelOpen] = useState(!!parallelTask);
  const [agentPanelCompact, setAgentPanelCompact] = useState(false);

  // Artifact template selector state
  const [templateSelectorOpen, setTemplateSelectorOpen] = useState(false);
  const [templates, setTemplates] = useState<ArtifactTemplate[]>([]);
  const [selectedArtifactType, setSelectedArtifactType] = useState<ArtifactTypeId | null>(null);

  // Preview URL from backend
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [previewPort, setPreviewPort] = useState(4173);

  // Design Mode state
  const [designModeActive, setDesignModeActive] = useState(false);
  const livePreviewRef = useRef<HTMLIFrameElement>(null);

  const handlePlusAction = useCallback((action: PlusAction) => {
    setPlusMenuOpen(false);
    setPlusMenuCoords(null);
    switch (action) {
      case 'build-mode':
        setBuildTab('overview');
        break;
      case 'studios':
        // Open studios hub
        break;
      case 'create-artifact':
        // Fetch templates from API and open selector
        fetch('/api/infinity/artifact-templates')
          .then(res => res.json())
          .then(data => {
            if (data.ok && data.templates) {
              setTemplates(data.templates);
              setTemplateSelectorOpen(true);
            }
          })
          .catch(err => console.error('Failed to fetch templates:', err));
        break;
    }
  }, []);

  const handleCommandSubmit = useCallback(async () => {
    const trimmed = commandInput.trim();
    if (!trimmed || commandBusy) return;

    // Check for /terminal slash command
    const terminalPrefix = '/terminal ';
    if (trimmed.startsWith(terminalPrefix)) {
      const command = trimmed.slice(terminalPrefix.length).trim();
      if (command) {
        setCommandBusy(true);
        setTerminalOutputBusy(true);
        setTerminalOutput(null);
        setTerminalOutputOpen(true);

        try {
          // Execute via terminal API
          const response = await fetch('/api/infinity/terminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceId: projectId ?? 'default',
              sessionId: 'buildview-terminal',
              command,
            }),
          });

          const data = await response.json();
          setTerminalOutput({
            command,
            stdout: data.stdout ?? data.output ?? '',
            stderr: data.stderr ?? '',
            exitCode: data.exitCode ?? (response.ok ? 0 : 1),
            timedOut: data.timedOut,
          });
        } catch (err) {
          setTerminalOutput({
            command,
            stdout: '',
            stderr: err instanceof Error ? err.message : 'Failed to execute command',
            exitCode: 1,
          });
        } finally {
          setCommandBusy(false);
          setTerminalOutputBusy(false);
        }
      }
      setCommandInput('');
      return;
    }

    // Regular command execution (placeholder for future)
    setCommandBusy(true);
    setCommandInput('');
    await new Promise(r => setTimeout(r, 100));
    setCommandBusy(false);
  }, [commandInput, commandBusy, projectId]);

  const handleOpenPlusMenu = useCallback((ref: React.RefObject<HTMLDivElement>) => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPlusMenuCoords({ top: rect.bottom + 8, left: rect.left });
      setPlusMenuOpen(true);
    }
  }, []);

  /* ── Mobile variant ── */
  if (isMobile) {
    const bottomNavItems: BottomNavItem[] = [
      {
        id: 'preview',
        label: t('build.tabs.preview'),
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        ),
      },
      {
        id: 'overview',
        label: t('build.tabs.overview'),
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        ),
      },
    ];

    return (
      <div className="h-dvh flex flex-col bg-background text-foreground overflow-hidden">
        {/* Mobile header */}
        <header className="shrink-0 glass-strong border-b border-border-primary/60 px-4 py-3 flex items-center gap-3">
          {onBack && (
            <IconButton
              onClick={onBack}
              aria-label={t('common.back')}
              variant="ghost"
              size="sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </IconButton>
          )}
          <h1 className="text-lg font-semibold flex-1">{t('build.title')}</h1>
          <IconButton
            onClick={() => toggleTheme()}
            aria-label={t('settings.theme')}
            variant="ghost"
            size="sm"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {theme === 'dark' ? (
                <circle cx="12" cy="12" r="5" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </>
              )}
            </svg>
          </IconButton>
          <IconButton
            onClick={() => setHistoryOpen(true)}
            aria-label={t('build.sidebar.recentBuilds')}
            variant="ghost"
            size="sm"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </IconButton>
        </header>

        {/* Build tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {bottomNavTab === 'preview' && (
            <div className="flex flex-col h-full">
              <LivePreview
                projectId={projectId ?? ''}
                initialUrl={previewUrl}
                onUrlChange={setPreviewUrl}
                onPreviewStart={() => setPreviewRunning(true)}
                onPreviewStop={() => setPreviewRunning(false)}
              />
            </div>
          )}
          {bottomNavTab === 'overview' && (
            <div className="flex flex-col h-full">
              <BuildOverviewPanel
                projectId={projectId ?? ''}
                initialPrompt={initialPrompt}
                buildRunKey={buildRunKey}
                parallelTask={parallelTask}
                onProgressEvent={onProgressEvent}
                onStartParallel={onStartParallel}
                onCancelParallel={onCancelParallel}
                onCreateCheckpoint={onCreateCheckpoint}
                onRollback={onRollback}
              />
            </div>
          )}
        </div>

        {/* Command input bar for terminal */}
        {bottomNavTab === 'overview' && (
          <div className="shrink-0 border-t border-border-primary bg-bg-elevated/50 backdrop-blur-xl p-3 safe-area-inset-bottom">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm font-mono">$</span>
              <Input
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCommandSubmit()}
                placeholder={t('build.terminal.placeholder')}
                disabled={commandBusy}
                className="flex-1"
              />
              <IconButton
                onClick={handleCommandSubmit}
                disabled={commandBusy || !commandInput.trim()}
                aria-label={t('common.run')}
                variant="primary"
                size="sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </IconButton>
            </div>
          </div>
        )}

        {/* Bottom nav */}
        <BottomNav
          items={bottomNavItems}
          activeId={bottomNavTab}
          onChange={(id) => {
            setBottomNavTab(id as typeof bottomNavTab);
            if (id === 'history') setHistoryOpen(true);
            if (id === 'tools') setToolsOpen(true);
          }}
        />

        {/* History sheet */}
        <SheetModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title={t('build.sidebar.recentBuilds')}
          defaultSnapPoint="half"
        >
          <div className="space-y-2">
            {commandHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('build.transcriptEmpty')}
              </p>
            ) : (
              commandHistory.map((cmd, i) => (
                <button
                  key={`${cmd}-${i}`}
                  onClick={() => {
                    setCommandInput(cmd);
                    setHistoryOpen(false);
                    setBottomNavTab('overview');
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg bg-bg-elevated/50 hover:bg-bg-elevated font-mono text-sm"
                >
                  <span className="text-muted-foreground">$ </span>
                  {cmd}
                </button>
              ))
            )}
          </div>
        </SheetModal>

        {/* Terminal output drawer for /terminal command (mobile) */}
        {terminalOutputOpen && (
          <Drawer
            open={terminalOutputOpen}
            onClose={() => setTerminalOutputOpen(false)}
            position="bottom"
            size="full"
            title={terminalOutput ? `${t('build.tabs.terminal')}: ${terminalOutput.command}` : t('build.tabs.terminal')}
          >
            {terminalOutput && (
              <div className="flex flex-col h-full p-4 space-y-4 font-mono text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono">$</span>
                  <span className="break-all">{terminalOutput.command}</span>
                  <span className="ml-auto px-2 py-0.5 text-xs rounded bg-muted">
                    {terminalOutput.timedOut ? 'TIMEOUT' : terminalOutput.exitCode === 0 ? 'OK' : 'FAILED'}
                  </span>
                </div>
                {(terminalOutput.stdout || terminalOutput.stderr) && (
                  <div className="flex-1 overflow-auto bg-black/20 rounded p-3 space-y-2 min-h-0">
                    {terminalOutput.stdout && (
                      <pre className="whitespace-pre-wrap text-green-300">{terminalOutput.stdout}</pre>
                    )}
                    {terminalOutput.stderr && (
                      <pre className="whitespace-pre-wrap text-red-300">{terminalOutput.stderr}</pre>
                    )}
                    {(!terminalOutput.stdout && !terminalOutput.stderr) && (
                      <p className="text-muted-foreground text-center py-8">No output</p>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <Button variant="ghost" size="sm" onClick={() => setTerminalOutputOpen(false)}>
                    {t('common.close')}
                  </Button>
                </div>
              </div>
            )}
          </Drawer>
        )}
      </div>
    );
  }

  /* ── Desktop variant ── */
  return (
    <AppShell
      header={
        <div className="flex items-center gap-4 w-full">
          {onBack && (
            <IconButton
              onClick={onBack}
              aria-label={t('common.back')}
              variant="ghost"
              size="sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </IconButton>
          )}
          <h1 className="text-xl font-semibold text-foreground">{t('build.title')}</h1>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            {/* TABS: Preview + Overview + Advanced Agent */}
            <Tabs
              tabs={[
                { id: 'preview', label: t('build.tabs.preview'), icon: <Monitor className="w-4 h-4" /> },
                { id: 'overview', label: t('build.tabs.overview'), icon: <LayoutDashboard className="w-4 h-4" /> },
                { id: 'advancedAgent', label: t('build.tabs.advancedAgent'), icon: <MousePointer2 className="w-4 h-4" /> },
              ]}
              activeTab={buildTab}
              onChange={(tab) => setBuildTab(tab as 'preview' | 'overview' | 'advancedAgent')}
              variant="pills"
              className="max-w-md"
            />
            <IconButton
              ref={handleOpenPlusMenu as any}
              onClick={() => setPlusMenuOpen(!plusMenuOpen)}
              aria-label={t('common.more')}
              variant="ghost"
              size="sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1"/>
                <circle cx="19" cy="12" r="1"/>
                <circle cx="5" cy="12" r="1"/>
              </svg>
            </IconButton>
            <IconButton
              onClick={() => toggleTheme()}
              aria-label={t('settings.theme')}
              variant="ghost"
              size="sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {theme === 'dark' ? (
                  <circle cx="12" cy="12" r="5"/>
                ) : (
                  <>
                    <circle cx="12" cy="12" r="5"/>
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                  </>
                )}
              </svg>
            </IconButton>
          </div>
        </div>
      }
      sidebar={
        <Sidebar
          collapsed={collapsed}
          onCollapseToggle={setCollapsed}
          width={280}
        >
          <AppShellSidebarSection title={t('build.sidebar.sections.project')}>
            <div className="space-y-2">
              <Button
                variant={!projectId ? 'primary' : 'secondary'}
                size="sm"
                className="w-full justify-start"
                onClick={() => onProjectChange?.(null)}
              >
                {t('build.sidebar.allProjects')}
              </Button>
              {/* Project list would be here */}
            </div>
          </AppShellSidebarSection>

          <AppShellSidebarSection title={t('build.sidebar.sections.history')}>
            <div className="space-y-1">
              <AppShellSidebarNavItem
                label={t('build.sidebar.recentBuilds')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>}
                onClick={() => setBuildTab('overview')}
                active={buildTab === 'overview'}
              />
            </div>
          </AppShellSidebarSection>

          <AppShellSidebarSection title={t('build.sidebar.sections.tools')}>
            <div className="space-y-1">
              <AppShellSidebarNavItem
                label={t('build.tabs.preview')}
                icon={<Monitor className="w-4 h-4" />}
                onClick={() => setBuildTab('preview')}
                active={buildTab === 'preview'}
              />
              <AppShellSidebarNavItem
                label={t('build.tabs.overview')}
                icon={<LayoutDashboard className="w-4 h-4" />}
                onClick={() => setBuildTab('overview')}
                active={buildTab === 'overview'}
              />
              <AppShellSidebarNavItem
                label={t('overview.tabs.security')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>}
                onClick={() => { setBuildTab('overview'); }}
                active={false}
              />
              <AppShellSidebarNavItem
                label={t('mobile.title')}
                icon={<Smartphone className="w-4 h-4" />}
                onClick={() => { setBuildTab('overview'); }}
                active={false}
              />
            </div>
          </AppShellSidebarSection>
        </Sidebar>
      }
      rightSidebar={
        <Sidebar
          width={320}
        >
          <AppShellSidebarSection title={t('build.sidebar.sections.debug')}>
            <BuildDebugPanel workspaceId={projectId ?? ''} />
          </AppShellSidebarSection>
          {agentPanelOpen && parallelTask && (
            <AppShellSidebarSection title={t('build.sidebar.sections.agents')}>
              <AgentPanel
                task={parallelTask}
                onProgressEvent={onProgressEvent}
                onCancel={onCancelParallel}
                onCreateCheckpoint={onCreateCheckpoint}
                onRollback={onRollback}
                compact={agentPanelCompact}
              />
            </AppShellSidebarSection>
          )}
        </Sidebar>
      }
      sidebarOpen={sidebarOpen}
      rightSidebarOpen={rightSidebarOpen}
      collapsed={collapsed}
      onSidebarToggle={setSidebarOpen}
      onRightSidebarToggle={setRightSidebarOpen}
      onCollapseToggle={setCollapsed}
    >
      <div className="flex flex-col h-full">
        {/* Tab content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {buildTab === 'preview' && (
            <div className="flex-1 flex flex-col relative">
              <LivePreview
                ref={livePreviewRef}
                projectId={projectId ?? ''}
                initialUrl={previewUrl}
                onUrlChange={setPreviewUrl}
                onPreviewStart={() => setPreviewRunning(true)}
                onPreviewStop={() => setPreviewRunning(false)}
              />
              {designModeActive && livePreviewRef.current && (
                <DesignMode
                  previewRef={livePreviewRef}
                  onToggleDesignMode={setDesignModeActive}
                />
              )}
            </div>
          )}
          {buildTab === 'overview' && (
            <BuildOverviewPanel
              projectId={projectId ?? ''}
              initialPrompt={initialPrompt}
              buildRunKey={buildRunKey}
              parallelTask={parallelTask}
              onProgressEvent={onProgressEvent}
              onStartParallel={onStartParallel}
              onCancelParallel={onCancelParallel}
              onCreateCheckpoint={onCreateCheckpoint}
              onRollback={onRollback}
            />
          )}
          {buildTab === 'advancedAgent' && (
            <div className="flex flex-col h-full">
              <AdvancedAgentPanel projectId={projectId ?? ''} />
            </div>
          )}
        </div>

        {/* Command input bar for terminal (only in overview tab) */}
        {buildTab === 'overview' && (
          <div className="border-t border-border-primary bg-bg-elevated/50 backdrop-blur-sm p-3">
            <div className="flex items-center gap-2 max-w-4xl mx-auto">
              <span className="text-muted-foreground text-sm font-mono">$</span>
              <Input
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCommandSubmit()}
                placeholder={t('build.terminal.placeholder')}
                disabled={commandBusy}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleCommandSubmit}
                disabled={commandBusy || !commandInput.trim()}
              >
                {commandBusy ? t('common.running') : t('common.run')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Plus menu */}
      {plusMenuOpen && plusMenuCoords && (
        <PlusMenu
          open={plusMenuOpen}
          onClose={() => { setPlusMenuOpen(false); setPlusMenuCoords(null); }}
          coords={plusMenuCoords}
          onAction={handlePlusAction}
          labels={{
            attachFile: t('input.attachFile'),
            camera: t('input.camera'),
            newExpert: 'New Expert',
            generateImage: t('input.generateImage'),
            createArtifact: 'Create Artifact',
            buildMode: t('mode.build'),
            research: 'Deep Research',
            dataLab: 'Data Lab',
          }}
        />
      )}

      {/* Artifact Template Selector */}
      <ArtifactTemplateSelector
        open={templateSelectorOpen}
        onClose={() => setTemplateSelectorOpen(false)}
        onSelect={async (templateId, artifactType) => {
          setTemplateSelectorOpen(false);
          setSelectedArtifactType(artifactType);

          // Create project from template
          const template = templates.find(t => t.id === templateId);
          if (!template) return;

          try {
            const response = await fetch('/api/infinity/artifact-templates/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                templateId,
                projectName: template.name,
                projectId: projectId ?? 'default',
              }),
            });

            const data = await response.json();
            if (data.ok && data.artifactConfig) {
              // Trigger parallel artifact build via orchestrator
              console.log('Artifact created:', data.artifactConfig);
              // Navigate to overview tab to show the build
              setBuildTab('overview');
            }
          } catch (err) {
            console.error('Failed to create artifact from template:', err);
          }
        }}
        templates={templates}
        selectedArtifactType={selectedArtifactType ?? undefined}
      />

      {/* Command palette - BuildCommandPalette used instead of standard */}
      <BuildCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={[
          { id: 'preview', label: t('build.tabs.preview'), icon: <Monitor className="w-4 h-4" />, action: () => setBuildTab('preview') },
          { id: 'overview', label: t('build.tabs.overview'), icon: <LayoutDashboard className="w-4 h-4" />, action: () => setBuildTab('overview') },
          { id: 'terminal', label: t('overview.tabs.terminal'), icon: <TerminalIcon className="w-4 h-4" />, action: () => setBuildTab('overview') },
          { id: 'security', label: t('overview.tabs.security'), icon: <Shield className="w-4 h-4" />, action: () => setBuildTab('overview') },
          { id: 'mobile', label: t('mobile.title'), icon: <Smartphone className="w-4 h-4" />, action: () => setBuildTab('overview') },
        ]}
      />

      {/* Terminal output drawer for /terminal command */}
      <Drawer
        open={terminalOutputOpen}
        onClose={() => setTerminalOutputOpen(false)}
        position="bottom"
        size="full"
        title={terminalOutput ? `${t('build.tabs.terminal')}: ${terminalOutput.command}` : t('build.tabs.terminal')}
      >
        {terminalOutput && (
          <div className="flex flex-col h-full p-4 space-y-4 font-mono text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="font-mono">$</span>
              <span className="break-all">{terminalOutput.command}</span>
              <span className="ml-auto px-2 py-0.5 text-xs rounded bg-muted">
                {terminalOutput.timedOut ? 'TIMEOUT' : terminalOutput.exitCode === 0 ? 'OK' : 'FAILED'}
              </span>
            </div>
            {(terminalOutput.stdout || terminalOutput.stderr) && (
              <div className="flex-1 overflow-auto bg-black/20 rounded p-3 space-y-2 min-h-0">
                {terminalOutput.stdout && (
                  <pre className="whitespace-pre-wrap text-green-300">{terminalOutput.stdout}</pre>
                )}
                {terminalOutput.stderr && (
                  <pre className="whitespace-pre-wrap text-red-300">{terminalOutput.stderr}</pre>
                )}
                {(!terminalOutput.stdout && !terminalOutput.stderr) && (
                  <p className="text-muted-foreground text-center py-8">No output</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="ghost" size="sm" onClick={() => setTerminalOutputOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </AppShell>
  );
};

export default BuildView;

/* ──────────────────────────────────────────────────────────────────────────
 * Build Overview Panel — Everything visual: progress, transcript, plan, terminal, security, deploy
 * ────────────────────────────────────────────────────────────────────────── */

interface BuildOverviewPanelProps {
  projectId: string;
  initialPrompt?: string;
  buildRunKey?: number;
  parallelTask?: ParallelTask | null;
  onProgressEvent?: (event: AgentProgressEvent) => void;
  onStartParallel?: (goal: string) => void;
  onCancelParallel?: () => void;
  onCreateCheckpoint?: (workstreamId: string, description: string) => void;
  onRollback?: (checkpointId: string) => void;
}

const BuildOverviewPanel: React.FC<BuildOverviewPanelProps> = ({
  projectId,
  initialPrompt,
  buildRunKey,
  parallelTask,
  onProgressEvent,
  onStartParallel,
  onCancelParallel,
  onCreateCheckpoint,
  onRollback,
}) => {
  const { t } = useI18n();
  const { build: buildTaskProvider } = useTaskProvider('BuildOverviewPanel');
  const [overviewTab, setOverviewTab] = useState<'progress' | 'transcript' | 'plan' | 'terminal' | 'security' | 'deploy' | 'agents' | 'codebase' | 'shadowWorkspaces' | 'agentReview' | 'automations'>('progress');

  return (
    <div className="flex flex-col h-full">
      {/* Overview sub-tabs - visual, horizontal */}
      <div className="shrink-0 border-b border-border-primary bg-bg-elevated/50 backdrop-blur-sm">
        <Tabs
          tabs={[
            { id: 'progress', label: t('overview.tabs.progress'), icon: <Zap className="w-4 h-4" /> },
            { id: 'plan', label: t('overview.tabs.plan'), icon: <GitBranch className="w-4 h-4" /> },
            { id: 'transcript', label: t('overview.tabs.transcript'), icon: <MessageSquare className="w-4 h-4" /> },
            { id: 'terminal', label: t('overview.tabs.terminal'), icon: <TerminalIcon className="w-4 h-4" /> },
            { id: 'security', label: t('overview.tabs.security'), icon: <Shield className="w-4 h-4" /> },
            { id: 'deploy', label: t('overview.tabs.deploy'), icon: <Globe className="w-4 h-4" /> },
            { id: 'agents', label: t('overview.tabs.agents'), icon: <Wrench className="w-4 h-4" /> },
            { id: 'codebase', label: t('overview.tabs.codebase'), icon: <Database className="w-4 h-4" /> },
            { id: 'shadowWorkspaces', label: t('overview.tabs.shadowWorkspaces'), icon: <Server className="w-4 h-4" /> },
            { id: 'agentReview', label: t('overview.tabs.agentReview'), icon: <GitPullRequest className="w-4 h-4" /> },
            { id: 'automations', label: t('overview.tabs.automations'), icon: <ZapIcon className="w-4 h-4" /> },
          ]}
          activeTab={overviewTab}
          onChange={(tab) => setOverviewTab(tab as typeof overviewTab)}
          variant="pills"
          className="mx-auto max-w-5xl px-4 py-2"
        />
      </div>

      {/* Overview tab content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {overviewTab === 'progress' && (
          <BuildProgressContent
            projectId={projectId}
            initialPrompt={initialPrompt}
            buildRunKey={buildRunKey}
            onStartParallel={onStartParallel}
            onCancelParallel={onCancelParallel}
            buildTaskProvider={buildTaskProvider}
          />
        )}
        {overviewTab === 'plan' && (
          <BuildPlanView
            workspaceId={projectId}
            initialPrompt={initialPrompt}
            buildRunKey={buildRunKey}
            onStartParallel={onStartParallel}
          />
        )}
        {overviewTab === 'transcript' && (
          <BuildTranscript toolCalls={[]} autoScroll />
        )}
        {overviewTab === 'terminal' && (
          <div className="flex flex-col h-full">
            <Terminal
              theme={resolved as 'light' | 'dark'}
              onReady={(term) => {
                if (initialPrompt) term.writeln(`$ ${initialPrompt}`);
              }}
            />
          </div>
        )}
        {overviewTab === 'security' && (
          <div className="flex flex-col h-full">
            <SecurityDashboard projectId={projectId} />
          </div>
        )}
        {overviewTab === 'deploy' && (
          <div className="flex flex-col h-full p-4">
            <DeployVisualPanel projectId={projectId} />
          </div>
        )}
        {overviewTab === 'agents' && parallelTask && (
          <div className="flex flex-col h-full p-4">
            <AgentPanel
              task={parallelTask}
              onProgressEvent={onProgressEvent}
              onCancel={onCancelParallel}
              onCreateCheckpoint={onCreateCheckpoint}
              onRollback={onRollback}
            />
          </div>
        )}
        {overviewTab === 'agents' && !parallelTask && (
          <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
            <p className="text-center">{t('build.agentPanel.noTask')}</p>
            <p className="text-sm text-center mt-2">{t('build.agentPanel.startBuildToSeeAgents')}</p>
          </div>
        )}
        {overviewTab === 'codebase' && (
          <div className="flex flex-col h-full">
            <CodebaseIndexPanel projectId={projectId} projectRoot="/" />
          </div>
        )}
        {overviewTab === 'shadowWorkspaces' && (
          <div className="flex flex-col h-full">
            <ShadowWorkspacePanel projectId={projectId} projectRoot="/" />
          </div>
        )}
        {overviewTab === 'agentReview' && (
          <div className="flex flex-col h-full">
            <AgentReviewPanel projectId={projectId} />
          </div>
        )}
        {overviewTab === 'automations' && (
          <div className="flex flex-col h-full">
            <AutomationList projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
 * Build Progress Content — Progress view with Live Task Display integration
 * ────────────────────────────────────────────────────────────────────────── */

interface BuildProgressContentProps {
  projectId: string;
  initialPrompt?: string;
  buildRunKey?: number;
  onStartParallel?: (goal: string) => void;
  onCancelParallel?: () => void;
  buildTaskProvider: ReturnType<typeof useTaskProvider>['build'];
}

const BuildProgressContent: React.FC<BuildProgressContentProps> = ({
  projectId,
  initialPrompt,
  buildRunKey,
  onStartParallel,
  onCancelParallel,
  buildTaskProvider,
}) => {
  const { t } = useI18n();
  const [buildTaskId, setBuildTaskId] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);

  const handleStartBuild = useCallback(async () => {
    if (!initialPrompt || isBuilding) return;

    setIsBuilding(true);
    try {
      // Create a build task in the Live Task Display
      const task = await buildTaskProvider.start(
        projectId,
        `build-${buildRunKey || Date.now()}`,
        'planning',
        t('build.progress.planning'),
        initialPrompt
      );
      setBuildTaskId(task.id);

      // Start the actual build
      onStartParallel?.(initialPrompt);
    } catch (err) {
      console.error('Failed to start build task:', err);
      setIsBuilding(false);
    }
  }, [initialPrompt, isBuilding, buildRunKey, buildTaskProvider, onStartParallel, projectId, t]);

  const handleCancelBuild = useCallback(async () => {
    if (buildTaskId) {
      await buildTaskProvider.error(buildTaskId, t('build.progress.cancelled'));
      setBuildTaskId(null);
    }
    onCancelParallel?.();
    setIsBuilding(false);
  }, [buildTaskId, buildTaskProvider, onCancelParallel, t]);

  // Build phases
  const phases = [
    { id: 'planning', label: t('build.progress.planning'), icon: <GitBranch className="w-4 h-4" /> },
    { id: 'generating', label: t('build.progress.generating'), icon: <Wrench className="w-4 h-4" /> },
    { id: 'reviewing', label: t('build.progress.reviewing'), icon: <GitPullRequest className="w-4 h-4" /> },
    { id: 'deploying', label: t('build.progress.deploying'), icon: <Globe className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full p-4 space-y-6">
      {/* Pipeline visualization */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">{t('build.progress.pipeline')}</h2>

        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-10 top-0 bottom-0 w-0.5 bg-border-primary/30" />

          <div className="space-y-4">
            {phases.map((phase, index) => (
              <div key={phase.id} className="relative flex items-start gap-4">
                <div className={`relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center z-10 transition-all duration-300 ${
                  isBuilding && buildTaskId ? 'bg-brand-500 text-white ring-4 ring-brand-500/30' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {phase.icon}
                  {isBuilding && buildTaskId && (
                    <div className="absolute -inset-1 rounded-full bg-brand-500/30 animate-ping" />
                  )}
                </div>
                <div className="flex-1 pt-1">
                  <div className={`font-medium transition-colors ${
                    isBuilding && buildTaskId ? 'text-brand-400' : 'text-foreground'
                  }`}>
                    {phase.label}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {isBuilding && buildTaskId ? t('build.progress.running') : t('build.progress.pending')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action button */}
      <div className="flex justify-end">
        {isBuilding ? (
          <Button
            onClick={handleCancelBuild}
            variant="destructive"
            size="lg"
          >
            {t('build.progress.cancel')}
          </Button>
        ) : (
          <Button
            onClick={handleStartBuild}
            disabled={!initialPrompt}
            variant="primary"
            size="lg"
          >
            {t('build.progress.start')}
          </Button>
        )}
      </div>
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
 * Deploy Visual Panel — Visual pipeline/steps for deployment
 * ────────────────────────────────────────────────────────────────────────── */

const DeployVisualPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useI18n();
  const [deployStage, setDeployStage] = useState<'idle' | 'building' | 'testing' | 'security' | 'deploying' | 'complete' | 'failed'>('idle');
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  const stages = [
    { id: 'building', label: t('deploy.stages.build'), icon: <Wrench className="w-5 h-5" /> },
    { id: 'testing', label: t('deploy.stages.test'), icon: <TerminalIcon className="w-5 h-5" /> },
    { id: 'security', label: t('deploy.stages.security'), icon: <Shield className="w-5 h-5" /> },
    { id: 'deploying', label: t('deploy.stages.deploy'), icon: <Globe className="w-5 h-5" /> },
  ];

  const runDeploy = async () => {
    setDeployStage('building');
    setDeployLogs([]);
    const log = (msg: string) => setDeployLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    log('Starting deployment pipeline...');

    try {
      // Stage 1: Build
      log('Building project...');
      setDeployStage('building');
      await new Promise(r => setTimeout(r, 1500));
      log('Build complete ✓');

      // Stage 2: Test
      log('Running tests...');
      setDeployStage('testing');
      await new Promise(r => setTimeout(r, 1000));
      log('All tests passed ✓');

      // Stage 3: Security
      log('Running security scan...');
      setDeployStage('security');
      await new Promise(r => setTimeout(r, 1000));
      log('Security scan passed ✓');

      // Stage 4: Deploy
      log('Deploying to production...');
      setDeployStage('deploying');
      await new Promise(r => setTimeout(r, 1500));

      const url = `https://${projectId}.infinity.ai`;
      setDeployUrl(url);
      log(`Deployment complete! Live at ${url}`);
      setDeployStage('complete');
    } catch (err) {
      log(`Deployment failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setDeployStage('failed');
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-6 p-4">
      {/* Pipeline visualization */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">{t('deploy.pipeline')}</h2>

        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-10 top-0 bottom-0 w-0.5 bg-border-primary/30" />

          <div className="space-y-4">
            {stages.map((stage, index) => (
              <div key={stage.id} className="relative flex items-start gap-4">
                <div className={`relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center z-10 transition-all duration-300 ${
                  deployStage === stage.id ? 'bg-brand-500 text-white ring-4 ring-brand-500/30' :
                  ['complete'].includes(deployStage) || stages.slice(0, index).some(s => s.id === deployStage) ? 'bg-green-500 text-white' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {stage.icon}
                  {deployStage === stage.id && (
                    <div className="absolute -inset-1 rounded-full bg-brand-500/30 animate-ping" />
                  )}
                </div>
                <div className="flex-1 pt-1">
                  <div className={`font-medium transition-colors ${
                    deployStage === stage.id ? 'text-brand-400' : 'text-foreground'
                  }`}>
                    {stage.label}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {deployStage === stage.id ? t('deploy.status.running') :
                    ['complete'].includes(deployStage) || stages.slice(0, index).some(s => s.id === deployStage) ? t('deploy.status.complete') :
                    t('deploy.status.pending')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="flex-1 min-h-0 bg-black/20 rounded-lg border border-border-primary overflow-hidden">
        <div className="p-3 border-b border-border-primary flex items-center justify-between">
          <h3 className="font-medium">{t('deploy.logs')}</h3>
          {deployStage === 'complete' && deployUrl && (
            <a href={deployUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-400 hover:underline flex items-center gap-1">
              <Globe className="w-4 h-4" />
              {t('deploy.openSite')}
            </a>
          )}
        </div>
        <div className="flex-1 overflow-auto p-3 font-mono text-sm text-green-300">
          {deployLogs.map((log, i) => (
            <div key={i} className="whitespace-pre-wrap">{log}</div>
          ))}
          {deployLogs.length === 0 && (
            <p className="text-muted-foreground text-center py-8">{t('deploy.noLogs')}</p>
          )}
        </div>
      </div>

      {/* Action button */}
      <div className="flex justify-end">
        <Button
          onClick={runDeploy}
          disabled={deployStage !== 'idle' && deployStage !== 'complete' && deployStage !== 'failed'}
          variant={deployStage === 'complete' ? 'secondary' : 'primary'}
          size="lg"
        >
          {deployStage === 'idle' ? t('deploy.start') :
           deployStage === 'complete' ? t('deploy.redeploy') :
           deployStage === 'failed' ? t('deploy.retry') :
           t('deploy.running')}
        </Button>
      </div>
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
 * Advanced Agent Panel — Planning Mode + Debugging Agent
 * ────────────────────────────────────────────────────────────────────────── */

const AdvancedAgentPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useI18n();
  const [advancedTab, setAdvancedTab] = useState<'planning' | 'debugging'>('planning');

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border-primary bg-bg-elevated/50 backdrop-blur-sm">
        <Tabs
          tabs={[
            { id: 'planning', label: t('advancedAgent.tabs.planning'), icon: <GitBranch className="w-4 h-4" /> },
            { id: 'debugging', label: t('advancedAgent.tabs.debugging'), icon: <TerminalIcon className="w-4 h-4" /> },
          ]}
          activeTab={advancedTab}
          onChange={(tab) => setAdvancedTab(tab as 'planning' | 'debugging')}
          variant="pills"
          className="mx-auto max-w-5xl px-4 py-2"
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {advancedTab === 'planning' && (
          <div className="flex flex-col h-full">
            <PlanningPanel workspaceId={projectId} />
          </div>
        )}
        {advancedTab === 'debugging' && (
          <div className="flex flex-col h-full">
            <DebugPanel workspaceId={projectId} />
          </div>
        )}
      </div>
    </div>
  );
};