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

interface ChatSession {
  id: string;
  name: string;
  process: ChildProcess | null;
  clients: Set<WebSocket>;
  history: string[];
  cwd: string;
  messageQueue: QueuedMessage[];
  isClaudeBusy: boolean;
  lastOutputTime: number;
  automations: Map<string, Automation>;
}

const sessions = new Map<string, ChatSession>();

function findClaudeSessions(): Array<{id: string, name: string}> {
  const sessions: Array<{id: string, name: string}> = [];

  // First, get all session IDs (PID -> sessionId mapping) and derived names from sessions dir
  const pidToSessionId = new Map<string, string>();
  const sessionMeta = new Map<string, string>(); // sessionId -> derived name
  if (fs.existsSync(CLAUDE_SESSIONS_DIR)) {
    for (const file of fs.readdirSync(CLAUDE_SESSIONS_DIR)) {
      if (file.endsWith('.json')) {
        const pid = file.replace('.json', '');
        const filePath = path.join(CLAUDE_SESSIONS_DIR, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const sessionId = data.sessionId || pid;
          pidToSessionId.set(pid, sessionId);
          sessionMeta.set(sessionId, data.name || pid);
        } catch {}
      }
    }
  }

  // Then, look in projects dir for AI-generated titles (ai-title events)
  const aiTitles = new Map<string, string>();
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
          for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'ai-title' && data.aiTitle) {
                aiTitles.set(sessionId, data.aiTitle);
                break;
              }
            } catch {}
          }
        } catch {}
      }
    }
  }

  // Combine: prefer AI title, then derived name, then PID
  for (const [pid, sessionId] of pidToSessionId) {
    const derivedName = sessionMeta.get(sessionId) || pid;
    const name = aiTitles.get(sessionId) || derivedName;
    sessions.push({ id: pid, name });
  }

  return sessions;
}

function loadSessionData(pid: string): { history: string[], name?: string } {
  const filePath = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const sessionId = data.sessionId || pid;

      // Look up AI title AND full chat history from projects dir
      let aiTitle: string | undefined;
      let fullHistory: string[] = [];

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
                  // Extract user and assistant messages
                  if (event.type === 'user' && event.message?.content) {
                    const content = typeof event.message.content === 'string'
                      ? event.message.content
                      : JSON.stringify(event.message.content);
                    fullHistory.push(`> ${content}`);
                  }
                  if (event.type === 'assistant' && event.message?.content) {
                    const content = typeof event.message.content === 'string'
                      ? event.message.content
                      : JSON.stringify(event.message.content);
                    fullHistory.push(content);
                  }
                } catch {}
              }
            } catch {}
          }
        }
      }

      // Use full history from JSONL, fallback to session history
      const history = fullHistory.length > 0 ? fullHistory : (data.history || []);
      return { history, name: aiTitle || data.name };
    } catch {
      return { history: [] };
    }
  }
  return { history: [] };
}

function attachToSession(sessionId: string): ChildProcess | null {
  const sessionName = `claude-${sessionId}`;
  const tmuxSession = `claude-${sessionId}`;

  const proc = spawn('tmux', ['attach-session', '-t', tmuxSession], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return proc;
}

function createNewClaudeSession(sessionId: string, cwd: string): ChildProcess {
  const proc = spawn('claude', [], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' }
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

  ws.on('message', (data: Buffer) => {
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
            let proc: ChildProcess | null = null;

            try {
              proc = attachToSession(sessionId);
            } catch {
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
                session!.history.push(output);
                if (session!.history.length > 10000) session!.history.shift();
                session!.lastOutputTime = Date.now();
                session!.isClaudeBusy = true;
                for (const client of session!.clients) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'output', sessionId, payload: output }));
                  }
                }
                checkClaudeIdle(session!);
              });

              proc.stderr?.on('data', (data: Buffer) => {
                const output = data.toString();
                session!.history.push(output);
                session!.lastOutputTime = Date.now();
                session!.isClaudeBusy = true;
                for (const client of session!.clients) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'output', sessionId, payload: output }));
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
            payload: { history: session.history }
          }));
          break;
        }

        case 'input': {
          if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session?.process?.stdin) {
              session.process.stdin.write(msg.payload + '\n');
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.get('/api/sessions', (req, res) => {
  res.json(findClaudeSessions());
});

server.listen(PORT, () => {
  console.log(`Remote chat server running on port ${PORT}`);
  console.log(`Looking for Claude sessions in: ${CLAUDE_SESSIONS_DIR}`);
});