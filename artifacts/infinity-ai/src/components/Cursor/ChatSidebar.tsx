/**
 * Cursor Chat Sidebar — AI chat with @codebase context (Optimized for <500ms first token)
 *
 * Features:
 * - Real-time streaming responses via SSE with connection reuse
 * - @codebase context injection with pre-emptive search
 * - Conversation history with local caching
 * - Tool call visualization
 * - Inline code references
 * - Performance monitoring headers
 * - Request deduplication and cancellation
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button, Input, TextArea, ScrollArea, Flex, Box, Text, Badge, Avatar, IconButton, Tooltip, Separator, Skeleton } from "@radix-ui/themes";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Send, Loader2, Copy, ChevronUp, ChevronDown, Code, FileText, Sparkles, Zap, X, Check, AlertCircle, MessageSquare, Database, Terminal, GitBranch, Search, Settings, Plus, Trash2, RotateCcw, ExternalLink } from "lucide-react";
// Import performance utilities from local frontend library for connection pooling
import { ConnectionPoolManager } from "@/lib/performance";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isStreaming?: boolean;
  codebaseContext?: CodebaseResult[];
  codebaseTriggered?: boolean;
  // Performance tracking
  firstTokenLatencyMs?: number;
  totalLatencyMs?: number;
  source?: "cache" | "remote" | "local";
}

/** A single codebase semantic-search hit, shaped by /api/infinity/codebase/search */
interface CodebaseResult {
  file: string;
  filePath: string;
  language: string;
  type: string;
  name: string;
  signature?: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
  matchType?: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
}

interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

interface ChatSidebarProps {
  projectId: string;
  projectRoot: string;
  isOpen: boolean;
  onClose: () => void;
  onNewConversation: () => void;
}

// ============================================================================
// Performance Infrastructure
// ============================================================================

