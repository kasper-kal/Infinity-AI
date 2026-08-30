import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { spawn, ChildProcess } from 'child_process';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3002;
const CLAUDE_SESSIONS_DIR = process.env.CLAUDE_SESSIONS_DIR || path.join(process.env.HOME || '/home/codespace', '.claude', 'sessions');
const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(process.env.HOME || '/home/codespace', '.claude', 'projects');

interface QueuedMessage {
  id: string;
  payload: string;
  timestamp: number;
}

interface Automation {
  id: string;
  sessionId: string;
  type: 'interval' | 'idle';
  intervalMs?: number;
  actions: Array<{type: 'input' | 'esc', payload?: string}>;
  enabled: boolean;
  timer?: NodeJS.Timeout;
  lastOutputTime?: number;
}

interface HistoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

interface SessionInfo {
  id: string;
  name: string;
  lastActivity?: number;
  preview?: string;
  status?: string;
  branch?: string;
  cwd?: string;
}

interface ChatSession {
  id: string;
  name: string;
  process: ChildProcess | null;
  clients: Set<WebSocket>;
  history: HistoryEntry[];
  cwd: string;
  messageQueue: QueuedMessage[];
  isClaudeBusy: boolean;
  lastOutputTime: number;
  automations: Map<string, Automation>;
}

const sessions = new Map<string, ChatSession>();

function findClaudeSessions(): SessionInfo[] {
  const sessions: SessionInfo[] = [];

  // First, get all session IDs (PID -> sessionId mapping) and derived names from sessions dir
  const pidToSessionId = new Map<string, string>();
  const sessionMeta = new Map<string, { name: string; cwd?: string }>(); // sessionId -> { name, cwd }
  if (fs.existsSync(CLAUDE_SESSIONS_DIR)) {
    for (const file of fs.readdirSync(CLAUDE_SESSIONS_DIR)) {
      if (file.endsWith('.json')) {
        const pid = file.replace('.json', '');
        const filePath = path.join(CLAUDE_SESSIONS_DIR, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const sessionId = data.sessionId || pid;
          pidToSessionId.set(pid, sessionId);
          sessionMeta.set(sessionId, { name: data.name || pid, cwd: data.cwd });
        } catch {}
      }
    }
  }

  // Then, look in projects dir for AI-generated titles (ai-title events) + preview/activity + git branch
  const aiTitles = new Map<string, string>();
  const sessionStats = new Map<string, { lastActivity: number, preview: string, branch?: string }>();
  if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    for (const projectDir of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
      const projectPath = path.join(CLAUDE_PROJECTS_DIR, projectDir);
      if (!fs.statSync(projectPath).isDirectory()) continue;

      for (const file of fs.readdirSync(projectPath)) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(projectPath, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          let lastActivity = 0;
          try { lastActivity = fs.statSync(filePath).mtimeMs; } catch {}
          let preview = '';
          let branch: string | undefined;
          for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'ai-title' && data.aiTitle) {
                aiTitles.set(sessionId, data.aiTitle);
              }
              if (data.type === 'git-branch' && data.branch) {
                branch = data.branch;
              }
              if ((data.type === 'user' || data.type === 'assistant') && data.message?.content) {
                const text = typeof data.message.content === 'string'
                  ? data.message.content
                  : JSON.stringify(data.message.content);
                const firstLine = text.split('\n')[0].trim();
                if (firstLine) preview = firstLine.slice(0, 120);
              }
            } catch {}
          }
          sessionStats.set(sessionId, { lastActivity, preview, branch });
        } catch {}
      }
    }
  }

  // Combine: prefer AI title, then derived name, then PID
  for (const [pid, sessionId] of pidToSessionId) {
    const meta = sessionMeta.get(sessionId) || { name: pid };
    const name = aiTitles.get(sessionId) || meta.name;
    const stats = sessionStats.get(sessionId);
    const lastActivity = stats?.lastActivity;
    const now = Date.now();
    const status = lastActivity && (now - lastActivity < 5 * 60 * 1000) ? 'active' : 'idle';
    sessions.push({
      id: pid,
      name,
      lastActivity,
      preview: stats?.preview,
      status,
      branch: stats?.branch,
      cwd: meta.cwd
    });
  }

  // Sort by most recent activity
  sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

  return sessions;
}

