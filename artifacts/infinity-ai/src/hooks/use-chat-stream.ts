/**
 * useChatStream, the chat round-trip + SSE consumption logic extracted from
 * home.tsx (the old `processUserText`). The hook owns the streaming/timer refs
 * and takes everything else through a `ChatStreamDeps` config object, so Home
 * shrinks by ~370 lines and the core chat path is isolated and reusable.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { looksLikeCodeRequest } from '@/lib/code-intent';
import type { Widget, FileEdit, TerminalResult, AttachedFile } from '@/types/widget';
import type { ErrorDetail } from '@/components/error-detail-panel';
import type { ChatMessage, AgentToolEvent } from '@/components/conversation-feed';
import type { EmotionLabel } from '@/hooks/use-emotion-detection';
import type { AppState } from '@/components/orb';
import type { ServerTimer } from '@/hooks/use-timer-orchestration';

/**
 * Manual LLM-key retry (chat and voice only). The chosen key failed and the
 * user decides what to do: retry the same key, or move to the next key.
 */
export interface ManualKeyRetry {
  message: string;
  keyId: string;
  keyName: string;
  nextKeyId: string | null;
  nextKeyName: string | null;
}

/** Everything `processUserText` reads or writes from the Home component. */
export interface ChatStreamDeps {
  isChatMode: boolean;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  screenShareActive: boolean;
  screenFrame: string | null;
  mode: 'voice' | 'chat' | 'agent' | 'camera';
  activeConvIdRef: MutableRefObject<string | null>;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  isChatModeRef: MutableRefObject<boolean>;
  voiceEmotionRef: MutableRefObject<EmotionLabel>;
  serverIdRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSuggestions: Dispatch<SetStateAction<string[]>>;
  setStatus: Dispatch<SetStateAction<AppState>>;
  setMode: Dispatch<SetStateAction<'voice' | 'chat' | 'agent' | 'camera'>>;
  setActiveConversationId: Dispatch<SetStateAction<string | null>>;
  setActiveWidget: Dispatch<SetStateAction<Widget | null>>;
  setAgentGoal: Dispatch<SetStateAction<string | null>>;
  setPipBrowserOpen: Dispatch<SetStateAction<boolean>>;
  setPipFullscreen: Dispatch<SetStateAction<'browser' | 'camera' | null>>;
  setSessionCommands: Dispatch<SetStateAction<TerminalResult[]>>;
  handleError: (msg: string, detail?: ErrorDetail, onRetry?: () => void, code?: string) => void;
  refreshSidebar: () => void;
  playTTS: (text: string, onStart: () => void, onDone: () => void) => void;
  activateCommand: (silent?: boolean) => void;
  vibrate: (pattern: number | number[]) => void;
  createTimer: (opts: { durationSeconds: number; label?: string; conversationId?: string }) => Promise<ServerTimer | null>;
  extendTimer: (id: string, addSeconds: number) => Promise<ServerTimer | null>;
  cancelTimer: (id: string) => Promise<ServerTimer | null>;
}

export interface ChatStreamResult {
  processUserText: (
    userText: string,
    file?: AttachedFile | null,
    speak?: boolean,
    codeAllowance?: boolean,
    researchMode?: boolean,
    buildAllowance?: boolean,
    keyId?: string,
  ) => Promise<void>;
  processUserTextRef: MutableRefObject<ChatStreamResult['processUserText'] | null>;
  nextMsgId: () => string;
  pendingCodeRef: MutableRefObject<{ userText: string; file: AttachedFile | null; speak: boolean } | null>;
  chatTimerMsgIdxRef: MutableRefObject<number | null>;
  timerStartedAtRef: MutableRefObject<number | null>;
  timerOriginalDurationRef: MutableRefObject<number | null>;
  /** Manual LLM-key retry (chat/voice): non-null when the chosen key failed. */
  keyRetry: ManualKeyRetry | null;
  retrySameKey: () => void;
  retryNextKey: () => void;
  dismissKeyRetry: () => void;
}

