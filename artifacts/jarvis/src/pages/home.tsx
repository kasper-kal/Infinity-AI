import { useState, useEffect, useRef, useCallback } from 'react';
import { useSpeechRecognition, isSpeechRecognitionSupported } from '@/hooks/use-speech-recognition';
import { useWakeWord, isWakeWordSupported } from '@/hooks/use-wake-word';
import { useClapDetection } from '@/hooks/use-clap-detection';
import { useSynthesizeSpeech } from '@workspace/api-client-react';
import type { SpeakOutput } from '@workspace/api-client-react';
import type { AppState } from '@/components/orb';
import type { ChatMessage } from '@/components/conversation-feed';
import { ChatSidebar } from '@/components/chat-sidebar';
import { useToast } from '@/hooks/use-toast';
import { Bug } from 'lucide-react';
import type { Widget, TerminalResult, AttachedFile } from '@/types/widget';
import { buildClientErrorDetail, type ErrorDetail } from '@/components/error-detail-panel';
import { useScreenShare } from '@/hooks/use-screen-share';
import { useI18n } from '@/lib/i18n';
import { useTimerOrchestration } from '@/hooks/use-timer-orchestration';
import { useChatStream } from '@/hooks/use-chat-stream';
import { useTheme } from '@/lib/use-theme';
import { getPlusMenuCoords, type PlusAction } from '@/components/plus-menu';
import { AppOverlays } from '@/components/app-overlays';
import { haptics } from '@/lib/haptics';
import { useEmotionDetection, type EmotionLabel } from '@/hooks/use-emotion-detection';
import type { ResearchJob } from '@/components/research-panel';
import type { BookJob } from '@/components/book-studio';
import { GemDialog } from '@/components/gem-dialog';
import type { StudioId } from '@/components/studios-hub';
import { ensurePushSubscription } from '@/lib/push';
import { KeyRetryBanner } from '@/components/home/key-retry-banner';
import { HomeHeader } from '@/components/home/home-header';
import { CameraModeView } from '@/components/home/camera-mode-view';
import { VoiceModeView } from '@/components/home/voice-mode-view';
import { ChatModeView } from '@/components/home/chat-mode-view';
import { PipBrowserWindow } from '@/components/home/pip-browser-window';
import { ProjectHome, type ProjectHomeAction } from '@/components/projects/project-home';
import type { ProjectSection } from '@/components/project-gallery';
import { ProjectMemory } from '@/components/projects/project-memory';
import { ProjectInstructions } from '@/components/projects/project-instructions';

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
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectView, setActiveProjectView] = useState<'home' | 'memory' | 'instructions' | 'activity'>('home');
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
  const [bookStudioOpen, setBookStudioOpen] = useState(false);
  const [bookJobs, setBookJobs] = useState<BookJob[]>([]);
  const bookNotifiedRef = useRef<Set<string>>(new Set());

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

  // ── Book Studio: poll background jobs + notify when a book is ready ──
  useEffect(() => {
    let cancelled = false;
    const loadBooks = async () => {
      try {
        const res = await fetch('/api/jarvis/book/jobs');
        if (!res.ok) return;
        const jobs = (await res.json()) as BookJob[];
        if (cancelled) return;
        setBookJobs(jobs);
        // Newly completed book → toast notification + browser notification
        for (const job of jobs) {
          if (job.status === 'completed' && !bookNotifiedRef.current.has(job.id)) {
            bookNotifiedRef.current.add(job.id);
            toast({
              title: t('book.notificationTitle'),
              description: `${job.title}, ${t('book.notificationBody')}`,
            });
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                const n = new Notification(job.title, { body: t('book.notificationBody'), tag: `book-${job.id}` });
                n.onclick = () => { window.focus(); setBookStudioOpen(true); };
              } catch { /* notifications unavailable */ }
            }
          }
        }
      } catch { /* server not reachable, retry on next tick */ }
    };
    void loadBooks();
    const iv = setInterval(loadBooks, 12_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [toast, t]);

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

  const handleNewChatFromShell = useCallback(() => {
    setActiveProjectId(null);
    setActiveProjectView('home');
    handleNewChat();
  }, [handleNewChat]);

  const handleSidebarSelect = useCallback(async (id: string) => {
    setActiveProjectId(null);
    setMode('chat');
    await loadConversation(id);
  }, [loadConversation]);

  const handleProjectBack = useCallback(() => {
    setActiveProjectId(null);
    setActiveProjectView('home');
  }, []);

  const handleProjectContinue = useCallback(async (conversationId: string) => {
    await loadConversation(conversationId);
    setActiveProjectId(null);
    setMode('chat');
  }, [loadConversation]);

  const handleProjectNewChat = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const response = await fetch('/api/jarvis/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      if (!response.ok) throw new Error('Could not create conversation');
      const conversation = await response.json() as { id: string };

      handleNewChat();
      setActiveConversationId(conversation.id);
      setActiveProjectId(null);
      setMode('chat');
      refreshSidebar();
    } catch {
      toast({ variant: 'destructive', title: t('projectHome.newChatError') });
    }
  }, [activeProjectId, handleNewChat, refreshSidebar, t, toast]);

  const handleProjectAction = useCallback((action: ProjectHomeAction) => {
    if (action === 'memory') {
      setActiveProjectView('memory');
      return;
    }
    if (action === 'instructions') {
      setActiveProjectView('instructions');
      return;
    }
    if (action === 'conversations') {
      setActiveProjectView('home');
      return;
    }
    if (action === 'activity') {
      setActiveProjectView('activity');
      return;
    }
    toast({ title: t('projectHome.actionComingSoon'), description: t('projectHome.actionComingSoonDesc') });
  }, [t, toast]);

  const handleProjectSection = useCallback((section: ProjectSection) => {
    if (section === 'chat') {
      void handleProjectNewChat();
      return;
    }
    if (section === 'home' || section === 'conversations') {
      setActiveProjectView('home');
      return;
    }
    handleProjectAction(section);
  }, [handleProjectAction, handleProjectNewChat]);

  const handleOpenProject = useCallback((projectId: string | null) => {
    setActiveProjectId(projectId);
    setActiveProjectView('home');
    if (projectId) {
      setMode('chat');
      setMobileSidebarOpen(false);
    }
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
        onSuccess: (speechData: SpeakOutput) => {
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
                // callback won't fire if playback begins afterward.
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
        onError: (err: unknown) => {
          // Surface TTS failures instead of silently returning to idle, a
          // missing/invalid ElevenLabs key otherwise looks like "voice mode
          // errors when I talk".
          const apiErr = err as { error?: { error?: string; detail?: ErrorDetail } };
          const detail = apiErr.error?.detail as ErrorDetail | undefined;
          handleError(
            apiErr.error?.error || 'Speech synthesis failed. Check your ElevenLabs API key.',
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

  /** Reduced +-menu handler used by the chat composer (the composer menu only
      offers attach/camera/gem/image/studios entries; the full handler below is
      for plugin actions & the command palette). */
  const handleComposerPlusAction = useCallback((action: PlusAction) => {
    switch (action) {
      case 'attach-file': fileInputRef.current?.click(); break;
      case 'camera': setMode('camera'); break;
      case 'new-gem': setGemDialogOpen(true); break;
      case 'generate-image': setTimeout(() => inputRef.current?.focus(), 50); break;
      case 'studios': setStudiosOpen(true); break;
      case 'design-studio': setDesignStudioOpen(true); break;
      case 'music-studio': setMusicStudioOpen(true); break;
    }
  }, []);

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
      case 'book': setBookStudioOpen(true); break;
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

  /** Composer drop handler: reads the dropped file with a fake progress bar. */
  const handleComposerDrop = useCallback(async (e: React.DragEvent) => {
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
  }, [attachedFile, readFile, toast, t]);

  return (
    <div className={`${resolved} h-dvh bg-background text-foreground flex flex-col overflow-hidden`}>

      {/* Manual LLM-key retry (chat/voice only): the chosen key failed, the
          user decides to try the same key again or switch to the next one. */}
      <KeyRetryBanner
        keyRetry={keyRetry}
        onSameKey={retrySameKey}
        onNextKey={retryNextKey}
        onDismiss={dismissKeyRetry}
      />

      {/* ── Header: Apple-style translucent toolbar ── */}
      {/* Hidden in voice mode, the orb view takes the full screen. */}
      <HomeHeader
        mode={mode}
        mobileSidebarOpen={mobileSidebarOpen}
        onToggleSidebar={() => setMobileSidebarOpen(open => !open)}
        onNewChat={handleNewChatFromShell}
        activeConversationId={activeConversationId}
      />

      {/* ── Body ─────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar hidden in voice mode, full screen orb experience */}
        {mode !== 'voice' && (
          <ChatSidebar
            activeId={activeConversationId}
            onSelect={handleSidebarSelect}
            onNew={handleNewChatFromShell}
            refreshTick={sidebarRefreshTick}
            mobileOpen={mobileSidebarOpen}
            desktopOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
            onNavigate={(m) => { haptics.light(); setMode(m); }}
            activeProjectId={activeProjectId}
            onOpenProject={handleOpenProject}
            onOpenProjectSection={handleProjectSection}
            onStartProjectChat={handleProjectNewChat}
          />
        )}

        <main className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
          {activeProjectId && activeProjectView === 'memory' && (
            <ProjectMemory
              projectId={activeProjectId}
              onBack={() => setActiveProjectView('home')}
            />
          )}

          {activeProjectId && activeProjectView === 'instructions' && (
            <ProjectInstructions
              projectId={activeProjectId}
              onBack={() => setActiveProjectView('home')}
            />
          )}

          {activeProjectId && activeProjectView === 'home' && (
            <ProjectHome
              projectId={activeProjectId}
              onBack={handleProjectBack}
              onContinueConversation={handleProjectContinue}
              onNewChat={handleProjectNewChat}
              onOpenAction={handleProjectAction}
            />
          )}

          {/* ── CAMERA MODE, full-screen object detection ── */}
          {!activeProjectId && mode === 'camera' && (
            <CameraModeView
              onBack={() => setMode('chat')}
              onUploadPhoto={() => cameraInputRef.current?.click()}
            />
          )}

          {/* ── VOICE MODE, full screen ── */}
          {!activeProjectId && mode === 'voice' && (
            <VoiceModeView
              status={status}
              voiceEmotion={voiceEmotion}
              orbAmplitude={orbAmplitude}
              activeTimers={activeTimers}
              activeWidget={activeWidget}
              agentModeActive={agentModeActive}
              pipBrowserOpen={pipBrowserOpen}
              messages={messages}
              subtitle={subtitle}
              onBack={() => setMode('chat')}
              onToggleRecording={handleToggleRecording}
              onStopSpeaking={handleStopSpeaking}
              onCancelTimer={(id) => void cancelTimer(id)}
              onPauseTimer={(id) => void pauseTimer(id)}
              onResumeTimer={(id) => void resumeTimer(id)}
              onCloseWidget={() => setActiveWidget(null)}
              onToggleAgent={() => { setAgentModeActive(a => !a); if (!agentModeActive) setPipBrowserOpen(true); setPipFullscreen(null); }}
              onToggleBrowser={() => { setPipBrowserOpen(b => !b); setPipFullscreen(null); }}
              onOpenCamera={() => setMode('camera')}
            />
          )}

          {/* ── CHAT MODE ── */}
          {!activeProjectId && mode === 'chat' && (
            <ChatModeView
              activeTimers={activeTimers}
              activeWidget={activeWidget}
              messages={messages}
              isThinking={status === 'thinking'}
              suggestions={suggestions}
              generatingImage={generatingImage}
              generatingImagePrompt={generatingImagePrompt}
              chatInput={chatInput}
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
              inputRef={inputRef}
              textareaRef={textareaRef}
              fileInputRef={fileInputRef}
              cameraInputRef={cameraInputRef}
              plusButtonRef={plusButtonRef}
              onCancelTimer={(id) => void cancelTimer(id)}
              onPauseTimer={(id) => void pauseTimer(id)}
              onResumeTimer={(id) => void resumeTimer(id)}
              onCloseWidget={() => setActiveWidget(null)}
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
              onChatInputChange={setChatInput}
              onToggleThinking={() => { haptics.light(); setThinkingEnabled(v => !v); }}
              onToggleAgentMode={() => { haptics.light(); setAgentModeActive(a => !a); }}
              onOpenPlusMenu={openPlusMenu}
              onClosePlusMenu={closePlusMenu}
              onPlusAction={handleComposerPlusAction}
              onChatSubmit={handleChatSubmit}
              onChatMicToggle={handleChatMicToggle}
              onOpenVoiceMode={handleOpenVoiceMode}
              onRemoveAttachedFile={removeAttachedFile}
              onPaste={handleInputPaste}
              onFileSelect={handleFileSelect}
              onDragOver={setDragOver}
              onDrop={handleComposerDrop}
              onStopSpeaking={handleStopSpeaking}
            />
          )}

        </main>

        {/* ── PiP Floating Window: Jarvis agent browser ── */}
        <PipBrowserWindow
          open={pipBrowserOpen}
          fullscreen={pipFullscreen}
          agentGoal={agentGoal}
          onToggleFullscreen={() => setPipFullscreen(f => f === 'browser' ? null : 'browser')}
          onClose={() => { setPipBrowserOpen(false); setPipFullscreen(null); }}
          onGoalHandled={() => setAgentGoal(null)}
        />
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
        bookStudioOpen={bookStudioOpen} onCloseBook={() => setBookStudioOpen(false)} bookJobs={bookJobs}
        onCancelBook={async (jobId) => { try { await fetch(`/api/jarvis/book/jobs/${jobId}/cancel`, { method: 'POST' }); } catch { /* noop */ } }}
        showResearchPulse={!researchPanelOpen && researchJobs.some(j => j.status === 'queued' || j.status === 'running')}
      />
    </div>
  );
}
