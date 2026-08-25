/**
 * Build View — Liquid Glass Design System
 * Main build studio interface with plan, transcript, diff preview, and debug panel
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { AppShell, AppShellSidebarSection, AppShellSidebarNavItem } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Panel, PanelGroup, SplitPanel } from "@/components/layout/Panel";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Terminal, TerminalSession } from "@/components/ui/Terminal";
import { CodeEditor, DiffEditor } from "@/components/ui/CodeEditor";
import { DiffView, InlineDiff, FileDiff } from "@/components/ui/DiffView";
import { Table, VirtualizedTable, Column } from "@/components/ui/Table";
import { Tree, FileTree } from "@/components/ui/Tree";
import { Dialog, AlertDialog, Drawer } from "@/components/ui/Dialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";
import { BuildStudio } from "@/components/build-studio";
import { BuildPlanView } from "@/components/build-plan-view";
import { BuildTranscript } from "@/components/build-transcript";
import { BuildDiffPreview } from "@/components/build-diff-preview";
import { BuildDebugPanel } from "@/components/build-debug-panel";
import { BuildProgressPanel } from "@/components/build-progress-panel";
import { BuildProgressRing } from "@/components/build-progress-ring";
import { AgentPanel, type ParallelTask, type AgentProgressEvent, type Workstream } from "@/components/build/AgentPanel";
import { PlusMenu, type PlusAction } from "@/components/plus-menu";
import { BuildCommandPalette, type CommandPaletteItem } from "@/components/build-command-palette";
import { BottomNav, type BottomNavItem } from "@/components/mobile/BottomNav";
import { SheetModal } from "@/components/mobile/SheetModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import { haptics } from "@/lib/haptics";

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
  const [buildTab, setBuildTab] = useState<'plan' | 'transcript' | 'diff' | 'debug' | 'terminal' | 'agents'>('plan');
  const [commandInput, setCommandInput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusMenuCoords, setPlusMenuCoords] = useState<{ top: number; left: number } | null>(null);

  // Terminal command output (for /terminal slash command)
  const [terminalOutputOpen, setTerminalOutputOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<{ command: string; stdout: string; stderr: string; exitCode: number; timedOut?: boolean } | null>(null);
  const [terminalOutputBusy, setTerminalOutputBusy] = useState(false);

  // Mobile state
  const [bottomNavTab, setBottomNavTab] = useState<'terminal' | 'history' | 'agents' | 'tools'>('terminal');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  // Agent panel state
  const [agentPanelOpen, setAgentPanelOpen] = useState(!!parallelTask);
  const [agentPanelCompact, setAgentPanelCompact] = useState(false);

  const handlePlusAction = useCallback((action: PlusAction) => {
    setPlusMenuOpen(false);
    setPlusMenuCoords(null);
    switch (action) {
      case 'build-mode':
        setBuildTab('plan');
        break;
      case 'studios':
        // Open studios hub
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
        id: 'terminal',
        label: t('build.tabs.terminal'),
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        ),
      },
      {
        id: 'history',
        label: t('build.sidebar.recentBuilds'),
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        ),
      },
      {
        id: 'agents',
        label: t('build.tabs.agents'),
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        id: 'tools',
        label: t('build.sidebar.sections.tools'),
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.7 6.3a4 4 0 0 0 5.4 5.4L21 11M3 21l5.7-5.7M9 9l-6 6M14 4l6 6" />
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
          {bottomNavTab === 'terminal' && (
            <div className="flex flex-col h-full">
              <Terminal
                theme={resolved as 'light' | 'dark'}
                onReady={(term) => {
                  if (initialPrompt) term.writeln(`$ ${initialPrompt}`);
                }}
              />
            </div>
          )}
          {bottomNavTab === 'history' && (
            <div className="flex flex-col h-full">
              <BuildTranscript toolCalls={[]} autoScroll />
            </div>
          )}
          {bottomNavTab === 'agents' && parallelTask && (
            <div className="flex flex-col h-full p-4">
              <AgentPanel
                task={parallelTask}
                onProgressEvent={onProgressEvent}
                onCancel={onCancelParallel}
                onCreateCheckpoint={onCreateCheckpoint}
                onRollback={onRollback}
                compact={true}
              />
            </div>
          )}
          {bottomNavTab === 'tools' && (
            <div className="flex flex-col h-full p-4 space-y-4">
              <BuildDebugPanel workspaceId={projectId ?? ''} />
            </div>
          )}
        </div>

        {/* Command input bar for terminal */}
        {bottomNavTab === 'terminal' && (
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
                    setBottomNavTab('terminal');
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

        {/* Tools sheet */}
        <SheetModal
          open={toolsOpen}
          onOpenChange={setToolsOpen}
          title={t('build.sidebar.sections.tools')}
          defaultSnapPoint="half"
        >
          <div className="space-y-2">
            <button
              onClick={() => {
                setBuildTab('plan');
                setToolsOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg bg-bg-elevated/50 hover:bg-bg-elevated"
            >
              {t('build.sidebar.plan')}
            </button>
            <button
              onClick={() => {
                setBuildTab('terminal');
                setToolsOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg bg-bg-elevated/50 hover:bg-bg-elevated"
            >
              {t('build.sidebar.terminal')}
            </button>
            <button
              onClick={() => {
                setBuildTab('agents');
                setToolsOpen(false);
                setAgentPanelOpen(true);
              }}
              className="w-full text-left px-3 py-2 rounded-lg bg-bg-elevated/50 hover:bg-bg-elevated"
            >
              {t('build.sidebar.agents')}
            </button>
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
            <ButtonGroup>
              {['plan', 'transcript', 'diff', 'debug', 'terminal', 'agents'].map((tab) => (
                <Button
                  key={tab}
                  variant={buildTab === tab ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setBuildTab(tab as typeof buildTab)}
                >
                  {(t(`build.tabs.${tab}` as TranslationKey) || tab)}
                </Button>
              ))}
            </ButtonGroup>
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
                onClick={() => setBuildTab('transcript')}
                active={buildTab === 'transcript'}
              />
              <AppShellSidebarNavItem
                label={t('build.sidebar.snapshots')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>}
                onClick={() => setBuildTab('debug')}
              />
            </div>
          </AppShellSidebarSection>

          <AppShellSidebarSection title={t('build.sidebar.sections.tools')}>
            <div className="space-y-1">
              <AppShellSidebarNavItem
                label={t('build.sidebar.plan')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
                onClick={() => setBuildTab('plan')}
                active={buildTab === 'plan'}
              />
              <AppShellSidebarNavItem
                label={t('build.sidebar.terminal')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>}
                onClick={() => setBuildTab('terminal')}
                active={buildTab === 'terminal'}
              />
              <AppShellSidebarNavItem
                label={t('build.sidebar.agents')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                onClick={() => {
                  setBuildTab('agents');
                  setAgentPanelOpen(true);
                }}
                active={buildTab === 'agents'}
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
          {buildTab === 'plan' && (
            <BuildStudio
              open={true}
              onClose={onBack ?? (() => {})}
              title={t('build.title')}
              initialCommands={[]}
              initialPrompt={initialPrompt}
              runKey={buildRunKey}
            />
          )}
          {buildTab === 'transcript' && (
            <BuildTranscript toolCalls={[]} autoScroll />
          )}
          {buildTab === 'diff' && (
            <BuildDiffPreview diffs={[]} open={true} onClose={() => {}} />
          )}
          {buildTab === 'debug' && (
            <BuildDebugPanel workspaceId={projectId ?? ''} />
          )}
          {buildTab === 'terminal' && (
            <div className="flex flex-col h-full">
              <Terminal
                theme={resolved as 'light' | 'dark'}
                onReady={(term) => {
                  if (initialPrompt) term.writeln(`$ ${initialPrompt}`);
                }}
              />
            </div>
          )}
          {buildTab === 'agents' && parallelTask && (
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
        </div>

        {/* Command input bar for terminal */}
        {buildTab === 'terminal' && (
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
            buildMode: 'Build Mode',
            research: 'Deep Research',
            dataLab: 'Data Lab',
          }}
        />
      )}

      {/* Command palette - BuildCommandPalette used instead of standard */}
      <BuildCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={[
          { id: 'plan', label: t('build.sidebar.plan'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>, action: () => setBuildTab('plan') },
          { id: 'transcript', label: t('build.sidebar.recentBuilds'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>, action: () => setBuildTab('transcript') },
          { id: 'terminal', label: t('build.sidebar.terminal'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>, action: () => setBuildTab('terminal') },
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