function loadSessionData(pid: string): { history: HistoryEntry[], name?: string } {
  const filePath = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const sessionId = data.sessionId || pid;

      // Look up AI title AND full chat history from projects dir
      let aiTitle: string | undefined;
      let fullHistory: HistoryEntry[] = [];

      if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
        for (const projectDir of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
          const projectPath = path.join(CLAUDE_PROJECTS_DIR, projectDir);
          if (!fs.statSync(projectPath).isDirectory()) continue;

          const jsonlFile = path.join(projectPath, `${sessionId}.jsonl`);
          if (fs.existsSync(jsonlFile)) {
            try {
              const content = fs.readFileSync(jsonlFile, 'utf-8');
              for (const line of content.split('\n')) {
                if (!line.trim()) continue;
                try {
                  const event = JSON.parse(line);
                  if (event.type === 'ai-title' && event.aiTitle) {
                    aiTitle = event.aiTitle;
                  }
                  // Extract user and assistant messages with proper roles
                  function extractText(content: any): string {
                    if (typeof content === 'string') return content;
                    if (Array.isArray(content)) {
                      return content.map(c => extractText(c)).join('\n');
                    }
                    if (content && typeof content === 'object') {
                      if (content.type === 'text' && content.text) return content.text;
                      if (content.type === 'thinking' && content.thinking) return `[thinking: ${content.thinking.slice(0,100)}...]`;
                      if (content.type === 'tool_use') return `[tool: ${content.name}]`;
                      if (content.type === 'tool_result') return `[tool result: ${typeof content.content === 'string' ? content.content.slice(0,200) : JSON.stringify(content.content).slice(0,200)}]`;
                      return JSON.stringify(content);
                    }
                    return '';
                  }

                  if (event.type === 'user' && event.message?.content) {
                    const content = extractText(event.message.content);
                    fullHistory.push({ role: 'user', content, timestamp: event.timestamp });
                  }
                  if (event.type === 'assistant' && event.message?.content) {
                    const content = extractText(event.message.content);
                    fullHistory.push({ role: 'assistant', content, timestamp: event.timestamp });
                  }
                } catch {}
              }
            } catch {}
          }
        }
      }

      // Use full history from JSONL, fallback to session history
      let history: HistoryEntry[] = fullHistory.length > 0
        ? fullHistory
        : (data.history || []).map((h: string) => ({ role: 'system' as const, content: h }));

      return { history, name: aiTitle || data.name };
    } catch {
      return { history: [] };
    }
  }
  return { history: [] };
}

function createNewClaudeSession(sessionId: string, cwd: string): ChildProcess {
  // Use --bg to create background session, then attach for interactive I/O
  // First create the background session
  const { spawnSync } = require('child_process');
  const bgResult = spawnSync('claude', ['--bg', '--dangerously-skip-permissions'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      ANTHROPIC_BASE_URL: "http://localhost:20128",
      ANTHROPIC_AUTH_TOKEN: "sk-2535363cc0d37fa7-f00e7b-3f4f64b2",
      ANTHROPIC_MODEL: "auto",
      ANTHROPIC_SMALL_FAST_MODEL: "auto",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "auto",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "auto"
    },
    encoding: 'utf8'
  });

  // Extract session ID from output like "backgrounded · abc12345 (idle — send a prompt to start)"
  const match = bgResult.stdout?.match(/backgrounded · (\w+)/);
  const bgSessionId = match ? match[1] : null;

  if (!bgSessionId) {
    console.error('Failed to create background session:', bgResult.stdout, bgResult.stderr);
    // Fallback to simple spawn
    return spawn('claude', ['--dangerously-skip-permissions'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        ANTHROPIC_BASE_URL: "http://localhost:20128",
        ANTHROPIC_AUTH_TOKEN: "sk-2535363cc0d37fa7-f00e7b-3f4f64b2",
        ANTHROPIC_MODEL: "auto",
        ANTHROPIC_SMALL_FAST_MODEL: "auto",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "auto",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "auto"
      }
    });
  }

  // Now attach to the background session for interactive I/O
  const proc = spawn('claude', ['attach', bgSessionId, '--dangerously-skip-permissions'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      ANTHROPIC_BASE_URL: "http://localhost:20128",
      ANTHROPIC_AUTH_TOKEN: "sk-2535363cc0d37fa7-f00e7b-3f4f64b2",
      ANTHROPIC_MODEL: "auto",
      ANTHROPIC_SMALL_FAST_MODEL: "auto",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "auto",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "auto"
    }
  });

  return proc;
}

function checkClaudeIdle(session: ChatSession) {
  const now = Date.now();
  if (now - session.lastOutputTime > 2000 && session.isClaudeBusy) {
    session.isClaudeBusy = false;
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'claude_idle', sessionId: session.id }));
      }
    }
    processQueue(session);
  }
}

function processQueue(session: ChatSession) {
  if (!session.isClaudeBusy && session.messageQueue.length > 0 && session.process?.stdin) {
    const next = session.messageQueue.shift()!;
    session.process.stdin.write(next.payload + '\n');
    session.isClaudeBusy = true;
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'dequeued', payload: next }));
      }
    }
  }
}

