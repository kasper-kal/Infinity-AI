/**
 * DesktopShell — Desktop-first application shell
 * Different website for the same goal: sidebar navigation, keyboard shortcuts,
 * multi-pane layouts, hover states, density controls.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AppShell, AppShellSidebarSection, AppShellSidebarNavItem, AppShellHeader } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { ConnectorMenu } from "@/components/layout/ConnectorMenu";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import { haptics } from "@/lib/haptics";

export type DesktopView = 'chat' | 'build' | 'terminal' | 'projects' | 'settings';

export interface DesktopShellProps {
  children: React.ReactNode;
  activeView: DesktopView;
  onNavigate: (view: DesktopView) => void;
  onBack?: () => void;
}

const VIEW_CONFIG: Record<DesktopView, { label: TranslationKey; icon: React.ReactNode }> = {
  chat: {
    label: 'nav.chat',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  build: {
    label: 'nav.build',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  terminal: {
    label: 'nav.terminal',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  projects: {
    label: 'nav.projects',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  settings: {
    label: 'nav.settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
};

export const DesktopShell: React.FC<DesktopShellProps> = ({
  children,
  activeView,
  onNavigate,
  onBack,
}) => {
  const { t } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K = Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShortcutsOpen(true);
      }
      // Cmd/Ctrl + B = Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(!sidebarOpen);
      }
      // Cmd/Ctrl + 1-5 = Switch views
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const views: DesktopView[] = ['chat', 'build', 'terminal', 'projects', 'settings'];
        const idx = parseInt(e.key, 10) - 1;
        if (idx < views.length) {
          onNavigate(views[idx]);
        }
      }
      // Escape = Close dialogs/panels
      if (e.key === 'Escape') {
        setShortcutsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen, onNavigate]);

  const sidebar = useMemo(() => (
    <Sidebar
      collapsed={collapsed}
      onCollapseToggle={setCollapsed}
      width={280}
    >
      <div className="flex items-center gap-2 px-2 py-4">
        <span className="text-lg font-display font-semibold tracking-tight">{t('app.name')}</span>
        <span className="text-xs text-muted-foreground">∞</span>
      </div>

      <AppShellSidebarSection title={t('nav.main')}>
        {(['chat', 'build', 'terminal', 'projects', 'settings'] as DesktopView[]).map((view) => (
          <AppShellSidebarNavItem
            key={view}
            label={t(VIEW_CONFIG[view].label)}
            icon={VIEW_CONFIG[view].icon}
            active={activeView === view}
            onClick={() => onNavigate(view)}
          />
        ))}
      </AppShellSidebarSection>

      <ConnectorMenu />
    </Sidebar>
  ), [activeView, collapsed, onNavigate, t]);

  const headerActions = useMemo(() => (
    <div className="flex items-center gap-2">
      <ButtonGroup>
        {(['chat', 'build', 'terminal', 'projects', 'settings'] as DesktopView[]).map((view) => (
          <Button
            key={view}
            variant={activeView === view ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onNavigate(view)}
          >
            {t(VIEW_CONFIG[view].label)}
          </Button>
        ))}
      </ButtonGroup>

      <IconButton
        onClick={() => setShortcutsOpen(true)}
        aria-label={t('shortcuts.title') || 'Keyboard shortcuts'}
        variant="ghost"
        size="sm"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6M9 15h6" />
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
  ), [activeView, onNavigate, theme, toggleTheme, t]);

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
          <h1 className="text-xl font-semibold text-foreground">{t(VIEW_CONFIG[activeView].label)}</h1>
          <div className="flex-1" />
          {headerActions}
        </div>
      }
      sidebar={sidebar}
      sidebarOpen={sidebarOpen}
      collapsed={collapsed}
      onSidebarToggle={setSidebarOpen}
      onCollapseToggle={setCollapsed}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          {children}
        </div>
      </div>

      {/* Keyboard shortcuts help modal */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="glass-strong rounded-2xl p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{t('shortcuts.title') || 'Keyboard Shortcuts'}</h2>
              <IconButton
                onClick={() => setShortcutsOpen(false)}
                aria-label={t('common.close')}
                variant="ghost"
                size="sm"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </IconButton>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-border-primary/60">
                <dt className="text-muted-foreground">{t('shortcuts.cmdK') || '⌘ K'}</dt>
                <dd className="text-foreground font-mono">Open command palette</dd>
              </div>
              <div className="flex justify-between py-2 border-b border-border-primary/60">
                <dt className="text-muted-foreground">{t('shortcuts.cmdB') || '⌘ B'}</dt>
                <dd className="text-foreground font-mono">Toggle sidebar</dd>
              </div>
              <div className="flex justify-between py-2 border-b border-border-primary/60">
                <dt className="text-muted-foreground">{t('shortcuts.cmd1') || '⌘ 1-5'}</dt>
                <dd className="text-foreground font-mono">Switch views (Chat, Build, Terminal, Projects, Settings)</dd>
              </div>
              <div className="flex justify-between py-2 border-b border-border-primary/60">
                <dt className="text-muted-foreground">{t('shortcuts.escape') || 'Esc'}</dt>
                <dd className="text-foreground font-mono">Close dialogs/panels</dd>
              </div>
              <div className="flex justify-between py-2 border-b border-border-primary/60">
                <dt className="text-muted-foreground">{t('shortcuts.cmdL') || '⌘ L'}</dt>
                <dd className="text-foreground font-mono">Focus terminal input (Terminal view)</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default DesktopShell;