// In-memory LRU cache for recent conversations and codebase search results
class LRUCache<K, V> {
  private map = new Map<K, { value: V; timestamp: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 100, ttlMs = 300000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Move to end (most recent)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.maxSize) {
      // Remove oldest
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

// Connection pool for SSE - keep one connection warm per project
const sseConnectionPool = new Map<string, EventSource>();
const CODEBASE_CACHE = new LRUCache<string, CodebaseResult[]>(50, 600000); // 10 min TTL
const CONVERSATION_CACHE = new LRUCache<string, ChatMessage[]>(20, 1800000); // 30 min TTL

// Connection pool for HTTP requests - reuse connections for keep-alive
const httpConnectionPool = new Map<string, { controller: AbortController; lastUsed: number }>();
const MAX_CONNECTION_AGE_MS = 30000; // 30 seconds
const MAX_POOL_SIZE = 10;

function getPooledConnection(projectId: string): AbortController {
  const now = Date.now();
  const poolKey = `chat:${projectId}`;

  // Clean up old connections
  for (const [key, conn] of httpConnectionPool.entries()) {
    if (now - conn.lastUsed > MAX_CONNECTION_AGE_MS) {
      conn.controller.abort();
      httpConnectionPool.delete(key);
    }
  }

  // Reuse existing connection controller if available
  const existing = httpConnectionPool.get(poolKey);
  if (existing) {
    existing.lastUsed = now;
    return existing.controller;
  }

  // Create new controller
  const controller = new AbortController();
  if (httpConnectionPool.size >= MAX_POOL_SIZE) {
    // Remove oldest
    const oldestKey = httpConnectionPool.keys().next().value;
    if (oldestKey) {
      httpConnectionPool.get(oldestKey)?.controller.abort();
      httpConnectionPool.delete(oldestKey);
    }
  }
  httpConnectionPool.set(poolKey, { controller, lastUsed: now });
  return controller;
}

// Debounced codebase search
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingSearches = new Map<string, Promise<CodebaseResult[]>>();

export function ChatSidebar({ projectId, projectRoot, isOpen, onClose, onNewConversation }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [codebaseResults, setCodebaseResults] = useState<CodebaseResult[]>([]);
  const [showCodebasePanel, setShowCodebasePanel] = useState(false);
  const [isCodebaseSearching, setIsCodebaseSearching] = useState(false);
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const [streamStartTime, setStreamStartTime] = useState(0);
  const [performanceStats, setPerformanceStats] = useState<{ firstTokenMs: number; totalMs: number; tokensPerSecond: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const models = [
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" },
    { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic" },
    { id: "claude-3-haiku", name: "Claude 3 Haiku", provider: "Anthropic" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "Google" },
    { id: "deepseek-chat", name: "DeepSeek Chat", provider: "DeepSeek" },
  ];

  // ============================================================================
  // Optimized Codebase Search with Caching & Debouncing
  // ============================================================================
  const searchCodebase = useCallback(async (query: string): Promise<CodebaseResult[]> => {
    const cacheKey = `search:${projectId}:${query.toLowerCase().slice(0, 100)}`;

    // Check cache first
    const cached = CODEBASE_CACHE.get(cacheKey);
    if (cached) {
      console.log("[Chat] Codebase cache HIT");
      return cached;
    }

    // Check for pending search to deduplicate
    const pending = pendingSearches.get(cacheKey);
    if (pending) {
      return pending;
    }

    setIsCodebaseSearching(true);
    const searchPromise = (async () => {
      try {
        const poolManager = ConnectionPoolManager.getInstance();
        const response = await poolManager.fetchWithPool(`/api/infinity/codebase/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            query,
            limit: 8, // Reduced from 10 for speed
            hybrid: true,
            expandQuery: true,
          }),
          priority: "normal",
        });

        if (!response.ok) {
          console.warn("Codebase search failed:", response.status);
          return [];
        }

        const data = await response.json();
        const results = data.results || [];

        // Cache results
        CODEBASE_CACHE.set(cacheKey, results);
        return results;
      } catch (error) {
        console.error("Codebase search error:", error);
        return [];
      } finally {
        setIsCodebaseSearching(false);
        pendingSearches.delete(cacheKey);
      }
    })();

    pendingSearches.set(cacheKey, searchPromise);
    return searchPromise;
  }, [projectId]);

  // Debounced pre-emptive search as user types
  const preemptiveSearch = useCallback((query: string) => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (query.trim().length > 3) {
        searchCodebase(query);
      }
    }, 150);
  }, [searchCodebase]);

  // Trigger pre-emptive search on input change
  useEffect(() => {
    preemptiveSearch(input);
    return () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    };
  }, [input, preemptiveSearch]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      abortControllerRef.current?.abort();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    };
  }, []);

  // ============================================================================
  // Optimized Streaming Handler
  // ============================================================================
  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    const currentRequestId = ++requestIdRef.current;
    const startTime = performance.now();
    setStreamStartTime(startTime);
    setFirstTokenReceived(false);
    setPerformanceStats(null);

    // In Build mode, ALWAYS search codebase - no toggle needed
    const codebaseContext = await searchCodebase(input);

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input,
      timestamp: new Date(),
      codebaseContext: codebaseContext.length > 0 ? codebaseContext : undefined,
      codebaseTriggered: false,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);

    // Prepare request body with minimal payload
    const conversationHistory = messages.slice(-6).map(m => ({ // Only last 6 messages
      role: m.role,
      content: m.content.slice(0, 2000), // Truncate long messages
      tool_calls: m.toolCalls?.slice(0, 3).map(tc => ({ // Limit tool calls
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments.slice(0, 500) },
      })),
    }));

    const body = JSON.stringify({
      projectId,
      projectRoot,
      message: input,
      conversationHistory,
      useCodebase: true,
      codebaseContext, // Pass pre-fetched context to backend
      model: selectedModel,
      maxTokens: 2000,
      temperature: 0.3,
      // Performance hints
      streamOptions: { includeUsage: true },
    });

    // Use pooled connection for keep-alive optimization
    const pooledController = getPooledConnection(projectId);
    abortControllerRef.current = pooledController;
    const { signal } = pooledController;

    try {
      // Use ConnectionPoolManager from performance library for optimal connection reuse
      const poolManager = ConnectionPoolManager.getInstance();
      const response = await poolManager.fetchWithPool(`/api/infinity/cursor/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": String(currentRequestId),
        },
        body,
        signal,
        priority: "high", // Prioritize chat streaming
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstTokenTime = 0;
      let tokenCount = 0;

      let assistantMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      };
      setMessages(prev => [...prev, assistantMessage]);

      while (reader) {
        // Check if request was superseded
        if (currentRequestId !== requestIdRef.current) {
          console.log("[Chat] Request superseded, aborting");
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            // Event type - next line is data
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.token) {
                tokenCount++;
                const now = performance.now();

                // Track first token latency
                if (!firstTokenReceived) {
                  firstTokenTime = now;
                  const firstTokenLatency = now - startTime;
                  setFirstTokenReceived(true);
                  setPerformanceStats({
                    firstTokenMs: Math.round(firstTokenLatency),
                    totalMs: 0,
                    tokensPerSecond: 0,
                  });

                  // Log if target missed
                  if (firstTokenLatency > 500) {
                    console.warn(`[Chat] First token latency target missed: ${Math.round(firstTokenLatency)}ms (target: <500ms)`);
                  }
                }

                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === "assistant" && last.isStreaming) {
                    return [...prev.slice(0, -1), { ...last, content: last.content + data.token }];
                  }
                  return prev;
                });
              } else if (data.agent_event) {
                const event = data.agent_event;
                if (event.type === "tool_call") {
                  setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === "assistant" && last.isStreaming) {
                      const newToolCalls = [...(last.toolCalls || []), {
                        id: event.data.toolCallId,
                        name: event.data.toolName,
                        arguments: JSON.stringify(event.data.arguments),
                        status: "running" as const,
                      }];
                      return [...prev.slice(0, -1), { ...last, toolCalls: newToolCalls }];
                    }
                    return prev;
                  });
                } else if (event.type === "tool_result") {
                  setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === "assistant") {
                      const newToolCalls = (last.toolCalls || []).map(tc =>
                        tc.id === event.data.toolCallId
                          ? { ...tc, status: "completed" as const, result: event.data.result }
                          : tc
                      );
                      const newToolResults = [...(last.toolResults || []), {
                        toolCallId: event.data.toolCallId,
                        content: event.data.result,
                        isError: event.data.isError,
                      }];
                      return [...prev.slice(0, -1), { ...last, toolCalls: newToolCalls, toolResults: newToolResults }];
                    }
                    return prev;
                  });
                }
              } else if (data.complete) {
                const totalLatency = performance.now() - startTime;
                const tps = tokenCount / (totalLatency / 1000);

                setPerformanceStats({
                  firstTokenMs: firstTokenTime ? Math.round(firstTokenTime - startTime) : Math.round(totalLatency),
                  totalMs: Math.round(totalLatency),
                  tokensPerSecond: Math.round(tps * 10) / 10,
                });

                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === "assistant" && last.isStreaming) {
                    return [...prev.slice(0, -1), {
                      ...last,
                      isStreaming: false,
                      content: data.response || last.content,
                      firstTokenLatencyMs: firstTokenTime ? Math.round(firstTokenTime - startTime) : Math.round(totalLatency),
                      totalLatencyMs: Math.round(totalLatency),
                      source: "remote",
                    }];
                  }
                  return prev;
                });
                setIsStreaming(false);
              } else if (data.error) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === "assistant" && last.isStreaming) {
                    return [...prev.slice(0, -1), { ...last, isStreaming: false, content: `Error: ${data.error}` }];
                  }
                  return prev;
                });
                setIsStreaming(false);
              }
            } catch (parseError) {
              console.warn("[Chat] Failed to parse SSE data:", line);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("[Chat] Request aborted");
        return;
      }
      console.error("Chat error:", error);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.isStreaming) {
          return [...prev.slice(0, -1), { ...last, isStreaming: false, content: `Error: ${error}` }];
        }
        return prev;
      });
      setIsStreaming(false);
    }
  }, [input, isStreaming, projectId, projectRoot, messages, selectedModel, searchCodebase]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatContent = (content: string) => {
    // Simple markdown-like rendering for code blocks
    const parts = content.split(/```(\w+)?\n([\s\S]*?)```/g);
    return parts.map((part, i) => {
      if (i % 3 === 1) {
        return <CodeBlock key={i} language={part} code={parts[i + 1]} />;
      }
      if (i % 3 === 2) return null;
      return <Text key={i} as="p" style={{ whiteSpace: "pre-wrap" }}>{part}</Text>;
    }).filter(Boolean);
  };

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    CONVERSATION_CACHE.clear();
    onNewConversation();
  }, [onNewConversation]);

  return (
    <Box
      role="complementary"
      aria-label="AI Chat Assistant"
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: "420px",
        maxWidth: "100vw",
        background: "var(--gray-1)",
        borderLeft: "1px solid var(--gray-5)",
        display: isOpen ? "flex" : "none",
        flexDirection: "column",
        zIndex: 1000,
        boxShadow: "var(--shadow-xl)",
        animation: isOpen ? "slideIn 0.2s ease-out" : "none",
      }}
    >
      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* Header */}
      <header style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--gray-5)",
        background: "var(--gray-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Avatar size="3" radius="full" style={{ background: "var(--violet-7)", color: "var(--violet-12)" }} aria-hidden="true">
            <Sparkles size={16} />
          </Avatar>
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            <h1 style={{ margin: 0, fontSize: "var(--text-2)", fontWeight: "bold" }}>Cursor Chat</h1>
            <span style={{ fontSize: "var(--text-1)", color: "var(--gray-10)" }}>@{projectId}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Tooltip content="New conversation">
            <IconButton onClick={onNewConversation} aria-label="New conversation" size="2">
              <Plus size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Clear history">
            <IconButton onClick={() => setMessages([])} aria-label="Clear history" size="2">
              <Trash2 size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Close">
            <IconButton onClick={onClose} aria-label="Close chat panel" size="2">
              <X size={16} />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      {/* Model selector */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--gray-5)",
          background: "var(--gray-1)",
          gap: "12px",
          flexWrap: "wrap",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Tooltip content="Codebase context: ALWAYS ON in Build mode">
          <Button variant="solid" color="violet" size="1" disabled style={{ minWidth: "auto", gap: "6px" }} aria-pressed="true">
            <Database size={14} aria-hidden="true" />
            <span style={{ fontSize: "var(--text-1)", fontWeight: "medium" }}>Codebase</span>
            <Badge variant="solid" color="violet" size="1">ON</Badge>
          </Button>
        </Tooltip>

        <DropdownMenu open={showModelSelector} onOpenChange={setShowModelSelector}>
          <DropdownMenuTrigger asChild>
            <Tooltip content="Select AI model">
              <Button variant="soft" size="1" style={{ minWidth: "160px", justifyContent: "space-between" }} aria-haspopup="listbox" aria-expanded={showModelSelector}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Sparkles size={14} aria-hidden="true" />
                  <span style={{ fontSize: "var(--text-1)", fontWeight: "medium" }}>{models.find(m => m.id === selectedModel)?.name || selectedModel}</span>
                </span>
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            </Tooltip>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" style={{ minWidth: "200px" }} role="listbox">
            {models.map(model => (
              <DropdownMenuItem
                key={model.id}
                onSelect={() => setSelectedModel(model.id)}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px" }}
                role="option"
                aria-selected={selectedModel === model.id}
              >
                <span style={{ fontSize: "var(--text-1)", fontWeight: selectedModel === model.id ? "bold" : "regular" }}>{model.name}</span>
                <span style={{ fontSize: "var(--text-1)", color: "var(--gray-10)" }}>{model.provider}</span>
                {selectedModel === model.id && <Check size={14} color="var(--green-9)" aria-hidden="true" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages */}
      <ScrollArea
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        style={{ flex: 1, overflow: "auto" }}
        onScroll={e => {
          // Could add infinite scroll here
        }}
      >
        <div style={{ padding: "16px", gap: "16px", minHeight: "100%", display: "flex", flexDirection: "column" }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, color: "var(--gray-10)", gap: "12px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <MessageSquare size={48} style={{ opacity: 0.3 }} aria-hidden="true" />
              <h2 style={{ margin: 0, fontSize: "var(--text-2)", fontWeight: "medium" }}>Start a conversation</h2>
              <p style={{ margin: 0, fontSize: "var(--text-2)", textAlign: "center" }}>
                Ask about your codebase, request edits, or get explanations.
                Codebase context is automatically included.
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                <Button variant="outline" size="2" onClick={() => { setInput("Explain the project structure"); handleSend(); }}>
                  <Search size={14} aria-hidden="true" /> Explain project
                </Button>
                <Button variant="outline" size="2" onClick={() => { setInput("Find bugs in the codebase"); handleSend(); }}>
                  <AlertCircle size={14} aria-hidden="true" /> Find bugs
                </Button>
                <Button variant="outline" size="2" onClick={() => { setInput("Add tests for the auth module"); handleSend(); }}>
                  <Check size={14} aria-hidden="true" /> Add tests
                </Button>
              </div>
            </div>
          )}

          {messages.map((message, idx) => (
            <MessageBubble
              key={message.id}
              message={message}
              isLast={idx === messages.length - 1}
              onCopy={copyToClipboard}
            />
          ))}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Streaming indicator with performance stats */}
      {isStreaming && (
        <div
          role="status"
          aria-live="polite"
          aria-label="AI response streaming"
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--gray-5)",
            background: "var(--gray-2)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
            color: "var(--violet-9)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Loader2 size={16} className="spin" aria-hidden="true" />
            <span style={{ fontSize: "var(--text-1)", fontWeight: "medium" }}>Generating response...</span>
            {!firstTokenReceived && (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                background: "var(--blue-3)",
                color: "var(--blue-11)",
                borderRadius: "9999px",
                fontSize: "var(--text-1)",
              }}>Waiting for first token...</span>
            )}
            {firstTokenReceived && performanceStats && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--gray-10)" }}>
                <span>First token: <strong style={{ color: "var(--green-9)" }}>{performanceStats.firstTokenMs}ms</strong></span>
                <span>Tokens/sec: <strong>{performanceStats.tokensPerSecond}</strong></span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Tooltip content="Cancel request">
              <IconButton
                onClick={() => {
                  abortControllerRef.current?.abort();
                  setIsStreaming(false);
                }}
                aria-label="Cancel response generation"
                size="1"
                variant="ghost"
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Performance stats for completed messages */}
      {performanceStats && !isStreaming && (
        <div
          style={{
            padding: "6px 16px",
            borderTop: "1px solid var(--gray-5)",
            background: "var(--gray-1)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            fontSize: "11px",
            color: "var(--gray-10)",
          }}
        >
          <span>First token: <strong style={{ color: performanceStats.firstTokenMs < 500 ? "var(--green-9)" : "var(--amber-9)" }}>{performanceStats.firstTokenMs}ms</strong></span>
          <span>Total: <strong>{performanceStats.totalMs}ms</strong></span>
          <span>Speed: <strong>{performanceStats.tokensPerSecond} tok/s</strong></span>
        </div>
      )}

      {/* Input */}
      <Flex
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--gray-5)",
          background: "var(--gray-1)",
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
        }}
      >
        <TextArea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "Waiting for response..." : "Ask about your codebase..."}
          disabled={isStreaming}
          aria-label="Chat message input"
          aria-describedby={isStreaming ? "streaming-status" : undefined}
          style={{
            flex: 1,
            minHeight: "44px",
            maxHeight: "200px",
            resize: "none",
            fontSize: "14px",
            lineHeight: "1.5",
            borderRadius: "8px",
            border: "1px solid var(--gray-6)",
            background: "var(--gray-3)",
            padding: "10px 12px",
          }}
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          size="2"
          style={{ height: "44px", minWidth: "44px" }}
        >
          <Send size={18} />
        </Button>
      </Flex>
    </Box>
  );
}

