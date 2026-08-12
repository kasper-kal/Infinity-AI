# 🟢 Jarvis — Your Personal AI Voice Assistant

A polished, all-in-one AI assistant — **talk to Jarvis, chat with it, have it research deep topics, build code, edit photos, compose music, fact-check answers, and more.** Built as a monorepo with a React frontend, Express API backend, and PostgreSQL database.

> **One app to replace: ChatGPT · Gemini · Grok · Claude · Replit · Claude Code · Suno · Canva · Snopes — and more.**

---

## ✨ Features

### 🎙️ Voice & Chat
- **Voice mode** — press the mic, speak, Jarvis answers out loud (Whisper STT → LLM → ElevenLabs TTS, British male voice)
- **Chat mode** — streaming markdown conversations with SSE token-by-token output
- **Wake word + clap detection** — hands-free activation (Chrome/Edge)
- **Thinking mode** — Jarvis reasons privately first, shown in a collapsible `>` block before answering
- **Agent mode** — research-style answers with live web search via Tavily

### 🧭 Studios Hub (Cmd+K or + menu → All Studios)
An organized launcher for every capability — no overwhelming menus:

| Studio | Replaces |
|---|---|
| **Chat** | ChatGPT · Gemini · Grok · Claude |
| **Voice** | Siri · Alexa · Google Assistant |
| **Camera** | Google Lens |
| **Deep Research** | Perplexity · ResearchGPT |
| **Build Mode** | Replit · Claude Code · Cursor |
| **Design Studio** | Canva · Photo editors |
| **Music Studio** | Suno · Udio |
| **Fact Check** | Snopes · Fact-check sites |
| **Data Lab** | Excel AI · NotebookLM |

### 🔬 Deep Research
Multi-hour autonomous investigations: Jarvis plans phases, searches the web (Tavily), critiques gaps, replans, and grows its knowledge over time. Produces a definitive report and spawns a **Gem** — an expert persona chat grounded in the research dossier.

### 🔨 Build Mode
A Linux workspace Jarvis can code in. The AI runs shell commands, creates files, and shows output in clean minimal **command cards** (no raw terminal clutter). Includes a file browser for the workspace.

### 🎨 Design Studio
Client-side photo editor — upload or generate an image, then apply filters, crop, rotate, flip, add text, and download as PNG. Fully in-browser.

### 🎵 Music Studio
Compose original tracks — pick a mood (Happy/Chill/Epic/Sad) and listen to a live Web Audio composition with pads, bass, plucks, and drums. 100% free, no server needed.

### ✅ Fact Check
Every assistant message has a **ShieldCheck** button. Tap it and Jarvis splits the answer into claims, searches each against the web (Tavily), and shows per-claim verdicts with source links.

### 🧮 Smart Widgets
Auto-detected from conversation and rendered inline:

| You say... | Widget |
|---|---|
| "what's the time" / "time in Tokyo" | Live clock with ticking seconds |
| "weather in London" | Weather card (Open-Meteo, no API key) |
| "set a timer for 5 minutes" | Live countdown timer |
| "what's 15% of 200" | **Interactive calculator** — real keypad, not just the answer |
| "convert 5 miles to km" | Unit converter (length, weight, temp, etc.) |
| "convert 100 usd to eur" | Currency converter (live rates, open.er-api.com) |
| "where is Paris" | Map widget (OSM embed) |
| "show me an image of a dog" | Real web images (Flickr/Wikimedia via Openverse) |
| "define serendipity" | Dictionary (dictionaryapi.dev) |
| "roll a dice" / "flip a coin" | Animated random generator |
| "compose me a happy song" | Music composition player |

### 🤖 Agent Browser
Give Jarvis a goal and it drives a real, visible browser — looking at screenshots, clicking, typing, scrolling, navigating step by step via a vision LLM.

### 🗃️ Long-term Memory
Jarvis remembers facts about you, supports 8 personality modes, custom system prompts, and reveals its identity as **Jarvis, built by Stark Industries** (never the real model name).

---

## 🏗️ Architecture

Monorepo with **pnpm workspaces**:

```
├── artifacts/
│   ├── jarvis/            # React + Vite frontend
│   └── api-server/        # Express 5 backend (port 8080)
├── lib/
│   ├── api-client-react/  # Generated React hooks (OpenAPI)
│   ├── api-spec/          # OpenAPI contract
│   ├── api-zod/           # Generated Zod schemas
│   └── db/                # Drizzle ORM + PostgreSQL schema
└── scripts/
```

**Stack:** React 19 · Vite 7 · TypeScript 5.9 · Tailwind CSS 4 · Framer Motion · Express 5 · Drizzle ORM · Neon PostgreSQL · NVIDIA NIM · Puppeteer

### Key backend routes

| Route | Purpose |
|---|---|
| `/chat` | Streaming LLM conversation (SSE) |
| `/transcribe` | Whisper speech-to-text |
| `/speak` | ElevenLabs TTS |
| `/research` | Deep research job management |
| `/verify` | Tavily fact-check of a message |
| `/terminal` | Linux shell in sandboxed workspace |
| `/workspace` | Build Mode file listing |
| `/generate-image` | Flux image generation |
| `/browse/agent-run` | Autonomous agent browser loop |
| `/spotify` · `/gmail` | OAuth integrations |

---

## 🚀 Getting Started

```bash
pnpm install
cp .env.local .env   # fill in your API keys
pnpm --filter @workspace/db run push
sh scripts/start-dev.sh
```

Open **http://localhost:5173**.

| Command | Purpose |
|---|---|
| `pnpm run typecheck` | Typecheck all workspaces |
| `pnpm run build` | Typecheck + build everything |

---

## 🔑 Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `DATABASE_URL_FILES` | Optional separate PostgreSQL connection string for Gallery metadata |
| `B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET_NAME` | Optional Backblaze B2 S3-compatible Gallery storage; endpoint defaults to `https://s3.eu-central-003.backblazeb2.com` |
| `B2_ENDPOINT` / `B2_REGION` | Optional Backblaze endpoint/region overrides; defaults to `eu-central-003` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY` / `R2_SECRET_KEY` / `R2_BUCKET` | Optional Cloudflare R2 fallback; no cloud keys means local `data/files/` storage |
| `OPENAI_LLM_API_KEY` | NVIDIA NIM — LLM + vision |
| `OPENAI_WHISPER_API_KEY` | NVIDIA NIM — Whisper large-v3 |
| `NVIDIA_IMAGE_API_KEY` | NVIDIA NIM — Flux image generation |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS |
| `TAVILY_API_KEY` | Tavily web search (research + fact-check) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (Gmail/Calendar) |

---

## 🤖 Agent Workflow

This repository includes an `AGENTS.md` file at the repo root. Automation agents should read it before making changes; it mirrors the Claude Code routine and documents the required session handoff files, zero-euro budget rule, and commit/push workflow.

For project continuity, keep these files aligned with the current state when work changes:

| File | Purpose |
|---|---|
| `AGENTS.md` | Repo-level instructions for coding agents working in this tree |
| `CLAUDE.md` | Claude Code routine copied into `AGENTS.md` for tool compatibility |
| `session-brief.md` | Live handoff: latest action, current project state, change record, next actions |
| `KNOWLEDGE.md` | Durable project knowledge and conventions that should survive between sessions |


---

## 📄 License

MIT — free to use, modify, and extend.
