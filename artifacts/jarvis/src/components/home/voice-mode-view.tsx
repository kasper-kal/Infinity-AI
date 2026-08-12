import { motion, AnimatePresence } from 'framer-motion';
import { Square, Search, Globe, Camera, MessagesSquare } from 'lucide-react';
import type { Widget } from '@/types/widget';
import type { ServerTimer } from '@/hooks/use-timer-orchestration';
import { ClockWidget, WeatherWidget, TimerWidget, AlarmWidget, CalendarWidget } from '@/components/widgets';
import { Orb, AppState } from '@/components/orb';
import { TimerStrip } from '@/components/timer-strip';
import { useI18n } from '@/lib/i18n';
import { haptics } from '@/lib/haptics';
import type { EmotionLabel } from '@/hooks/use-emotion-detection';

interface VoiceModeViewProps {
  status: AppState;
  voiceEmotion: EmotionLabel;
  orbAmplitude: number;
  activeTimers: ServerTimer[];
  activeWidget: Widget | null;
  agentModeActive: boolean;
  pipBrowserOpen: boolean;
  messages: { role: 'user' | 'assistant'; content: string }[];
  subtitle: { user: string; jarvis: string } | null;
  onBack: () => void;
  onToggleRecording: () => void;
  onStopSpeaking: () => void;
  onCancelTimer: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResumeTimer: (id: string) => void;
  onCloseWidget: () => void;
  onToggleAgent: () => void;
  onToggleBrowser: () => void;
  onOpenCamera: () => void;
}

