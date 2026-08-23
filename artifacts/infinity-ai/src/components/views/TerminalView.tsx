/**
 * Terminal View — Liquid Glass Design System
 * Responsive terminal interface that works equally well on mobile and desktop.
 * On desktop: sidebar + terminal + command palette + keyboard shortcuts.
 * On mobile: full-screen terminal with bottom nav + swipeable sheet for history.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AppShell, AppShellSidebarSection, AppShellSidebarNavItem, AppShellHeader } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Terminal, TerminalToolbar, TerminalSession, type TerminalInstance } from "@/components/ui/Terminal";
import { BottomNav, type BottomNavItem } from "@/components/mobile/BottomNav";
import { SheetModal } from "@/components/mobile/SheetModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import { haptics } from "@/lib/haptics";

export interface TerminalViewProps {
  /** Active project ID */
  projectId?: string | null;
  /** Initial command to run */
  initialCommand?: string;
  /** On navigate away */
  onBack?: () => void;
  /** On navigate to a different view */
  onNavigate?: (view: 'terminal' | 'build' | 'chat' | 'settings' | 'projects') => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  projectId,
  initialCommand,
  onBack,
  onNavigate,
}) => {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bottomNavTab, setBottomNavTab] = useState<'terminal' | 'history' | 'tools'>('terminal');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  const terminalRef = useRef<TerminalInstance | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
    haptics.light();
  }, []);

  const handleReset = useCallback(() => {
    terminalRef.current?.reset();
  }, []);

  const handleCommandSubmit = useCallback(async () => {
    const cmd = commandInput.trim();
    if (!cmd || commandBusy) return;

    setCommandBusy(true);
    setCommandHistory(prev => [cmd, ...prev.filter(c => c !== cmd)].slice(0, 50));
    if (terminalRef.current) {
      terminalRef.current.writeln(`$ ${cmd}`);
    }
    setCommandInput('');

    // Simulate command execution feedback loop
    await new Promise(r => setTimeout(r, 120));
    setCommandBusy(false);
  }, [commandInput, commandBusy]);

  const handleTerminalReady = useCallback((instance: TerminalInstance) => {
    terminalRef.current = instance;
    if (initialCommand) {
      instance.writeln(`$ ${initialCommand}`);
    }
  }, [initialCommand]);

  // Desktop keyboard shortcuts
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        handleClear();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, handleClear]);

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
          <h1 className="text-lg font-semibold flex-1">{t('build.tabs.terminal')}</h1>
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

        {/* Terminal body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Terminal
            onReady={handleTerminalReady}
            theme={theme as 'light' | 'dark' | 'auto'}
          />
        </div>

        {/* Command input bar */}
        <div className="shrink-0 border-t border-border-primary bg-bg-elevated/50 backdrop-blur-xl p-3 safe-area-inset-bottom">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm font-mono">$</span>
            <Input
              ref={inputRef}
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

        {/* Bottom nav */}
        <BottomNav
          items={bottomNavItems}
          activeId={bottomNavTab}
          onChange={(id) => {
            setBottomNavTab(id as typeof bottomNavTab);
            if (id === 'history') setHistoryOpen(true);
            if (id === 'tools') handleClear();
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
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </IconButton>
          )}
          <h1 className="text-xl font-semibold text-foreground">{t('build.tabs.terminal')}</h1>
          <div className="flex-1" />
          <ButtonGroup>
            {(['terminal', 'build', 'chat'] as const).map((view) => (
              <Button
                key={view}
                variant={view === 'terminal' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onNavigate?.(view)}
              >
                {t(`build.tabs.${view}` === 'build.tabs.terminal' ? 'build.tabs.terminal' : `build.tabs.${view}`)}
              </Button>
            ))}
          </ButtonGroup>
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
              >
                {t('build.sidebar.allProjects')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={handleClear}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {t('studio.build.debugClear')}
              </Button>
            </div>
          </AppShellSidebarSection>

          <AppShellSidebarSection title={t('build.sidebar.sections.history')}>
            <div className="space-y-1">
              {commandHistory.slice(0, 10).map((cmd, i) => (
                <AppShellSidebarNavItem
                  key={`${cmd}-${i}`}
                  label={`$ ${cmd}`}
                  icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>}
                  onClick={() => {
                    setCommandInput(cmd);
                    terminalRef.current?.focus();
                  }}
                />
              ))}
              {commandHistory.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-1">{t('build.transcriptEmpty')}</p>
              )}
            </div>
          </AppShellSidebarSection>

          <AppShellSidebarSection title={t('build.sidebar.sections.tools')}>
            <div className="space-y-1">
              <AppShellSidebarNavItem
                label={t('build.sidebar.terminal')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>}
                active
              />
              <AppShellSidebarNavItem
                label={t('build.tabs.plan')}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
                onClick={() => onNavigate?.('build')}
              />
            </div>
          </AppShellSidebarSection>
        </Sidebar>
      }
      sidebarOpen={sidebarOpen}
      collapsed={collapsed}
      onSidebarToggle={setSidebarOpen}
      onCollapseToggle={setCollapsed}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden">
          <Terminal
            onReady={handleTerminalReady}
            theme={theme as 'light' | 'dark' | 'auto'}
          />
        </div>

        {/* Command input bar for terminal */}
        <div className="border-t border-border-primary bg-bg-elevated/50 backdrop-blur-sm p-3">
          <div className="flex items-center gap-2 max-w-4xl mx-auto">
            <span className="text-muted-foreground text-sm font-mono">$</span>
            <Input
              ref={inputRef}
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
            <IconButton
              onClick={handleClear}
              aria-label={t('studio.build.debugClear')}
              variant="ghost"
              size="sm"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </IconButton>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default TerminalView;
