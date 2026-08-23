# ♾️ Infinity AI

> **One AI. Infinite possibilities.**

Infinity AI is an all-in-one AI workspace built to bring conversation, research, coding, browsing, creativity, automation, and everyday tools into one place.

Instead of jumping between separate AI products for every task, Infinity gives you a single interface that can **think, research, build, browse, create, verify, act, and evolve**.

## ✨ What can Infinity do?

| Capability | Description |
| --- | --- |
| 💬 **Chat** | Stream natural conversations with an AI assistant. |
| 🎙️ **Voice** | Talk to Infinity and receive spoken responses. |
| 🔬 **Deep Research** | Perform multi-step web research and turn findings into detailed reports. |
| 🔨 **Build Mode** | Give the AI a coding task and let it work inside a real Linux workspace. |
| 🧬 **Evolving** | Infinity can inspect and modify its own codebase, allowing it to implement changes and evolve its capabilities. |
| 🌐 **Agent Browser** | Navigate real websites, click, type, scroll, and inspect pages. |
| 🎨 **Design Studio** | Edit, manipulate, and export images directly in the browser. |
| 🎵 **Music Studio** | Create and play compositions using browser-based audio. |
| 🛡️ **Fact Check** | Break answers into claims and verify them against web evidence. |
| 📊 **Data Lab** | Work with information through interactive tools and visualizations. |
| 📷 **Vision** | Analyze images and visual information. |
| 🧠 **Memory** | Keep useful long-term context and preferences. |
| 🧩 **Smart Widgets** | Turn requests into interactive interfaces such as timers, calculators, maps, and converters. |
| 🧑‍🔬 **Experts** | Create specialized AI personas with their own instructions and context. |

---

## 🧠 AI that does more than chat

Infinity is designed around **action over conversation**.

### 🔬 Deep Research

Give Infinity a complicated question and it can approach it as a research task instead of simply producing an answer.

The research workflow can:

1. Plan the investigation
2. Search the web
3. Analyze sources
4. Identify information gaps
5. Continue researching
6. Re-evaluate the direction of the investigation
7. Compile the findings into a final report

Research can also produce a persistent **Expert** grounded in the resulting findings.

### 🔨 Build Mode

Build Mode turns Infinity into a coding agent with access to a Linux workspace.

The agent can:

- Create files
- Read and modify existing files
- Execute shell commands
- Install packages
- Inspect project structure
- Run development tools
- Iterate on implementations

A built-in workspace file browser makes it possible to inspect the project while the agent works.

### 🧬 Evolving

**Evolving** is Infinity's ability to work on its own source code.

Rather than being limited to generating code for the user, Infinity can operate inside its own development environment and modify the codebase it runs from. This allows it to work toward improvements, fixes, new functionality, and architectural changes through its coding capabilities.

Evolving builds on Build Mode: the same ability that lets Infinity work inside a user's project can be used to work on **Infinity itself**.

This makes Infinity more than a coding assistant — it is designed to be a system that can **improve and expand itself over time**.

### 🌐 Agent Browser

Infinity can control a real browser to complete tasks rather than merely describing what a user should do.

The browser agent can:

- Navigate websites
- Read pages
- Click elements
- Type into forms
- Scroll
- Inspect screenshots
- Decide what to do next

---

## 🎨 Creative Studios

### Design Studio

A browser-based image workspace supporting features such as:

- Image uploads
- Image generation
- Filters
- Cropping
- Rotation and flipping
- Text overlays
- PNG export

Basic image manipulation runs client-side in the browser.

### Music Studio

Create original compositions directly in the browser with:

- Mood selection
- Drums
- Bass
- Plucks
- Pads
- Live Web Audio playback

---

## 🛡️ Fact checking

AI can be wrong. Infinity includes verification directly inside the AI workflow.

When an answer is fact-checked, Infinity can:

1. Extract individual claims
2. Search for supporting or contradicting evidence
3. Evaluate each claim
4. Produce individual verdicts
5. Show the relevant sources

Verification becomes part of the conversation instead of a separate tool.

---

## 🧩 Smart Widgets

Infinity can recognize when a request is better represented as an interactive tool.

Examples:

- **“What's the weather in London?”** → Live weather interface
- **“What's 15% of 200?”** → Calculator
- **“Set a timer for 5 minutes.”** → Countdown timer
- **“Convert 5 miles to kilometers.”** → Unit converter
- **“What time is it in Tokyo?”** → Live clock
- **“Where is Paris?”** → Map
- **“Show me an image of a dog.”** → Image search

The goal is simple: **the AI should choose the right interface for the task instead of returning everything as plain text.**

---

## 🧠 Memory & personalization

Infinity can maintain useful context across conversations and adapt the assistant experience around the user.

Supported personalization includes:

- Long-term memory
- Personality modes
- Custom system prompts
- Persistent preferences

