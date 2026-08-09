import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSpeechRecognition, isSpeechRecognitionSupported } from '@/hooks/use-speech-recognition';
import { useWakeWord, isWakeWordSupported } from '@/hooks/use-wake-word';
import { useClapDetection } from '@/hooks/use-clap-detection';
import { useSynthesizeSpeech } from '@workspace/api-client-react';
import { Orb, AppState } from '@/components/orb';
import { ConversationFeed, ChatMessage } from '@/components/conversation-feed';
import { ChatSidebar } from '@/components/chat-sidebar';
import { SettingsPanel } from '@/components/settings-panel';
import { useToast } from '@/hooks/use-toast';
import { Square, Mic, Send, PanelLeft, X, Plus, Bug, Search, Lightbulb, Minimize2, Maximize2, ArrowLeft, MessagesSquare, SquarePen, Camera, Globe, FileText } from 'lucide-react';
import type { Widget, TerminalResult, FileEdit } from '@/types/widget';
import { ClockWidget, WeatherWidget, TimerWidget, AlarmWidget, CalendarWidget, CommandCard } from '@/components/widgets';
import { ErrorDetailPanel, buildClientErrorDetail, type ErrorDetail } from '@/components/error-detail-panel';
import { useScreenShare } from '@/hooks/use-screen-share';
import { JarvisBrowser } from '@/components/jarvis-browser';
import { CameraFeed } from '@/components/camera-feed';
import { useI18n } from '@/lib/i18n';
import { useTimerOrchestration } from '@/hooks/use-timer-orchestration';
import { useChatStream } from '@/hooks/use-chat-stream';
import { TimerStrip } from '@/components/timer-strip';
import { useTheme } from '@/lib/use-theme';
import { PlusMenu, getPlusMenuCoords, type PlusAction } from '@/components/plus-menu';
import { AppOverlays } from '@/components/app-overlays';
import { looksLikeCodeRequest } from '@/lib/code-intent';
import { haptics } from '@/lib/haptics';
import { useEmotionDetection, type EmotionLabel } from '@/hooks/use-emotion-detection';
import { ResearchPanel, type ResearchJob } from '@/components/research-panel';
import { GemDialog } from '@/components/gem-dialog';
import { DataLab } from '@/components/data-lab';
import { CommandPalette } from '@/components/command-palette';
import { DesignStudio } from '@/components/design-studio';
import { MusicStudio } from '@/components/music-studio';
import { StudiosHub, type StudioId } from '@/components/studios-hub';
import { ConversationActions } from '@/components/conversation-actions';
import { GroupSettings } from '@/components/group-settings';
import { ensurePushSubscription } from '@/lib/push';

interface AttachedFile {
  base64: string;
  mimeType: string;
  fileName: string;
  preview?: string; // object URL for images
}

