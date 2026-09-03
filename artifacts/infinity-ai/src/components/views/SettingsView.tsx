/**
 * Settings View — Liquid Glass Design System
 * Responsive settings interface for managing theme, API keys, notifications, and preferences.
 * On desktop: sidebar sections + form panels.
 * On mobile: full-screen with bottom nav + sheet modals for sections.
 */

import React, { useState, useCallback } from "react";
import { AppShell, AppShellSidebarSection, AppShellHeader } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button, IconButton, ButtonGroup, Input, Textarea, Select, Dialog, AlertDialog, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { BottomNav, type BottomNavItem } from "@/components/mobile/BottomNav";
import { SheetModal } from "@/components/mobile/SheetModal";
import { TouchButton, TouchListItem, TouchIconButton } from "@/components/mobile/TouchTargets";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import { haptics } from "@/lib/haptics";
import { MCPConfigPanel } from "@/components/settings/MCPConfigPanel";
import { AIManagementTab } from "@/components/settings/AIManagementTab";
import { ReviewPanel, type ReviewRequest } from "@/components/ui-builder/ReviewPanel";
import { APIWizard } from "@/components/ui-builder/APIWizard";
import { DatabasePanel } from "@/components/ui-builder/DatabasePanel";
import { AuthPanel } from "@/components/ui-builder/AuthPanel";
import { FrameworkSelector, type SupportedFrameworkId, FRAMEWORKS } from "@/components/ui-builder/FrameworkSelector";
import { ComponentMarketplace } from "@/components/ComponentMarketplace";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { RulesEditor } from "@/components/cursor/RulesEditor";
import { NotepadManager } from "@/components/cursor/NotepadManager";
import { ModelPreferences } from "@/components/cursor/ModelPreferences";