function startAutomation(session: ChatSession, automation: Automation) {
  if (automation.timer) clearInterval(automation.timer);

  if (automation.type === 'interval' && automation.intervalMs) {
    automation.timer = setInterval(() => {
      if (!automation.enabled) return;
      for (const action of automation.actions) {
        if (action.type === 'esc' && session.process?.stdin) {
          session.process.stdin.write('\x1b');
        } else if (action.type === 'input' && action.payload && session.process?.stdin) {
          session.process.stdin.write(action.payload + '\n');
        }
      }
    }, automation.intervalMs);
  } else if (automation.type === 'idle') {
    automation.timer = setInterval(() => {
      if (!automation.enabled) return;
      const now = Date.now();
      if (now - session.lastOutputTime > (automation.intervalMs || 30000)) {
        for (const action of automation.actions) {
          if (action.type === 'esc' && session.process?.stdin) {
            session.process.stdin.write('\x1b');
          } else if (action.type === 'input' && action.payload && session.process?.stdin) {
            session.process.stdin.write(action.payload + '\n');
          }
        }
      }
    }, 5000);
  }
}

wss.on('connection', (ws: WebSocket) => {
  let currentSessionId: string | null = null;

  ws.on('message', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'list': {
          const available = findClaudeSessions();
          ws.send(JSON.stringify({ type: 'sessions', payload: available }));
          break;
        }

        case 'join': {
          const sessionId = msg.sessionId;
          if (!sessionId) break;
          currentSessionId = sessionId;
          let session = sessions.get(sessionId);

          if (!session) {
            const { history, name } = loadSessionData(sessionId);

            // Try to attach to tmux, fall back to new claude process if tmux unavailable
            let proc: ChildProcess | null = null;

            // Check if tmux exists first
            const { spawnSync } = require('child_process');
            const tmuxCheck = spawnSync('which', ['tmux']);
            const hasTmux = tmuxCheck.status === 0;

            if (hasTmux) {
              const attachProc = spawn('tmux', ['attach-session', '-t', `claude-${sessionId}`], {
                stdio: ['pipe', 'pipe', 'pipe']
              });

              // Wait briefly to see if attach succeeds
              await new Promise<void>((resolve) => {
                setTimeout(resolve, 300);
              });

              if (!attachProc.killed) {
                proc = attachProc;
              }
            }

            if (!proc) {
              proc = createNewClaudeSession(sessionId, process.cwd());
            }

            session = {
              id: sessionId,
              name: name || sessionId,
              process: proc,
              clients: new Set(),
              history,
              cwd: process.cwd(),
              messageQueue: [],
              isClaudeBusy: false,
              lastOutputTime: Date.now(),
              automations: new Map()
            };
            sessions.set(sessionId, session);

            if (proc) {
              proc.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                const entry: HistoryEntry = { role: 'assistant', content: output, timestamp: Date.now() };
                session!.history.push(entry);
                if (session!.history.length > 10000) session!.history.shift();
                session!.lastOutputTime = Date.now();
                session!.isClaudeBusy = true;
                for (const client of session!.clients) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'output', sessionId, payload: entry }));
                  }
                }
                checkClaudeIdle(session!);
              });

              proc.stderr?.on('data', (data: Buffer) => {
                const output = data.toString();
                const entry: HistoryEntry = { role: 'system', content: output, timestamp: Date.now() };
                session!.history.push(entry);
                session!.lastOutputTime = Date.now();
                session!.isClaudeBusy = true;
                for (const client of session!.clients) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'output', sessionId, payload: entry }));
                  }
                }
                checkClaudeIdle(session!);
              });
            }
          }

          session.clients.add(ws);
          ws.send(JSON.stringify({
            type: 'joined',
            sessionId,
            payload: { history: session.history, name: session.name }
          }));
          break;
        }

        case 'create_session': {
          const newSessionId = 'sess_' + Math.random().toString(36).slice(2, 10);
          const cwd = msg.cwd || process.cwd();
          const proc = createNewClaudeSession(newSessionId, cwd);

          const session: ChatSession = {
            id: newSessionId,
            name: newSessionId,
            process: proc,
            clients: new Set<WebSocket>(),
            history: [],
            cwd,
            messageQueue: [],
            isClaudeBusy: false,
            lastOutputTime: Date.now(),
            automations: new Map()
          };
          sessions.set(newSessionId, session);

          proc.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            const entry: HistoryEntry = { role: 'assistant', content: output, timestamp: Date.now() };
            session.history.push(entry);
            if (session.history.length > 10000) session.history.shift();
            session.lastOutputTime = Date.now();
            session.isClaudeBusy = true;
            for (const client of session.clients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'output', sessionId: newSessionId, payload: entry }));
              }
            }
            checkClaudeIdle(session);
          });

          proc.stderr?.on('data', (data: Buffer) => {
            const output = data.toString();
            const entry: HistoryEntry = { role: 'system', content: output, timestamp: Date.now() };
            session.history.push(entry);
            session.lastOutputTime = Date.now();
            session.isClaudeBusy = true;
            for (const client of session.clients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'output', sessionId: newSessionId, payload: entry }));
              }
            }
            checkClaudeIdle(session);
          });

          session.clients.add(ws);
          ws.send(JSON.stringify({
            type: 'joined',
            sessionId: newSessionId,
            payload: { history: [], name: newSessionId }
          }));
          broadcastSessionsList();
          break;
        }

        case 'input': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session?.process?.stdin) {
              const entry: HistoryEntry = { role: 'user', content: msg.payload, timestamp: Date.now() };
              session.history.push(entry);
              for (const client of session.clients) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'output', sessionId: currentSessionId, payload: entry }));
                }
              }
              session.process.stdin.write(msg.payload + '\n');
              // Notify clients that Claude is busy
              for (const client of session.clients) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'claude_busy', sessionId: currentSessionId }));
                }
              }
            }
          }
          break;
        }

        case 'queue': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session) {
              const queued: QueuedMessage = {
                id: Math.random().toString(36).slice(2),
                payload: msg.payload,
                timestamp: Date.now()
              };
              session.messageQueue.push(queued);
              ws.send(JSON.stringify({ type: 'queued', payload: queued }));
            }
          }
          break;
        }

        case 'process_queue': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session && !session.isClaudeBusy && session.messageQueue.length > 0) {
              const next = session.messageQueue.shift()!;
              if (session.process?.stdin) {
                session.process.stdin.write(next.payload + '\n');
                session.isClaudeBusy = true;
              }
              ws.send(JSON.stringify({ type: 'dequeued', payload: next }));
            }
          }
          break;
        }

        case 'add_automation': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session) {
              const automation: Automation = {
                id: Math.random().toString(36).slice(2),
                sessionId: currentSessionId,
                type: msg.automation.type,
                intervalMs: msg.automation.intervalMs,
                actions: msg.automation.actions,
                enabled: true
              };
              session.automations.set(automation.id, automation);
              startAutomation(session, automation);
              ws.send(JSON.stringify({ type: 'automation_added', payload: automation }));
            }
          }
          break;
        }

        case 'remove_automation': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session) {
              const auto = session.automations.get(msg.automationId);
              if (auto) {
                if (auto.timer) clearInterval(auto.timer);
                session.automations.delete(msg.automationId);
                ws.send(JSON.stringify({ type: 'automation_removed', payload: msg.automationId }));
              }
            }
          }
          break;
        }

        case 'list_automations': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session) {
              const autos = Array.from(session.automations.values());
              ws.send(JSON.stringify({ type: 'automations', payload: autos }));
            }
          }
          break;
        }

        case 'toggle_automation': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session) {
              const auto = session.automations.get(msg.automationId);
              if (auto) {
                auto.enabled = !auto.enabled;
                if (auto.enabled) startAutomation(session, auto);
                else if (auto.timer) clearInterval(auto.timer);
                ws.send(JSON.stringify({ type: 'automation_toggled', payload: auto }));
              }
            }
          }
          break;
        }

        case 'resize': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session?.process?.pid) {
              try {
                process.kill(session.process.pid, 'SIGWINCH');
              } catch {}
            }
          }
          break;
        }

        case 'leave': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            session?.clients.delete(ws);
            currentSessionId = null;
          }
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'rename_session': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session && msg.newName?.trim()) {
              session.name = msg.newName.trim();
              // Broadcast to all clients of this session
              for (const client of session.clients) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'session_renamed', sessionId: currentSessionId, name: session.name }));
                }
              }
              // Also update the sessions list for all connected clients
              broadcastSessionsList();
            }
          }
          break;
        }

        case 'kill_session': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session) {
              if (session.process) {
                session.process.kill('SIGTERM');
                setTimeout(() => {
                  if (session.process && !session.process.killed) session.process.kill('SIGKILL');
                }, 2000);
              }
              for (const client of session.clients) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'session_killed', sessionId: currentSessionId }));
                }
              }
              sessions.delete(currentSessionId);
              broadcastSessionsList();
            }
          }
          break;
        }
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    if (currentSessionId) {
      const session = sessions.get(currentSessionId);
      session?.clients.delete(ws);
    }
  });
});

function broadcastSessionsList() {
  const available = findClaudeSessions();
  const payload = JSON.stringify({ type: 'sessions', payload: available });
  for (const session of sessions.values()) {
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.get('/api/sessions', (req, res) => {
  res.json(findClaudeSessions());
});

server.listen({ port: PORT, host: '0.0.0.0' }, () => {
  console.log(`Remote chat server running on port ${PORT}`);
  console.log(`Looking for Claude sessions in: ${CLAUDE_SESSIONS_DIR}`);
});