export function useChatStream(deps: ChatStreamDeps): ChatStreamResult {
  const {
    isChatMode, webSearchEnabled, thinkingEnabled, screenShareActive, screenFrame, mode,
    activeConvIdRef, inputRef, isChatModeRef, voiceEmotionRef, serverIdRef,
    setMessages, setSuggestions, setStatus, setMode, setActiveConversationId,
    setActiveWidget, setAgentGoal, setPipBrowserOpen, setPipFullscreen,
    setSessionCommands, handleError, refreshSidebar, playTTS, activateCommand,
    vibrate, createTimer, extendTimer, cancelTimer,
  } = deps;

  // Streaming refs owned by the hook, shared with Home so it can keep using
  // them (history load, conversation-switch resets, code-confirmation UI).
  const nextMsgIdRef = useRef(0);
  const nextMsgId = useCallback(() => `m${++nextMsgIdRef.current}`, []);
  const pendingCodeRef = useRef<{ userText: string; file: AttachedFile | null; speak: boolean } | null>(null);
  const chatTimerMsgIdxRef = useRef<number | null>(null);
  const timerStartedAtRef = useRef<number | null>(null);
  const timerOriginalDurationRef = useRef<number | null>(null);

  // Manual LLM-key retry (chat/voice): when the chosen key fails, remember the
  // last send so "Try same key" / "Try next key" can re-send with a keyId.
  // User wants: fail → "Try same key" button → if fails again → "Try next key" button
  const [keyRetry, setKeyRetry] = useState<ManualKeyRetry | null>(null);
  const [retryAttempt, setRetryAttempt] = useState<0 | 1 | 2>(0); // 0=initial, 1=first retry (same key), 2=second retry (next key)
  const lastSendArgsRef = useRef<{
    userText: string; file: AttachedFile | null; speak: boolean;
    codeAllowance?: boolean; researchMode?: boolean; buildAllowance?: boolean; keyId?: string;
  } | null>(null);

  const processUserText = useCallback(async (userText: string, file?: AttachedFile | null, speak = true, codeAllowance?: boolean, researchMode = false, buildAllowance?: boolean, keyId?: string) => {
    // ── "Use code for this answer?" confirmation gate ─────────────
    // If the message looks like a question about Infinity's own code and the
    // user hasn't decided yet, show the confirmation card first. Confirm
    // re-sends with code access (codeAllowance=true); Cancel re-sends without
    // it (false), the message is never dropped, Infinity still answers.
    if (codeAllowance === undefined && isChatMode && looksLikeCodeRequest(userText)) {
      pendingCodeRef.current = { userText, file: file ?? null, speak };
      setSuggestions([]);
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
        id: nextMsgId(),
        pendingSourceCode: { userText },
      }]);
      return;
    }

    // Remember the send so the manual key-retry buttons can re-send it.
    lastSendArgsRef.current = { userText, file: file ?? null, speak, codeAllowance, researchMode, buildAllowance, keyId };
    setKeyRetry(null);
    setRetryAttempt(0);
    // Optimistically add message (with file preview if any)
    setMessages(prev => [...prev, { role: 'user', content: userText, file: file ?? undefined, timestamp: Date.now(), id: nextMsgId() }]);
    setSuggestions([]);
    setStatus('thinking');
    vibrate(20);
    try {
      const body: Record<string, string> = { userMessage: userText };
      if (activeConvIdRef.current) body.conversationId = activeConvIdRef.current;
      if (file) { body.fileBase64 = file.base64; body.fileMimeType = file.mimeType; }
      // Include screen share frame as image for AI to see (don't overwrite manual file)
      if (screenShareActive && screenFrame && !file) {
        const base64 = screenFrame.split(',')[1] || screenFrame;
        if (base64.length > 100) {
          body.fileBase64 = base64;
          body.fileMimeType = 'image/jpeg';
        }
      }
      if (webSearchEnabled || researchMode) body.webSearchEnabled = 'true';
      if (thinkingEnabled) body.thinkingEnabled = 'true';
      if (researchMode) body.agentMode = 'true';
      body.responseStyle = isChatMode ? 'chat' : 'voice';
      const detectedEmotion = voiceEmotionRef.current;
      if (detectedEmotion !== 'neutral') body.emotion = detectedEmotion;
      if (codeAllowance === true) body.allowSourceCode = 'true';
      else if (codeAllowance === false) body.allowSourceCode = 'false';
      if (buildAllowance === true) body.allowBuildMode = 'true';
      if (keyId) body.keyId = keyId;

      const res = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      if (!res.ok) {
        try {
          const errBody = await res.json();
          // Chat/voice are manual: on a failed key, show "Try same key" /
          // "Try next key" instead of a plain error.
          if (errBody?.code === 'llm_manual_retry') {
            if (errBody?.key?.id) {
              // First failure: show "Try same key" only
              // After retrySameKey is clicked and fails again: show "Try next key"
              if (retryAttempt === 0) {
                setKeyRetry({
                  message: errBody.error || 'LLM key failed',
                  keyId: errBody.key.id,
                  keyName: errBody.key.name ?? errBody.key.id,
                  nextKeyId: null, // Hide next key on first failure
                  nextKeyName: null,
                });
                setRetryAttempt(1);
                setStatus('idle');
                return;
              } else if (retryAttempt === 1) {
                // Second failure: now show "Try next key"
                setKeyRetry({
                  message: errBody.error || 'LLM key failed again',
                  keyId: errBody.key.id,
                  keyName: errBody.key.name ?? errBody.key.id,
                  nextKeyId: errBody.nextKey?.id ?? null,
                  nextKeyName: errBody.nextKey?.name ?? null,
                });
                setRetryAttempt(2);
                setStatus('idle');
                return;
              }
            }
            handleError(errBody.error || 'No LLM key available', errBody.detail);
            return;
          }
          handleError(errBody?.error || `Server error (${res.status})`, errBody?.detail, () => processUserTextRef.current?.(userText, file, speak));
        } catch {
          // Body isn't JSON, the API server is likely down or restarting
          // (a gateway/proxy-level 502/500). Explain it instead of a bare number.
          const hint = res.status >= 500
            ? 'The Infinity server is unreachable right now (likely restarting or down). Wait a few seconds and retry.'
            : `Server returned HTTP ${res.status} with an unexpected response.`;
          handleError(hint, undefined, () => processUserTextRef.current?.(userText, file, speak));
        }
        return;
      }

      // ── SSE stream consumption ──────────────────────────────────
      const reader = res.body?.getReader();
      if (!reader) { handleError('No response stream'); return; }

      const decoder = new TextDecoder();
      let streamBuffer = '';
      let jarvisText = '';
      let jarvisReasoning = '';
      let convId = activeConvIdRef.current ?? '';
      let newSuggestions: string[] = [];
      let widget: Widget | null = null;

      // Add an empty assistant message that we'll update as tokens arrive
      setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: Date.now(), id: nextMsgId() }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            switch (parsed.type) {
              case 'token':
                jarvisText += parsed.content;
                // Update the last message (assistant) with accumulated text
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: jarvisText };
                  return updated;
                });
                break;
              case 'live_text':
                // @Browse / @Agent live streaming text (Tavily search progress,
                // browser agent steps). Appended to the assistant message as plain
                // live text in chat (NOT a widget).
                jarvisText += parsed.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: jarvisText };
                  return updated;
                });
                break;
              case 'reasoning':
                // Thinking mode, accumulate the private reasoning chain onto
                // the same assistant message (shown in a collapsible block).
                jarvisReasoning += parsed.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], reasoning: jarvisReasoning };
                  return updated;
                });
                break;
              case 'done':
                convId = parsed.conversationId ?? convId;
                // Auto-follow-up: when Infinity signals the next step (Infinity Build
                // multi-step workflows), auto-submit it after a short delay.
                if (parsed.followUp && typeof parsed.followUp === 'string') {
                  const task = parsed.followUp.trim().slice(0, 200);
                  setTimeout(() => {
                    setMessages(prev => [...prev, {
                      role: 'user', content: task,
                      timestamp: Date.now(), id: `fu${Date.now()}`,
                    }]);
                    processUserTextRef.current?.(task, null, false);
                  }, 1800);
                }
                break;
              case 'suggestions':
                newSuggestions = parsed.suggestions ?? [];
                break;
              case 'widget':
                widget = parsed.widget ?? null;
                break;
              case 'figma_design':
                // The AI fetched a Figma design, show the live frame embed
                // plus the real extracted fonts & colors on the assistant message.
                {
                  const fd = {
                    fileKey: parsed.fileKey ?? '',
                    name: parsed.name ?? 'design',
                    frameName: parsed.frameName ?? 'Design',
                    width: parsed.width ?? 0,
                    height: parsed.height ?? 0,
                    fonts: parsed.fonts ?? [],
                    colors: parsed.colors ?? [],
                  };
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      updated[updated.length - 1] = { ...last, figma: fd };
                    }
                    return updated;
                  });
                }
                break;
              case 'file_edit':
                // The AI wrote a file, show it as an expandable diff card
                // on the current assistant message.
                {
                  const fe: FileEdit = { path: parsed.path, bytesWritten: parsed.bytesWritten ?? 0, oldContent: parsed.oldContent ?? '', newContent: parsed.newContent ?? '' };
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      updated[updated.length - 1] = {
                        ...last,
                        fileEdits: [...(last.fileEdits ?? []), fe],
                      };
                    }
                    return updated;
                  });
                }
                break;
              case 'terminal_result':
                // The AI ran a shell command, show it as a clean minimal card
                // on the current assistant message and log it for Infinity Build.
                {
                  const tr: TerminalResult = { command: parsed.command, exitCode: parsed.exitCode ?? 0, output: parsed.output ?? '' };
                  setSessionCommands(prev => [...prev, tr]);
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      updated[updated.length - 1] = {
                        ...last,
                        terminalResults: [...(last.terminalResults ?? []), tr],
                      };
                    }
                    return updated;
                  });
                }
                break;
              case 'agent_browser_detected':
                // Auto-open PiP browser and kick off the autonomous agent loop
                setPipBrowserOpen(true);
                setPipFullscreen(null);
                setMessages(prev => prev.slice(0, -1)); // remove empty assistant msg
                // Start the vision-driven agent loop (it navigates + clicks itself)
                setAgentGoal(parsed.searchQuery ? `search for ${parsed.searchQuery}` : 'search the web');
                break;
              case 'screen_share_detected':
                // Show screen share confirmation card
                setMessages(prev => {
                  const withoutEmpty = prev.slice(0, -1);
                  return [...withoutEmpty, {
                    role: 'assistant' as const,
                    content: '',
                    timestamp: Date.now(),
                    id: nextMsgId(),
                    pendingScreenShare: true,
                  }];
                });
                // If in voice mode, switch to chat so card is visible
                if (mode === 'voice') setMode('chat');
                break;
              case 'build_mode_detected':
                if (mode === 'voice') setMode('chat');
                setMessages(prev => {
                  const withoutEmpty = prev.slice(0, -1);
                  return [...withoutEmpty, {
                    role: 'assistant' as const,
                    content: '',
                    timestamp: Date.now(),
                    id: nextMsgId(),
                    pendingBuildMode: { userText: parsed.confirmationMessage ?? '' },
                  }];
                });
                break;
              case 'local_model_available':
                // Notify user that local AI model is available for error fixing
                console.log('[useChatStream] Local model available:', parsed.model);
                break;
              case 'image_request_detected':
                // If in voice mode, switch to chat mode so the confirmation card is visible
                if (mode === 'voice') setMode('chat');
                // Show image generation confirmation card, embed it in the message list
                setMessages(prev => {
                  const withoutEmpty = prev.slice(0, -1); // remove the empty assistant message
                  return [...withoutEmpty, {
                    role: 'assistant' as const,
                    content: '',
                    timestamp: Date.now(),
                    id: nextMsgId(),
                    pendingImage: {
                      imagePrompt: parsed.imagePrompt,
                      confirmationMessage: parsed.confirmationMessage,
                    },
                  }];
                });
                break;
              case 'agent_loop_event':
                // Agent loop event for UI timeline (thinking, tool calls, results)
                if (parsed.event) {
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                      const lastMsg = updated[lastIdx];
                      const agentEvents = [...(lastMsg.agentEvents ?? []), parsed.event];
                      updated[lastIdx] = { ...lastMsg, agentEvents };
                      return updated;
                    }
                    return updated;
                  });
                }
                break;
              case 'follow_up':
                // Standalone follow-up event, auto-submit the next task
                if (parsed.task && typeof parsed.task === 'string') {
                  const task = parsed.task.trim().slice(0, 200);
                  setTimeout(() => {
                    setMessages(prev => [...prev, {
                      role: 'user', content: task,
                      timestamp: Date.now(), id: `fu${Date.now()}`,
                    }]);
                    processUserTextRef.current?.(task, null, false);
                  }, 1500);
                }
                break;
              case 'error':
                // Manual key failure (chat/voice), offer the two retry buttons.
                if (parsed.code === 'llm_manual_retry' && parsed.key?.id) {
                  setKeyRetry({
                    message: parsed.message ?? 'LLM key failed',
                    keyId: parsed.key.id,
                    keyName: parsed.key.name ?? parsed.key.id,
                    nextKeyId: parsed.nextKey?.id ?? null,
                    nextKeyName: parsed.nextKey?.name ?? null,
                  });
                  setStatus('idle');
                  return;
                }
                handleError(parsed.message ?? 'Stream error', parsed.detail as ErrorDetail | undefined, undefined, parsed.code as string | undefined);
                return;
            }
          } catch { /* skip malformed lines */ }
        }
      }

      if (!activeConvIdRef.current && convId) setActiveConversationId(convId);
      refreshSidebar();

      // Apply widget and suggestions after stream completes
      if (widget) {
        // Server-backed timers: sync every timer widget to the API server so it
        // survives reloads and fires via web-push even with the tab closed.
        if (widget.type === 'timer') {
          if (widget.timerAction === 'cancel') {
            if (serverIdRef.current) void cancelTimer(serverIdRef.current);
          } else if (widget.timerAction === 'add' && widget.deltaSeconds) {
            if (serverIdRef.current) void extendTimer(serverIdRef.current, widget.deltaSeconds);
          } else {
            void createTimer({
              durationSeconds: widget.durationSeconds,
              label: widget.label,
              conversationId: activeConvIdRef.current ?? undefined,
            });
          }
        }
        if (widget.type === 'timer' && isChatMode) {
          setMessages(prev => {
            const existingIdx = chatTimerMsgIdxRef.current;
            if (widget.timerAction === 'cancel') {
              chatTimerMsgIdxRef.current = null;
              timerStartedAtRef.current = null;
              timerOriginalDurationRef.current = null;
              if (existingIdx !== null && existingIdx < prev.length) {
                const copy = [...prev];
                copy[existingIdx] = { ...copy[existingIdx], widget: undefined };
                return copy;
              }
              return prev;
            } else if (existingIdx !== null && existingIdx < prev.length) {
              let newDuration = widget.durationSeconds;
              if (widget.timerAction === 'add' && widget.deltaSeconds) {
                const elapsed = timerStartedAtRef.current
                  ? Math.floor((Date.now() - timerStartedAtRef.current) / 1000) : 0;
                const currentRemaining = Math.max(0, (timerOriginalDurationRef.current ?? 0) - elapsed);
                newDuration = currentRemaining + widget.deltaSeconds;
              }
              timerStartedAtRef.current = Date.now();
              timerOriginalDurationRef.current = newDuration;
              const copy = [...prev];
              copy[existingIdx] = { ...copy[existingIdx], widget: { ...widget, durationSeconds: newDuration, timerAction: 'set' } };
              return copy;
            } else {
              chatTimerMsgIdxRef.current = prev.length - 1;
              timerStartedAtRef.current = Date.now();
              timerOriginalDurationRef.current = widget.durationSeconds;
              const copy = [...prev];
              copy[copy.length - 1] = { ...copy[copy.length - 1], widget };
              return copy;
            }
          });
        } else if (widget.type !== 'timer') {
          setMessages(prev => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...copy[copy.length - 1], widget: widget! };
            return copy;
          });
          setActiveWidget(widget);
        } else {
          // Non-chat timer: attach to the message for the live session, but the
          // durable strip above the orb renders it (server-backed).
          setMessages(prev => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...copy[copy.length - 1], widget: widget! };
            return copy;
          });
        }
      }
      setSuggestions(newSuggestions);

      // In chat mode, only speak if the request came from the mic (speak=true).
      if (speak) {
        playTTS(jarvisText, () => { vibrate([20, 30, 20]); setStatus('speaking'); }, () => {
          if (isChatModeRef.current) {
            setStatus('idle');
            setTimeout(() => inputRef.current?.focus(), 50);
          } else {
            // Conversational voice loop, immediately keep listening so the
            // user can just keep talking without tapping the orb again.
            setStatus('recording');
            activateCommand(true);
          }
        });
      } else {
        setStatus('idle');
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } catch (err) {
      const msg = err instanceof TypeError ? 'Network error, is the server running?' : 'Request failed';
      handleError(msg, undefined, () => processUserTextRef.current?.(userText, file, speak));
    }
  }, [handleError, refreshSidebar, playTTS, isChatMode, webSearchEnabled, thinkingEnabled, activateCommand, vibrate, createTimer, extendTimer, cancelTimer, serverIdRef, mode, screenShareActive, screenFrame]);

  const processUserTextRef = useRef<typeof processUserText | null>(null);
  useEffect(() => { processUserTextRef.current = processUserText; }, [processUserText]);

  // Re-send the last failed message against a specific key (manual mode).
  const retryWithKey = useCallback((keyId: string | null, attempt: 1 | 2) => {
    const a = lastSendArgsRef.current;
    if (!a || !keyId) return;
    setKeyRetry(null);
    setRetryAttempt(attempt);
    void processUserTextRef.current?.(a.userText, a.file, a.speak, a.codeAllowance, a.researchMode, a.buildAllowance, keyId);
  }, []);

  const retrySameKey = useCallback(() => {
    if (!keyRetry?.keyId) return;
    retryWithKey(keyRetry.keyId, 1); // First retry - same key
  }, [keyRetry, retryWithKey]);

  const retryNextKey = useCallback(() => {
    if (!keyRetry?.nextKeyId) return;
    retryWithKey(keyRetry.nextKeyId, 2); // Second retry - next key
  }, [keyRetry, retryWithKey]);

  const dismissKeyRetry = useCallback(() => {
    setKeyRetry(null);
    setRetryAttempt(0);
  }, []);

  return {
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
  };
}