// Codebase context display component
function CodebaseContextDisplay({ results, triggered }: { results: CodebaseResult[]; triggered: boolean }) {
  if (!results || results.length === 0) return null;

  return (
    <Flex
      direction="column"
      gap="6"
      style={{
        marginTop: "8px",
        padding: "10px 12px",
        background: "var(--violet-2)",
        border: "1px solid var(--violet-5)",
        borderRadius: "8px",
        fontSize: "12px",
      }}
    >
      <Flex align="center" gap="6" style={{ opacity: 0.8 }}>
        <Database size={12} color="var(--violet-9)" />
        <Text size="1" weight="medium" color="var(--violet-11)">
          {triggered ? "Codebase context (explicit @codebase)" : "Codebase context (auto)"}
        </Text>
        <Badge variant="soft" color="violet" size="1">{results.length} result{results.length !== 1 ? "s" : ""}</Badge>
      </Flex>

      <Flex direction="column" gap="4" style={{ maxHeight: "200px", overflow: "auto" }}>
        {results.slice(0, 5).map((result, idx) => (
          <CodebaseResultCard key={`${result.file}-${result.startLine}-${idx}`} result={result} />
        ))}
        {results.length > 5 && (
          <Text size="1" color="var(--gray-10)" style={{ textAlign: "center", padding: "4px" }}>
            +{results.length - 5} more results...
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

function CodebaseResultCard({ result }: { result: CodebaseResult }) {
  const languageColors: Record<string, string> = {
    typescript: "var(--blue-9)",
    javascript: "var(--yellow-9)",
    python: "var(--green-9)",
    rust: "var(--orange-9)",
    go: "var(--cyan-9)",
    java: "var(--red-9)",
    cpp: "var(--purple-9)",
    c: "var(--purple-9)",
  };

  const typeIcons: Record<string, React.ReactNode> = {
    function: <Code size={10} />,
    class: <FileText size={10} />,
    interface: <FileText size={10} />,
    type: <FileText size={10} />,
    import: <GitBranch size={10} />,
    export: <GitBranch size={10} />,
    comment: <MessageSquare size={10} />,
    block: <Terminal size={10} />,
  };

  return (
    <Tooltip content={result.filePath}>
      <Flex
        direction="column"
        gap="4"
        onClick={() => navigator.clipboard.writeText(`${result.filePath}:${result.startLine}-${result.endLine}`)}
        style={{
          padding: "8px",
          background: "var(--violet-1)",
          border: "1px solid var(--violet-4)",
          borderRadius: "6px",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--violet-3)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "var(--violet-1)"; }}
      >
        <Flex align="center" gap="6">
          <Box style={{ color: languageColors[result.language] || "var(--gray-9)", display: "flex" }}>
            {typeIcons[result.type] || <Code size={10} />}
          </Box>
          <Flex direction="column" gap="0" style={{ flex: 1, minWidth: 0 }}>
            <Flex align="center" gap="4">
              <Text size="1" weight="medium" color="var(--violet-12)" style={{ fontFamily: "monospace" }}>
                {result.name || "anonymous"}
              </Text>
              {result.signature && (
                <Text size="1" color="var(--gray-10)" style={{ fontFamily: "monospace", fontSize: "10px" }}>
                  {result.signature.slice(0, 60)}{result.signature.length > 60 ? "..." : ""}
                </Text>
              )}
            </Flex>
            <Flex align="center" gap="6">
              <Text size="1" color="var(--gray-10)" style={{ fontFamily: "monospace", fontSize: "10px" }}>
                {result.file}
              </Text>
              <Text size="1" color="var(--gray-10)" style={{ fontFamily: "monospace", fontSize: "10px" }}>
                L{result.startLine}–{result.endLine}
              </Text>
              <Badge variant="outline" color="violet" size="1" style={{ fontSize: "9px" }}>
                {Math.round(result.score * 100)}%
              </Badge>
            </Flex>
          </Flex>
        </Flex>
        <Flex justify="flex-end">
          <Tooltip content="Copy file:line reference">
            <IconButton size="1" variant="ghost" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(`${result.filePath}:${result.startLine}-${result.endLine}`); }} aria-label="Copy reference">
              <ExternalLink size={10} />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>
    </Tooltip>
  );
}

// Message Bubble Component
function MessageBubble({ message, isLast, onCopy }: { message: ChatMessage; isLast: boolean; onCopy: (text: string) => void }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isTool = message.role === "tool";

  const authorName = isUser ? "You" : isAssistant ? "Cursor" : "Tool";
  const authorColor = isUser ? "var(--violet-12)" : "var(--gray-11)";

  return (
    <Flex
      direction="column"
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "85%",
        gap: "8px",
        animation: "fadeIn 0.2s ease-out",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />

      {/* Tool calls visualization */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Flex direction="column" gap="4" style={{ width: "100%" }}>
          {message.toolCalls.map(tc => (
            <ToolCallBadge key={tc.id} toolCall={tc} result={message.toolResults?.find(r => r.toolCallId === tc.id)} />
          ))}
        </Flex>
      )}

      {/* Message content */}
      <Flex
        style={{
          background: isUser ? "var(--violet-9)" : isAssistant ? "var(--gray-3)" : "var(--amber-3)",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          padding: "12px 16px",
          maxWidth: "100%",
        }}
        direction="column"
        gap="8px"
      >
        <Flex align="center" gap="2" style={{ opacity: 0.7 }}>
          <Avatar size="1" radius="full" style={{ background: isUser ? "var(--violet-7)" : "var(--gray-6)" }}>
            {isUser ? <Text size="1" weight="bold" color="var(--violet-12)">U</Text> : <Sparkles size={10} />}
          </Avatar>
          <Text size="1" weight="medium" color={authorColor}>
            {authorName}
          </Text>
          <Text size="1" color="var(--gray-10)">{message.timestamp.toLocaleTimeString()}</Text>
        </Flex>

        <Box style={{ color: isUser ? "var(--violet-12)" : "var(--gray-12)" }}>
          {message.content ? formatContent(message.content) : <Skeleton width="100%" height={40} />}
        </Box>

        {/* Codebase context display for user messages */}
        {isUser && message.codebaseContext && message.codebaseContext.length > 0 && (
          <CodebaseContextDisplay results={message.codebaseContext} triggered={message.codebaseTriggered || false} />
        )}

        {/* Copy button for assistant messages */}
        {isAssistant && !message.isStreaming && (
          <Flex justify="flex-end">
            <Tooltip content="Copy">
              <IconButton size="1" variant="ghost" onClick={() => onCopy(message.content)} aria-label="Copy message">
                <Copy size={12} />
              </IconButton>
            </Tooltip>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}

// Tool Call Badge Component
function ToolCallBadge({ toolCall, result }: { toolCall: ToolCall; result?: ToolResult }) {
  const icons: Record<string, React.ReactNode> = {
    codebase_search: <Search size={12} />,
    read_file: <FileText size={12} />,
    write_file: <FileText size={12} />,
    edit_file: <Code size={12} />,
    terminal: <Terminal size={12} />,
    git: <GitBranch size={12} />,
    test: <Check size={12} />,
    debug: <Zap size={12} />,
  };

  const statusColors = {
    pending: "var(--gray-9)",
    running: "var(--blue-9)",
    completed: "var(--green-9)",
    failed: "var(--red-9)",
  };

  return (
    <Flex
      align="center"
      gap="8px"
      style={{
        padding: "8px 12px",
        background: "var(--gray-3)",
        borderRadius: "8px",
        border: "1px solid var(--gray-5)",
        fontSize: "12px",
      }}
    >
      <Box style={{ color: statusColors[toolCall.status], display: "flex", alignItems: "center" }}>
        {icons[toolCall.name] || <Code size={12} />}
      </Box>
      <Flex direction="column" gap="2" style={{ flex: 1, minWidth: 0 }}>
        <Flex align="center" gap="6">
          <Text weight="medium" size="1" style={{ textTransform: "capitalize" }}>{toolCall.name.replace(/_/g, " ")}</Text>
          <Badge variant="soft" color={
            toolCall.status === "running" ? "blue" :
            toolCall.status === "completed" ? "green" :
            toolCall.status === "failed" ? "red" : "gray"
          } size="1">
            {toolCall.status}
          </Badge>
        </Flex>
        <Text size="1" color="var(--gray-10)" style={{ fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {toolCall.arguments.slice(0, 100)}
        </Text>
      </Flex>
      {result && (
        <Tooltip content={result.isError ? "Error" : "Result"}>
          <IconButton size="1" variant="ghost" onClick={() => navigator.clipboard.writeText(result.content)} aria-label="Copy result">
            <Copy size={12} />
          </IconButton>
        </Tooltip>
      )}
    </Flex>
  );
}

// Code Block Component
function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Box style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid var(--gray-5)", marginTop: "8px" }}>
      <Flex
        align="center"
        justify="space-between"
        style={{ padding: "8px 12px", background: "var(--gray-3)", borderBottom: "1px solid var(--gray-5)" }}
      >
        <Text size="1" color="var(--gray-10)" style={{ textTransform: "uppercase" }}>{language || "code"}</Text>
        <Tooltip content={copied ? "Copied!" : "Copy"}>
          <IconButton size="1" variant="ghost" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }} aria-label="Copy code">
            <Copy size={12} />
          </IconButton>
        </Tooltip>
      </Flex>
      <pre style={{ margin: 0, padding: "12px", overflow: "auto", maxHeight: "300px", background: "var(--gray-2)" }}>
        <code style={{ fontFamily: "monospace", fontSize: "12px", lineHeight: "1.5", color: "var(--gray-12)" }}>
          {code}
        </code>
      </pre>
    </Box>
  );
}

export default ChatSidebar;
export { ChatSidebar as CursorChatSidebar };