---

## 🏗️ Architecture

Infinity AI is organized as a **pnpm monorepo**.

```text
Infinity-AI/
├── artifacts/
│   ├── infinity-ai/            # React + Vite frontend
│   └── api-server/        # Express backend
├── lib/
│   ├── api-client-react/  # Generated React API hooks
│   ├── api-spec/          # OpenAPI definitions
│   ├── api-zod/           # Generated Zod schemas
│   └── db/                # Database layer
├── docs/                  # Documentation
├── scripts/               # Development utilities
└── README.md
```

### Core stack

- React 19
- Vite 7
- TypeScript 5.9
- Tailwind CSS 4
- Framer Motion
- Express 5
- Drizzle ORM
- PostgreSQL
- Puppeteer
- NVIDIA NIM
- Whisper
- ElevenLabs
- Tavily

The frontend also includes CodeMirror-based editing, TensorFlow/MediaPipe vision tooling, React Markdown, and a large collection of Radix UI primitives.

---

## 🔌 Backend

The backend exposes dedicated systems for Infinity's major capabilities, including:

| Endpoint | Purpose |
| --- | --- |
| `/chat` | Streaming AI conversations |
| `/transcribe` | Speech-to-text |
| `/speak` | Text-to-speech |
| `/research` | Research jobs |
| `/verify` | Claim verification |
| `/terminal` | Workspace shell access |
| `/workspace` | Workspace file operations |
| `/generate-image` | Image generation |
| `/browse/agent-run` | Browser-agent execution |
| `/spotify` | Spotify integration |
| `/gmail` | Gmail integration |

---

## 🚀 Getting started

### Requirements

- Node.js
- pnpm
- PostgreSQL
- API credentials for the services you want to enable

### Installation

```bash
git clone https://github.com/kasper-kal/Infinity-AI.git
cd Infinity-AI
pnpm install
```

Configure your environment variables, initialize the database, and start the development environment:

```bash
pnpm --filter @workspace/db run push
sh scripts/start-dev.sh
```

The frontend runs on:

```text
http://localhost:5173
```

> **Note:** Infinity has multiple optional integrations. You only need credentials for the services required by the features you want to use.

---

## 🔑 Environment variables

Depending on the features you enable, Infinity can use:

| Variable | Service |
| --- | --- |
| `DATABASE_URL` | PostgreSQL |
| `DATABASE_URL_FILES` | Optional file metadata database |
| `B2_KEY_ID` | Backblaze B2 |
| `B2_APPLICATION_KEY` | Backblaze B2 |
| `B2_BUCKET_NAME` | Backblaze B2 |
| `R2_ACCOUNT_ID` | Cloudflare R2 |
| `R2_ACCESS_KEY` | Cloudflare R2 |
| `R2_SECRET_KEY` | Cloudflare R2 |
| `R2_BUCKET` | Cloudflare R2 |
| `OPENAI_LLM_API_KEY` | LLM / vision provider |
| `OPENAI_WHISPER_API_KEY` | Whisper |
| `NVIDIA_IMAGE_API_KEY` | Image generation |
| `ELEVENLABS_API_KEY` | Text-to-speech |
| `TAVILY_API_KEY` | Web search |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |

Never commit real credentials or secrets to the repository.

---

## 🛠️ Development

### Type checking

```bash
pnpm run typecheck
```

### Production build

```bash
pnpm run build
```

### Development server

```bash
sh scripts/start-dev.sh
```

---

## 🗺️ Philosophy

Infinity AI is built around a few principles:

**One workspace** — AI capabilities shouldn't be scattered across dozens of applications.

**Action over conversation** — The best AI isn't only capable of explaining how to do something. It should be capable of doing it.

**Evolution over stagnation** — Infinity should be capable of improving itself rather than remaining permanently fixed at the moment it was built.

**Tools should feel native** — Research, coding, browsing, images, music, and utilities should feel like parts of the same product.

**The interface should adapt to the task** — A calculator should look like a calculator. A timer should look like a timer. A research report should look like a research report.

---

## 📚 Documentation

Additional project documentation and development notes are available throughout the repository, including:

- [`docs/`](./docs)
- [`KNOWLEDGE.md`](./KNOWLEDGE.md)
- [`BUILD_MODE_COMPLETION_PLAN.md`](./BUILD_MODE_COMPLETION_PLAN.md)
- [`CLAUDE.md`](./CLAUDE.md)

---

## 🤝 Contributing

Infinity AI is an evolving project. Bug reports, ideas, improvements, and contributions are welcome.

For significant changes, opening an issue first is recommended so the approach can be discussed before implementation.

---

## 📄 License

Infinity AI is released under the **MIT License**.

You are free to use, modify, distribute, and build upon the project in accordance with the license.

---

<div align="center">

# ♾️ Infinity AI

**One AI. Infinite possibilities.**

</div>
