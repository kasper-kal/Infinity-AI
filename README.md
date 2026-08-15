♾️ Infinity AI

«One AI. Infinite possibilities.»

Infinity AI is an all-in-one AI workspace designed to bring conversation, research, coding, creativity, automation, and everyday tools into a single application.

Instead of switching between ChatGPT, Claude, Perplexity, Replit, Canva, Suno, Google Lens, and a dozen other tools, Infinity AI brings those experiences together under one interface.

---

✨ What is Infinity AI?

Infinity AI is built around a simple idea:

AI shouldn't be a collection of disconnected tools. It should be one environment that can actually get things done.

You can have a normal conversation, ask Infinity to research a complicated subject, build software, analyze information, edit images, generate music, operate a browser, verify claims, or use interactive tools — all from the same application.

Everything in one place

Capability| What it does
💬 Chat| Stream conversations with an AI assistant
🎙️ Voice| Talk naturally and receive spoken responses
🔬 Deep Research| Conduct multi-step web research and produce detailed reports
🔨 Build Mode| Give the AI a coding task and let it work inside a real Linux workspace
🌐 Agent Browser| Let the AI navigate websites using a real browser
🎨 Design Studio| Edit and manipulate images directly in the browser
🎵 Music Studio| Create and play original compositions
🛡️ Fact Check| Break answers into claims and verify them against web sources
📊 Data Lab| Work with information using interactive tools
📷 Camera| Analyze visual information
🧠 Memory| Maintain useful long-term context about the user
🧩 Smart Widgets| Turn natural-language requests into interactive UI
🧑‍🔬 Experts| Create custom AI personas or spawn them from deep research

---

🧠 AI That Can Actually Do Things

Infinity isn't limited to generating text.

🧑‍🔬 Experts

Create custom AI personas with your own system prompts, or let Deep Research spawn a specialized Expert grounded in its findings. These persistent conversations carry their own context and behave as dedicated specialists — quantum engineers, legal analysts, creative writers, or any domain you define.

🔬 Deep Research

Give Infinity a complicated question and it can approach it as a research task rather than simply answering from its existing knowledge.

The research system can:

1. Plan the investigation
2. Search the web
3. Analyze sources
4. Identify gaps
5. Continue researching
6. Re-evaluate the direction of the investigation
7. Compile the findings into a final report

Research can also produce a persistent Expert — an expert-style conversational interface grounded in the resulting research.

---

🔨 Build Mode

Build Mode turns Infinity into a coding agent.

The AI can work inside a Linux workspace where it can:

- Create files
- Read and modify existing files
- Execute shell commands
- Install packages
- Inspect project structure
- Run development tools
- Iterate on its implementation

Instead of dumping a terminal into the UI, commands and their output are presented through clean, focused command cards.

Build Mode also includes a workspace file browser and tooling specifically designed around autonomous software development.

---

🌐 Agent Browser

Infinity can control a real browser to complete tasks.

The browser agent operates visually, allowing it to:

- Navigate websites
- Read pages
- Click elements
- Type into forms
- Scroll
- Inspect screenshots
- Decide what to do next

This turns the AI from something that simply describes actions into something capable of performing them.

---

🎨 Creative Studios

Infinity includes dedicated environments for different kinds of creative work.

🎨 Design Studio

A browser-based image editor supporting operations such as:

- Uploading images
- Image generation
- Filters
- Cropping
- Rotation
- Flipping
- Text
- PNG export

The editor runs client-side, keeping basic image manipulation directly in the browser.

🎵 Music Studio

Create original music without requiring a dedicated external music service.

The Music Studio includes:

- Mood selection
- Drums
- Bass
- Plucks
- Pads
- Live Web Audio playback

The composition engine runs locally in the browser.

---

🛡️ Built-In Fact Checking

AI can be wrong.

Infinity includes a built-in verification workflow that lets you challenge an answer instead of simply trusting it.

When a response is fact-checked, Infinity can:

1. Extract individual claims
2. Search for supporting or contradicting evidence
3. Evaluate each claim
4. Present individual verdicts
5. Provide the relevant sources

This makes verification part of the conversation rather than a separate workflow.

---

🧩 Smart Widgets

Infinity can turn certain natural-language requests into interactive components.

For example:

«"What's the weather in London?"»

→ Live weather interface

«"What's 15% of 200?"»

→ Interactive calculator

«"Set a timer for 5 minutes."»

→ Live countdown timer

«"Convert 5 miles to kilometers."»

→ Unit converter

«"What time is it in Tokyo?"»

→ Live clock

«"Where is Paris?"»

→ Map

«"Show me an image of a dog."»

→ Image search

Other supported experiences include dictionaries, currency conversion, random generators, and music composition.

The goal is simple:

The AI doesn't just answer — it can choose the right interface for the task.

---

