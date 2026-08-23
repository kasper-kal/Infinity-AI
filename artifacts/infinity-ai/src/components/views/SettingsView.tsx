/**
 * Settings View — Liquid Glass Design System
 * Responsive settings interface for managing theme, API keys, notifications, and preferences.
 * On desktop: sidebar sections + form panels.
 * On mobile: full-screen with bottom nav + sheet modals for sections.
 */

import React, { useState, useCallback } from "react";
import { AppShell, AppShellSidebarSection, AppShellHeader } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Dialog, AlertDialog } from "@/components/ui/Dialog";
import { BottomNav, type BottomNavItem } from "@/components/mobile/BottomNav";
import { SheetModal } from "@/components/mobile/SheetModal";
import { TouchButton, TouchListItem, TouchIconButton } from "@/components/mobile/TouchTargets";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import { haptics } from "@/lib/haptics";
import { MCPConfigPanel } from "@/components/settings/MCPConfigPanel";

export interface SettingsViewProps {
  /** On navigate back */
  onBack?: () => void;
  /** On navigate to a different view */
  onNavigate?: (view: 'terminal' | 'build' | 'chat' | 'settings' | 'projects') => void;
  /** Project ID for project-scoped settings (e.g., MCP servers) */
  projectId?: string;
}

type SettingsSection = 'theme' | 'notifications' | 'api-keys' | 'language' | 'mcp-servers' | 'advanced';