export default function Home() {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<AppState>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // #13: Persist modes across iOS Safari tab reloads
  // Start with 'chat' as safe default - user can switch modes once loaded
  const [mode, setMode] = useState<'voice' | 'chat' | 'agent' | 'camera'>(() => {
    try {
      const saved = localStorage.getItem('jarvis-mode') as any;
      // Validate the saved mode, fallback to 'chat' if invalid or 'agent'/'voice' (expensive modes)
      return (saved === 'chat' || saved === 'camera') ? saved : 'chat';
    } catch {
      return 'chat';
    }
  });
  const isChatMode = mode === 'chat';
  const isAgentMode = mode === 'agent';
  const isCameraMode = mode === 'camera';
  const [chatInput, setChatInput] = useState('');
  // Thinking mode, Jarvis streams a private reasoning pass before the answer
  // (shown in a collapsible "Thinking" block). Persisted across reloads.
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('jarvis-thinking') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('jarvis-thinking', thinkingEnabled ? 'true' : 'false'); } catch { /* noop */ }
  }, [thinkingEnabled]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarRefreshTick, setSidebarRefreshTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [subtitle, setSubtitle] = useState<{ user: string; jarvis: string } | null>(null);
  const [personality, setPersonality] = useState('balanced');
  const [personalityMenuOpen, setPersonalityMenuOpen] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [activeWidget, setActiveWidget] = useState<Widget | null>(null);
  // Server-backed timers, survive reloads and fire via web-push even with the tab closed.
  const {
    activeTimers,
    serverIdRef,
    createTimer,
    extendTimer,
    cancelTimer,
    pauseTimer,
    resumeTimer,
  } = useTimerOrchestration();
  const [customPrompt, setCustomPrompt] = useState('');
  const [customPromptOpen, setCustomPromptOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [pluginQuery, setPluginQuery] = useState<string | null>(null);
  const pluginMenuOpen = pluginQuery !== null;
  const openPlusMenu = useCallback(() => {
    if (plusButtonRef.current) setPlusMenuCoords(getPlusMenuCoords(plusButtonRef.current));
    setPluginQuery(null);
    setPlusMenuOpen(true);
  }, []);
  const openPluginMenu = useCallback(() => {
    if (plusButtonRef.current) setPlusMenuCoords(getPlusMenuCoords(plusButtonRef.current));
    setPlusMenuOpen(false);
    setPluginQuery('');
  }, []);
  const closePlusMenu = useCallback(() => {
    setPlusMenuOpen(false);
    setPluginQuery(null);
    setPlusMenuCoords(null);
  }, []);
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatingImagePrompt, setGeneratingImagePrompt] = useState('');
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [pipBrowserOpen, setPipBrowserOpen] = useState(false);
  const [pipFullscreen, setPipFullscreen] = useState<'browser' | 'camera' | null>(null);
  const [agentModeActive, setAgentModeActive] = useState(false);
  const [agentGoal, setAgentGoal] = useState<string | null>(null);
  const [plusMenuCoords, setPlusMenuCoords] = useState<{ top: number; left: number } | null>(null);
  const plusButtonRef = useRef<HTMLDivElement>(null);
  // QA-002: only request/notify about the microphone after the user has shown
  // explicit intent (tapped the orb / a voice control), never on first load.
  const micIntentRef = useRef(false);
  const micGrantedBeforeRef = useRef<string | null>(null);
  useEffect(() => {
    try { micGrantedBeforeRef.current = localStorage.getItem('jarvis-mic-granted'); } catch { /* noop */ }
  }, []);
  const markMicIntent = useCallback(() => {
    micIntentRef.current = true;
    try { localStorage.setItem('jarvis-mic-intent', 'true'); } catch { /* noop */ }
  }, []);

  // Deep research, background jobs + gem chats
  const [researchPanelOpen, setResearchPanelOpen] = useState(false);
  const [researchJobs, setResearchJobs] = useState<ResearchJob[]>([]);
  const researchNotifiedRef = useRef<Set<string>>(new Set());

  // Wave 2, user-defined gems + Data Lab
  const [gemDialogOpen, setGemDialogOpen] = useState(false);
  const [dataLabOpen, setDataLabOpen] = useState(false);
  const [buildPanelOpen, setBuildPanelOpen] = useState(false);
  const [buildTab, setBuildTab] = useState<string>('terminal');
  const [commandInput, setCommandInput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  // "@Build <message>" chat shortcut: prefills + auto-runs the build prompt.
  const [buildInitialPrompt, setBuildInitialPrompt] = useState<string | null>(null);
  const [buildRunKey, setBuildRunKey] = useState(0);
  const [studiosOpen, setStudiosOpen] = useState(false);
  const [designStudioOpen, setDesignStudioOpen] = useState(false);
  const [designImage, setDesignImage] = useState<string | null>(null);
  const [musicStudioOpen, setMusicStudioOpen] = useState(false);
  const [buildFiles, setBuildFiles] = useState<{ path: string; type: 'file' | 'dir'; size: number }[]>([]);
  const [sessionCommands, setSessionCommands] = useState<TerminalResult[]>([]);
  // Command palette (Cmd+K), search memory + run anything
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { theme, resolved, toggle: toggleTheme } = useTheme();
  const { toast } = useToast();

  // Track the last submitted message for retry
  const lastFailedTextRef = useRef<string | null>(null);
  const lastFailedFileRef = useRef<AttachedFile | null>(null);


  const messagesRef = useRef<ChatMessage[]>([]);
  const activeConvIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<AppState>('idle');
  const chatDictatingRef = useRef(false);
  useEffect(() => { statusRef.current = status; }, [status]);

  // Timer tracking for chat mode, timer lives inline in the feed, not in the sidebar

  // Keep a ref so speech-recognition callbacks never hold stale closures.
  const isChatModeRef = useRef(isChatMode);
  useEffect(() => { isChatModeRef.current = isChatMode; }, [isChatMode]);
  // #13: Persist chat mode to localStorage
  useEffect(() => {
    try { localStorage.setItem('jarvis-mode', mode); } catch { /* noop */ }
  }, [mode]);

  const { start: startListening, stop: stopListening } = useSpeechRecognition({
    lang: lang === 'nl' ? 'nl-NL' : 'en-US',
    autoDetectLang: true,
    onTranscript: (text) => {
      setStatus('thinking');
      processUserText(text);
    },
    onError: (msg) => handleError(msg),
    onEnd: () => {
      // Called when the orb-tap recording session ends (no transcript came through).
      // IMPORTANT: do NOT call startWakeWord() here, this callback fires from inside
      // a SpeechRecognition event, and iOS WebKit blocks new SR instances from that
      // context. Setting status to 'wake' is enough, the useEffect will call
      // startWakeWord() after React's commit phase (safely outside the SR callback).
      setStatus(prev => {
        if (prev === 'recording') {
          return isChatModeRef.current ? 'idle' : 'wake';
        }
        return prev;
      });
    },
  });

  // Activation method: 'wake' for "Hey Jarvis", 'clap' for double clap
  const [activationMethod, setActivationMethod] = useState<'wake' | 'clap'>(() => {
    try { return (localStorage.getItem('jarvis-activation-method') as 'wake' | 'clap') || 'wake'; }
    catch { return 'wake'; }
  });

  const { start: startWakeWord, stop: stopWakeWord, reset: resetWakeWord, suppress: suppressWakeWord, unsuppress: unsuppressWakeWord, activateCommand } = useWakeWord({
    lang: lang === 'nl' ? 'nl-NL' : 'en-US',
    autoDetectLang: true,
    onWake: () => {
      if (isChatMode) return;
      try { localStorage.setItem('jarvis-mic-granted', 'true'); } catch { /* noop */ }
      playWakeSound();
      vibrate([50, 30, 50]);
      setStatus('recording');
    },
    onCommand: (text) => {
      // Command captured within the wake-word session (no new recognizer spawned).
      // The wake-word hook restarts itself in wake mode after this fires.
      setStatus('thinking');
      processUserText(text);
    },
    onError: (msg) => {
      // QA-002: keep unsolicited permission failures quiet, the user may not
      // have asked for voice yet. Only surface a toast after explicit intent.
      if (msg.includes('denied')) {
        try { localStorage.removeItem('jarvis-mic-granted'); } catch { /* noop */ }
        if (micIntentRef.current) {
          toast({ title: 'Wake word needs mic access', description: msg });
        }
      }
      setStatus('idle');
    },
    onCommandTimeout: () => {
      // Direct-command mode timed out with no speech, fall back to idle.
      setStatus(prev => prev === 'recording' ? 'idle' : prev);
    },
  });

  // Double clap detection, alternative activation method
  const { start: startClapDetection, stop: stopClapDetection } = useClapDetection({
    onClap: () => {
      if (isChatMode) return;
      if (status === 'idle' || status === 'wake') {
        playWakeSound();
        vibrate([50, 30, 50]);
        setStatus('recording');
        activateCommand(true);
      }
    },
    enabled: activationMethod === 'clap' && !isChatMode,
  });

  // Persist activation method to localStorage
  useEffect(() => {
    try { localStorage.setItem('jarvis-activation-method', activationMethod); } catch { /* noop */ }
  }, [activationMethod]);
  const synthesizeSpeech = useSynthesizeSpeech();

  // Free client-side emotion detection (Web Audio prosody) while recording.
  // The detected label is sent to the chat endpoint so Jarvis can adapt tone.
  const [voiceEmotion, setVoiceEmotion] = useState<EmotionLabel>('neutral');
  const voiceEmotionRef = useRef<EmotionLabel>('neutral');
  voiceEmotionRef.current = voiceEmotion;
  const [orbAmplitude, setOrbAmplitude] = useState(0);
  useEmotionDetection({
    enabled: !isChatMode && status === 'recording',
    onEmotion: setVoiceEmotion,
    onAmplitude: setOrbAmplitude,
  });
  useEffect(() => {
    if (status !== 'recording') {
      setVoiceEmotion('neutral');
      if (status !== 'speaking') setOrbAmplitude(0);
    }
  }, [status]);

  // Screen share, start/stop + track active state + latest frame for AI
  const { start: startScreenShare, stop: stopScreenShare, latestFrame: screenFrame } = useScreenShare({
    onFrame: (frame) => {
      // Store latest frame for AI context
    },
  });
  const activeAudioRef = useRef<{ stop: () => void } | null>(null);
  const orbAmplitudeRafRef = useRef<number | null>(null);
  // Audio context shared across all TTS playback. Using Web Audio API with
  // decodeAudioData fully buffers the audio before playing, eliminates the
  // "l...lo... ho...w..." stutter on Android Chrome.
  const audioContextRef = useRef<AudioContext | null>(null);
  // The unlocked Audio element is kept only for the iOS gesture unlock (the
  // silent play that tells Safari "this origin is allowed audio").
  const iosUnlockedAudioRef = useRef<HTMLAudioElement | null>(null);
  const unlockAudioForIOS = useCallback(() => {
    if (!audioContextRef.current) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new Ctor();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
    if (!iosUnlockedAudioRef.current) {
      const el = new Audio();
      el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      el.volume = 0;
      el.play().catch(() => {});
      iosUnlockedAudioRef.current = el;
    }
  }, []);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { activeConvIdRef.current = activeConversationId; }, [activeConversationId]);

  // Keep subtitle in sync with latest exchange
  useEffect(() => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const lastJarvis = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastUser || lastJarvis) {
      setSubtitle({ user: lastUser?.content ?? '', jarvis: lastJarvis?.content ?? '' });
    }
  }, [messages]);
  useEffect(() => { if (isChatMode) setTimeout(() => inputRef.current?.focus(), 50); }, [isChatMode]);

  // Revoke object URL on cleanup
  useEffect(() => {
    return () => { if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview); };
  }, [attachedFile]);

  // Register for real push notifications if the user already allowed them
  // (silent, no prompt; keeps the subscription fresh across sessions).
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      ensurePushSubscription().catch(() => {});
    }
  }, []);

  // Load personality and web search from settings
  useEffect(() => {
    fetch('/api/jarvis/settings')
      .then(r => r.json())
      .then(data => {
        if (data.personality) setPersonality(data.personality);
        setWebSearchEnabled(data.web_search_enabled === 'true');
        if (data.custom_personality_prompt) setCustomPrompt(data.custom_personality_prompt);
      })
      .catch(() => {});
  }, []);



  // Wake-word lifecycle
  useEffect(() => {
    if (isChatMode) { stopWakeWord(); return; }

    if (status === 'idle' || status === 'wake') {
      // Ensure recognizer is running and not suppressed. QA-002: do NOT
      // auto-request the mic on first load, only after the user has tapped
      // a voice control (micIntentRef) or previously granted access.
      if ((micIntentRef.current || micGrantedBeforeRef.current) && isWakeWordSupported()) {
        startWakeWord(); // guard in hook prevents double-start
      }
      unsuppressWakeWord();
    } else if (status === 'thinking' || status === 'speaking' || status === 'transcribing') {
      // Suppress instead of stop: keeps the recognizer alive so activateCommand()
      // only needs to flip a ref (no recognition.start()), which is iOS-safe.
      suppressWakeWord();
    }
    // 'recording' → leave alone. Either:
    //   • orb-tap: stopWakeWord() already called inside handleToggleRecording
    //   • wake-word command capture: hook must keep running to capture the command
  }, [isChatMode, status, startWakeWord, stopWakeWord, suppressWakeWord, unsuppressWakeWord]);

  const handleSetPersonality = async (value: string) => {
    setPersonality(value);
    if (value === 'custom') {
      setCustomPromptOpen(true);
      setPersonalityMenuOpen(false);
      return;
    }
    setPersonalityMenuOpen(false);
    setCustomPromptOpen(false);
    try {
      await fetch('/api/jarvis/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality: value }),
      });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save personality' });
    }
  };

  const handleSaveCustomPrompt = async () => {
    try {
      await fetch('/api/jarvis/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality: 'custom', custom_personality_prompt: customPrompt }),
      });
      setCustomPromptOpen(false);
      toast({ title: 'Custom personality saved' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save personality' });
    }
  };

  const handleToggleWebSearch = async () => {
    const next = !webSearchEnabled;
    setWebSearchEnabled(next);
    try {
      await fetch('/api/jarvis/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ web_search_enabled: next ? 'true' : 'false' }),
      });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save web search setting' });
    }
  };

  /** Fire haptic vibration on mobile, silently no-ops on desktop */
  const vibrate = useCallback((pattern: number | number[]) => {
    try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
  }, []);

  const playWakeSound = useCallback(() => {
    // #44: Reuse the shared AudioContext, creating a new one per wake-word leaks browser
    // audio handles and eventually exhausts the limit (~6 contexts on Chrome/Safari).
    try {
      if (!audioContextRef.current) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new Ctor();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch { /* audio not supported */ }
  }, []);

  const handleError = useCallback((msg: string, detail?: ErrorDetail, onRetry?: () => void, code?: string) => {
    // The panel stays CLOSED until the user clicks DETAILS, the toast shows
    // the message with a DETAILS button. If the server didn't send a detail
    // object, build one client-side with every bit of browser/context info
    // we can capture so the user can copy a complete bug report.
    const resolvedDetail = detail ?? buildClientErrorDetail(msg);

    // LLM cooldown (every provider key cooling) is an expected, temporary
    // state on the free tier, render it as a gentle "recharging" toast, not
    // a scary destructive error.
    if (code === 'llm_cooling') {
      toast({
        variant: 'default',
        title: 'Jarvis is recharging',
        description: (
          <span className="flex items-center gap-2">
            <span className="flex-1">{msg}</span>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary text-[10px] font-mono tracking-wider hover:bg-primary/20 transition-colors flex-shrink-0"
              >
                RETRY
              </button>
            )}
          </span>
        ),
        duration: 15000,
      });
      vibrate([30]);
      setStatus('idle');
      return;
    }

    toast({
      variant: 'destructive',
      title: 'Something went wrong',
      description: (
        <span className="flex items-center gap-2">
          <span className="flex-1">{msg}</span>
          <span className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setErrorDetail(resolvedDetail)}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-red-400/30 bg-red-400/10 text-red-400 text-[10px] font-mono tracking-wider hover:bg-red-400/20 transition-colors"
            >
              <Bug className="w-2.5 h-2.5" />
              DETAILS
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-2 py-0.5 rounded border border-amber-400/30 bg-amber-400/10 text-amber-400 text-[10px] font-mono tracking-wider hover:bg-amber-400/20 transition-colors"
              >
                RETRY
              </button>
            )}
          </span>
        </span>
      ),
      duration: 15000, // long enough to actually click DETAILS / RETRY
    });
    vibrate([100, 50, 100]);
    setStatus('idle');
  }, [toast, vibrate]);

  const refreshSidebar = useCallback(() => setSidebarRefreshTick(t => t + 1), []);

  // ── Deep research: poll background jobs + fire browser notification when a gem is ready ──
  useEffect(() => {
    let cancelled = false;
    const loadResearch = async () => {
      try {
        const res = await fetch('/api/jarvis/research');
        if (!res.ok) return;
        const jobs = (await res.json()) as ResearchJob[];
        if (cancelled) return;
        setResearchJobs(jobs);
        // Newly completed job → notify + refresh sidebar so the gem chat appears
        for (const job of jobs) {
          if (job.status === 'completed' && !researchNotifiedRef.current.has(job.id)) {
            researchNotifiedRef.current.add(job.id);
            refreshSidebar();
            toast({
              title: t('research.notificationTitle'),
              description: `${job.title}, ${t('research.notificationBody')}`,
            });
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
              const n = new Notification(job.title, {
                  body: t('research.notificationBody'),
                  tag: `research-${job.id}`,
                });
                n.onclick = () => { window.focus(); setResearchPanelOpen(true); };
              } catch { /* notifications unavailable */ }
            }
          }
        }
      } catch { /* server not reachable, retry on next tick */ }
    };
    void loadResearch();
    const iv = setInterval(loadResearch, 12_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [refreshSidebar, toast, t]);

  /** Convert a File to base64 + metadata */
  const readFile = useCallback((file: File): Promise<AttachedFile> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const [header, base64] = dataUrl.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] ?? file.type;
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        resolve({ base64, mimeType, fileName: file.name, preview });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 1024 * 1024 * 1024; // 1 GB
    if (file.size > maxSize) { toast({ title: 'File too large', description: 'Max 1 GB' }); return; }
    try {
      if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview);
      setAttachedFile(await readFile(file));
    } catch { toast({ title: 'Could not read file' }); }
    e.target.value = '';
  }, [attachedFile, readFile, toast]);

  /** Handle paste events, capture images pasted from clipboard */
  const handleInputPaste = useCallback(async (e: React.ClipboardEvent) => {
    const imageItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    try {
      if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview);
      setAttachedFile(await readFile(file));
    } catch { toast({ title: 'Could not load image' }); }
  }, [attachedFile, readFile, toast]);

  const removeAttachedFile = useCallback(() => {
    if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview);
    setAttachedFile(null);
  }, [attachedFile]);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/jarvis/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      // Filter out poisoned history entries, raw tool-call JSON an older
      // broken tool-calling attempt stored as assistant messages.
      const cleanMessages = (data.messages ?? []).filter(
        (m: any) =>
          !(
            m.role === 'assistant' &&
            typeof m.content === 'string' &&
            m.content.includes('read_source_code') &&
            (m.content.trim().startsWith('{') || m.content.trim().startsWith('```'))
          ),
      ).map((m: any) => ({ id: nextMsgId(), role: m.role, content: m.content, reasoning: m.reasoning ?? undefined }));
      setMessages(cleanMessages);
      setActiveConversationId(id);
      setSuggestions([]);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load conversation' });
    }
  }, [toast]);

  const handleNewChat = useCallback(() => {
    haptics.light();
    setMessages([]);
    setActiveConversationId(null);
    setSuggestions([]);
    setSubtitle(null);
    setActiveWidget(null);
    chatTimerMsgIdxRef.current = null;
    timerStartedAtRef.current = null;
    timerOriginalDurationRef.current = null;
  }, []);

  // Wave 2, a freshly created gem opens straight into chat mode
  const handleGemCreated = useCallback((conv: { id: string; title: string }) => {
    haptics.medium?.();
    setMode('chat');
    setActiveConversationId(conv.id);
    setMessages([]);
    setSuggestions([]);
    toast({ title: conv.title, description: t('gem.createdToast') });
    void loadConversation(conv.id);
  }, [loadConversation, toast, t]);

  // Wave 2, Data Lab hands a data summary to Jarvis in chat mode
  const handleDataLabAsk = useCallback((summaryText: string) => {
    haptics.medium?.();
    setMode('chat');
    setTimeout(() => processUserTextRef.current?.(summaryText, null, false), 80);
  }, []);

  const playTTS = useCallback((jarvisText: string, onStart: () => void, onDone: () => void) => {
    synthesizeSpeech.mutate(
      { data: { text: jarvisText } },
      {
        onSuccess: (speechData) => {
          try {
            const binaryString = atob(speechData.audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            const blob = new Blob([bytes.buffer], { type: speechData.contentType });
            const url = URL.createObjectURL(blob);

            // Use Web Audio API for stutter-free playback on Android.
            // decodeAudioData fully decodes the buffer into memory before
            // playback starts, so there's no gap/choppiness on any browser.
            // The pre-unlocked Audio element (iosUnlockedAudioRef) is kept
            // solely for the iOS gesture unlock at the top of this flow.
            const ctx = audioContextRef.current;
            if (!ctx) { handleError("Audio not ready"); URL.revokeObjectURL(url); onDone(); return; }

            void ctx.resume();
            fetch(url)
              .then(r => r.arrayBuffer())
              .then(buf => ctx.decodeAudioData(buf))
              .then(decoded => {
                URL.revokeObjectURL(url);
                const source = ctx.createBufferSource();
                source.buffer = decoded;
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.78;
                source.connect(analyser);
                analyser.connect(ctx.destination);

                const audioData = new Uint8Array(analyser.fftSize);
                let smoothedAmplitude = 0;
                let tracking = true;
                const updateOrbAmplitude = () => {
                  if (!tracking) return;
                  analyser.getByteTimeDomainData(audioData);
                  let sum = 0;
                  for (const sample of audioData) {
                    const normalized = (sample - 128) / 128;
                    sum += normalized * normalized;
                  }
                  const rms = Math.sqrt(sum / audioData.length);
                  const target = Math.min(1, Math.max(0, (rms - 0.008) / 0.12));
                  smoothedAmplitude = smoothedAmplitude * 0.78 + target * 0.22;
                  setOrbAmplitude(smoothedAmplitude);
                  orbAmplitudeRafRef.current = requestAnimationFrame(updateOrbAmplitude);
                };

                source.onended = () => {
                  tracking = false;
                  if (orbAmplitudeRafRef.current) cancelAnimationFrame(orbAmplitudeRafRef.current);
                  orbAmplitudeRafRef.current = null;
                  setOrbAmplitude(0);
                  activeAudioRef.current = null;
                  onDone();
                };
                // MUST set onended BEFORE start(0), on some browsers the
                // callback won't fire if registered after playback begins.
                activeAudioRef.current = {
                  stop: () => {
                    tracking = false;
                    if (orbAmplitudeRafRef.current) cancelAnimationFrame(orbAmplitudeRafRef.current);
                    orbAmplitudeRafRef.current = null;
                    setOrbAmplitude(0);
                    try { source.stop(); } catch {}
                  },
                };

                onStart();
                source.start(0);
                orbAmplitudeRafRef.current = requestAnimationFrame(updateOrbAmplitude);
              })
              .catch(() => { URL.revokeObjectURL(url); handleError("Audio playback failed"); });
          } catch { handleError("Failed to decode audio"); }
        },
        onError: (err) => {
          // Surface TTS failures instead of silently returning to idle, a
          // missing/invalid ElevenLabs key otherwise looks like "voice mode
          // errors when I talk".
          const detail = (err as any)?.error?.detail as ErrorDetail | undefined;
          handleError(
            (err as any)?.error?.error || 'Speech synthesis failed. Check your ElevenLabs API key.',
            detail,
          );
          onDone();
        },
      }
    );
  }, [synthesizeSpeech, handleError, iosUnlockedAudioRef]);

  // Chat streaming + SSE consumption, extracted to use-chat-stream for size & clarity.
  const {
    processUserText,
    processUserTextRef,
    nextMsgId,
    pendingCodeRef,
    chatTimerMsgIdxRef,
    timerStartedAtRef,
    timerOriginalDurationRef,
    keyRetry,
    retrySameKey,
    retryNextKey,
    dismissKeyRetry,
  } = useChatStream({
    isChatMode,
    webSearchEnabled,
    thinkingEnabled,
    screenShareActive,
    screenFrame,
    mode,
    activeConvIdRef,
    inputRef,
    isChatModeRef,
    voiceEmotionRef,
    serverIdRef,
    setMessages,
    setSuggestions,
    setStatus,
    setMode,
    setActiveConversationId,
    setActiveWidget,
    setAgentGoal,
    setPipBrowserOpen,
    setPipFullscreen,
    setSessionCommands,
    handleError,
    refreshSidebar,
    playTTS,
    activateCommand,
    vibrate,
    createTimer,
    extendTimer,
    cancelTimer,
  });

  const handleToggleRecording = useCallback(() => {
    markMicIntent(); // user explicitly tapped the orb → mic intent established
    unlockAudioForIOS(); // must be called synchronously from user gesture for iOS Safari
    vibrate(30);
    if (status === 'speaking') {
      activeAudioRef.current?.stop?.();
      activeAudioRef.current = null;
      // Barge-in: stop TTS and immediately start recording
      setStatus('recording');
      if (isChatMode) {
        // In chat mode, start chat mic recording for barge-in
        unlockAudioForIOS();
        vibrate([30, 50, 30]);
        startChatRecording();
      } else {
        activateCommand(true); // user gesture, safe on iOS, starts listening immediately
      }
      return;
    }
    if (status === 'idle' || status === 'wake') {
      if (!isSpeechRecognitionSupported()) {
        handleError("Voice mode requires Chrome or Edge browser.");
        return;
      }
      // Use activateCommand() instead of stopWakeWord() + startListening().
      // This keeps a single recognizer alive, critical on iOS where start()
      // is only allowed from a user gesture. Here we ARE in a gesture, so
      // activateCommand()'s fallback start() is also iOS-safe.
      setStatus('recording');
      activateCommand(true); // user gesture, safe to start a fresh recognizer on iOS
    } else if (status === 'recording') {
      // Cancel: reset the wake-word hook to idle wake mode without stopping it.
      // suppress() clears command mode, unsuppress() re-enables callbacks —
      // net effect: recognizer stays alive in wake-word detection mode.
      suppressWakeWord();
      stopListening(); // no-op if orb-tap recognizer isn't running
      if (!isChatMode) {
        setStatus('wake');
        unsuppressWakeWord();
      } else {
        setStatus('idle');
      }
    }
  }, [status, isChatMode, startListening, stopListening, stopWakeWord, startWakeWord, suppressWakeWord, unsuppressWakeWord, activateCommand, handleError]);

  const handleChatSubmit = () => {
    const text = chatInput.trim();
    if (!text && !attachedFile) return;
    if (status === 'thinking' || status === 'transcribing') return;
    haptics.medium();
    unlockAudioForIOS(); // must be called synchronously from user gesture for iOS Safari
    const file = attachedFile;
    setChatInput('');
    setAttachedFile(null);

    // "@Build <message>" shortcut → auto-switch to Jarvis Build with the task.
    // Runs before the agent-mode branch so @build always opens the studio.
    const buildMatch = text.match(/^@build\b\s*(.*)$/i);
    if (buildMatch) {
      const task = (buildMatch[1] ?? '').trim();
      setBuildInitialPrompt(task || null);
      setBuildRunKey((k) => k + 1);
      setBuildPanelOpen(true);
      refreshBuildFiles();
      if (task) toast({ title: t('build.title'), description: task });
      return;
    }

    // Agent mode: research-style answer with live web search (no browser theater)
    if (agentModeActive) {
      processUserText(text, file, false, undefined, true);
      return;
    }

    // Keyboard submit: no TTS. Only mic-sourced messages speak in chat mode.
    processUserText(text || file?.fileName || 'File', file, false);
  };

  const handleSuggestionClick = useCallback((text: string) => {
    haptics.light();
    setSuggestions([]);
    // Suggestions in chat mode don't speak; in voice mode they do (speak defaults to true).
    processUserText(text, null, !isChatMode);
  }, [processUserText, isChatMode]);

  // ── Image generation ────────────────────────────────────────────

  const handleImageCancel = useCallback(() => {
    setMessages(prev => prev.filter(m => !m.pendingImage));
    setStatus('idle');
  }, []);

  const handleGenerateImage = useCallback(async (prompt: string) => {
    setMessages(prev => prev.filter(m => !m.pendingImage));
    setGeneratingImage(true);
    setGeneratingImagePrompt(prompt);
    setStatus('thinking');

    // Add a user message about the image request
    setMessages(prev => [...prev, { role: 'user', content: prompt, timestamp: Date.now(), id: nextMsgId() }]);

    try {
      const res = await fetch('/api/jarvis/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        handleError(errBody?.error || `Image generation failed (${res.status})`, errBody?.detail);
        return;
      }

      const data = await res.json();
      // Add the generated image as an assistant message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Here's your image of: ${prompt}`,
        image: data.image,
        timestamp: Date.now(),
        id: nextMsgId(),
      }]);
    } catch (err) {
      const msg = err instanceof TypeError ? 'Network error, is the server running?' : 'Image generation failed';
      handleError(msg);
    } finally {
      setGeneratingImage(false);
      setGeneratingImagePrompt('');
      setStatus('idle');
      refreshSidebar();
    }
  }, [handleError, refreshSidebar]);

  const handleImageConfirm = useCallback((prompt: string) => {
    handleGenerateImage(prompt);
  }, [handleGenerateImage]);

  // ── Screen sharing ────────────────────────────────────────────

  const handleToggleScreenShare = useCallback(async () => {
    if (screenShareActive) {
      stopScreenShare();
      setScreenShareActive(false);
      toast({ title: 'Screen sharing stopped' });
    } else {
      try {
        await startScreenShare();
        setScreenShareActive(true);
        toast({ title: 'Screen sharing started', description: 'Jarvis can now see your screen' });
      } catch {
        setScreenShareActive(false);
        toast({ variant: 'destructive', title: 'Screen sharing failed' });
      }
    }
  }, [screenShareActive, startScreenShare, stopScreenShare, toast]);

  const [chatRecording, setChatRecording] = useState(false);
  const [chatInterim, setChatInterim] = useState('');
  // Ref so the transcript callback can call processUserText without stale closure
  // Pending "Use code for this answer?" confirmation payload
  const refreshBuildFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/jarvis/workspace');
      const data = await res.json();
      if (Array.isArray(data.files)) setBuildFiles(data.files);
    } catch { /* keep stale list */ }
  }, []);

  const pendingBuildRef = useRef<{ userText: string; file: AttachedFile | null; speak: boolean } | null>(null);

  const handlePlusAction = useCallback((action: PlusAction) => {
    closePlusMenu();
    switch (action) {
      case 'attach-file':
        fileInputRef.current?.click();
        break;
      case 'camera':
        setMode('camera');
        break;
      case 'new-gem':
        setGemDialogOpen(true);
        break;
      case 'generate-image':
        setChatInput(prev => prev || 'Create an image of ');
        setTimeout(() => inputRef.current?.focus(), 50);
        break;
      case 'studios':
        setStudiosOpen(true);
        break;
      case 'design-studio':
        setDesignStudioOpen(true);
        break;
      case 'music-studio':
        setMusicStudioOpen(true);
        break;
      case 'thinking':
        haptics.light();
        setThinkingEnabled(value => !value);
        break;
      case 'agent-mode':
        haptics.light();
        setAgentModeActive(value => !value);
        break;
      case 'web-search':
        void handleToggleWebSearch();
        break;
      case 'screen-share':
        void handleToggleScreenShare();
        break;
      case 'build-mode':
        setBuildPanelOpen(true);
        void refreshBuildFiles();
        break;
      case 'research':
        setResearchPanelOpen(true);
        break;
      case 'data-lab':
        setDataLabOpen(true);
        break;
    }
  }, [closePlusMenu, handleToggleScreenShare, handleToggleWebSearch, refreshBuildFiles]);

  const handlePluginAction = useCallback((action: PlusAction) => {
    setChatInput(value => value.replace(/(^|\s)@[^\s@]*$/, '$1'));
    handlePlusAction(action);
  }, [handlePlusAction]);

  const getPluginAction = useCallback((query: string): PlusAction | null => {
    const normalizedQuery = query.trim().toLowerCase();
    const actions: readonly [string, PlusAction][] = [
      [t('input.attachFile'), 'attach-file'],
      [t('header.mode.camera'), 'camera'],
      [t('gem.menuItem'), 'new-gem'],
      [t('input.generateImage'), 'generate-image'],
      [t('input.thinking'), 'thinking'],
      [t('input.agentMode'), 'agent-mode'],
      [t('input.webSearch'), 'web-search'],
      [t('input.shareScreen'), 'screen-share'],
      [t('build.menuItem'), 'build-mode'],
      [t('research.title'), 'research'],
      [t('datalab.menuItem'), 'data-lab'],
      ['All Studios', 'studios'],
      ['Design Studio', 'design-studio'],
      ['Music Studio', 'music-studio'],
    ];
    return actions.find(([label]) => label.toLowerCase().includes(normalizedQuery))?.[1] ?? null;
  }, [t]);

  useEffect(() => {
    const onPluginAction = (event: Event) => {
      const action = (event as CustomEvent<PlusAction>).detail;
      if (action) handlePluginAction(action);
    };
    window.addEventListener('jarvis-plugin-action', onPluginAction);
    return () => window.removeEventListener('jarvis-plugin-action', onPluginAction);
  }, [handlePluginAction]);

  /** Studios hub, route a selected studio to its feature. */
  const handleStudioSelect = useCallback((id: StudioId) => {
    haptics.medium?.();
    setStudiosOpen(false);
    switch (id) {
      case 'chat': setMode('chat'); break;
      case 'voice': setMode('voice'); break;
      case 'camera': setMode('camera'); break;
      case 'research': setResearchPanelOpen(true); break;
      case 'build': setBuildPanelOpen(true); refreshBuildFiles(); break;
      case 'design': setDesignStudioOpen(true); break;
      case 'music': setMusicStudioOpen(true); break;
      case 'factcheck': setMode('chat'); break; // fact-check lives on each message
      case 'datalab': setDataLabOpen(true); break;
    }
  }, [refreshBuildFiles]);

  // Auto-grow/shrink the chat textarea when input changes
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [chatInput]);

  // Barge-in recognizer, orb tap while Jarvis is speaking in chat mode:
  // auto-submit + speak back (kept separate from the input-bar dictation).
  const { start: startChatRecording, stop: stopChatRecording } = useSpeechRecognition({
    lang: lang === 'nl' ? 'nl-NL' : 'en-US',
    autoDetectLang: true,
    onTranscript: (text) => {
      setChatRecording(false);
      if (!text.trim()) return;
      unlockAudioForIOS();
      processUserTextRef.current?.(text.trim(), null, true);
    },
    onError: (msg) => { toast({ title: 'Voice input failed', description: msg }); setChatRecording(false); },
    onEnd: () => setChatRecording(false),
  });

  // In-chat dictation recognizer, Whisper transcribes into the input box and
  // STAYS in chat mode. Continuous + interim: it keeps listening until the user
  // taps the square stop button; nothing is auto-submitted while talking.
  const { start: startChatDictation, stop: stopChatDictation } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    lang: lang === 'nl' ? 'nl-NL' : 'en-US',
    autoDetectLang: true,
    onTranscript: (text) => {
      if (!text.trim()) return;
      setChatInput(prev => prev ? `${prev.trimEnd()} ${text.trim()}` : text.trim());
      setChatInterim('');
    },
    onInterim: (text) => setChatInterim(text),
    onError: (msg) => { toast({ title: 'Voice input failed', description: msg }); setChatDictating(false); setChatInterim(''); },
    onEnd: () => { setChatDictating(false); setChatInterim(''); },
  });

  /** In-chat dictation toggle, mic button beside the input. While active it
      becomes a square button; tap it to stop recording. Stays in chat mode. */
  const [chatDictating, setChatDictating] = useState(false);
  useEffect(() => { chatDictatingRef.current = chatDictating; }, [chatDictating]);
  const handleChatMicToggle = () => {
    if (chatDictating) {
      haptics.light();
      stopChatDictation();
      setChatDictating(false);
      setChatInterim('');
      return;
    }
    if (!isSpeechRecognitionSupported()) {
      toast({ title: 'Voice input unavailable', description: 'Speech recognition needs Chrome or Edge.' });
      return;
    }
    haptics.heavy();
    unlockAudioForIOS(); // must run synchronously from the user gesture (iOS)
    setChatDictating(true);
    setChatInterim('');
    startChatDictation();
  };

  /** The blue circular waveform button, opens the full-screen voice assistant. */
  const handleOpenVoiceMode = () => {
    markMicIntent(); // opening voice mode is explicit mic intent
    haptics.heavy();
    setMode('voice');
  };

  // Leave-the-tab safeguard: stop recording / TTS / dictation the moment the
  // user switches away, so the mic never keeps listening in a background tab.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      // Stop TTS playback
      if (activeAudioRef.current) {
        activeAudioRef.current.stop?.();
        activeAudioRef.current = null;
      }
      // Stop in-chat dictation (continuous mic)
      if (chatDictatingRef.current) {
        stopChatDictation();
        setChatDictating(false);
        setChatInterim('');
      }
      // Cancel active voice recording (same reset as handleToggleRecording cancel)
      if (statusRef.current === 'recording') {
        suppressWakeWord();
        stopListening();
        if (isChatModeRef.current) {
          setStatus('idle');
        } else {
          setStatus('wake');
          unsuppressWakeWord();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stopListening, stopChatDictation, suppressWakeWord, unsuppressWakeWord]);

  const handleStopSpeaking = () => {
    haptics.light();
    activeAudioRef.current?.stop?.();
    activeAudioRef.current = null;
    if (isChatMode) {
      setStatus('idle');
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setStatus('wake');
      startWakeWord(); // call directly, user-gesture context (iOS safe)
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K → command palette (search memory + run anything)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // Spacebar for voice mode PTT
      if (isChatMode) return;
      if (e.code !== 'Space' || e.repeat) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      if (status === 'idle' || status === 'wake' || status === 'recording' || status === 'speaking') handleToggleRecording();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, isChatMode, handleToggleRecording]);

  /** Read a message aloud from the ChatGPT-style action row. */
  const speakMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    unlockAudioForIOS();
    activeAudioRef.current?.stop?.();
    activeAudioRef.current = null;
    playTTS(text, () => setStatus('speaking'), () => {
      if (isChatModeRef.current) setStatus('idle');
    });
  }, [playTTS, unlockAudioForIOS]);

  /** Regenerate the assistant's response from a given message index */
  const handleRegenerate = useCallback((messageIndex: number) => {
    // Find the last user message before this assistant message
    const msg = messages[messageIndex];
    if (!msg || msg.role !== 'assistant') return;
    // Walk backwards to find the user message that triggered this response
    let userText = '';
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userText = messages[i].content; break; }
    }
    if (!userText) return;
    // Remove everything from the assistant message onward
    setMessages(prev => prev.slice(0, messageIndex));
    // Re-send
    processUserText(userText, null, false);
  }, [messages, processUserText]);

  /** Edit a user message and re-send from that point */
  const handleEditMessage = useCallback((messageIndex: number, newContent: string) => {
    const msg = messages[messageIndex];
    if (!msg || msg.role !== 'user') return;
    if (newContent === msg.content) return; // no change
    // Trim history to before this message, then re-send with edited text
    setMessages(prev => prev.slice(0, messageIndex));
    processUserText(newContent, null, false);
  }, [messages, processUserText]);

  const isBusy = status === 'thinking' || status === 'transcribing';

  const statusLabels: Record<AppState, string> = {
    idle: t('voice.status.idle'),
    wake: t('voice.status.wake'),
    recording: t('voice.status.recording'),
    transcribing: t('voice.status.transcribing'),
    thinking: t('voice.status.thinking'),
    speaking: t('voice.status.speaking'),
  };


  return (
    <div className={`${resolved} h-dvh bg-background text-foreground flex flex-col overflow-hidden`}>

      {/* Manual LLM-key retry (chat/voice only): the chosen key failed, the
          user decides to try the same key again or switch to the next one. */}
      <AnimatePresence>
        {keyRetry && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-2rem)] max-w-md"
            data-testid="llm-key-retry"
          >
            <div className="rounded-xl border border-amber-400/30 bg-card/95 backdrop-blur-xl shadow-apple-lg p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono tracking-widest text-amber-400 uppercase">LLM key failed</p>
                  <p className="text-xs text-foreground/90 mt-1 leading-relaxed">{keyRetry.message}</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-1 truncate">{keyRetry.keyName}</p>
                </div>
                <button
                  onClick={dismissKeyRetry}
                  className="p-1 rounded-md hover:bg-secondary/70 text-muted-foreground transition-colors flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-2 mt-2.5">
                <button
                  onClick={retrySameKey}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-400 text-[11px] font-medium hover:bg-amber-400/20 active:scale-[0.98] transition-all"
                  data-testid="retry-same-key"
                >
                  Try same key
                </button>
                <button
                  onClick={retryNextKey}
                  disabled={!keyRetry.nextKeyId}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
                  data-testid="retry-next-key"
                >
                  Try next key{keyRetry.nextKeyName ? `: ${keyRetry.nextKeyName.split(' ').slice(-2).join(' ')}` : ''}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header: Apple-style translucent toolbar ── */}
      {/* Hidden in voice mode, the orb view takes the full screen. */}
      <header className={`glass-toolbar px-4 py-2.5 flex items-center border-b border-border/50 relative z-50 flex-shrink-0 ${mode === 'voice' ? 'hidden' : ''}`}>
        {/* Left: hamburger (menu), always visible, ChatGPT style */}
        <button
          onClick={() => setMobileSidebarOpen(open => !open)}
          className="w-9 h-9 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/10 dark:border-white/15 text-foreground flex items-center justify-center shadow-sm transition-all hover:bg-secondary/70 active:scale-95"
          aria-label={mobileSidebarOpen ? 'Close history' : 'Open history'}
          aria-expanded={mobileSidebarOpen}
        >
          <PanelLeft className="w-[18px] h-[18px]" />
        </button>

        {/* Right: new chat */}
        <div className="relative flex items-center ml-auto">
          <div className="flex items-center rounded-full bg-white dark:bg-[#1c1c1e] border border-black/10 dark:border-white/15 shadow-sm overflow-hidden">
            <button
              onClick={() => { haptics.light(); handleNewChat(); }}
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

      {/* ── Body ─────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar hidden in voice mode, full screen orb experience */}
        {mode !== 'voice' && (
          <ChatSidebar
            activeId={activeConversationId}
            onSelect={loadConversation}
            onNew={handleNewChat}
            refreshTick={sidebarRefreshTick}
            mobileOpen={mobileSidebarOpen}
            desktopOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
            onNavigate={(m) => { haptics.light(); setMode(m); }}
          />
        )}

        <main className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">

          {/* ── CAMERA MODE, full-screen object detection ── */}
          {mode === 'camera' && (
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* Back to chat */}
              <button
                onClick={() => { haptics.light(); setMode('chat'); }}
                className="absolute top-3 left-3 z-30 w-9 h-9 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/10 dark:border-white/15 text-foreground flex items-center justify-center shadow-sm hover:bg-secondary/70 active:scale-95 transition-all"
                aria-label={t('voice.backToChat')}
                title={t('voice.backToChat')}
              >
                <ArrowLeft className="w-[18px] h-[18px]" />
              </button>
              <div className="flex-1 min-h-0 p-4 sm:p-8 flex flex-col">
                <div className="liquid-glass-soft rounded-2xl overflow-hidden flex-1 min-h-0 relative">
                  <CameraFeed
                    className="h-full"
                    enableDetection
                    onUploadPhoto={() => cameraInputRef.current?.click()}
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground mt-3">
                  {t('header.mode.camera')}, object detection runs 100% in your browser
                </p>
              </div>
            </div>
          )}

          {/* ── VOICE MODE, full screen ── */}
          {mode === 'voice' && (
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* Back to chat, header is hidden in voice mode */}
              <button
                onClick={() => { haptics.light(); setMode('chat'); }}
                className="absolute top-3 left-3 z-30 w-9 h-9 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/10 dark:border-white/15 text-foreground flex items-center justify-center shadow-sm hover:bg-secondary/70 active:scale-95 transition-all"
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
                  onCancel={(id) => void cancelTimer(id)}
                  onPause={(id) => void pauseTimer(id)}
                  onResume={(id) => void resumeTimer(id)}
                />
                {(activeWidget?.type === 'alarm' || activeWidget?.type === 'timer') && (
                  <div className="mb-4 flex flex-col items-center">
                    {activeWidget.type === 'alarm' && (
                      <AlarmWidget {...activeWidget} compact onClose={() => setActiveWidget(null)} />
                    )}
                    {activeWidget.type === 'timer' && (
                      <TimerWidget {...activeWidget} compact onClose={() => setActiveWidget(null)} />
                    )}
                  </div>
                )}
                <Orb
                  status={status}
                  onClick={handleToggleRecording}
                  amplitude={orbAmplitude}
                />

                {/* PiP toggles, agent + browser + camera */}
                <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                  <button
                    onClick={() => { haptics.light(); setAgentModeActive(a => !a); if (!agentModeActive) setPipBrowserOpen(true); setPipFullscreen(null); }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium font-rounded transition-all ${
                      agentModeActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground/80 hover:text-foreground'
                    }`}
                  >
                    <Search className="w-3 h-3 inline mr-1" />
                    {agentModeActive ? t('voice.agentOn') : t('voice.agent')}
                  </button>
                  <button
                    onClick={() => { haptics.light(); setPipBrowserOpen(b => !b); setPipFullscreen(null); }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium font-rounded transition-all ${
                      pipBrowserOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground/80 hover:text-foreground'
                    }`}
                  >
                    <Globe className="w-3 h-3 inline mr-1" />
                    {pipBrowserOpen ? t('voice.browserOn') : t('voice.browser')}
                  </button>
                  <button
                    onClick={() => { haptics.light(); setMode('camera'); }}
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
                      onClick={handleStopSpeaking}
                      className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 text-foreground/70 hover:bg-secondary/80 transition-colors text-xs font-medium">
                      <Square className="w-3 h-3 fill-current" /> Stop
                    </motion.button>
                  )}
                </div>
              </div>

              {/* Widget panel OR conversation history, pinned to bottom */}
              <div className="flex-shrink-0 px-4 sm:px-6 pb-4 sm:pb-8 pt-2 max-w-2xl w-full mx-auto">
                {activeWidget && activeWidget.type !== 'alarm' && activeWidget.type !== 'timer' ? (
                  <div className="overflow-y-auto max-h-[40vh] sm:max-h-[55vh]">
                    {activeWidget.type === 'clock'    && <ClockWidget {...activeWidget} onClose={() => setActiveWidget(null)} />}
                    {activeWidget.type === 'weather'  && <WeatherWidget {...activeWidget} onClose={() => setActiveWidget(null)} />}
                    {activeWidget.type === 'calendar' && <CalendarWidget {...activeWidget} onClose={() => setActiveWidget(null)} />}
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
                            {msg.role === 'user' ? 'YOU' : 'JARVIS'}
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
                        <span className="text-[10px] tracking-widest text-muted-foreground/70 block mb-0.5">YOU</span>
                        {subtitle.user}
                      </p>
                    )}
                    {subtitle?.jarvis && (
                      <p className="text-center text-sm text-primary/80 leading-snug">
                        <span className="text-[10px] tracking-widest text-primary/70 block mb-0.5">JARVIS</span>
                        {subtitle.jarvis}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CHAT MODE ── */}
          {mode === 'chat' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Chat area */}
              <div className="flex-1 flex flex-col h-full min-h-0 bg-card/5">

                {/* Durable server-side timers, survive reloads, fire even with the tab closed */}
                <TimerStrip
                  timers={activeTimers}
                  onCancel={(id) => void cancelTimer(id)}
                  onPause={(id) => void pauseTimer(id)}
                  onResume={(id) => void resumeTimer(id)}
                />

                {/* Mobile-only widget strip (orb panel is hidden on mobile) */}
                {activeWidget && (
                  <div className="lg:hidden flex-shrink-0 px-3 pt-2 pb-1 border-b border-border/20">
                    {activeWidget.type === 'timer'    && <TimerWidget {...activeWidget} compact onClose={() => setActiveWidget(null)} />}
                    {activeWidget.type === 'alarm'    && <AlarmWidget {...activeWidget} compact onClose={() => setActiveWidget(null)} />}
                    {activeWidget.type === 'clock'    && <ClockWidget {...activeWidget} onClose={() => setActiveWidget(null)} />}
                    {activeWidget.type === 'weather'  && <WeatherWidget {...activeWidget} onClose={() => setActiveWidget(null)} />}
                    {activeWidget.type === 'calendar' && <CalendarWidget {...activeWidget} onClose={() => setActiveWidget(null)} />}
                  </div>
                )}

                <ConversationFeed
                  messages={messages}
                  isThinking={status === 'thinking'}
                  suggestions={suggestions}
                  onSuggestionClick={handleSuggestionClick}
                  onRegenerate={handleRegenerate}
                  onEditMessage={handleEditMessage}
                  onSpeak={speakMessage}
                  onImageConfirm={(prompt) => {
                    // Remove pending image messages and generate
                    setMessages(prev => prev.filter(m => !m.pendingImage));
                    handleGenerateImage(prompt);
                  }}
                  onEditImage={(image) => {
                    setDesignImage(image);
                    setDesignStudioOpen(true);
                  }}
                  onImageCancel={() => {
                    // Remove pending image messages
                    setMessages(prev => prev.filter(m => !m.pendingImage));
                    setStatus('idle');
                  }}
                  generatingImage={generatingImage}
                  generatingImagePrompt={generatingImagePrompt}
                  onScreenShareConfirm={() => {
                    setMessages(prev => prev.filter(m => !m.pendingScreenShare));
                    handleToggleScreenShare();
                  }}
                  onScreenShareCancel={() => {
                    setMessages(prev => prev.filter(m => !m.pendingScreenShare));
                    setStatus('idle');
                  }}
                  onAgentBrowserConfirm={(query) => {
                    setMessages(prev => prev.filter(m => !m.pendingAgentBrowser));
                    setPipBrowserOpen(true);
                    setPipFullscreen(null);
                    // Start the autonomous agent loop with the confirmed query
                    setAgentGoal(`search for ${query}`);
                  }}
                  onAgentBrowserCancel={() => {
                    setMessages(prev => prev.filter(m => !m.pendingAgentBrowser));
                    setStatus('idle');
                  }}
                  onSourceCodeConfirm={() => {
                    const pending = pendingCodeRef.current;
                    pendingCodeRef.current = null;
                    setMessages(prev => prev.filter(m => !m.pendingSourceCode));
                    if (pending) processUserTextRef.current?.(pending.userText, pending.file, pending.speak, true);
                  }}
                  onSourceCodeCancel={() => {
                    const pending = pendingCodeRef.current;
                    pendingCodeRef.current = null;
                    setMessages(prev => prev.filter(m => !m.pendingSourceCode));
                    if (pending) processUserTextRef.current?.(pending.userText, pending.file, pending.speak, false);
                  }}
                  onBuildModeConfirm={() => {
                    const pending = pendingBuildRef.current;
                    pendingBuildRef.current = null;
                    setMessages(prev => prev.filter(m => !m.pendingBuildMode));
                    setBuildPanelOpen(true);
                    refreshBuildFiles();
                    if (pending) processUserTextRef.current?.(pending.userText, pending.file, pending.speak, undefined, false, true);
                  }}
                  onBuildModeCancel={() => {
                    const pending = pendingBuildRef.current;
                    pendingBuildRef.current = null;
                    setMessages(prev => prev.filter(m => !m.pendingBuildMode));
                    if (pending) processUserTextRef.current?.(pending.userText, pending.file, pending.speak, undefined, false, false);
                  }}
                />

                {/* Input bar, #21: padding-bottom accounts for Safari's home indicator / safe area */}
                <div
                  data-chat-composer
                  className={`border-t border-border/30 bg-background/90 backdrop-blur-md px-4 pt-3 flex-shrink-0 space-y-2 relative ${dragOver ? 'border-primary/50' : ''}`}
                  style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
                  onDrop={async e => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    setUploadProgress(0);
                    try {
                      // Simulate progress during file read
                      const progressInterval = setInterval(() => {
                        setUploadProgress(p => Math.min(95, (p ?? 0) + Math.random() * 15));
                      }, 200);
                      const result = await readFile(file);
                      clearInterval(progressInterval);
                      setUploadProgress(100);
                      setTimeout(() => setUploadProgress(null), 500);
                      if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview);
                      setAttachedFile(result);
                      toast({ title: t('input.fileAttached'), description: file.name });
                    } catch {
                      setUploadProgress(null);
                      toast({ title: t('input.couldNotRead'), variant: 'destructive' });
                    }
                  }}
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
                    <div className="flex items-center gap-2">
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-border flex-shrink-0 flex items-center justify-center bg-card/40">
                        {attachedFile.preview ? (
                          <img src={attachedFile.preview} alt="Attachment" className="w-full h-full object-cover" />
                        ) : (
                          <FileText className="w-5 h-5 text-muted-foreground/60" />
                        )}
                        <button onClick={removeAttachedFile}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-background/80 flex items-center justify-center text-foreground hover:text-red-400 transition-colors">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono text-foreground/80 tracking-widest truncate">{attachedFile.fileName}</p>
                        <p className="text-[10px] font-mono text-muted-foreground/50 tracking-widest">FILE ATTACHED</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1 px-2 py-1.5 rounded-full border border-[#e5e5ea] dark:border-white/10 bg-white dark:bg-[#1c1c1e] shadow-sm">
                    {/* Hidden file inputs */}
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />

                    {/* + menu button */}
                    <div className="relative flex-shrink-0" ref={plusButtonRef}>
                      <button
                        id="plus-menu-button"
                        onClick={() => plusMenuOpen ? closePlusMenu() : openPlusMenu()}
                        disabled={isBusy}
                        title="Attach, camera, or search"
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
                      onClick={() => { haptics.light(); setThinkingEnabled(v => !v); }}
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
                      onClick={() => { haptics.light(); setAgentModeActive(a => !a); }}
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
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSubmit(); }
                          if (e.key === 'Escape' && chatInput) { setChatInput(''); e.preventDefault(); }
                          if (e.key === 'ArrowUp' && !chatInput && messages.length > 0) {
                            // Find last user message for quick edit
                            const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
                            if (lastUserIdx >= 0) {
                              const realIdx = messages.length - 1 - lastUserIdx;
                              const lastUserMsg = messages[realIdx].content;
                              if (lastUserMsg) {
                                setChatInput(lastUserMsg);
                                e.preventDefault();
                              }
                            }
                          }
                        }}
                        onPaste={handleInputPaste}
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
                         onClick={handleChatMicToggle}
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
                    <button onClick={handleOpenVoiceMode} disabled={isBusy}
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
                    onClose={closePlusMenu}
                    onAction={(action) => {
                      closePlusMenu();
                      switch (action) {
                        case 'attach-file': fileInputRef.current?.click(); break;
                        case 'camera': setMode('camera'); break;
                        case 'new-gem': setGemDialogOpen(true); break;
                        case 'generate-image': setTimeout(() => inputRef.current?.focus(), 50); break;
                        case 'studios': setStudiosOpen(true); break;
                        case 'design-studio': setDesignStudioOpen(true); break;
                        case 'music-studio': setMusicStudioOpen(true); break;
                      }
                    }}
                    coords={plusMenuCoords}
                    labels={{
                      attachFile: t('input.attachFile'),
                      camera: t('header.mode.camera'),
                      newGem: t('gem.menuItem'),
                      generateImage: t('input.generateImage'),
                      buildMode: t('build.menuItem'),
                    }}
                  />

                  {/* Agent mode indicator */}
                  {agentModeActive && (
                    <div className="flex items-center gap-1.5 px-1 pb-1">
                      <Search className="w-3 h-3 text-primary" />
                      <span className="text-[11px] font-mono text-primary tracking-wider">AGENT MODE ON: your message will search the web</span>
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
                        <button onClick={handleStopSpeaking} className="text-primary hover:underline">{t('input.stop')}</button>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* ── PiP Floating Windows ── */}
        <AnimatePresence>
          {pipBrowserOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className={`fixed z-50 bg-card border border-border/50 rounded-xl shadow-apple-lg overflow-hidden flex flex-col ${
                pipFullscreen === 'browser'
                  ? 'inset-4'
                  : 'bottom-20 right-4 w-80 h-60'
              }`}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-primary/60" />
                  <span className="text-[10px] font-medium text-muted-foreground">{t('sidebar.navBrowser')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPipFullscreen(f => f === 'browser' ? null : 'browser')} className="p-1 rounded hover:bg-secondary/80 text-muted-foreground transition-colors">
                    {pipFullscreen === 'browser' ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                  </button>
                  <button onClick={() => { setPipBrowserOpen(false); setPipFullscreen(null); }} className="p-1 rounded hover:bg-secondary/80 text-muted-foreground transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <JarvisBrowser
                  className="h-full border-0 rounded-b-xl"
                  autoRunGoal={agentGoal}
                  onGoalHandled={() => setAgentGoal(null)}
                />
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── New Gem dialog ── */}
      <GemDialog
        open={gemDialogOpen}
        onClose={() => setGemDialogOpen(false)}
        onCreated={handleGemCreated}
      />

      {/* ── All modal overlays ── */}
      <AppOverlays
        settingsOpen={settingsOpen} onCloseSettings={() => setSettingsOpen(false)}
        theme={theme} onToggleTheme={() => toggleTheme()}
        errorDetail={errorDetail} onCloseError={() => setErrorDetail(null)}
        researchPanelOpen={researchPanelOpen} researchJobs={researchJobs}
        onCloseResearch={() => setResearchPanelOpen(false)}
        onOpenGem={(convId) => { loadConversation(convId); setResearchPanelOpen(false); }}
        onStartResearch={() => { refreshSidebar(); }}
        onCancelResearch={async (jobId) => { try { await fetch(`/api/jarvis/research/${jobId}/cancel`, { method: 'POST' }); refreshSidebar(); } catch { /* noop */ } }}
        gemDialogOpen={gemDialogOpen} onCloseGem={() => setGemDialogOpen(false)}
        onGemCreated={handleGemCreated}
        dataLabOpen={dataLabOpen} onCloseDataLab={() => setDataLabOpen(false)} onDataLabAsk={handleDataLabAsk}
        paletteOpen={paletteOpen} onClosePalette={() => setPaletteOpen(false)}
        onOpenGemFromPalette={() => setGemDialogOpen(true)} onOpenDataLabFromPalette={() => setDataLabOpen(true)}
        onOpenConversation={(id) => { void loadConversation(id); setMode('chat'); }}
        onNewChat={handleNewChat}
        onNavigate={(m) => { haptics.light(); setMode(m); }}
        onOpenResearch={() => setResearchPanelOpen(true)}
        onToggleWebSearch={handleToggleWebSearch}
        onOpenSettings={() => setSettingsOpen(true)}
        buildPanelOpen={buildPanelOpen} buildTab={buildTab} setBuildTab={setBuildTab}
        onCloseBuild={() => setBuildPanelOpen(false)} buildFiles={buildFiles} onRefreshBuildFiles={refreshBuildFiles}
        sessionCommands={sessionCommands} commandInput={commandInput} setCommandInput={setCommandInput}
        commandBusy={commandBusy} buildTitle={t('build.title')}
        buildInitialPrompt={buildInitialPrompt} buildRunKey={buildRunKey}
        studiosOpen={studiosOpen} onCloseStudios={() => setStudiosOpen(false)} onSelectStudio={handleStudioSelect}
        designStudioOpen={designStudioOpen} onCloseDesign={() => setDesignStudioOpen(false)} designInitialImage={designImage}
        musicStudioOpen={musicStudioOpen} onCloseMusic={() => setMusicStudioOpen(false)}
        showResearchPulse={!researchPanelOpen && researchJobs.some(j => j.status === 'queued' || j.status === 'running')}
      />
    </div>
  );
}
