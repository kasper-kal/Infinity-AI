const express = require('express');
const cors = require('cors');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let nextSessionId = 1;
const sessions = new Map(); // sessionId -> { pty, clients, name, createdAt, history, realSessionId, cwd }
const eventClients = new Map(); // sessionId -> Set of response objects

const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function getRealClaudeSessions() {
  try {
    if (!fs.existsSync(CLAUDE_SESSIONS_DIR)) return [];
    const files = fs.readdirSync(CLAUDE_SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const result = [];
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CLAUDE_SESSIONS_DIR, f), 'utf8'));
        if (data.entrypoint === 'cli' && data.kind === 'interactive') {
          // Get the AI title from transcript
          const aiTitle = getAiTitle(data.sessionId, data.cwd);
          result.push({ ...data, aiTitle });
        }
      } catch (e) {}
    }
    return result;
  } catch (e) {
    return [];
  }
}

function getAiTitle(sessionId, cwd) {
  try {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, '-' + cwd.replace(/^\//, '').replace(/\//g, '-'));
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(transcriptPath)) return null;
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.type === 'ai-title' && d.aiTitle) return d.aiTitle;
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function generateSessionName() {
  const now = new Date();
  return `Chat ${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function createSession({ name = null, realSessionId = null, cwd = process.cwd() } = {}) {
  const sessionId = nextSessionId++;
  const sessionName = name || generateSessionName();
  const createdAt = Date.now();
  const clients = new Set();
  eventClients.set(sessionId, clients);

  const args = ['--dangerously-skip-permissions'];
  if (realSessionId) args.push('--resume', realSessionId);

  // Clean env: remove CLAUDE_CODE_CHILD_SESSION to fix "transcript saving off" warning
  // Keep model env vars so OmniRoute works (existing sessions work with them)
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_CHILD_SESSION;
  delete cleanEnv.CLAUDE_CODE_SESSION_ID;
  delete cleanEnv.CLAUDECODE;

  const ptyProcess = pty.spawn('claude', args, {
    name: 'xterm-color',
    cols: 80,
    rows: 40,
    cwd: cwd,
    env: cleanEnv
  });

  ptyProcess.onData((data) => {
    broadcast(sessionId, { type: 'output', data });
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    broadcast(sessionId, { type: 'exit', code: exitCode, signal });
    sessions.delete(sessionId);
    eventClients.delete(sessionId);
  });

  const session = { pty: ptyProcess, clients, name: sessionName, createdAt, history: [], realSessionId, cwd };
  sessions.set(sessionId, session);

  const initMsg = realSessionId
    ? `--- Resumed: ${sessionName} ---\n`
    : `--- Started: ${sessionName} ---\n`;
  session.history.push({ type: 'system', data: initMsg });
  broadcast(sessionId, { type: 'system', data: initMsg });

  return sessionId;
}

function broadcast(sessionId, event) {
  const clients = eventClients.get(sessionId);
  const session = sessions.get(sessionId);
  if (!clients) return;

  if (session) {
    session.history.push(event);
    if (session.history.length > 2000) session.history.shift();
  }

  const message = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try { client.write(message); } catch (e) {}
  }
}

function sendToClaude(sessionId, input) {
  const session = sessions.get(sessionId);
  if (session && session.pty && session.pty.write) {
    session.pty.write(input + '\n');
  }
}

function stopTask(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.pty && session.pty.write) {
    session.pty.write('\x03'); // Ctrl+C
    broadcast(sessionId, { type: 'system', data: '--- Interrupted (Ctrl+C) ---\n' });
  }
}

function killSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.pty) {
    try { session.pty.kill(); } catch (e) {}
  }
  sessions.delete(sessionId);
  eventClients.delete(sessionId);
}

// SSE endpoint
app.get('/api/stream/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const clients = eventClients.get(sessionId);
  if (!clients) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Send prompt
app.post('/api/send/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const { prompt } = req.body;
  if (!sessions.has(sessionId)) return res.status(404).json({ error: 'Session not found' });
  sendToClaude(sessionId, prompt);
  res.json({ ok: true });
});

// Interrupt task
app.post('/api/stop/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  if (!sessions.has(sessionId)) return res.status(404).json({ error: 'Session not found' });
  stopTask(sessionId);
  res.json({ ok: true });
});

// List REAL claude sessions from ~/.claude/sessions
app.get('/api/claude-sessions', (req, res) => {
  const real = getRealClaudeSessions();
  const openRealIds = new Set([...sessions.values()].map(s => s.realSessionId).filter(Boolean));
  const available = real.filter(s => !openRealIds.has(s.sessionId));
  res.json({ sessions: available });
});

// Create new session (optionally resume a real one)
app.post('/api/session/new', (req, res) => {
  const { name, realSessionId, cwd } = req.body || {};
  const sessionId = createSession({ name, realSessionId, cwd });
  const s = sessions.get(sessionId);
  res.json({ sessionId, name: s.name, realSessionId: s.realSessionId });
});

// List UI sessions
app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const [id, session] of sessions) {
    list.push({ id, name: session.name, createdAt: session.createdAt, active: !!session.pty, realSessionId: session.realSessionId, cwd: session.cwd });
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ sessions: list });
});

app.get('/api/session/:sessionId/history', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ history: session.history });
});

// Delete a UI session
app.delete('/api/session/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  if (!sessions.has(sessionId)) return res.status(404).json({ error: 'Session not found' });
  killSession(sessionId);
  res.json({ ok: true });
});

// Rename session
app.patch('/api/session/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const { name } = req.body;
  const session = sessions.get(sessionId);
  if (!session || !name) return res.status(404).json({ error: 'Session not found' });
  session.name = name;
  res.json({ ok: true, name });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});