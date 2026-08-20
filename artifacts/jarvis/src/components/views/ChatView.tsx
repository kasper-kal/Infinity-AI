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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

      <IconButton
        onClick={() => toggleTheme()}
        variant="ghost"
        size="sm"
        aria-label={t('settings.theme')}
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
  );

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
      </div>
    </AppShell>
  );
};

export default ChatView;