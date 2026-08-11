import type { ChangeEvent, ClipboardEvent, DragEvent, RefObject } from 'react';
import type { Widget, AttachedFile } from '@/types/widget';
import type { ServerTimer } from '@/hooks/use-timer-orchestration';
import { ClockWidget, WeatherWidget, TimerWidget, AlarmWidget, CalendarWidget } from '@/components/widgets';
import { ConversationFeed, ChatMessage } from '@/components/conversation-feed';
import { TimerStrip } from '@/components/timer-strip';
import type { PlusAction } from '@/components/plus-menu';
import { ChatComposer } from '@/components/home/chat-composer';
import type { AppState } from '@/components/orb';

export interface ChatModeViewProps {
  activeTimers: ServerTimer[];
  activeWidget: Widget | null;
  messages: ChatMessage[];
  isThinking: boolean;
  suggestions: string[];
  generatingImage: boolean;
  generatingImagePrompt: string;
  chatInput: string;
  chatDictating: boolean;
  chatInterim: string;
  attachedFile: AttachedFile | null;
  dragOver: boolean;
  uploadProgress: number | null;
  isBusy: boolean;
  thinkingEnabled: boolean;
  agentModeActive: boolean;
  webSearchEnabled: boolean;
  plusMenuOpen: boolean;
  plusMenuCoords: { top: number; left: number } | null;
  status: AppState;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  cameraInputRef: RefObject<HTMLInputElement | null>;
  plusButtonRef: RefObject<HTMLDivElement | null>;
  onCancelTimer: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResumeTimer: (id: string) => void;
  onCloseWidget: () => void;
  onSuggestionClick: (text: string) => void;
  onRegenerate: (index: number) => void;
  onEditMessage: (index: number, newContent: string) => void;
  onSpeak: (text: string) => void;
  onImageConfirm: (prompt: string) => void;
  onEditImage: (image: string) => void;
  onImageCancel: () => void;
  onScreenShareConfirm: () => void;
  onScreenShareCancel: () => void;
  onAgentBrowserConfirm: (query: string) => void;
  onAgentBrowserCancel: () => void;
  onSourceCodeConfirm: () => void;
  onSourceCodeCancel: () => void;
  onBuildModeConfirm: () => void;
  onBuildModeCancel: () => void;
  onChatInputChange: (value: string) => void;
  onToggleThinking: () => void;
  onToggleAgentMode: () => void;
  onOpenPlusMenu: () => void;
  onClosePlusMenu: () => void;
  onPlusAction: (action: PlusAction) => void;
  onChatSubmit: () => void;
  onChatMicToggle: () => void;
  onOpenVoiceMode: () => void;
  onRemoveAttachedFile: () => void;
  onPaste: (e: ClipboardEvent) => void;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (v: boolean) => void;
  onDrop: (e: DragEvent) => void;
  onStopSpeaking: () => void;
}

