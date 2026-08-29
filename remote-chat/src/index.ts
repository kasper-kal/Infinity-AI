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

interface ChatSession {
  id: string;
  name: string;
  process: ChildProcess | null;
  clients: Set<WebSocket>;
  history: string[];
  cwd: string;
}

const sessions = new Map<string, ChatSession>();

function findClaudeSessions(): string[] {
  const sessions: string[] = [];
  if (fs.existsSync(CLAUDE_SESSIONS_DIR)) {
    for (const file of fs.readdirSync(CLAUDE_SESSIONS_DIR)) {
      if (file.endsWith('.json')) {
        sessions.push(file.replace('.json', ''));
      }
    }
  }
  return sessions;
}

function loadSessionHistory(sessionId: string): string[] {
  const filePath = path.join(CLAUDE_SESSIONS_DIR, `${sessionId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data.history || [];
    } catch {
      return [];
    }
  }
  return [];
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
            const history = loadSessionHistory(sessionId);
            let proc: ChildProcess | null = null;

            try {
              proc = attachToSession(sessionId);
            } catch {
              proc = createNewClaudeSession(sessionId, process.cwd());
            }

            session = {
              id: sessionId,
              name: sessionId,
              process: proc,
              clients: new Set(),
              history,
              cwd: process.cwd()
            };
            sessions.set(sessionId, session);

            if (proc) {
              proc.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                session!.history.push(output);
                if (session!.history.length > 10000) session!.history.shift();
                for (const client of session!.clients) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'output', sessionId, payload: output }));
                  }
                }
              });

              proc.stderr?.on('data', (data: Buffer) => {
                const output = data.toString();
                session!.history.push(output);
                for (const client of session!.clients) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'output', sessionId, payload: output }));
                  }
                }
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