const SECTION_CONFIG: Record<SettingsSection, { icon: React.ReactNode; labelKey: string }> = {
  theme: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
    labelKey: 'settings.theme',
  },
  notifications: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
    labelKey: 'settings.notifications',
  },
  'api-keys': {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    ),
    labelKey: 'settings.apiKeys',
  },
  language: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    labelKey: 'settings.language',
  },
  'mcp-servers': {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M6 9h12M6 13h12" />
      </svg>
    ),
    labelKey: 'settings.mcpServers',
  },
  advanced: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    labelKey: 'settings.advanced',
  },
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  onBack,
  onNavigate,
  projectId,
}) => {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const { theme, setTheme: setThemeMode } = useTheme();
  const [activeSection, setActiveSection] = useState<SettingsSection>('theme');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Settings state
  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState('en');
  const [notifications, setNotifications] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const handleThemeChange = useCallback((mode: 'light' | 'dark' | 'auto') => {
    setThemeMode(mode);
    haptics.light();
  }, [setThemeMode]);

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang);
    haptics.light();
  }, []);

  const handleResetSettings = useCallback(() => {
    setApiKey('');
    setLanguage('en');
    setNotifications(true);
    setDebugMode(false);
    setThemeMode('auto');
    setResetConfirmOpen(false);
    haptics.medium();
  }, [setThemeMode]);

  const renderSectionContent = (section: SettingsSection) => {
    switch (section) {
      case 'theme':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.theme')}</h3>
            <div className="flex gap-2">
              {(['light', 'dark', 'auto'] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={theme === mode ? 'primary' : 'secondary'}
                  onClick={() => handleThemeChange(mode)}
                >
                  {mode === 'light' ? '☀️' : mode === 'dark' ? '🌙' : '💻'}{' '}
                  {mode === 'auto' ? 'System' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        );
      case 'notifications':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.notifications')}</h3>
            <label className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50">
              <span>Enable notifications</span>
              <input
                type="checkbox"
                checked={notifications}
                onChange={(e) => setNotifications(e.target.checked)}
                className="w-5 h-5"
              />
            </label>
          </div>
        );
      case 'api-keys':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.apiKeys')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('settings.apiKeysDescription')}
            </p>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('settings.apiKeyPlaceholder')}
              type="password"
            />
          </div>
        );
      case 'language':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.language')}</h3>
            <Select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              options={[
                { value: 'en', label: 'English' },
                { value: 'nl', label: 'Nederlands' },
              ]}
            />
          </div>
        );
      case 'mcp-servers':
        return (
          <MCPConfigPanel
            projectId={projectId || ''}
            onServersChange={() => {}}
          />
        );
      case 'advanced':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.advanced')}</h3>
            <label className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50">
              <span>Debug mode</span>
              <input
                type="checkbox"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
                className="w-5 h-5"
              />
            </label>
            <Button variant="danger" onClick={() => setResetConfirmOpen(true)}>
              {t('settings.resetToDefaults')}
            </Button>
          </div>
        );
    }
  };

  const bottomNavItems: BottomNavItem[] = [
    {
      id: 'theme',
      label: t('settings.theme'),
      icon: SECTION_CONFIG.theme.icon,
    },
    {
      id: 'notifications',
      label: t('settings.notifications'),
      icon: SECTION_CONFIG.notifications.icon,
    },
    {
      id: 'api-keys',
      label: t('settings.apiKeys'),
      icon: SECTION_CONFIG['api-keys'].icon,
    },
    {
      id: 'language',
      label: t('settings.language'),
      icon: SECTION_CONFIG.language.icon,
    },
    {
      id: 'mcp-servers',
      label: t('settings.mcpServers'),
      icon: SECTION_CONFIG['mcp-servers'].icon,
    },
    {
      id: 'advanced',
      label: t('settings.advanced'),
      icon: SECTION_CONFIG.advanced.icon,
    },
  ];

  /* ── Mobile variant ── */
  if (isMobile) {
    return (
      <div className="h-dvh flex flex-col bg-background text-foreground overflow-hidden">
        {/* Mobile header */}
        <header className="shrink-0 glass-strong border-b border-border-primary/60 px-4 py-3 flex items-center gap-3">
          {onBack && (
            <IconButton onClick={onBack} aria-label={t('common.back')} variant="ghost" size="sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </IconButton>
          )}
          <h1 className="text-lg font-semibold flex-1">{t('settings.title')}</h1>
          <IconButton onClick={() => setResetConfirmOpen(true)} aria-label="Reset" variant="ghost" size="sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </IconButton>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {renderSectionContent(activeSection)}
        </div>

        {/* Bottom nav */}
        <BottomNav
          items={bottomNavItems}
          activeId={activeSection}
          onChange={(id) => {
            setActiveSection(id as SettingsSection);
            haptics.light();
          }}
        />

        {/* Reset confirmation */}
        <AlertDialog
          open={resetConfirmOpen}
          onClose={() => setResetConfirmOpen(false)}
          title={t('settings.resetToDefaults')}
          description="Are you sure? This cannot be undone."
          confirmText={t('common.confirm')}
          cancelText={t('common.cancel')}
          onConfirm={handleResetSettings}
          variant="danger"
        />
      </div>
    );
  }

  /* ── Desktop variant ── */
  return (
    <AppShell
      header={
        <div className="flex items-center gap-4 w-full">
          {onBack && (
            <IconButton onClick={onBack} aria-label={t('common.back')} variant="ghost" size="sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </IconButton>
          )}
          <h1 className="text-xl font-semibold text-foreground">{t('settings.title')}</h1>
          <div className="flex-1" />
          <ButtonGroup>
            {(['terminal', 'build', 'chat'] as const).map((view) => (
              <Button key={view} variant="ghost" size="sm" onClick={() => onNavigate?.(view)}>
                {t(`build.tabs.${view}` as TranslationKey)}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      }
      sidebar={
        <Sidebar
          collapsed={collapsed}
          onCollapseToggle={setCollapsed}
          width={240}
        >
          {Object.entries(SECTION_CONFIG).map(([key, config]) => (
            <AppShellSidebarSection key={key} title="">
              <button
                onClick={() => setActiveSection(key as SettingsSection)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeSection === key
                    ? 'bg-accent/10 text-accent-foreground'
                    : 'hover:bg-bg-elevated/50'
                }`}
              >
                {config.icon}
                {t(config.labelKey as TranslationKey)}
              </button>
            </AppShellSidebarSection>
          ))}
        </Sidebar>
      }
      sidebarOpen={sidebarOpen}
      collapsed={collapsed}
      onSidebarToggle={setSidebarOpen}
      onCollapseToggle={setCollapsed}
    >
      <div className="p-6 max-w-2xl mx-auto">
        {renderSectionContent(activeSection)}
      </div>

      <AlertDialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        title={t('settings.resetToDefaults')}
        description="Are you sure? This cannot be undone."
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={handleResetSettings}
        variant="danger"
      />
    </AppShell>
  );
};

export default SettingsView;