🎙️ Voice

Infinity supports conversational voice interaction.

The voice pipeline can combine:

Speech → Whisper → LLM → ElevenLabs → Speech

It also includes hands-free activation features such as wake-word and clap detection in supported browsers.

---

🧠 Memory & Personalization

Infinity can maintain long-term information and adapt the assistant experience around the user.

The system supports:

- Long-term memory
- Multiple personality modes
- Custom system prompts
- Persistent user preferences

This allows Infinity to behave more like a personal assistant than a stateless chatbot.

---

🏗️ Architecture

Infinity AI is structured as a pnpm monorepo.

Infinity-AI/
│
├── artifacts/
│   ├── jarvis/            # React + Vite frontend
│   └── api-server/        # Express backend
│
├── lib/
│   ├── api-client-react/  # Generated React API hooks
│   ├── api-spec/          # OpenAPI definitions
│   ├── api-zod/           # Generated Zod schemas
│   └── db/                # Database layer
│
├── docs/                  # Project documentation
├── scripts/               # Development and utility scripts
└── README.md

Core stack

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

---

🔌 Backend Capabilities

The API provides dedicated systems for the major AI capabilities.

Endpoint| Purpose
"/chat"| Streaming AI conversations
"/transcribe"| Speech-to-text
"/speak"| Text-to-speech
"/research"| Research jobs
"/verify"| Claim verification
"/terminal"| Workspace shell
"/workspace"| Workspace files
"/generate-image"| Image generation
"/browse/agent-run"| Browser agent
"/spotify"| Spotify integration
"/gmail"| Gmail integration

---

🚀 Getting Started

Requirements

You'll need:

- Node.js
- pnpm
- PostgreSQL
- The API credentials for the services you want to use

Installation

git clone https://github.com/kasper-kal/Infinity-AI.git
cd Infinity-AI

pnpm install

cp .env.local .env

Configure the required environment variables, then initialize the database:

pnpm --filter @workspace/db run push

Start the development environment:

sh scripts/start-dev.sh

The application will be available at:

http://localhost:5173

---

🔑 Environment Variables

Infinity can connect to several external services.

Variable| Service
"DATABASE_URL"| PostgreSQL
"DATABASE_URL_FILES"| Optional file metadata database
"B2_KEY_ID"| Backblaze B2
"B2_APPLICATION_KEY"| Backblaze B2
"B2_BUCKET_NAME"| Backblaze B2
"R2_ACCOUNT_ID"| Cloudflare R2
"R2_ACCESS_KEY"| Cloudflare R2
"R2_SECRET_KEY"| Cloudflare R2
"R2_BUCKET"| Cloudflare R2
"OPENAI_LLM_API_KEY"| LLM / vision provider
"OPENAI_WHISPER_API_KEY"| Whisper
"NVIDIA_IMAGE_API_KEY"| Image generation
"ELEVENLABS_API_KEY"| Text-to-speech
"TAVILY_API_KEY"| Web search
"SPOTIFY_CLIENT_ID"| Spotify OAuth
"SPOTIFY_CLIENT_SECRET"| Spotify OAuth
"GOOGLE_CLIENT_ID"| Google OAuth
"GOOGLE_CLIENT_SECRET"| Google OAuth

Not every integration is required to run the application. Configure the services corresponding to the features you want to use.

---

🛠️ Development

Type checking

pnpm run typecheck

Production build

pnpm run build

Development server

sh scripts/start-dev.sh

---

🗺️ Project Philosophy

Infinity AI is built around a few principles:

One workspace

AI capabilities shouldn't be scattered across dozens of applications.

Action over conversation

The best AI isn't only capable of explaining how to do something.

It should be capable of doing it.

Tools should feel native

Research, coding, browsing, images, music, and utilities should feel like parts of the same product rather than unrelated integrations.

The interface should adapt to the task

A calculator should look like a calculator.

A timer should look like a timer.

A research report should look like a research report.

The AI should be able to choose the appropriate interface instead of returning everything as plain text.

---

📚 Documentation

Project documentation and development notes can be found throughout the repository.

Useful areas include:

- ""docs/"" (./docs)
- ""KNOWLEDGE.md"" (./KNOWLEDGE.md)
- ""BUILD_MODE_COMPLETION_PLAN.md"" (./BUILD_MODE_COMPLETION_PLAN.md)
- ""CLAUDE.md"" (./CLAUDE.md)

---

🤝 Contributing

Infinity AI is an evolving project.

Contributions, ideas, bug reports, and improvements are welcome.

If you're working on a significant change, consider opening an issue first so the approach can be discussed before implementation.

---

📄 License

Infinity AI is released under the MIT License.

You are free to use, modify, distribute, and build upon the project in accordance with the license.

---

<div align="center">♾️ Infinity AI

One AI. Infinite possibilities.

</div>
