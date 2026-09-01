import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ChatSidebarProps {
  vscode: any;
  onSendMessage: (msg: any) => void;
  projectRoot: string;
  connected: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  files?: FileReference[];
  codebaseResults?: CodebaseResult[];
  streaming?: boolean;
}

interface FileReference {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

interface CodebaseResult {
  file: string;
  symbol: string;
  signature: string;
  lines: string;
  score: number;
}

export function ChatSidebar({ vscode, onSendMessage, projectRoot, connected }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [useCodebase, setUseCodebase] = useState(true);
  const [showCodebaseResults, setShowCodebaseResults] = useState(false);
  const [codebaseResults, setCodebaseResults] = useState<CodebaseResult[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<FileReference[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() && attachedFiles.length === 0) return;
    if (!connected) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString(),
      files: attachedFiles.length > 0 ? attachedFiles : undefined,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);
    setInputValue('');
    setAttachedFiles([]);

    // Check for @codebase mention
    const codebaseMatch = inputValue.match(/@codebase\s+(.+)/);
    if (codebaseMatch && useCodebase) {
      const query = codebaseMatch[1].trim();
      onSendMessage({ type: 'codebase_search', query });
    }

    onSendMessage({
      type: 'chat',
      message: inputValue,
      files: attachedFiles,
      useCodebase,
    });
  }, [inputValue, attachedFiles, connected, useCodebase, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleAttachFile = useCallback(async () => {
    // In a real implementation, this would open a file picker
    // For now, we'll simulate by allowing manual path entry
    const path = prompt('Enter file path relative to project root:');
    if (path) {
      try {
        const response = await fetch(`vscode://file/${projectRoot}/${path}`);
        // This is a simplified approach - in reality we'd use the extension API
        const fileRef: FileReference = { path, content: `// Content of ${path}` };
        setAttachedFiles(prev => [...prev, fileRef]);
      } catch (err) {
        console.error('Failed to attach file:', err);
      }
    }
  }, [projectRoot]);

  const handleCodebaseResult = useCallback((results: CodebaseResult[]) => {
    setCodebaseResults(results);
    setShowCodebaseResults(results.length > 0);
  }, []);

  const handleAssistantMessage = useCallback((data: any) => {
    if (data.type === 'chat_token') {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + data.token }];
        } else {
          return [...prev, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: data.token,
            timestamp: new Date().toISOString(),
            streaming: true,
          }];
        }
      });
    } else if (data.type === 'chat_complete') {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false, content: data.content || last.content }];
        }
        return prev;
      });
      setIsStreaming(false);
    } else if (data.type === 'codebase_results') {
      handleCodebaseResult(data.results);
    }
  }, [handleCodebaseResult]);

  // Listen for chat messages from extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'chat_token' || message.type === 'chat_complete' || message.type === 'codebase_results') {
        handleAssistantMessage(message);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleAssistantMessage]);

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const copyCodebaseReference = useCallback((result: CodebaseResult) => {
    const ref = `${result.file}:${result.symbol}`;
    navigator.clipboard.writeText(ref);
    vscode.postMessage({ type: 'show_info', message: `Copied: ${ref}` });
  }, [vscode]);

  return (
    <div className="chat-sidebar">
      <div className="chat-header">
        <h3>Infinity Chat</h3>
        <div className="chat-controls">
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={useCodebase}
              onChange={(e) => setUseCodebase(e.target.checked)}
              disabled={!connected}
            />
            @codebase
          </label>
          <button className="icon-btn" onClick={() => setMessages([])} title="Clear chat">
            🗑
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map(msg => (
          <ChatMessageComponent
            key={msg.id}
            message={msg}
            codebaseResults={msg.codebaseResults}
            onCopyReference={copyCodebaseReference}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {showCodebaseResults && codebaseResults.length > 0 && (
        <div className="codebase-results">
          <div className="codebase-results-header">
            <span>Codebase Results ({codebaseResults.length})</span>
            <button className="icon-btn small" onClick={() => setShowCodebaseResults(false)}>✕</button>
          </div>
          <div className="codebase-results-list">
            {codebaseResults.map((result, i) => (
              <div key={i} className="codebase-result-item" onClick={() => copyCodebaseReference(result)}>
                <div className="codebase-result-file">{result.file}</div>
                <div className="codebase-result-symbol">{result.symbol}</div>
                <div className="codebase-result-signature">{result.signature}</div>
                <div className="codebase-result-preview">{result.lines}</div>
                <span className="score-badge">{Math.round(result.score * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {attachedFiles.length > 0 && (
        <div className="attached-files">
          {attachedFiles.map((file, i) => (
            <div key={i} className="attached-file">
              <span className="file-path">{file.path}</span>
              <button className="icon-btn small" onClick={() => removeAttachedFile(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-area">
        <div className="input-toolbar">
          <button className="icon-btn" onClick={handleAttachFile} title="Attach file" disabled={!connected}>
            📎
          </button>
          <button className="icon-btn" onClick={() => {}} title="Add folder" disabled={!connected}>
            📁
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? 'Ask anything about your codebase...' : 'Connect to Infinity to start chatting'}
          disabled={!connected || isStreaming}
          rows={3}
        />
        <div className="input-actions">
          <button
            className="btn primary send-btn"
            onClick={handleSend}
            disabled={!inputValue.trim() && attachedFiles.length === 0 || !connected || isStreaming}
          >
            {isStreaming ? '⏳' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMessageComponent({ message, codebaseResults, onCopyReference }: {
  message: ChatMessage;
  codebaseResults?: CodebaseResult[];
  onCopyReference: (result: CodebaseResult) => void;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-header">
        <span className="message-role">{isUser ? 'You' : 'Infinity'}</span>
        <span className="message-time">{new Date(message.timestamp).toLocaleTimeString()}</span>
      </div>
      <div className="message-content">
        {message.content}
      </div>
      {message.files && message.files.length > 0 && (
        <div className="message-files">
          {message.files.map((file, i) => (
            <div key={i} className="message-file">
              📄 {file.path}
            </div>
          ))}
        </div>
      )}
      {message.codebaseResults && message.codebaseResults.length > 0 && (
        <div className="message-codebase-results">
          {message.codebaseResults.map((result, i) => (
            <div key={i} className="codebase-result-item" onClick={() => onCopyReference(result)}>
              <div className="codebase-result-file">{result.file}</div>
              <div className="codebase-result-symbol">{result.symbol}</div>
              <span className="score-badge">{Math.round(result.score * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}