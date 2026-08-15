import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Lightbulb, Search, Mic, Square, X, FileText } from 'lucide-react';
import type { ChangeEvent, ClipboardEvent, DragEvent, RefObject } from 'react';
import { PlusMenu } from '@/components/plus-menu';
import type { PlusAction } from '@/components/plus-menu';
import type { ChatMessage } from '@/components/conversation-feed';
import type { AttachedFile } from '@/types/widget';
import { useI18n } from '@/lib/i18n';
import type { AppState } from '@/components/orb';

interface ChatComposerProps {
  chatInput: string;
  onChatInputChange: (value: string) => void;
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
  messages: ChatMessage[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  cameraInputRef: RefObject<HTMLInputElement | null>;
  plusButtonRef: RefObject<HTMLDivElement | null>;
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

/** The chat-mode input bar: + menu, toggles, textarea, dictation, voice button. */
export function ChatComposer(props: ChatComposerProps) {
  const {
    chatInput,
    onChatInputChange,
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
    messages,
    inputRef,
    textareaRef,
    fileInputRef,
    cameraInputRef,
    plusButtonRef,
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
    onDragOver: setDragOver,
    onDrop,
    onStopSpeaking,
  } = props;
  const { t } = useI18n();

  return (
    <div
      data-chat-composer
      className={`relative flex-shrink-0 space-y-2 border-t border-border/30 bg-background/90 px-4 pt-4 backdrop-blur-md ${dragOver ? 'border-primary/50' : ''}`}
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
      onDrop={onDrop}
    >
      {/* Drag-over overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 flex items-center justify-center pointer-events-none"
          >
            <p className="font-display text-sm tracking-widest text-primary/70">{t('input.dropHere')}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Upload progress bar */}
      <AnimatePresence>
        {uploadProgress !== null && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="h-1 bg-card rounded-full overflow-hidden"
          >
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${uploadProgress}%` }}
              transition={{ duration: 0.3 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {attachedFile && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card/40">
            {attachedFile.preview ? (
              <img src={attachedFile.preview} alt={t('input.attachmentAlt')} className="w-full h-full object-cover" />
            ) : (
              <FileText className="w-5 h-5 text-muted-foreground/60" />
            )}
            <button onClick={onRemoveAttachedFile}
              className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-background/80 flex items-center justify-center text-foreground hover:text-red-400 transition-colors">
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-mono text-foreground/80 tracking-widest truncate">{attachedFile.fileName}</p>
            <p className="text-[10px] font-mono text-muted-foreground/50 tracking-widest">{t('input.fileAttachedLabel')}</p>
          </div>
        </div>
      )}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1.5 rounded-2xl border border-border/60 bg-card/80 px-2.5 py-2 shadow-apple-sm backdrop-blur-xl">
        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelect} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileSelect} />

        {/* + menu button */}
        <div className="relative flex-shrink-0" ref={plusButtonRef}>
          <button
            id="plus-menu-button"
            onClick={() => plusMenuOpen ? onClosePlusMenu() : onOpenPlusMenu()}
            disabled={isBusy}
            title={t('input.attachTitle')}
            className={`p-2 rounded-full transition-all disabled:opacity-30 ${
              attachedFile || webSearchEnabled
                ? 'text-primary bg-primary/10'
                : 'text-foreground/70 hover:text-foreground hover:bg-secondary/70'
            }`}
          >
            <Plus className="w-[18px] h-[18px]" strokeWidth={2} />
          </button>
        </div>

        {/* Thinking mode toggle, Jarvis streams his reasoning before answering */}
        <button
          onClick={onToggleThinking}
          disabled={isBusy}
          title={thinkingEnabled ? t('input.thinkingOn') : t('input.thinking')}
          className={`p-2 rounded-full transition-all flex-shrink-0 disabled:opacity-30 ${
            thinkingEnabled
              ? 'text-primary bg-primary/10'
              : 'text-foreground/70 hover:text-foreground hover:bg-secondary/70'
          }`}
        >
          <Lightbulb
            className={`w-[18px] h-[18px] transition-transform ${thinkingEnabled ? 'scale-110' : ''}`}
            strokeWidth={2}
          />
        </button>

        {/* Agent mode toggle, Jarvis researches with live web search */}
        <button
          onClick={onToggleAgentMode}
          disabled={isBusy}
          title={agentModeActive ? t('input.agentModeOn') : t('input.agentMode')}
          className={`p-2 rounded-full transition-all flex-shrink-0 disabled:opacity-30 ${
            agentModeActive
              ? 'text-primary bg-primary/10'
              : 'text-foreground/70 hover:text-foreground hover:bg-secondary/70'
          }`}
        >
          <Search
            className={`w-[18px] h-[18px] transition-transform ${agentModeActive ? 'scale-110' : ''}`}
            strokeWidth={2}
          />
        </button>

        <div className="relative flex-1 min-w-0">
          <textarea ref={e => { inputRef.current = e; textareaRef.current = e; }} value={chatInput}
            onChange={e => onChatInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onChatSubmit(); }
              if (e.key === 'Escape' && chatInput) { onChatInputChange(''); e.preventDefault(); }
              if (e.key === 'ArrowUp' && !chatInput && messages.length > 0) {
                // Find last user message for quick edit
                const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
                if (lastUserIdx >= 0) {
                  const realIdx = messages.length - 1 - lastUserIdx;
                  const lastUserMsg = messages[realIdx].content;
                  if (lastUserMsg) {
                    onChatInputChange(lastUserMsg);
                    e.preventDefault();
                  }
                }
              }
            }}
            onPaste={onPaste}
            rows={1}
            placeholder={
              chatDictating
                ? (chatInterim || t('input.listening'))
                : isBusy ? t('input.processing')
                : attachedFile ? t('input.placeholderFile')
                : t('input.placeholder')
            }
            disabled={isBusy}
              className="chat-composer-input w-full bg-transparent text-foreground placeholder:text-muted-foreground/50 placeholder:text-center font-sans text-[15px] pl-2 pr-12 py-2.5 outline-none resize-none min-h-[24px] max-h-[140px]"
          />
           <button
             onClick={onChatMicToggle}
             disabled={isBusy}
             title={chatDictating ? t('input.stopDictate') : t('input.dictate')}
             aria-label={chatDictating ? t('input.stopDictate') : t('input.dictate')}
             className={`absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all disabled:opacity-30 ${
               chatDictating
                 ? 'text-red-500 bg-red-500/10 animate-pulse'
                 : 'text-foreground/60 hover:text-foreground hover:bg-secondary/70'
             }`}
           >
             {chatDictating
               ? <Square className="w-[17px] h-[17px] fill-current" />
               : <Mic className="w-[18px] h-[18px]" strokeWidth={2} />}
           </button>
        </div>
        {/* Blue circular button, opens full-screen voice mode */}
        <button onClick={onOpenVoiceMode} disabled={isBusy}
          title={t('input.voiceMode')}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:opacity-90 active:scale-95 transition-all flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed">
           <span
             aria-hidden="true"
             className="flex h-5 items-center justify-center gap-[2px]"
           >
             {[2, 3, 4, 3, 2].map((height, index) => {
               const isDot = index === 0 || index === 4;
               return (
               <span
                 key={index}
                 className={`${isDot ? 'h-1.5 w-[2px]' : 'w-[2px]'} rounded-full bg-current`}
                 style={isDot ? undefined : { height: `${height * 4 + 2}px` }}
               />
               );
             })}
           </span>
        </button>
      </div>

      {/* + menu popover, rendered through a portal so its fixed
          positioning is always viewport-relative (framer-motion
          transforms on ancestors used to throw it off-screen). */}
      <PlusMenu
        open={plusMenuOpen && !isBusy && plusMenuCoords !== null}
        onClose={onClosePlusMenu}
        onAction={(action) => {
          onClosePlusMenu();
          onPlusAction(action);
        }}
        coords={plusMenuCoords}
        labels={{
          attachFile: t('input.attachFile'),
          camera: t('header.mode.camera'),
          newExpert: t('expert.menuItem'),
          generateImage: t('input.generateImage'),
          buildMode: t('build.menuItem'),
        }}
      />

      {/* Agent mode indicator */}
      {agentModeActive && (
        <div className="flex items-center gap-1.5 px-1 pb-1">
          <Search className="w-3 h-3 text-primary" />
          <span className="text-[11px] font-mono text-primary tracking-wider">{t('input.agentModeIndicator')}</span>
        </div>
      )}

      {/* Status bar below input */}
      <div className="min-h-[16px]">
        {chatDictating && (
          <p className="text-[10px] font-mono text-red-400/70 tracking-widest text-center animate-pulse">
            {t('input.listeningStatus')}
          </p>
        )}
        {status === 'thinking' && !chatDictating && (
          <p className="text-[10px] font-mono text-yellow-400/60 tracking-widest text-center animate-pulse">
            {t('input.thinkingStatus')}
          </p>
        )}
        {status === 'speaking' && (
          <p className="text-[10px] font-mono text-muted-foreground/50 tracking-widest text-center">
            {t('input.speakingStatus')}
            <button onClick={onStopSpeaking} className="text-primary hover:underline">{t('input.stop')}</button>
          </p>
        )}
      </div>
    </div>
  );
}
