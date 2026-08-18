/**
 * Projects View — Liquid Glass Design System
 * Responsive project gallery for creating, switching, and managing AI build projects.
 * On desktop: sidebar with project list + main gallery grid.
 * On mobile: bottom nav + sheet modal for project list, swipe to switch.
 */

import React, { useState, useCallback } from "react";
import { AppShell, AppShellSidebarSection, AppShellHeader } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { BottomNav, type BottomNavItem } from "@/components/mobile/BottomNav";
import { SheetModal } from "@/components/mobile/SheetModal";
import { TouchButton, TouchListItem, TouchIconButton } from "@/components/mobile/TouchTargets";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export interface ProjectsViewProps {
  /** On navigate back */
  onBack?: () => void;
  /** On navigate to a different view */
  onNavigate?: (view: 'terminal' | 'build' | 'chat' | 'settings' | 'projects') => void;
  /** On select a project */
  onSelectProject?: (projectId: string) => void;
}

interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed';
  lastModified: string;
}

const SAMPLE_PROJECTS: Project[] = [
  {
    id: 'project-1',
    name: 'E-commerce API',
    description: 'REST API for online store with payments',
    status: 'active',
    lastModified: '2026-08-18',
  },
  {
    id: 'project-2',
    name: 'Dashboard UI',
    description: 'Analytics dashboard with charts',
    status: 'paused',
    lastModified: '2026-08-15',
  },
  {
    id: 'project-3',
    name: 'Chat Bot',
    description: 'Customer support automation',
    status: 'completed',
    lastModified: '2026-08-10',
  },
  {
    id: 'project-4',
    name: 'Mobile App',
    description: 'React Native app for iOS/Android',
    status: 'active',
    lastModified: '2026-08-17',
  },
];

const STATUS_COLORS: Record<Project['status'], string> = {
  active: 'bg-green-500/20 text-green-600 dark:text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  completed: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
};

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  onBack,
  onNavigate,
  onSelectProject,
}) => {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>(SAMPLE_PROJECTS);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelectProject = useCallback((project: Project) => {
    setSelectedProject(project);
    onSelectProject?.(project.id);
    haptics.light();
  }, [onSelectProject]);

  const handleCreateProject = useCallback(() => {
    haptics.light();
    // In real impl: open create dialog
  }, []);

  const filteredProjects = projects.filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const bottomNavItems: BottomNavItem[] = [
    {
      id: 'gallery',
      label: t('projects.gallery'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      id: 'list',
      label: t('projects.list'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      ),
    },
    {
      id: 'create',
      label: t('projects.create'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
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
          <h1 className="text-lg font-semibold flex-1">{t('projects.title')}</h1>
          <IconButton onClick={() => setSheetOpen(true)} aria-label="Filter" variant="ghost" size="sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </IconButton>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('projects.search')}
          />
          {filteredProjects.map((project) => (
            <TouchListItem
              key={project.id}
              onClick={() => handleSelectProject(project)}
              startContent={
                <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[project.status]}`} />
              }
              endContent={
                <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[project.status]}`}>
                  {project.status}
                </span>
              }
            >
              <div className="font-medium">{project.name}</div>
              <div className="text-xs text-muted-foreground">{project.description}</div>
            </TouchListItem>
          ))}
        </div>

        {/* Bottom nav */}
        <BottomNav
          items={bottomNavItems}
          activeId="gallery"
          onChange={(id) => {
            haptics.light();
            if (id === 'create') handleCreateProject();
            if (id === 'list') setSheetOpen(true);
          }}
        />

        {/* Filter sheet */}
        <SheetModal open={sheetOpen} onOpenChange={setSheetOpen} title={t('projects.filter')}>
          <div className="space-y-2">
            {(['all', 'active', 'paused', 'completed'] as const).map((f) => (
              <TouchListItem
                key={f}
                onClick={() => { setFilter(f); setSheetOpen(false); }}
                pressed={filter === f}
              >
                {t(`projects.status.${f}`)}
              </TouchListItem>
            ))}
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
            <IconButton onClick={onBack} aria-label={t('common.back')} variant="ghost" size="sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </IconButton>
          )}
          <h1 className="text-xl font-semibold text-foreground">{t('projects.title')}</h1>
          <div className="flex-1" />
          <ButtonGroup>
            {(['terminal', 'build', 'chat'] as const).map((view) => (
              <Button key={view} variant="ghost" size="sm" onClick={() => onNavigate?.(view)}>
                {t(`build.tabs.${view}`)}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      }
      sidebar={
        <Sidebar
          collapsed={collapsed}
          onCollapseToggle={setCollapsed}
          width={260}
        >
          <AppShellSidebarSection title={t('projects.list')}>
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleSelectProject(project)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedProject?.id === project.id
                    ? 'bg-accent/10 text-accent-foreground'
                    : 'hover:bg-bg-elevated/50'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[project.status]}`} />
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </AppShellSidebarSection>
        </Sidebar>
      }
      sidebarOpen={sidebarOpen}
      collapsed={collapsed}
      onSidebarToggle={setSidebarOpen}
      onCollapseToggle={setCollapsed}
    >
      <div className="p-6 space-y-4">
        <div className="flex gap-3 flex-wrap">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('projects.search')}
            className="flex-1 min-w-[200px]"
          />
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="w-40"
            options={[
              { value: 'all', label: t('projects.status.all') },
              { value: 'active', label: t('projects.status.active') },
              { value: 'paused', label: t('projects.status.paused') },
              { value: 'completed', label: t('projects.status.completed') },
            ]}
          />
          <Button variant="primary" onClick={handleCreateProject}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('projects.create')}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              onClick={() => handleSelectProject(project)}
              className="p-4 rounded-xl glass border border-border-primary/60 hover:border-accent/40 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold">{project.name}</h3>
                <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[project.status]}`}>
                  {project.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{project.description}</p>
              <p className="text-xs text-muted-foreground">
                {t('projects.lastModified')}: {project.lastModified}
              </p>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
};

export default ProjectsView;
