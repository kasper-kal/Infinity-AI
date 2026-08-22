/**
 * AppShellRouter — Viewport-aware application shell router
 * Treats mobile and desktop as "different websites for the same goal"
 * Routes to MobileShell (< 1024px) or DesktopShell (≥ 1024px)
 */

import React, { useState, useCallback, useEffect, Suspense, lazy } from "react";
import { Route, Switch, useLocation, useRoute } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileShell, type MobileView } from "@/components/mobile";
import { DesktopShell, type DesktopView } from "./DesktopShell";

export type View = 'chat' | 'build' | 'terminal' | 'projects' | 'settings';

interface AppShellRouterProps {
  /** Base path for routing */
  base?: string;
}

// Lazy-load heavy views for code splitting (security fix: bundle size)
const ChatView = lazy(() => import("@/components/views/ChatView").then(m => ({ default: m.ChatView })));
const BuildView = lazy(() => import("@/components/views/BuildView").then(m => ({ default: m.BuildView })));
const TerminalView = lazy(() => import("@/components/views/TerminalView").then(m => ({ default: m.TerminalView })));
const SettingsView = lazy(() => import("@/components/views/SettingsView").then(m => ({ default: m.SettingsView })));
const ProjectsView = lazy(() => import("@/components/views/ProjectsView").then(m => ({ default: m.ProjectsView })));

/**
 * Wrapper to provide required props for ChatView
 */
function ChatViewWrapper() {
  return (
    <ChatView
      messages={[]}
      onSend={() => {}}
      onNewChat={() => {}}
      activeConversationId={null}
      onSelectConversation={() => {}}
    />
  );
}

/**
 * Wrapper for views that don't need extra props
 */
function BuildViewWrapper() {
  return <BuildView />;
}

function TerminalViewWrapper() {
  return <TerminalView />;
}

function SettingsViewWrapper() {
  return <SettingsView />;
}

function ProjectsViewWrapper() {
  return <ProjectsView />;
}

/**
 * Map view to wrapper component
 */
function getViewComponent(view: View) {
  const components: Record<View, React.ComponentType> = {
    chat: ChatViewWrapper,
    build: BuildViewWrapper,
    terminal: TerminalViewWrapper,
    projects: ProjectsViewWrapper,
    settings: SettingsViewWrapper,
  };
  return components[view];
}

/**
 * View content component - renders the active view with Suspense for lazy loading
 */
function ViewContent({ activeView }: { activeView: View }) {
  const Component = getViewComponent(activeView);
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full" aria-label="Loading view...">Loading…</div>}>
      <Component />
    </Suspense>
  );
}

/**
 * Main shell component that picks mobile or desktop based on viewport
 */
function ResponsiveShell({ activeView, onNavigate, children }: { activeView: View; onNavigate: (view: View) => void; children?: React.ReactNode }) {
  const isMobile = useIsMobile();
  const content = children ?? <ViewContent activeView={activeView} />;

  if (isMobile) {
    return (
      <MobileShell
        activeView={activeView}
        onNavigate={onNavigate}
      >
        {content}
      </MobileShell>
    );
  }

  return (
    <DesktopShell
      activeView={activeView}
      onNavigate={onNavigate}
    >
      {content}
    </DesktopShell>
  );
}

/**
 * AppShellRouter - Main entry point for the responsive app
 */
export const AppShellRouter: React.FC<AppShellRouterProps> = ({ base = '' }) => {
  const [location, setLocation] = useLocation();
  const [activeView, setActiveView] = useState<View>('chat');

  // Sync activeView with URL
  useEffect(() => {
    const path = location.replace(base, '').replace(/^\//, '') as View;
    if (['chat', 'build', 'terminal', 'projects', 'settings'].includes(path)) {
      setActiveView(path);
    } else {
      setActiveView('chat');
    }
  }, [location, base]);

  const handleNavigate = useCallback((view: View) => {
    setActiveView(view);
    const path = `${base}/${view}`.replace(/\/+/g, '/');
    setLocation(path);
  }, [setLocation, base]);

  // Redirect /app → /app/chat on mount
  useEffect(() => {
    if (location === base) {
      setLocation(`${base}/chat`.replace(/\/+/g, '/'));
    }
  }, [location, base, setLocation]);

  return (
    <ResponsiveShell activeView={activeView} onNavigate={handleNavigate} />
  );
};

/**
 * Route-based version (alternative using wouter routes)
 */
export const AppShellRouterRoutes: React.FC<AppShellRouterProps> = ({ base = '' }) => {
  const isMobile = useIsMobile();

  const routes = (
    <Switch>
      <Route path={`${base}/chat`}>
        {(params) => (
          <ResponsiveShell activeView="chat" onNavigate={(v) => {}}>
            <ChatViewWrapper />
          </ResponsiveShell>
        )}
      </Route>
      <Route path={`${base}/build`}>
        {(params) => (
          <ResponsiveShell activeView="build" onNavigate={(v) => {}}>
            <BuildViewWrapper />
          </ResponsiveShell>
        )}
      </Route>
      <Route path={`${base}/terminal`}>
        {(params) => (
          <ResponsiveShell activeView="terminal" onNavigate={(v) => {}}>
            <TerminalViewWrapper />
          </ResponsiveShell>
        )}
      </Route>
      <Route path={`${base}/projects`}>
        {(params) => (
          <ResponsiveShell activeView="projects" onNavigate={(v) => {}}>
            <ProjectsViewWrapper />
          </ResponsiveShell>
        )}
      </Route>
      <Route path={`${base}/settings`}>
        {(params) => (
          <ResponsiveShell activeView="settings" onNavigate={(v) => {}}>
            <SettingsViewWrapper />
          </ResponsiveShell>
        )}
      </Route>
      <Route path={`${base}/:view`}>
        {(params) => (
          <ResponsiveShell activeView="chat" onNavigate={(v) => {}}>
            <ChatViewWrapper />
          </ResponsiveShell>
        )}
      </Route>
      <Route>
        <ResponsiveShell activeView="chat" onNavigate={(v) => {}}>
          <ChatViewWrapper />
        </ResponsiveShell>
      </Route>
    </Switch>
  );

  return routes;
};

export default AppShellRouter;