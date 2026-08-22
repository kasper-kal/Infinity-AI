import { useRef, useCallback, useEffect } from 'react';
import { detectSpeechLanguage, toSpeechLangTag } from '@/lib/speech-lang';

// Extend window for webkit prefix
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export function isWakeWordSupported(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

function soundsLikeWakeWord(text: string): boolean {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const wakePatterns = [
    /\bhey\s+jarvis\b/,
    /\bhey\s+j[ua]rv[ei]s\b/,
    /\bhey\s+j[ua]h+s?\b/,
    /\bhey\s+j[ua]v[ie]s\b/,
    /\bhey\s+j[ua]rr\b/,
    /\bhey\s+j[ua]r\b/,
    /\bjarvis\b/,
    /\bj[ua]rv[ei]s\b/,
    /\bj[ua]v[ie]s\b/,
  ];
  return wakePatterns.some((p) => p.test(lower));
}

/** Strip the wake phrase from the front of a transcript so only the command remains. */
function extractCommand(text: string): string {
  return text
    .replace(/^(hey\s+)?j[ua]r?v?[ie]?s?\s*/i, '')
    .replace(/^hey\s+/i, '')
    .trim();
}

interface UseWakeWordOptions {
  /** Wake word detected; the recognizer is still running to capture the command. */
  onWake: () => void;
  /**
   * Full command captured after the wake word, delivered within the same
   * recognizer session so iOS never needs to spawn a second instance.
   */
  onCommand: (text: string) => void;
  onError?: (msg: string) => void;
  /** BCP-47 speech-recognition language, e.g. "nl-NL" or "en-US". */
  lang?: string;
  /** Auto-detect Dutch vs English and adapt the recognizer language. */
  autoDetectLang?: boolean;
  /** Fired when auto-detection flips the language. */
  onLangChange?: (lang: string) => void;
  /**
   * Called when the recognizer was in direct-command mode (after activateCommand)
   * but timed out with no speech. Home can use this to revert UI back to wake state.
   */
  onCommandTimeout?: () => void;
}

export function useWakeWord({ onWake, onCommand, onError, onCommandTimeout, lang = 'en-US', autoDetectLang = false, onLangChange }: UseWakeWordOptions) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const activeRef = useRef(false);

  // true while we're capturing the command (after wake word, before final result)
  const commandModeRef = useRef(false);
  // the result index at which the wake word was detected
  const wakeResultIndexRef = useRef(-1);
  // When true, all callbacks are silenced but the recognizer keeps running.
  // Used during TTS/thinking so we never have to restart from a non-gesture context
  // (which iOS WebKit blocks). The recognizer auto-restarts on onend using the same
  // instance, which iOS allows.
  const suppressedRef = useRef(false);
  // After unsuppressing, we ignore results for this long so residual TTS audio
  // doesn't trigger a false command.
  const unsuppressCooldownRef = useRef(0);
  // Debounce timer for command submission, fires onCommand only after the user
  // stops speaking for 900ms, so a brief pause mid-sentence doesn't cut them off.
  const commandDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommandRef = useRef<string>('');

  const onWakeRef = useRef(onWake);
  const onCommandRef = useRef(onCommand);
  const onErrorRef = useRef(onError);
  const onCommandTimeoutRef = useRef(onCommandTimeout);
  const onLangChangeRef = useRef(onLangChange);

  onWakeRef.current = onWake;
  onCommandRef.current = onCommand;
  onErrorRef.current = onError;
  onCommandTimeoutRef.current = onCommandTimeout;
  onLangChangeRef.current = onLangChange;

  // Ref so the onend fallback can call start() without a stale closure.
  const startRef = useRef<() => void>(() => {});

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      onErrorRef.current?.('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    if (activeRef.current) return;
    activeRef.current = true;
    commandModeRef.current = false;
    wakeResultIndexRef.current = -1;

    const recognition = new SR();
    recognition.lang = langRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // Debounce helper: waits 900ms after the last final result before firing
    // onCommand. Resets on every new final chunk so mid-sentence pauses don't
    // submit prematurely.
    const scheduleCommand = (text: string) => {
      pendingCommandRef.current = text;
      if (commandDebounceRef.current) clearTimeout(commandDebounceRef.current);
      commandDebounceRef.current = setTimeout(() => {
        commandDebounceRef.current = null;
        const cmd = pendingCommandRef.current;
        pendingCommandRef.current = '';
        if (!cmd) return;
        commandModeRef.current = false;
        wakeResultIndexRef.current = -1;
        // Auto-adapt language before handing the command over, the next
        // utterance should be recognized in the language the user just used.
        if (autoDetectLang) {
          const next = toSpeechLangTag(detectSpeechLanguage(cmd), langRef.current);
          if (next !== langRef.current) {
            langRef.current = next;
            onLangChangeRef.current?.(next);
          }
        }
        onCommandRef.current(cmd);
      }, 900);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // While suppressed (during TTS / thinking), keep the recognizer alive but
      // ignore all results so we don't send background noise as commands.
      if (suppressedRef.current) return;
      // Cooldown after unsuppress: ignore results for 1.5 s so residual TTS
      // audio picked up by the recognizer doesn't trigger a false command.
      if (Date.now() < unsuppressCooldownRef.current) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        const isFinal = result.isFinal;

        if (!commandModeRef.current) {
          // ── WAKE MODE ──────────────────────────────────────────────────
          if (soundsLikeWakeWord(transcript)) {
            commandModeRef.current = true;
            wakeResultIndexRef.current = i;
            onWakeRef.current();

            // If the wake word result is already final, check for an inline command
            // (user said "hey jarvis what's the weather" in one breath).
            if (isFinal) {
              const cmd = extractCommand(transcript);
              if (cmd.length > 1) {
                // Debounce even inline commands so a one-word inline doesn't
                // fire before the user finishes the sentence.
                scheduleCommand(cmd);
                return;
              }
              // No inline command, wait for the next utterance in command mode.
            }
          }
        } else {
          // ── COMMAND MODE ───────────────────────────────────────────────
          if (i === wakeResultIndexRef.current) {
            // Still processing the same result that contained the wake word.
            if (isFinal) {
              const cmd = extractCommand(transcript);
              if (cmd.length > 1) scheduleCommand(cmd);
            }
          } else if (i > wakeResultIndexRef.current && isFinal) {
            // A subsequent final result, accumulate and debounce.
            scheduleCommand(transcript);
          }
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Expected; onend will handle restart.
      } else if (event.error === 'not-allowed') {
        activeRef.current = false;
        commandModeRef.current = false;
        onErrorRef.current?.('Microphone access denied. Wake word needs the microphone.');
      } else {
        onErrorRef.current?.(`Wake-word error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      if (!activeRef.current) return; // stopped intentionally

      if (commandModeRef.current) {
        // Session ended while waiting for a command (e.g. long silence).
        // Reset and restart in wake mode, user will need to say "hey jarvis" again.
        commandModeRef.current = false;
        wakeResultIndexRef.current = -1;
        onCommandTimeoutRef.current?.();
      }

      // Restart in wake mode by reusing the same instance, iOS allows .start()
      // on the same instance from onend. We intentionally do NOT fall back to
      // creating a new instance via setTimeout: that path is blocked on iOS
      // (WKWebView) and throws "not allowed". If the same instance can't restart
      // (e.g. audio session conflict while TTS is playing), we stop gracefully
      // and let the home page know so it can revert to wake-mode UI.
      // Re-apply the (possibly auto-detected) language before restarting.
      recognition.lang = langRef.current;
      try {
        recognition.start();
      } catch {
        activeRef.current = false;
        recognitionRef.current = null;
        // Signal home to flip back to wake status so the user can tap to re-engage.
        onCommandTimeoutRef.current?.();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      activeRef.current = false;
      onErrorRef.current?.('Could not start wake-word listener.');
    }
  }, []);

  // Always keep startRef pointing at start so the onend fallback can call it.
  startRef.current = start;
  // Keep lang in a ref so `start` never needs to recreate its closure.
  const langRef = useRef(lang);
  langRef.current = lang;

  // #11: Restart the recognizer if it died while the tab was hidden (tab switch / lock screen).
  // Without this, "hey Infinity" stops working after the user backgrounds the app on iOS/Android.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      // Tab became visible, if we should be active but the recognizer is gone, restart it.
      if (activeRef.current && !recognitionRef.current) {
        activeRef.current = false; // allow start() to proceed
        startRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []); // empty deps, only uses refs that are always current

  const stop = useCallback(() => {
    activeRef.current = false;
    commandModeRef.current = false;
    wakeResultIndexRef.current = -1;
    if (commandDebounceRef.current) { clearTimeout(commandDebounceRef.current); commandDebounceRef.current = null; }
    pendingCommandRef.current = '';
    try {
      recognitionRef.current?.stop();
    } catch { /* noop */ }
    recognitionRef.current = null;
  }, []);

  const reset = useCallback(() => {
    if (activeRef.current) {
      stop();
      start();
    }
  }, [start, stop]);

  /**
   * Silence all wake-word callbacks without stopping the recognizer.
   * iOS WebKit blocks recognition.start() outside a user gesture, so we must
   * keep the recognizer alive during TTS/thinking rather than stopping and
   * restarting it. Call this when Infinity starts thinking or speaking.
   */
  const suppress = useCallback(() => {
    suppressedRef.current = true;
    // Also reset command mode so a stale command-mode state doesn't fire on unsuppress.
    commandModeRef.current = false;
    wakeResultIndexRef.current = -1;
  }, []);

  /**
   * Re-enable callbacks on the still-running recognizer.
   * Call this when returning to idle/wake state.
   */
  const unsuppress = useCallback(() => {
    suppressedRef.current = false;
    // 800ms cooldown so TTS-echo audio (Infinity saying "Infinity" in a response,
    // or mic picking up its voice) doesn't trigger a false wake/command.
    unsuppressCooldownRef.current = Date.now() + 800;
  }, []);

  /**
   * Skip wake-word detection for one utterance, the next thing the user says
   * goes straight to onCommand.
   *
   * @param fromGesture  Pass true when called directly from a user tap (orb press).
   *   iOS WebKit only allows recognition.start() on a NEW instance from a gesture
   *   context. If the recognizer is already alive, both values are safe (no new
   *   instance needed). If the recognizer died (e.g. audio-session conflict during
   *   TTS) and fromGesture is false, we fall back gracefully instead of throwing.
   */
  const activateCommand = useCallback((fromGesture = false) => {
    suppressedRef.current = false;
    commandModeRef.current = true;
    wakeResultIndexRef.current = -1;
    if (!activeRef.current) {
      if (fromGesture) {
        // User tap, safe to start a brand-new recognizer instance on iOS.
        start();
        commandModeRef.current = true;
        wakeResultIndexRef.current = -1;
      } else {
        // Non-gesture context (e.g. setTimeout after TTS). Starting a new
        // recognizer here is blocked on iOS. Fall back to wake mode so the
        // user can tap or say "hey Infinity" to continue.
        commandModeRef.current = false;
        onCommandTimeoutRef.current?.();
      }
    }
  }, [start]);

  return { start, stop, reset, suppress, unsuppress, activateCommand };
}