/* ── Enterprise Settings Panel ── */
const EnterpriseSettingsPanel: React.FC = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<string>('sso');

  const tabs = [
    { id: 'sso', label: 'SSO / SAML / OIDC' },
    { id: 'scim', label: 'SCIM Provisioning' },
    { id: 'vpc', label: 'VPC / Network' },
    { id: 'audit', label: 'Audit Logs' },
    { id: 'rbac', label: 'RBAC' },
    { id: 'observability', label: 'Observability Export' },
    { id: 'single-tenant', label: 'Single Tenant' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('settings.enterprise')}</h3>
      <p className="text-sm text-muted-foreground">
        Configure enterprise features: SSO, SCIM, VPC, audit logging, RBAC, and single-tenant environments.
      </p>

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className="whitespace-nowrap"
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'sso' && (
          <div className="space-y-4">
            <h4 className="font-medium">SSO / SAML / OIDC Configuration</h4>
            <p className="text-sm text-muted-foreground">
              Configure identity providers (Okta, Entra ID, Google Workspace, custom SAML/OIDC).
            </p>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Okta</div>
                    <div className="text-sm text-muted-foreground">OIDC / SAML 2.0</div>
                  </div>
                  <span className="px-2 py-1 text-xs rounded-full bg-muted-foreground/10 text-muted-foreground">
                    Not Configured
                  </span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Entra ID (Azure AD)</div>
                    <div className="text-sm text-muted-foreground">OIDC</div>
                  </div>
                  <span className="px-2 py-1 text-xs rounded-full bg-muted-foreground/10 text-muted-foreground">
                    Not Configured
                  </span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Google Workspace</div>
                    <div className="text-sm text-muted-foreground">OIDC</div>
                  </div>
                  <span className="px-2 py-1 text-xs rounded-full bg-muted-foreground/10 text-muted-foreground">
                    Not Configured
                  </span>
                </div>
              </div>
              <Button variant="outline" size="sm">Configure SSO Providers</Button>
            </div>
          </div>
        )}

        {activeTab === 'scim' && (
          <div className="space-y-4">
            <h4 className="font-medium">SCIM Provisioning</h4>
            <p className="text-sm text-muted-foreground">
              Automate user and group provisioning from your identity provider (RFC 7644).
            </p>
            <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">SCIM Server</div>
                  <div className="text-sm text-muted-foreground">Base URL: not configured</div>
                </div>
                <span className="px-2 py-1 text-xs rounded-full bg-muted-foreground/10 text-muted-foreground">
                  Not Configured
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <input type="checkbox" className="w-4 h-4" />
                <span className="text-sm">Enable User Provisioning</span>
              </label>
              <label className="flex items-center gap-2 p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <input type="checkbox" className="w-4 h-4" />
                <span className="text-sm">Enable Group Provisioning</span>
              </label>
            </div>
            <Button variant="outline" size="sm">Configure SCIM</Button>
          </div>
        )}

        {activeTab === 'vpc' && (
          <div className="space-y-4">
            <h4 className="font-medium">VPC / Network Configuration</h4>
            <p className="text-sm text-muted-foreground">
              Generate Terraform configurations for isolated VPCs (GCP, AWS, Azure).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {['gcp', 'aws', 'azure'].map((provider) => (
                <div key={provider} className="p-4 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                  <div className="font-medium capitalize">{provider}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Region: us-central1 / us-east-1 / eastus
                  </div>
                  <Button variant="outline" size="sm" className="mt-3 w-full">
                    Generate Terraform
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h4 className="font-medium">Audit Logs</h4>
            <p className="text-sm text-muted-foreground">
              Comprehensive audit trail for all organization activity. Export to multiple destinations.
            </p>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Audit Logging</div>
                    <div className="text-sm text-muted-foreground">Enabled</div>
                  </div>
                  <span className="px-2 py-1 text-xs rounded-full bg-green-500/10 text-green-500">
                    Active
                  </span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Destinations</div>
                    <div className="text-sm text-muted-foreground">Console, File (ClickHouse, BigQuery, Splunk, Datadog available)</div>
                  </div>
                  <Button variant="outline" size="sm">Manage</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'rbac' && (
          <div className="space-y-4">
            <h4 className="font-medium">Role-Based Access Control (RBAC)</h4>
            <p className="text-sm text-muted-foreground">
              Fine-grained permissions with custom roles, resource-level access, and ABAC conditions.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="font-medium">System Roles</div>
                <div className="text-sm text-muted-foreground mt-1">Owner, Admin, Developer, Viewer, Auditor</div>
              </div>
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="font-medium">Custom Roles</div>
                <div className="text-sm text-muted-foreground mt-1">0 configured</div>
              </div>
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="font-medium">Active Assignments</div>
                <div className="text-sm text-muted-foreground mt-1">0</div>
              </div>
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="font-medium">Permissions</div>
                <div className="text-sm text-muted-foreground mt-1">47 available</div>
              </div>
            </div>
            <Button variant="outline" size="sm">Manage RBAC</Button>
          </div>
        )}

        {activeTab === 'observability' && (
          <div className="space-y-4">
            <h4 className="font-medium">Observability Export</h4>
            <p className="text-sm text-muted-foreground">
              Stream audit logs to observability platforms: Datadog, Splunk, Sumo Logic, custom webhooks.
            </p>
            <div className="space-y-3">
              {[
                { name: 'Datadog', type: 'datadog', configured: false },
                { name: 'Splunk HEC', type: 'splunk', configured: false },
                { name: 'Sumo Logic', type: 'sumologic', configured: false },
                { name: 'Custom Webhook', type: 'webhook', configured: false },
              ].map((dest) => (
                <div key={dest.type} className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{dest.name}</div>
                      <div className="text-sm text-muted-foreground">Audit log destination</div>
                    </div>
                    <span className="px-2 py-1 text-xs rounded-full bg-muted-foreground/10 text-muted-foreground">
                      {dest.configured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm">Add Destination</Button>
          </div>
        )}

        {activeTab === 'single-tenant' && (
          <div className="space-y-4">
            <h4 className="font-medium">Single-Tenant Environments</h4>
            <p className="text-sm text-muted-foreground">
              Provision isolated control plane + data plane per enterprise. Dedicated VPC, static IPs, custom domain.
            </p>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Active Tenants</div>
                    <div className="text-sm text-muted-foreground">0 provisioned</div>
                  </div>
                  <Button variant="primary" size="sm">Provision New Tenant</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                  <div className="font-medium">Standard</div>
                  <div className="text-sm text-muted-foreground mt-1">Shared control plane, isolated data</div>
                </div>
                <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50 border-accent/50">
                  <div className="font-medium">Dedicated</div>
                  <div className="text-sm text-muted-foreground mt-1">Dedicated control + data plane</div>
                </div>
                <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
                  <div className="font-medium">Isolated</div>
                  <div className="text-sm text-muted-foreground mt-1">Full VPC isolation, static IPs</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export interface SettingsViewProps {
  /** On navigate back */
  onBack?: () => void;
  /** On navigate to a different view */
  onNavigate?: (view: 'terminal' | 'build' | 'chat' | 'settings' | 'projects') => void;
  /** Project ID for project-scoped settings (e.g., MCP servers) */
  projectId?: string;
}

type SettingsSection =
  | 'theme'
  | 'notifications'
  | 'api-keys'
  | 'language'
  | 'mcp-servers'
  | 'advanced'
  | 'enterprise'
  | 'skills'
  | 'marketplace'
  | 'collaboration'
  | 'integrations'
  | 'ai-customization'
  | 'rules'
  | 'notepads'
  | 'model-preferences'
  | 'ai-management';

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
  enterprise: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M6 9h12M6 13h12" />
        <path d="M2 9h20M2 13h20" />
      </svg>
    ),
    labelKey: 'settings.enterprise',
  },
  skills: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
    labelKey: 'settings.skills',
  },
  marketplace: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12l2 2 4-4" />
        <path d="M16 12l-4 4" />
      </svg>
    ),
    labelKey: 'settings.marketplace',
  },
  collaboration: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    labelKey: 'settings.collaboration',
  },
  integrations: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M13.5 18H9a6 6 0 0 0-6-5v-1a6 6 0 0 1 6-5h14" />
        <path d="M10.5 6a4.5 4.5 0 1 1 4.5 4.5H15" />
      </svg>
    ),
    labelKey: 'settings.integrations',
  },
  'ai-customization': {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 17.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
    labelKey: 'settings.aiCustomization',
  },
  rules: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    labelKey: 'settings.rules',
  },
  notepads: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    labelKey: 'settings.notepads',
  },
  'model-preferences': {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M6 9h12M6 13h12" />
      </svg>
    ),
    labelKey: 'settings.modelPreferences',
  },
  'ai-management': {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M9 9h6v6H9z" />
        <path d="M9 17h6" />
      </svg>
    ),
    labelKey: 'settings.aiManagement',
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
  const [selectedFramework, setSelectedFramework] = useState<SupportedFrameworkId>('nextjs');

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
      case 'enterprise':
        return (
          <EnterpriseSettingsPanel />
        );
      case 'skills':
        return (
          <SkillsSettingsPanel projectId={projectId || ''} />
        );
      case 'marketplace':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.marketplace')}</h3>
            <p className="text-sm text-muted-foreground">
              Browse and install components, templates, and starter kits from the Infinity AI Marketplace.
            </p>
            <Tabs defaultValue="components" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="components">
                  <span>Components</span>
                </TabsTrigger>
                <TabsTrigger value="templates">
                  <span>Templates</span>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="components" className="mt-4">
                <ComponentMarketplace />
              </TabsContent>
              <TabsContent value="templates" className="mt-4">
                <TemplateLibrary />
              </TabsContent>
            </Tabs>
          </div>
        );
      case 'collaboration':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Collaboration & Review</h3>
            <p className="text-sm text-muted-foreground">
              Manage shareable preview links, review workflows, and element-level comments.
            </p>
            <ReviewPanel
              projectId={projectId || 'default'}
              reviewRequests={[]}
              isLoading={false}
              currentVersion="main"
              previousVersion="develop"
              onRequestReview={async () => {
                console.log('Request review clicked');
              }}
              onApprove={async () => {
                console.log('Approve clicked');
              }}
              onRequestChanges={async () => {
                console.log('Request changes clicked');
              }}
              onLoadHistory={async () => {
                console.log('Load history clicked');
              }}
              onSelectVersion={() => {}}
              currentUser={{ name: 'Current User', email: 'user@example.com', avatar: undefined }}
            />
          </div>
        );
      case 'integrations':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.integrations')}</h3>
            <p className="text-sm text-muted-foreground">
              Connect external APIs, databases, authentication providers, and choose your target framework.
            </p>
            <Tabs defaultValue="api" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="api">
                  <span>API</span>
                </TabsTrigger>
                <TabsTrigger value="database">
                  <span>Database</span>
                </TabsTrigger>
                <TabsTrigger value="auth">
                  <span>Auth</span>
                </TabsTrigger>
                <TabsTrigger value="framework">
                  <span>Framework</span>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="api" className="mt-4">
                <APIWizard projectId={projectId || ''} />
              </TabsContent>
              <TabsContent value="database" className="mt-4">
                <DatabasePanel projectId={projectId || ''} />
              </TabsContent>
              <TabsContent value="auth" className="mt-4">
                <AuthPanel projectId={projectId || ''} />
              </TabsContent>
              <TabsContent value="framework" className="mt-4">
                <FrameworkSelector
                  value={selectedFramework}
                  onChange={setSelectedFramework}
                  variant="cards"
                  showCategories={true}
                />
              </TabsContent>
            </Tabs>
          </div>
        );
      case 'ai-customization':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.aiCustomization')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('settings.aiCustomizationDescription')}
            </p>
            <Tabs defaultValue="rules" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="rules">
                  <span>{t('settings.rules')}</span>
                </TabsTrigger>
                <TabsTrigger value="notepads">
                  <span>{t('settings.notepads')}</span>
                </TabsTrigger>
                <TabsTrigger value="model-preferences">
                  <span>{t('settings.modelPreferences')}</span>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="rules" className="mt-4">
                <RulesEditor projectRoot={projectId || ''} />
              </TabsContent>
              <TabsContent value="notepads" className="mt-4">
                <NotepadManager projectRoot={projectId || ''} />
              </TabsContent>
              <TabsContent value="model-preferences" className="mt-4">
                <ModelPreferences projectRoot={projectId || ''} />
              </TabsContent>
            </Tabs>
          </div>
        );
      case 'rules':
        return (
          <RulesEditor projectRoot={projectId || ''} />
        );
      case 'notepads':
        return (
          <NotepadManager projectRoot={projectId || ''} />
        );
      case 'model-preferences':
        return (
          <ModelPreferences projectRoot={projectId || ''} />
        );
      case 'ai-management':
        return (
          <AIManagementTab projectId={projectId} />
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
    {
      id: 'enterprise',
      label: t('settings.enterprise'),
      icon: SECTION_CONFIG.enterprise.icon,
    },
    {
      id: 'skills',
      label: t('settings.skills'),
      icon: SECTION_CONFIG.skills.icon,
    },
    {
      id: 'marketplace',
      label: t('settings.marketplace'),
      icon: SECTION_CONFIG.marketplace.icon,
    },
    {
      id: 'collaboration',
      label: t('settings.collaboration'),
      icon: SECTION_CONFIG.collaboration.icon,
    },
    {
      id: 'integrations',
      label: t('settings.integrations'),
      icon: SECTION_CONFIG.integrations.icon,
    },
    {
      id: 'ai-customization',
      label: t('settings.aiCustomization'),
      icon: SECTION_CONFIG['ai-customization'].icon,
    },
    {
      id: 'rules',
      label: t('settings.rules'),
      icon: SECTION_CONFIG.rules.icon,
    },
    {
      id: 'notepads',
      label: t('settings.notepads'),
      icon: SECTION_CONFIG.notepads.icon,
    },
    {
      id: 'model-preferences',
      label: t('settings.modelPreferences'),
      icon: SECTION_CONFIG['model-preferences'].icon,
    },
    {
      id: 'ai-management',
      label: t('settings.aiManagement'),
      icon: SECTION_CONFIG['ai-management'].icon,
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
