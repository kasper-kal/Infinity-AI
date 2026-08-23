/**
 * useTerminalBridge - Hook for connecting to the Infinity Terminal Bridge
 *
 * Provides WebSocket connection to the local terminal bridge (node-pty)
 * running on ws://localhost:3001 with shared secret authentication.
 * Supports multiple terminal sessions, resize, input, and MCP stdio bridging.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface TerminalSession {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  buffer: string;
  createdAt: number;
}

export interface TerminalOutput {
  sessionId: string;
  data: string;
  timestamp: number;
}

export interface BridgeConfig {
  host: string;
  port: number;
  secret: string;
  autoConnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

export interface MCPConnection {
  mcpId: string;
  command: string;
  args: string[];
  connected: boolean;
}

const DEFAULT_CONFIG: BridgeConfig = {
  host: '127.0.0.1',
  port: 3001,
  secret: '',
  autoConnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
};

type MessageHandler = (message: ServerMessage) => void;

interface ClientMessage {
  type: 'create' | 'resize' | 'input' | 'close' | 'signal' | 'ping' | 'mcp_connect' | 'mcp_request';
  sessionId?: string;
  payload?: unknown;
}

interface ServerMessage {
  type: 'created' | 'output' | 'closed' | 'error' | 'pong' | 'mcp_response' | 'mcp_error';
  sessionId?: string;
  payload?: unknown;
  timestamp: number;
}

export function useTerminalBridge(config: Partial<BridgeConfig> = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const wsRef = useRef<WebSocket | null>(null);
  const sessionsRef = useRef<Map<string, TerminalSession>>(new Map());
  const outputBufferRef = useRef<Map<string, string>>(new Map());
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageHandlersRef = useRef<Set<MessageHandler>>(new Set());
  const pendingCreatesRef = useRef<Map<string, { resolve: (session: TerminalSession) => void; reject: (err: Error) => void }>>(new Map());

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [outputHistory, setOutputHistory] = useState<TerminalOutput[]>([]);
  const [mcpConnections, setMcpConnections] = useState<MCPConnection[]>([]);

  // Build WebSocket URL with secret
  const getWsUrl = useCallback(() => {
    return `ws://${mergedConfig.host}:${mergedConfig.port}?secret=${encodeURIComponent(mergedConfig.secret)}`;
  }, [mergedConfig.host, mergedConfig.port, mergedConfig.secret]);

  // Notify all message handlers
  const notifyHandlers = useCallback((message: ServerMessage) => {
    messageHandlersRef.current.forEach(handler => {
      try {
        handler(message);
      } catch (err) {
        console.error('[TerminalBridge] Handler error:', err);
      }
    });
  }, []);

  // Subscribe to messages
  const subscribe = useCallback((handler: MessageHandler) => {
    messageHandlersRef.current.add(handler);
    return () => {
      messageHandlersRef.current.delete(handler);
    };
  }, []);

  // Send message to bridge
  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  // Create a new terminal session
  const createSession = useCallback(async (options?: {
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
  }): Promise<TerminalSession> => {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      // Store resolver
      pendingCreatesRef.current.set(sessionId, { resolve, reject });

      // Send create message
      const success = send({
        type: 'create',
        sessionId,
        payload: {
          shell: options?.shell,
          cwd: options?.cwd,
          cols: options?.cols ?? 120,
          rows: options?.rows ?? 30,
          env: options?.env,
          secret: mergedConfig.secret,
        },
      });

      if (!success) {
        pendingCreatesRef.current.delete(sessionId);
        reject(new Error('Not connected to bridge'));
        return;
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingCreatesRef.current.has(sessionId)) {
          pendingCreatesRef.current.delete(sessionId);
          reject(new Error('Session creation timeout'));
        }
      }, 10000);
    });
  }, [send, mergedConfig.secret]);

  // Resize terminal session
  const resizeSession = useCallback((sessionId: string, cols: number, rows: number) => {
    return send({
      type: 'resize',
      sessionId,
      payload: { cols, rows },
    });
  }, [send]);

  // Send input to terminal session
  const sendInput = useCallback((sessionId: string, data: string) => {
    return send({
      type: 'input',
      sessionId,
      payload: { data },
    });
  }, [send]);

  // Close terminal session
  const closeSession = useCallback((sessionId: string) => {
    const session = sessionsRef.current.get(sessionId);
    if (session) {
      sessionsRef.current.delete(sessionId);
      outputBufferRef.current.delete(sessionId);
      setSessions(Array.from(sessionsRef.current.values()));
    }
    return send({
      type: 'close',
      sessionId,
    });
  }, [send]);

  // Send signal to terminal session
  const sendSignal = useCallback((sessionId: string, signal: NodeJS.Signals) => {
    return send({
      type: 'signal',
      sessionId,
      payload: { signal },
    });
  }, [send]);

  // Connect to MCP server via stdio bridge
  const connectMCP = useCallback(async (command: string, args: string[] = [], env?: Record<string, string>): Promise<string> => {
    const mcpId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const handler = (message: ServerMessage) => {
        if (message.type === 'mcp_response' && message.sessionId === mcpId) {
          const payload = message.payload as { connected?: boolean; mcpId?: string } | string;
          if (typeof payload === 'object' && payload?.connected) {
            messageHandlersRef.current.delete(handler);
            resolve(mcpId);
          }
        } else if (message.type === 'mcp_error' && message.sessionId === mcpId) {
          messageHandlersRef.current.delete(handler);
          reject(new Error(typeof message.payload === 'string' ? message.payload : 'MCP connection failed'));
        }
      };

      messageHandlersRef.current.add(handler);

      const success = send({
        type: 'mcp_connect',
        payload: { command, args, env, secret: mergedConfig.secret },
      });

      if (!success) {
        messageHandlersRef.current.delete(handler);
        reject(new Error('Not connected to bridge'));
        return;
      }

      setTimeout(() => {
        if (messageHandlersRef.current.has(handler)) {
          messageHandlersRef.current.delete(handler);
          reject(new Error('MCP connection timeout'));
        }
      }, 10000);
    });
  }, [send, mergedConfig.secret]);

  // Send request to MCP server
  const sendMCPRequest = useCallback((mcpId: string, request: unknown) => {
    return send({
      type: 'mcp_request',
      payload: { mcpId, request },
    });
  }, [send]);

  // Disconnect from MCP server
  const disconnectMCP = useCallback((mcpId: string) => {
    // The bridge will clean up on process exit
    setMcpConnections(prev => prev.filter(c => c.mcpId !== mcpId));
  }, []);

  // Ping to keep connection alive
  const ping = useCallback(() => {
    return send({ type: 'ping' });
  }, [send]);

  // Connect to bridge
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (!mergedConfig.secret) {
      setError('No secret configured');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[TerminalBridge] Connected to bridge');
        setConnected(true);
        setConnecting(false);
        reconnectAttemptsRef.current = 0;

        // Start ping interval
        const pingInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            ping();
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);

        if (wsRef.current) {
          wsRef.current.onclose = () => {
            clearInterval(pingInterval);
          };
        }
      };

      ws.onclose = (event) => {
        console.log('[TerminalBridge] Disconnected:', event.code, event.reason);
        setConnected(false);
        setConnecting(false);

        // Attempt reconnect if not intentional close
        if (event.code !== 1000 && reconnectAttemptsRef.current < mergedConfig.maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`[TerminalBridge] Reconnecting... (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, mergedConfig.reconnectInterval);
        } else if (reconnectAttemptsRef.current >= mergedConfig.maxReconnectAttempts) {
          setError('Max reconnection attempts reached');
        }
      };

      ws.onerror = (err) => {
        console.error('[TerminalBridge] WebSocket error:', err);
        setError('WebSocket connection error');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          switch (message.type) {
            case 'created': {
              const payload = message.payload as { buffer?: string } | undefined;
              const session: TerminalSession = {
                id: message.sessionId!,
                shell: '', // Will be updated from bridge
                cwd: '',
                cols: 120,
                rows: 30,
                buffer: payload?.buffer || '',
                createdAt: message.timestamp,
              };
              sessionsRef.current.set(message.sessionId!, session);
              setSessions(Array.from(sessionsRef.current.values()));

              // Resolve pending create
              const pending = pendingCreatesRef.current.get(message.sessionId!);
              if (pending) {
                pendingCreatesRef.current.delete(message.sessionId!);
                pending.resolve(session);
              }
              break;
            }

            case 'output': {
              const sessionId = message.sessionId!;
              const data = message.payload as string;

              // Update session buffer
              const session = sessionsRef.current.get(sessionId);
              if (session) {
                session.buffer += data;
                if (session.buffer.length > 10000) {
                  session.buffer = session.buffer.slice(-10000);
                }
                sessionsRef.current.set(sessionId, session);
                setSessions(Array.from(sessionsRef.current.values()));
              }

              // Add to output history
              const output: TerminalOutput = {
                sessionId,
                data,
                timestamp: message.timestamp,
              };
              setOutputHistory(prev => [...prev.slice(-999), output]); // Keep last 1000

              notifyHandlers(message);
              break;
            }

            case 'closed': {
              const sessionId = message.sessionId!;
              sessionsRef.current.delete(sessionId);
              outputBufferRef.current.delete(sessionId);
              setSessions(Array.from(sessionsRef.current.values()));
              notifyHandlers(message);
              break;
            }

            case 'error': {
              console.error('[TerminalBridge] Bridge error:', message.payload);
              setError(message.payload as string);
              notifyHandlers(message);
              break;
            }

            case 'pong': {
              // Connection alive
              break;
            }

            case 'mcp_response': {
              const payload = message.payload as { connected?: boolean; mcpId?: string } | string;
              if (typeof payload === 'object' && payload?.connected && payload.mcpId) {
                const mcpConn: MCPConnection = {
                  mcpId: payload.mcpId,
                  command: '',
                  args: [],
                  connected: true,
                };
                setMcpConnections(prev => [...prev, mcpConn]);
              }
              notifyHandlers(message);
              break;
            }

            case 'mcp_error': {
              notifyHandlers(message);
              break;
            }

            default:
              notifyHandlers(message);
          }
        } catch (err) {
          console.error('[TerminalBridge] Failed to parse message:', err);
        }
      };
    } catch (err) {
      console.error('[TerminalBridge] Connection failed:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
    }
  }, [getWsUrl, mergedConfig.secret, mergedConfig.maxReconnectAttempts, mergedConfig.reconnectInterval, ping, notifyHandlers]);

  // Disconnect from bridge
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setConnected(false);
    setConnecting(false);
    reconnectAttemptsRef.current = 0;
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (mergedConfig.autoConnect && mergedConfig.secret) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, []); // Only run once on mount

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    // Connection state
    connected,
    connecting,
    error,

    // Sessions
    sessions,
    createSession,
    resizeSession,
    sendInput,
    closeSession,
    sendSignal,

    // Output
    outputHistory,

    // MCP
    mcpConnections,
    connectMCP,
    sendMCPRequest,
    disconnectMCP,

    // Utilities
    ping,
    connect,
    disconnect,
    subscribe,

    // Config
    config: mergedConfig,
  };
}

export type UseTerminalBridgeReturn = ReturnType<typeof useTerminalBridge>;