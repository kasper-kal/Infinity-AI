import { PanelLeft, SquarePen } from "lucide-react";
import { GroupSettings } from "@/components/group-settings";
import { ConversationActions } from "@/components/conversation-actions";
import { useI18n } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

interface HomeHeaderProps {
  mode: "voice" | "chat" | "agent" | "camera";
  mobileSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  activeConversationId: string | null;
}

/**
 * Apple-style translucent toolbar. Hidden in voice mode, the orb view takes
 * the full screen.
 */
export function HomeHeader({
  mode,
  mobileSidebarOpen,
  onToggleSidebar,
  onNewChat,
  activeConversationId,
}: HomeHeaderProps) {
  const { t } = useI18n();
  if (mode === "voice") return null;

  return (
    <header className="ios-header flex h-14 flex-shrink-0 items-center justify-between px-3 sm:px-4 relative z-50">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border/50 bg-background/70 text-foreground shadow-sm backdrop-blur-xl transition-colors hover:bg-secondary/70 active:scale-95"
          aria-label={t(
            mobileSidebarOpen ? "sidebar.closeHistory" : "sidebar.openHistory",
          )}
          aria-expanded={mobileSidebarOpen}
        >
          <PanelLeft className="h-[18px] w-[18px]" />
        </button>
        <div className="hidden items-center gap-2 sm:flex">
          <span
            className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.65)]"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {t("header.title")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <GroupSettings conversationId={activeConversationId} />
        <ConversationActions conversationId={activeConversationId} />
        <button
          onClick={() => {
            haptics.light();
            onNewChat();
          }}
          className="flex h-9 items-center gap-2 rounded-full border border-border/50 bg-foreground px-2.5 text-background shadow-sm transition-colors hover:opacity-90 active:scale-95 sm:px-3"
          aria-label={t("sidebar.newChat")}
          title={t("sidebar.newChat")}
        >
          <SquarePen className="h-[17px] w-[17px]" strokeWidth={2} />
          <span className="hidden text-xs font-medium sm:inline">
            {t("sidebar.newChat")}
          </span>
        </button>
      </div>
    </header>
  );
}
