import { useRef, useCallback } from 'react';
import { detectSpeechLanguage, toSpeechLangTag } from '@/lib/speech-lang';

// Extend window for webkit prefix
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export function isSpeechRecognitionSupported(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

interface UseSpeechRecognitionOptions {
  onTranscript: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
  /** Called for interim (non-final) results while speaking, live preview. */
  onInterim?: (text: string) => void;
  /** Keep listening after a pause instead of stopping automatically. */
  continuous?: boolean;
  /** Emit partial results while the user is still talking. */
  interimResults?: boolean;
  /** BCP-47 speech-recognition language, e.g. "nl-NL" or "en-US". */
  lang?: string;
  /**
   * Auto-detect whether the user is speaking Dutch or English and adapt the
   * recognition language for subsequent utterances. Uses lib/speech-lang.
   */
  autoDetectLang?: boolean;
  /** Fired when auto-detection flips the language (e.g. to update a badge). */
  onLangChange?: (lang: string) => void;
}

export function useSpeechRecognition({
  onTranscript,
  onError,
  onEnd,
  onInterim,
  continuous = false,
  interimResults = false,
  lang = 'en-US',
  autoDetectLang = false,
  onLangChange,
}: UseSpeechRecognitionOptions) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const onLangChangeRef = useRef(onLangChange);
  onLangChangeRef.current = onLangChange;

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      onError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    const recognition = new SR();
    recognition.lang = langRef.current;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // With continuous + interim enabled, one event can contain multiple
      // results: walk every result from resultIndex onward and split
      // finalized chunks from the live interim text.
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const chunk = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += chunk;
        else interimText += chunk;
      }
      if (finalText.trim()) {
        // Auto-adapt the recognition language to what the user actually speaks.
        if (autoDetectLang) {
          const next = toSpeechLangTag(detectSpeechLanguage(finalText), langRef.current);
          if (next !== langRef.current) {
            langRef.current = next;
            onLangChangeRef.current?.(next);
          }
        }
        onTranscript(finalText.trim());
      }
      if (interimText.trim()) onInterim?.(interimText.trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Do NOT call onEnd() here, the browser always fires onend after onerror,
        // so onEnd() would be called twice (once here, once in onend). Let onend handle it.
      } else if (event.error === 'not-allowed') {
        onError('Microphone access denied. Please allow microphone in your browser settings.');
      } else if (event.error === 'network') {
        // #12: Distinguish network errors, give useful feedback on WiFi→LTE handoffs
        if (!navigator.onLine) {
          onError('No internet connection. Speech recognition requires an active connection.');
        } else {
          onError('Network error during speech recognition. Check your connection and try again.');
        }
      } else {
        onError(`Microphone error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      onEnd();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      // DOMException thrown synchronously (e.g. "not-allowed", "invalid-state").
      // Treat as a recoverable end so the caller can reset state.
      const msg = err instanceof DOMException ? err.message : String(err);
      if (msg.toLowerCase().includes('not-allowed') || msg.toLowerCase().includes('permission')) {
        onError('Microphone access denied. Please allow microphone in your browser settings.');
      } else {
        onEnd();
      }
    }
  }, [onTranscript, onError, onEnd, onInterim, continuous, interimResults, lang, autoDetectLang]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  return { start, stop };
}
