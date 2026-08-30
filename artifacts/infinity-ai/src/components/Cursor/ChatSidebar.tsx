/**
 * Cursor Chat Sidebar — AI chat with @codebase context
 *
 * Features:
 * - Real-time streaming responses via SSE
 * - @codebase context injection
 * - Conversation history
 * - Tool call visualization
 * - Inline code references
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button, Input, TextArea, ScrollArea, Flex, Box, Text, Badge, Avatar, IconButton, Tooltip, Separator, Skeleton } from "@radix-ui/themes";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Send, Loader2, Copy, ChevronUp, ChevronDown, Code, FileText, Sparkles, Zap, X, Check, AlertCircle, MessageSquare, Database, Terminal, GitBranch, Search, Settings, Plus, Trash2, RotateCcw, ExternalLink } from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isStreaming?: boolean;
  codebaseContext?: CodebaseResult[];
  codebaseTriggered?: boolean; // Was @codebase used explicitly?
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

export function ChatSidebar({ projectId, projectRoot, isOpen, onClose, onNewConversation }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [useCodebase, setUseCodebase] = useState(true);
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [codebaseResults, setCodebaseResults] = useState<CodebaseResult[]>([]);
  const [showCodebasePanel, setShowCodebasePanel] = useState(false);
  const [isCodebaseSearching, setIsCodebaseSearching] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const models = [
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" },
    { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic" },
    { id: "claude-3-haiku", name: "Claude 3 Haiku", provider: "Anthropic" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "Google" },
    { id: "deepseek-chat", name: "DeepSeek Chat", provider: "DeepSeek" },
  ];

  // Parse @codebase mentions from user message
  const parseCodebaseMention = useCallback((message: string): { query: string; hasExplicitMention: boolean } => {
    const mentionMatch = message.match(/@codebase\s+(.+)$/i);
    if (mentionMatch) {
      return { query: mentionMatch[1].trim(), hasExplicitMention: true };
    }
    return { query: message, hasExplicitMention: false };
  }, []);

  // Semantic search against the project's codebase index
  const searchCodebase = useCallback(async (query: string): Promise<CodebaseResult[]> => {
    setIsCodebaseSearching(true);
    try {
      const response = await fetch(`/api/infinity/codebase/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          query,
          limit: 10,
          hybrid: true,
          expandQuery: true,
        }),
      });

      if (!response.ok) {
        console.warn("Codebase search failed:", response.status);
        return [];
      }

      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error("Codebase search error:", error);
      return [];
    } finally {
      setIsCodebaseSearching(false);
    }
  }, [projectId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    // Parse @codebase mention from input
    const { query, hasExplicitMention } = parseCodebaseMention(input);

    // Determine if we should use codebase context:
    // - Explicit @codebase mention always triggers search (even if toggle is off)
    // - If toggle is ON (default in Build mode), search automatically
    // - If toggle is OFF and no @codebase mention, don't search
    const shouldSearchCodebase = hasExplicitMention || useCodebase;

    let codebaseContext: CodebaseResult[] = [];
    if (shouldSearchCodebase) {
      codebaseContext = await searchCodebase(query);
    }

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input,
      timestamp: new Date(),
      codebaseContext: codebaseContext.length > 0 ? codebaseContext : undefined,
      codebaseTriggered: hasExplicitMention,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);

    // Start SSE connection
    const url = `/api/infinity/cursor/chat/stream`;
    const body = JSON.stringify({
      projectId,
      projectRoot,
      message: input,
      conversationHistory: messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls?.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })),
      useCodebase: shouldSearchCodebase,
      codebaseContext, // Pass pre-fetched context to backend
      model: selectedModel,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      };
      setMessages(prev => [...prev, assistantMessage]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const event = line.slice(7);
            // Next line will be data
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.token) {
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
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === "assistant" && last.isStreaming) {
                  return [...prev.slice(0, -1), { ...last, isStreaming: false, content: data.response || last.content }];
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
          }
        }
      }
    } catch (error) {
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
  }, [input, isStreaming, projectId, projectRoot, messages, useCodebase, selectedModel]);

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

  return (
    <Box
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
      <Flex
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--gray-5)",
          background: "var(--gray-2)",
        }}
        align="center"
        justify="space-between"
      >
        <Flex align="center" gap="2">
          <Avatar size="3" radius="full" style={{ background: "var(--violet-7)", color: "var(--violet-12)" }}>
            <Sparkles size={16} />
          </Avatar>
          <Flex direction="column" gap="0">
            <Text weight="bold" size="2">Cursor Chat</Text>
            <Text size="1" color="var(--gray-10)">@{projectId}</Text>
          </Flex>
        </Flex>
        <Flex align="center" gap="1">
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
            <IconButton onClick={onClose} aria-label="Close" size="2">
              <X size={16} />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>

      {/* Model selector & codebase toggle */}
      <Flex
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--gray-5)",
          background: "var(--gray-1)",
          gap: "12px",
          flexWrap: "wrap",
        }}
        align="center"
        gap="2"
      >
        <Tooltip content="Toggle codebase context">
          <Button
            variant={useCodebase ? "solid" : "soft"}
            color="violet"
            size="1"
            onClick={() => setUseCodebase(!useCodebase)}
            style={{ minWidth: "auto", gap: "6px" }}
          >
            <Database size={14} />
            <Text size="1" weight="medium">Codebase</Text>
            <Badge variant={useCodebase ? "solid" : "outline"} color="violet" size="1">ON</Badge>
          </Button>
        </Tooltip>

        <DropdownMenu open={showModelSelector} onOpenChange={setShowModelSelector}>
          <DropdownMenuTrigger asChild>
            <Tooltip content="Select model">
              <Button variant="soft" size="1" style={{ minWidth: "160px", justifyContent: "space-between" }}>
                <Flex align="center" gap="2">
                  <Sparkles size={14} />
                  <Text size="1" weight="medium">{models.find(m => m.id === selectedModel)?.name || selectedModel}</Text>
                </Flex>
                <ChevronDown size={14} />
              </Button>
            </Tooltip>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" style={{ minWidth: "200px" }}>
            {models.map(model => (
              <DropdownMenuItem
                key={model.id}
                onSelect={() => setSelectedModel(model.id)}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px" }}
              >
                <Text size="1" weight={selectedModel === model.id ? "bold" : "regular"}>{model.name}</Text>
                <Text size="1" color="var(--gray-10)">{model.provider}</Text>
                {selectedModel === model.id && <Check size={14} color="var(--green-9)" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </Flex>

      {/* Messages */}
      <ScrollArea
        style={{ flex: 1, overflow: "auto" }}
        onScroll={e => {
          // Could add infinite scroll here
        }}
      >
        <Flex direction="column" style={{ padding: "16px", gap: "16px", minHeight: "100%" }}>
          {messages.length === 0 && (
            <Flex direction="column" align="center" justify="center" style={{ flex: 1, color: "var(--gray-10)", gap: "12px" }}>
              <MessageSquare size={48} style={{ opacity: 0.3 }} />
              <Text weight="medium" size="2">Start a conversation</Text>
              <Text size="2" style={{ textAlign: "center" }}>
                Ask about your codebase, request edits, or get explanations.
                Use <Code style={{ background: "var(--gray-4)", padding: "2px 6px", borderRadius: "4px" }}>@codebase</Code> for context.
              </Text>
              <Flex gap="2">
                <Button variant="outline" size="2" onClick={() => { setInput("Explain the project structure"); handleSend(); }}>
                  <Search size={14} /> Explain project
                </Button>
                <Button variant="outline" size="2" onClick={() => { setInput("Find bugs in the codebase"); handleSend(); }}>
                  <AlertCircle size={14} /> Find bugs
                </Button>
                <Button variant="outline" size="2" onClick={() => { setInput("Add tests for the auth module"); handleSend(); }}>
                  <Check size={14} /> Add tests
                </Button>
              </Flex>
            </Flex>
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
        </Flex>
      </ScrollArea>

      {/* Streaming indicator */}
      {isStreaming && (
        <Flex
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--gray-5)",
            background: "var(--gray-2)",
            justifyContent: "center",
            gap: "8px",
            color: "var(--violet-9)",
          }}
          align="center"
        >
          <Loader2 size={16} className="spin" />
          <Text size="1" weight="medium">Generating response...</Text>
        </Flex>
      )}

      {/* Input */}
      <Flex
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--gray-5)",
          background: "var(--gray-1)",
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