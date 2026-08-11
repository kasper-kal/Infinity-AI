import { PanelLeft, SquarePen } from 'lucide-react';
import { GroupSettings } from '@/components/group-settings';
import { ConversationActions } from '@/components/conversation-actions';
import { useI18n } from '@/lib/i18n';
import { haptics } from '@/lib/haptics';

interface HomeHeaderProps {
  mode: 'voice' | 'chat' | 'agent' | 'camera';
  mobileSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  activeConversationId: string | null;
}

/**
 * Apple-style translucent toolbar. Hidden in voice mode, the orb view takes
 * the full screen.
 */
export function HomeHeader({ mode, mobileSidebarOpen, onToggleSidebar, onNewChat, activeConversationId }: HomeHeaderProps) {
  const { t } = useI18n();
  if (mode === 'voice') return null;

  return (
    <header className="glass-toolbar px-4 py-2.5 flex items-center border-b border-border/50 relative z-50 flex-shrink-0">
      {/* Left: hamburger (menu), always visible, ChatGPT style */}
      <button
        onClick={onToggleSidebar}
        className="w-9 h-9 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/10 dark:border-white/15 text-foreground flex items-center justify-center shadow-sm transition-all hover:bg-secondary/70 active:scale-95"
        aria-label={t(mobileSidebarOpen ? 'sidebar.closeHistory' : 'sidebar.openHistory')}
        aria-expanded={mobileSidebarOpen}
      >
        <PanelLeft className="w-[18px] h-[18px]" />
      </button>

      {/* Right: new chat */}
      <div className="relative flex items-center ml-auto">
        <div className="flex items-center rounded-full bg-white dark:bg-[#1c1c1e] border border-black/10 dark:border-white/15 shadow-sm overflow-hidden">
          <button
            onClick={() => { haptics.light(); onNewChat(); }}
            className="w-9 h-9 flex items-center justify-center text-foreground transition-colors hover:bg-secondary/70 active:scale-95"
            aria-label={t('sidebar.newChat')}
            title={t('sidebar.newChat')}
          >
            <SquarePen className="w-[18px] h-[18px]" strokeWidth={2} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <GroupSettings conversationId={activeConversationId} />
          <ConversationActions conversationId={activeConversationId} />
        </div>
      </div>
    </header>
  );
}