/** Full-screen voice mode: orb, status, PiP toggles and the widget/conversation panel. */
export function VoiceModeView(props: VoiceModeViewProps) {
  const {
    status,
    voiceEmotion,
    orbAmplitude,
    activeTimers,
    activeWidget,
    agentModeActive,
    pipBrowserOpen,
    messages,
    subtitle,
    onBack,
    onToggleRecording,
    onStopSpeaking,
    onCancelTimer,
    onPauseTimer,
    onResumeTimer,
    onCloseWidget,
    onToggleAgent,
    onToggleBrowser,
    onOpenCamera,
  } = props;
  const { t } = useI18n();

  const statusLabels: Record<AppState, string> = {
    idle: t('voice.status.idle'),
    wake: t('voice.status.wake'),
    recording: t('voice.status.recording'),
    transcribing: t('voice.status.transcribing'),
    thinking: t('voice.status.thinking'),
    speaking: t('voice.status.speaking'),
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Back to chat, header is hidden in voice mode */}
      <button
        onClick={() => { haptics.light(); onBack(); }}
        className="absolute top-3 left-3 z-30 w-9 h-9 rounded-full bg-card/80 border border-border/50 backdrop-blur-xl text-foreground flex items-center justify-center shadow-sm hover:bg-secondary/80 active:scale-95 transition-all"
        aria-label={t('voice.backToChat')}
        title={t('voice.backToChat')}
      >
        <MessagesSquare className="w-[18px] h-[18px]" />
      </button>
      {/* Orb + status */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 min-h-0">
        {/* Durable server-side timers, survive reloads, fire even with the tab closed */}
        <TimerStrip
          timers={activeTimers}
          onCancel={onCancelTimer}
          onPause={onPauseTimer}
          onResume={onResumeTimer}
        />
        {(activeWidget?.type === 'alarm' || activeWidget?.type === 'timer') && (
          <div className="mb-4 flex flex-col items-center">
            {activeWidget.type === 'alarm' && (
              <AlarmWidget {...activeWidget} compact onClose={onCloseWidget} />
            )}
            {activeWidget.type === 'timer' && (
              <TimerWidget {...activeWidget} compact onClose={onCloseWidget} />
            )}
          </div>
        )}
        <Orb
          status={status}
          onClick={onToggleRecording}
          amplitude={orbAmplitude}
        />

        {/* PiP toggles, agent + browser + camera */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
          <button
            onClick={() => { haptics.light(); onToggleAgent(); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium font-rounded transition-all ${
              agentModeActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground/80 hover:text-foreground'
            }`}
          >
            <Search className="w-3 h-3 inline mr-1" />
            {agentModeActive ? t('voice.agentOn') : t('voice.agent')}
          </button>
          <button
            onClick={() => { haptics.light(); onToggleBrowser(); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium font-rounded transition-all ${
              pipBrowserOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground/80 hover:text-foreground'
            }`}
          >
            <Globe className="w-3 h-3 inline mr-1" />
            {pipBrowserOpen ? t('voice.browserOn') : t('voice.browser')}
          </button>
          <button
            onClick={() => { haptics.light(); onOpenCamera(); }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium font-rounded transition-all text-muted-foreground/80 hover:text-foreground"
          >
            <Camera className="w-3 h-3 inline mr-1" />
            {t('voice.cameraMode')}
          </button>
        </div>
        <div className="mt-6 text-center space-y-2">
          <AnimatePresence mode="wait">
            <motion.h2
              key={status}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className={`text-lg tracking-tight ${
                status === 'recording' ? 'text-red-500 dark:text-red-400' :
                status === 'speaking' ? 'text-green-500 dark:text-green-400' :
                status === 'thinking' || status === 'transcribing' ? 'text-amber-500 dark:text-amber-400' :
                'text-foreground font-normal'
              }`}
            >
              {statusLabels[status]}
            </motion.h2>
          </AnimatePresence>
          {voiceEmotion !== 'neutral' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 font-rounded rounded-full border border-primary/25 bg-primary/5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-medium text-primary/80">{t(`emotion.${voiceEmotion}`)}</span>
            </motion.div>
          )}
          {status === 'speaking' && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={onStopSpeaking}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 text-foreground/70 hover:bg-secondary/80 transition-colors text-xs font-medium">
              <Square className="w-3 h-3 fill-current" /> {t('voice.stop')}
            </motion.button>
          )}
        </div>
      </div>

      {/* Widget panel OR conversation history, pinned to bottom */}
      <div className="flex-shrink-0 px-4 sm:px-6 pb-4 sm:pb-8 pt-2 max-w-2xl w-full mx-auto">
        {activeWidget && activeWidget.type !== 'alarm' && activeWidget.type !== 'timer' ? (
          <div className="overflow-y-auto max-h-[40vh] sm:max-h-[55vh]">
            {activeWidget.type === 'clock'    && <ClockWidget {...activeWidget} onClose={onCloseWidget} />}
            {activeWidget.type === 'weather'  && <WeatherWidget {...activeWidget} onClose={onCloseWidget} />}
            {activeWidget.type === 'calendar' && <CalendarWidget {...activeWidget} onClose={onCloseWidget} />}
          </div>
        ) : messages.length > 0 ? (
          /* Compact conversation history strip */
          <div className="max-h-[40vh] overflow-y-auto space-y-2 scrollbar-thin px-2">
            {messages.slice(-8).map((msg, i) => (
              <motion.div
                key={messages.length - 8 + i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-start gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-sm leading-snug font-sans ${
                  msg.role === 'user'
                    ? 'bg-primary/20 text-foreground rounded-tr-sm'
                    : 'bg-card/60 border border-border/30 text-foreground/90 rounded-tl-sm'
                }`}>
                  <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-0.5">
                    {msg.role === 'user' ? t('voice.you') : t('voice.jarvis')}
                  </p>
                  <p className="text-[13px] leading-relaxed line-clamp-3">
                    {msg.content}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="space-y-2 min-h-[5rem]">
            {subtitle?.user && (
              <p className="text-center text-sm text-muted-foreground/70 leading-snug">
                <span className="text-[10px] tracking-widest text-muted-foreground/70 block mb-0.5">{t('voice.you')}</span>
                {subtitle.user}
              </p>
            )}
            {subtitle?.jarvis && (
              <p className="text-center text-sm text-primary/80 leading-snug">
                <span className="text-[10px] tracking-widest text-primary/70 block mb-0.5">{t('voice.jarvis')}</span>
                {subtitle.jarvis}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
