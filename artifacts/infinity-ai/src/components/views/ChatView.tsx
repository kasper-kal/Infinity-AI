/**
 * Chat View — Liquid Glass Design System
 * Responsive chat interface that works equally well on mobile and desktop.
 * On desktop: sidebar + message feed + optional right panel.
 * On mobile: full-screen feed with bottom composer, sheet-based sidebar.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AppShell, AppShellSidebarSection, AppShellSidebarNavItem, AppShellHeader } from "@/components/layout/AppShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Panel } from "@/components/layout/Panel";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";
import { SegmentedControl } from "@/components/ui/Tabs";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import { haptics } from "@/lib/haptics";
import type { ChatMessage } from "@/components/conversation-feed";
import { ConversationFeed } from "@/components/conversation-feed";
import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatComposer } from "@/components/home/chat-composer";
import { EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MoreHorizontal, Layout, Code, Eye, Monitor, Palette, Box, Sparkles, ChevronRight, ChevronLeft, Send, Loader2, RotateCcw, Copy, AlertTriangle } from "lucide-react";
import { LivePreview } from "@/components/ui-builder/LivePreview";
import { ComponentRegistry } from "@/components/ui-builder/ComponentRegistry";
import { DeployPanel } from "@/components/ui-builder/DeployPanel";
import { VisualInspector } from "@/components/ui-builder/VisualInspector";
import { PropEditor } from "@/components/ui-builder/PropEditor";
import { ComponentExtractor } from "@/components/ui-builder/ComponentExtractor";
import { useConflictResolution } from "@/hooks";

export interface ChatViewProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onNewChat: () => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  isBusy?: boolean;
  thinkingEnabled?: boolean;
  webSearchEnabled?: boolean;
  onToggleThinking?: () => void;
  onToggleWebSearch?: () => void;
  suggestions?: string[];
  onSuggestionClick?: (text: string) => void;
  onDeepResearchExpert?: (conversationId: string) => void;
  status?: "idle" | "thinking" | "transcribing" | "recording" | "wake" | "speaking";
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  onSend,
  onNewChat,
  activeConversationId,
  onSelectConversation,
  isBusy = false,
  thinkingEnabled = false,
  webSearchEnabled = false,
  onToggleThinking,
  onToggleWebSearch,
  suggestions = [],
  onSuggestionClick,
  onDeepResearchExpert,
  status = "idle",
}) => {
  const { t } = useI18n();
  const { theme, resolved, toggle: toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'chat' | 'agent' | 'camera'>('chat');
  const [buildMode, setBuildMode] = useState<'visual' | 'chat' | 'ui-builder'>('visual');
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [uiBuilderMode, setUiBuilderMode] = useState(false);
  const [uiComponents, setUiComponents] = useState<Array<{ name: string; code: string; imports?: string[] }>>([]);
  const [uiGenerating, setUiGenerating] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<any>(null);
  const [deployFiles, setDeployFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [showDeployPanel, setShowDeployPanel] = useState(false);
  const [uiChatHistory, setUiChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [activeTab, setActiveTab] = useState<'registry' | 'preview' | 'code'>('preview');

  // Visual Inspector state
  const [previewRef, setPreviewRef] = useState<HTMLIFrameElement | null>(null);
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [hoveredElement, setHoveredElement] = useState<any>(null);
  const [showExtractor, setShowExtractor] = useState(false);
  const [extractorElements, setExtractorElements] = useState<any[]>([]);
  const [designTokens, setDesignTokens] = useState<any>({});

  // Conflict resolution for simultaneous code + visual edits
  const {
    registerCodeChange,
    registerVisualChange,
    getConflicts,
    resolveConflict,
    ignoreConflict,
    pendingCount,
  } = useConflictResolution({
    conflictWindow: 500,
    autoResolve: 'manual',
    onConflict: (conflict) => {
      console.warn('Conflict detected:', conflict);
      // Could show a toast notification here
    },
    onResolved: (conflict, resolution) => {
      console.log('Conflict resolved:', conflict.selector, resolution);
    },
  });

  // Fetch design tokens on mount
  useEffect(() => {
    fetch('/api/infinity/ui-builder/design-tokens')
      .then(res => res.json())
      .then(data => setDesignTokens(data.designSystem || {}))
      .catch(() => setDesignTokens({}));
  }, []);

  // Keyboard shortcuts for UI Builder
  useEffect(() => {
    if (!uiBuilderMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Cmd/Ctrl + D: Duplicate selected element
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        if (selectedElement && !showExtractor) {
          // Trigger duplicate via onStructureChange
          console.log('Duplicate element:', selectedElement.selector);
        }
      }

      // Delete/Backspace: Delete selected element
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement && !showExtractor) {
        e.preventDefault();
        console.log('Delete element:', selectedElement.selector);
      }

      // Escape: Deselect / Close extractor
      if (e.key === 'Escape') {
        if (showExtractor) {
          setShowExtractor(false);
          setExtractorElements([]);
        } else if (selectedElement) {
          setSelectedElement(null);
        }
      }

      // Arrow keys: Navigate element stack
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Handled by VisualInspector
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uiBuilderMode, selectedElement, showExtractor]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [chatInput]);

  const handleSubmit = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    haptics.medium();
    setChatInput('');
    onSend(text);
  }, [chatInput, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const sidebar = (
    <Sidebar
      collapsed={collapsed}
      onCollapseToggle={setCollapsed}
      width={280}
    >
      <div className="flex items-center gap-2 px-2 py-4">
        <span className="text-lg font-display font-semibold tracking-tight">{t('app.name')}</span>
        <span className="text-xs text-muted-foreground">∞</span>
      </div>
      <AppShellSidebarSection>
        <div className="space-y-1">
          <AppShellSidebarNavItem
            label={t('nav.chat')}
            collapsedIcon={<span>💬</span>}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
            active={viewMode === 'chat'}
            onClick={() => setViewMode('chat')}
          />
          <AppShellSidebarNavItem
            label={t('nav.agent' as TranslationKey)}
            collapsedIcon={<span>🤖</span>}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M18 17v4"/></svg>}
            onClick={() => setViewMode('agent')}
            active={viewMode === 'agent'}
          />
          <AppShellSidebarNavItem
            label={t('nav.camera')}
            collapsedIcon={<span>📷</span>}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>}
            onClick={() => setViewMode('camera')}
          />
        </div>
      </AppShellSidebarSection>

      <AppShellSidebarSection title={t('nav.conversations')}>
        <div className="mb-2">
          <Button
            size="sm"
            variant="secondary"
            className="w-full justify-start"
            onClick={onNewChat}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            {t('nav.newChat')}
          </Button>
        </div>
        <ChatSidebar
          activeId={activeConversationId}
          onSelect={onSelectConversation}
          onNew={onNewChat}
          mobileOpen={mobileSidebarOpen}
          desktopOpen={sidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          onOpenSettings={() => {}}
          onNavigate={(m) => setViewMode(m)}
          refreshTick={0}
        />
      </AppShellSidebarSection>
    </Sidebar>
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      <ButtonGroup>
        <Button variant={viewMode === 'chat' ? 'primary' : 'ghost'} size="sm" onClick={() => setViewMode('chat')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          {t('nav.chat')}
        </Button>
        <Button variant={viewMode === 'agent' ? 'primary' : 'ghost'} size="sm" onClick={() => setViewMode('agent')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M18 17v4"/></svg>
          {t('nav.agent' as TranslationKey)}
        </Button>
        <Button variant={viewMode === 'camera' ? 'primary' : 'ghost'} size="sm" onClick={() => setViewMode('camera')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/></svg>
          {t('nav.camera')}
        </Button>
      </ButtonGroup>

      {onToggleThinking && (
        <Tooltip content={t('input.thinking')}>
          <IconButton
            onClick={onToggleThinking}
            variant={thinkingEnabled ? 'primary' : 'ghost'}
            size="sm"
            aria-label={t('input.thinking')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
          </IconButton>
        </Tooltip>
      )}

      {onToggleWebSearch && (
        <Tooltip content={t('input.webSearch')}>
          <IconButton
            onClick={onToggleWebSearch}
            variant={webSearchEnabled ? 'primary' : 'ghost'}
            size="sm"
            aria-label={t('input.webSearch')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          </IconButton>
        </Tooltip>
      )}

      {/* Chat Menu with Build Mode Toggle */}
      <div className="relative">
        <IconButton
          onClick={() => setChatMenuOpen(!chatMenuOpen)}
          variant="ghost"
          size="sm"
          aria-label={t('common.more')}
        >
          <MoreHorizontal className="w-5 h-5" />
        </IconButton>

        {chatMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setChatMenuOpen(false)} aria-hidden="true" />
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-border/60 bg-card/95 p-2 shadow-apple-xl backdrop-blur-xl">
              {/* Build Mode Section */}
              <div className="border-b border-border/30 pb-2 mb-2">
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('build.mode.title')}
                </p>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => { setBuildMode('visual'); setChatMenuOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      buildMode === 'visual'
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                    }`}
                  >
                    <Layout className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <p className="font-medium">{t('build.mode.visual')}</p>
                      <p className="text-xs text-muted-foreground/70">{t('build.mode.visualDesc')}</p>
                    </div>
                    {buildMode === 'visual' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBuildMode('chat'); setChatMenuOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      buildMode === 'chat'
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                    }`}
                  >
                    <Code className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <p className="font-medium">{t('build.mode.chat')}</p>
                      <p className="text-xs text-muted-foreground/70">{t('build.mode.chatDesc')}</p>
                    </div>
                    {buildMode === 'chat' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBuildMode('ui-builder'); setUiBuilderMode(true); setChatMenuOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      buildMode === 'ui-builder'
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <p className="font-medium">UI Builder</p>
                      <p className="text-xs text-muted-foreground/70">Visual component editor with code sync</p>
                    </div>
                    {buildMode === 'ui-builder' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Build Visual Tools (only shown in visual mode) */}
              {buildMode === 'visual' && (
                <div className="border-b border-border/30 pb-2 mb-2">
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t('build.mode.title')} Tools
                  </p>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => { setChatMenuOpen(false); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
                    >
                      <Eye className="w-4 h-4 flex-shrink-0" />
                      <span>{t('build.mode.preview')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setChatMenuOpen(false); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
                    >
                      <Code className="w-4 h-4 flex-shrink-0" />
                      <span>{t('build.mode.code')}</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                {onToggleThinking && (
                  <button
                    type="button"
                    onClick={() => { onToggleThinking(); setChatMenuOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      thinkingEnabled
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                    <span>{t('input.thinking')}</span>
                    {thinkingEnabled && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                )}

                {onToggleWebSearch && (
                  <button
                    type="button"
                    onClick={() => { onToggleWebSearch(); setChatMenuOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      webSearchEnabled
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                    <span>{t('input.webSearch')}</span>
                    {webSearchEnabled && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => { toggleTheme(); setChatMenuOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
                >
                  {theme === 'dark' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                  )}
                  <span>{t('settings.theme')}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // UI Builder Mode - Three-pane layout: Chat | Component Registry + Live Preview | Deploy
  const renderUiBuilder = () => {
    return (
      <div className="flex flex-1 h-full overflow-hidden bg-background">
        {/* Left Pane: Chat Sidebar / Conversation */}
        <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-card">
          {/* Header */}
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              UI Builder
            </h3>
            <Button variant="ghost" size="icon" onClick={() => { setUiBuilderMode(false); setBuildMode('visual'); }}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {uiChatHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">Start building</p>
              <p className="text-xs mt-1">Describe what you want to create</p>
            </div>
          ) : (
            uiChatHistory.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-none'
                      : 'bg-muted text-muted-foreground rounded-bl-none'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe changes..."
              className="flex-1 px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              size="sm"
              onClick={async () => {
                const text = chatInput.trim();
                if (!text) return;
                setChatInput('');
                setUiChatHistory(prev => [...prev, { role: 'user', content: text }]);
                setUiGenerating(true);
                setUiError(null);

                try {
                  const response = await fetch('/api/infinity/ui-builder/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      prompt: text,
                      framework: 'nextjs',
                      conversationHistory: uiChatHistory,
                    }),
                  });

                  if (!response.ok) throw new Error('Generation failed');

                  const data = await response.json();
                  const components = data.components || [];
                  setUiComponents(components);
                  setDeployFiles(components.map((c: any) => ({ path: `${c.name}.tsx`, content: c.code })));
                  setUiChatHistory(prev => [...prev, {
                    role: 'assistant',
                    content: `Generated ${components.length} component(s): ${components.map((c: any) => c.name).join(', ')}`
                  }]);
                } catch (err) {
                  setUiError(err instanceof Error ? err.message : 'Generation failed');
                  setUiChatHistory(prev => [...prev, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Failed'}` }]);
                } finally {
                  setUiGenerating(false);
                }
              }}
              disabled={uiGenerating || !chatInput.trim()}
              className="px-4"
            >
              {uiGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          {uiError && <p className="text-xs text-destructive mt-2">{uiError}</p>}
        </div>
      </div>

      {/* Middle Pane: Component Registry + Live Preview + Visual Editor */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border bg-background">
        {/* Tabs for Registry / Preview / Code / Inspector */}
        <div className="flex border-b border-border px-2">
          <button
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === 'registry' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('registry')}
          >
            <Box className="w-4 h-4 inline mr-1" /> Components
          </button>
          <button
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === 'preview' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('preview')}
          >
            <Monitor className="w-4 h-4 inline mr-1" /> Preview
          </button>
          <button
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === 'code' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('code')}
          >
            <Code className="w-4 h-4 inline mr-1" /> Code
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'registry' && (
            <ComponentRegistry
              onSelectComponent={(comp) => {
                setSelectedComponent(comp);
                setActiveTab('code');
              }}
            />
          )}

          {activeTab === 'preview' && (
            <div className="h-full flex flex-col">
              <LivePreview
                components={uiComponents}
                framework="nextjs"
                onError={(err) => setUiError(err.message)}
                ref={(el) => setPreviewRef(el)}
              />
              {/* Visual Inspector - always active in preview tab */}
              {previewRef && (
                <VisualInspector
                  iframeRef={{ current: previewRef }}
                  onSelectElement={setSelectedElement}
                  codeSelectedElement={selectedElement}
                  enabled={true}
                  showHoverPreview={true}
                />
              )}
            </div>
          )}

          {activeTab === 'code' && (
            <div className="h-full flex flex-col">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <select
                  value={selectedComponent?.name || ''}
                  onChange={(e) => {
                    const comp = uiComponents.find(c => c.name === e.target.value);
                    setSelectedComponent(comp);
                  }}
                  className="px-2 py-1 bg-input border border-border rounded text-sm"
                >
                  <option value="">Select component...</option>
                  {uiComponents.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => navigator.clipboard.writeText(selectedComponent?.code || '')}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 p-3 overflow-auto font-mono text-xs bg-muted/30">
                <pre className="whitespace-pre-wrap text-foreground">{selectedComponent?.code || '// Select a component to view code'}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar within Middle Pane: PropEditor + ComponentExtractor */}
        {((activeTab === 'preview' || activeTab === 'code') && (selectedElement || showExtractor)) && (
          <div className="w-80 flex-shrink-0 border-l border-border bg-card flex flex-col">
            {/* Prop Editor */}
            {selectedElement && !showExtractor && (
              <PropEditor
                selectedElement={selectedElement}
                designTokens={designTokens}
                availableComponents={uiComponents.map(c => c.name)}
                enforceDesignTokens={true}
                onPropChange={(selector, propName, value) => {
                  // Register visual change for conflict detection
                  registerVisualChange(selector, {
                    type: 'prop',
                    previousValue: selectedElement.props[propName],
                    newValue: value,
                    timestamp: Date.now(),
                  });
                  // TODO: Wire to AST editor for code sync
                  console.log('Prop change:', selector, propName, value);
                }}
                onStructureChange={(selector, operation, options) => {
                  // Register visual change for conflict detection
                  registerVisualChange(selector, {
                    type: 'structure',
                    previousValue: null,
                    newValue: { operation, options },
                    timestamp: Date.now(),
                  });
                  // Handle structure operations: duplicate, delete, wrap, unwrap, move
                  const componentIndex = uiComponents.findIndex(c => c.code.includes(selector));
                  if (componentIndex === -1) return;

                  const component = uiComponents[componentIndex];
                  let newCode = component.code;

                  switch (operation) {
                    case 'duplicate':
                      // Duplicate would require AST manipulation - for now log
                      console.log('Duplicate element:', selector);
                      break;
                    case 'delete':
                      console.log('Delete element:', selector);
                      break;
                    case 'wrap':
                      console.log('Wrap element:', selector, 'with', options?.wrapper);
                      break;
                    case 'unwrap':
                      console.log('Unwrap element:', selector);
                      break;
                    case 'move':
                      console.log('Move element:', selector, 'to index', options?.targetIndex);
                      break;
                  }
                }}
                onExtractComponent={(selector, name) => {
                  setExtractorElements([selectedElement]);
                  setShowExtractor(true);
                }}
                onDeselect={() => setSelectedElement(null)}
              />
            )}

            {/* Conflict Resolution Indicator */}
            {pendingCount > 0 && (
              <div className="p-3 border-t border-destructive/30 bg-destructive/5">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    {pendingCount} conflict{pendingCount > 1 ? 's' : ''} detected
                  </span>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {getConflicts().map(conflict => (
                    <div key={conflict.id} className="text-xs p-2 bg-background border border-border rounded">
                      <div className="font-mono text-destructive/80 mb-1">{conflict.selector}</div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-5 px-2 text-xs"
                          onClick={() => resolveConflict(conflict.id, 'visual-wins')}
                        >
                          Visual wins
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-5 px-2 text-xs"
                          onClick={() => resolveConflict(conflict.id, 'code-wins')}
                        >
                          Code wins
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-5 px-2 text-xs"
                          onClick={() => ignoreConflict(conflict.id)}
                        >
                          Ignore
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Component Extractor */}
            {showExtractor && (
              <ComponentExtractor
                selectedElements={extractorElements}
                availableComponents={uiComponents.map(c => c.name)}
                onExtract={(componentName, code, options) => {
                  setUiComponents(prev => [...prev, { name: componentName, code, imports: [] }]);
                  setShowExtractor(false);
                  setExtractorElements([]);
                }}
                onClose={() => setShowExtractor(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Right Pane: Deploy Panel */}
      <div className="w-80 flex-shrink-0 border-l border-border bg-card">
        <DeployPanel
          projectId={activeConversationId || 'ui-builder'}
          files={deployFiles}
          onDeployComplete={(result) => {
            setUiChatHistory(prev => [...prev, {
              role: 'assistant',
              content: `Deployed to ${result.provider}! Preview: ${result.previewUrl}`
            }]);
          }}
        />
      </div>
    </div>
  );
};

  return (
    <AppShell
      header={
        <AppShellHeader
          title={t('app.name')}
          subtitle={activeConversationId ? '' : t('nav.newChat')}
          actions={headerActions}
        />
      }
      sidebar={sidebar}
      sidebarOpen={sidebarOpen}
      collapsed={collapsed}
      onSidebarToggle={setSidebarOpen}
      onCollapseToggle={setCollapsed}
      rightSidebarOpen={rightSidebarOpen}
      onRightSidebarToggle={setRightSidebarOpen}
    >
      <div className="flex flex-col h-full">
        {uiBuilderMode ? (
          renderUiBuilder()
        ) : (
          <>
            {/* Desktop: two-pane — feed + composer stacked vertically */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-hidden">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <div className="w-16 h-16 rounded-full glass-strong flex items-center justify-center">
                        <span className="text-3xl">∞</span>
                      </div>
                      <div className="text-lg font-medium">{t('chat.empty.title')}</div>
                      <div className="text-sm text-muted-foreground">{t('chat.empty.description')}</div>
                    </div>
                  </div>
                ) : (
                  <ConversationFeed
                    messages={messages}
                    isThinking={isBusy}
                    suggestions={suggestions}
                    onSuggestionClick={onSuggestionClick}
                    onDeepResearchExpert={onDeepResearchExpert}
                  />
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-border-primary/60 bg-bg-elevated/50 backdrop-blur-xl p-3 sm:p-4">
                <div className="max-w-3xl mx-auto">
                  <div className="glass rounded-2xl p-1.5 flex items-end gap-2">
                    <IconButton
                      onClick={() => setMobileSidebarOpen(true)}
                      variant="ghost"
                      size="sm"
                      className="sm:hidden"
                      aria-label={t('nav.sidebar')}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                    </IconButton>
                    <textarea
                      ref={textareaRef}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t('input.placeholder')}
                      rows={1}
                      className="flex-1 bg-transparent border-none resize-none outline-none px-2 py-2 text-foreground placeholder:text-muted-foreground text-[15px] leading-relaxed"
                    />
                    <Button
                      size="sm"
                      onClick={handleSubmit}
                      disabled={!chatInput.trim() || isBusy}
                      className="shrink-0 rounded-xl"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                      {t('input.send')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
};

export default ChatView;