/** Full chat mode: timer strip, mobile widget strip, conversation feed and composer. */
export function ChatModeView(props: ChatModeViewProps) {
  const {
    activeTimers,
    activeWidget,
    messages,
    isThinking,
    suggestions,
    generatingImage,
    generatingImagePrompt,
    chatInput,
    chatDictating,
    chatInterim,
    attachedFile,
    dragOver,
    uploadProgress,
    isBusy,
    thinkingEnabled,
    agentModeActive,
    webSearchEnabled,
    plusMenuOpen,
    plusMenuCoords,
    status,
    inputRef,
    textareaRef,
    fileInputRef,
    cameraInputRef,
    plusButtonRef,
    onCancelTimer,
    onPauseTimer,
    onResumeTimer,
    onCloseWidget,
    onSuggestionClick,
    onRegenerate,
    onEditMessage,
    onSpeak,
    onImageConfirm,
    onEditImage,
    onImageCancel,
    onScreenShareConfirm,
    onScreenShareCancel,
    onAgentBrowserConfirm,
    onAgentBrowserCancel,
    onSourceCodeConfirm,
    onSourceCodeCancel,
    onBuildModeConfirm,
    onBuildModeCancel,
    onChatInputChange,
    onToggleThinking,
    onToggleAgentMode,
    onOpenPlusMenu,
    onClosePlusMenu,
    onPlusAction,
    onChatSubmit,
    onChatMicToggle,
    onOpenVoiceMode,
    onRemoveAttachedFile,
    onPaste,
    onFileSelect,
    onDragOver,
    onDrop,
    onStopSpeaking,
  } = props;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Chat area */}
      <div className="flex-1 flex flex-col h-full min-h-0 bg-card/5">

        {/* Durable server-side timers, survive reloads, fire even with the tab closed */}
        <TimerStrip
          timers={activeTimers}
          onCancel={onCancelTimer}
          onPause={onPauseTimer}
          onResume={onResumeTimer}
        />

        {/* Mobile-only widget strip (orb panel is hidden on mobile) */}
        {activeWidget && (
          <div className="lg:hidden flex-shrink-0 px-3 pt-2 pb-1 border-b border-border/20">
            {activeWidget.type === 'timer'    && <TimerWidget {...activeWidget} compact onClose={onCloseWidget} />}
            {activeWidget.type === 'alarm'    && <AlarmWidget {...activeWidget} compact onClose={onCloseWidget} />}
            {activeWidget.type === 'clock'    && <ClockWidget {...activeWidget} onClose={onCloseWidget} />}
            {activeWidget.type === 'weather'  && <WeatherWidget {...activeWidget} onClose={onCloseWidget} />}
            {activeWidget.type === 'calendar' && <CalendarWidget {...activeWidget} onClose={onCloseWidget} />}
          </div>
        )}

        <ConversationFeed
          messages={messages}
          isThinking={isThinking}
          suggestions={suggestions}
          onSuggestionClick={onSuggestionClick}
          onRegenerate={onRegenerate}
          onEditMessage={onEditMessage}
          onSpeak={onSpeak}
          onImageConfirm={onImageConfirm}
          onEditImage={onEditImage}
          onImageCancel={onImageCancel}
          generatingImage={generatingImage}
          generatingImagePrompt={generatingImagePrompt}
          onScreenShareConfirm={onScreenShareConfirm}
          onScreenShareCancel={onScreenShareCancel}
          onAgentBrowserConfirm={onAgentBrowserConfirm}
          onAgentBrowserCancel={onAgentBrowserCancel}
          onSourceCodeConfirm={onSourceCodeConfirm}
          onSourceCodeCancel={onSourceCodeCancel}
          onBuildModeConfirm={onBuildModeConfirm}
          onBuildModeCancel={onBuildModeCancel}
        />

        <ChatComposer
          chatInput={chatInput}
          onChatInputChange={onChatInputChange}
          chatDictating={chatDictating}
          chatInterim={chatInterim}
          attachedFile={attachedFile}
          dragOver={dragOver}
          uploadProgress={uploadProgress}
          isBusy={isBusy}
          thinkingEnabled={thinkingEnabled}
          agentModeActive={agentModeActive}
          webSearchEnabled={webSearchEnabled}
          plusMenuOpen={plusMenuOpen}
          plusMenuCoords={plusMenuCoords}
          status={status}
          messages={messages}
          inputRef={inputRef}
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          cameraInputRef={cameraInputRef}
          plusButtonRef={plusButtonRef}
          onToggleThinking={onToggleThinking}
          onToggleAgentMode={onToggleAgentMode}
          onOpenPlusMenu={onOpenPlusMenu}
          onClosePlusMenu={onClosePlusMenu}
          onPlusAction={onPlusAction}
          onChatSubmit={onChatSubmit}
          onChatMicToggle={onChatMicToggle}
          onOpenVoiceMode={onOpenVoiceMode}
          onRemoveAttachedFile={onRemoveAttachedFile}
          onPaste={onPaste}
          onFileSelect={onFileSelect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onStopSpeaking={onStopSpeaking}
        />
      </div>
    </div>
  );
}
