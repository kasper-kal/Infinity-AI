# infinity-ai — Complete Project Map

Deep analysis of every page, panel, overlay, widget, and API endpoint.
Generated 2026-08-08. Single-page app: `/` routes to `Home` (`pages/home.tsx`, 1982 lines);
everything else is a mode, panel, overlay, or PiP window inside it.

---

## 1. The App Shell (`App.tsx`, `main.tsx`, `index.css`)

- **Router**: `wouter` — one route `/` → `<Home/>`; anything else shows a "SYSTEM FAULT: MODULE NOT FOUND" screen. Base URL from Vite `BASE_URL`.
- **Providers**: `QueryClientProvider` (React Query), `TooltipProvider` (Radix), `LanguageProvider` (i18n, `en` + `nl`), global `<Toaster/>`.
- **Theme**: Tailwind v4 + `tw-animate-css`. Self-hosted **SF Pro Display / Rounded** woff2 fonts (9 weights each). Apple devices get system SF via `platform-apple` class.
- **Accent system**: 5 accents (blue/green/purple/orange/pink) applied pre-paint via `applyStoredAccent()` (CSS variables), persisted in localStorage. Themes: system/light/dark.
- **Modes** (`type Mode`): `voice` | `chat` | `agent` | `camera`. `agent` is a research-style chat with web search on.

## 2. Home — Main Page Layout (`pages/home.tsx`)

The header bar + mode-based body:

**Header** (top):
- Hamburger (`PanelLeft`) — opens sidebar (mobile/desktop).
- Title "infinity-ai" (voice/chat modes).
- Mode nav: **Voice / Chat / Agent / Camera** (labelled as Chat, Browser, Camera in sidebar nav).
- `New Chat` button (`SquarePen`).
- `GroupSettings` (collab) and `ConversationActions` (share/files/search/project/pin) dropdowns — only when a conversation is active.
- Right side: settings gear, theme toggle.

**Body by mode:**
- **Camera mode**: full-screen `CameraFeed` with object detection overlay + interactive highlight, PiP browser/camera toggles.
- **Voice mode**: `TimerStrip` (if timers live) → compact Alarm/Timer widgets → the **Orb** (tap to record) with status rings/waveform → emotion badge → "Stop speaking" pill → toggle row for agent/browser/camera PiP → widget panel OR compact conversation-history strip → live subtitle transcript.
- **Chat/Agent mode**: `TimerStrip` → mobile widget strip → `ConversationFeed` → input composer bar → `PlusMenu` popover.

**Input composer** (chat): `+` button (opens PlusMenu), thinking toggle (💡), agent toggle, textarea (grows, Enter=send, Shift+Enter=newline), mic dictation button (voice-input), Send button. `@` triggers PlusMenu with context query.

**PiP floating windows** (draggable): `infinity-aiBrowser`, `ScreenShare` (when sharing), camera PiP.

**Modals/overlays** via `AppOverlays`: Settings, ErrorDetail, ResearchPanel, GemDialog, DataLab, CommandPalette, DesignStudio, MusicStudio, StudiosHub, BuildStudio.

## 3. Sidebar (`chat-sidebar.tsx` + `project-gallery.tsx`)

- Header: "infinity-ai" title + circular search-focus button.
- Nav links: Chat / Browser / Camera (switch modes).
- **ProjectGallery**: expandable **Projects** list (create/archive/color, chats per project) and **Gallery** of uploaded files (search + filter by kind, opens file viewer).
- **Search input**: `GET /api/infinity-ai/conversations/search?q=` (searches titles AND message contents — "episodic memory").
- **Conversation list** grouped Today / Yesterday / Previous 7 Days / Older; each row: title, relative time, hover actions (rename ✏️, delete 🗑️). Clicking the active conversation's delete shows a 2-step confirm.
- Footer: **Clear All** (with confirm dialog) or "Memory Active" text; **Settings** button.
- Mobile: slides in as a drawer with backdrop; closes on nav/selection.

## 4. Conversation Feed (`conversation-feed.tsx`)

`ChatMessage` shape: `{ id, role: 'user'|'assistant', content, file?, widget?, timestamp?, image?, pendingImage?, pendingScreenShare?, pendingAgentBrowser?, pendingSourceCode?, pendingBuildMode?, terminalResults?, fileEdits?, reasoning?, verify? }`.

Rendered message variants:
- **User**: avatar, content, optional attached-file chip (image preview + name).
- **Assistant thinking**: collapsible `ThinkingBlock` (reasoning chain, 💡 "Thinking").
- **Markdown body**: GFM via react-markdown + remark-gfm.
- **HTML artifact**: a ```html fenced block renders in an iframe (`ArtifactPreview`).
- **Widgets**: `InlineWidget` switch → all 14 widget cards (clock, weather, timer, alarm, calendar, images, date, calculator, define, unit, currency, map, random, music).
- **Generated image**: `image` base64 data URL rendered inline.
- **Image request flow**: `pendingImage` → `ImageConfirmationCard` (prompt + Confirm/Cancel) → `ImageGeneratingCard` (loading) → final image.
- **Screen share flow**: `pendingScreenShare` → `ScreenShareConfirmationCard` → shares.
- **Agent browser flow**: `pendingAgentBrowser` → `AgentBrowserConfirmationCard` (goal input) → PiP browser runs.
- **Source code flow**: `pendingSourceCode` → `SourceCodeConfirmationCard` ("USE SOURCE CODE?" / "SKIP CODE") → infinity-ai reads own code.
- **Build mode flow**: `pendingBuildMode` → `BuildModeConfirmationCard` → Build Studio opens.
- **Terminal commands**: `terminalResults[]` → `CommandCard` (command + exit code + output, copy/download).
- **File edits**: `fileEdits[]` → `FileEditCard` (path, bytes written, diff).
- **Fact check**: `verify` → verdict chips (supported/contradicted/unverifiable) with evidence links.
- **Suggestions**: follow-up chips below the last assistant message (tap to send).
- Scroll-to-bottom pill when scrolled up; rich empty state (welcome + example prompts).

## 5. Studios Hub (`studios-hub.tsx`) — opened from + menu "All Studios" or Cmd+K

Nine studios, each with icon tile + tagline + "Replaces" caption:
Chat, Voice, Camera, Deep Research, Build Mode, Design Studio, Music Studio, Fact Check, Data Lab. Tapping switches mode or opens the matching overlay.

## 6. Command Palette (`command-palette.tsx`) — Cmd+K

- Fuzzy search box, keyboard nav (↑↓, Enter), search results overlay (debounced `GET /api/infinity-ai/conversations/search`).
- Action list: Chat, Voice, Webcam, Web Search (toggle), Deep Research, New Gem, Data Lab, Light/Dark, Settings, New Chat.

## 7. Plus Menu (`plus-menu.tsx`) — `+` in composer

Actions: Attach File 📎 (base64 upload), Camera 📷, New Gem ✨, Generate Image 🖼️, All Studios 🧭, Design Studio 🎨, Music Studio 🎵, Thinking toggle 💡, Agent mode, Web Search, Screen Share, Build Mode, Deep Research, Data Lab. Viewport-relative positioning that flips above/below.

## 8. Settings Panel (`settings-panel.tsx`) — 5 sections

**Customize**: Personalization (personality: balanced/talkative/helpful/concise/custom prompt), Memory (list/edit/delete user memories from `userMemories` table), Language (en/nl).
**Account**: email, connect Google (Gmail+Calendar OAuth, `/api/infinity-ai/gmail`), connect Spotify, sign out.
**Theme**: appearance system/light/dark, accent color (5 swatches).
**App Settings (Web Search & Data)**: web search toggle (Tavily), weather location, 5 manual calendar feeds (name + ICS URL), **LLM Keys** manager (add key: name, base URL, model; test/priority/enable/disable/delete; shows status + cooldown), user profile text.
**Help**: Report a Problem, Help Center, About, Sign Out.

## 9. Build Studio (`build-studio.tsx`) — Build Mode / "Linux workspace infinity-ai codes in"

Toolbar: back, workspace selector (path dropdown), **Run/Pause/Stop** (preview server), **Iterate** (AI fix loop), Plan, walkthrough, save/restore app, terminal toggle.

**13 tabs** (left rail): `editor` (CodeMirror 6 file tree + editor, save/Cmd+S, hot-reload toggle), `terminal` (persistent session), `preview` (dual-viewport: responsive + browser-agent that inspects/decides/acts), `packages` (package-manager), `env` (env-manager), `git`, `search` (grep + replace), `quality` (tests + debug), `history` (checkpoints/snapshots), `templates` (scaffold), `docker`, `database`, `api` (API explorer).

**Build flow**: user request → `POST /api/infinity-ai/build/ask` → `POST /api/infinity-ai/build/iterate` runs an unlimited AI loop (iteration-controller) → terminal commands run live, output streamed as command cards → "Fix" prompt re-runs → completion summary with deferred items + changed files. Hot reload via SSE. Apps saved to Gallery (`POST /api/infinity-ai/build/apps`).

## 10. Design Studio (`design-studio.tsx`)

Image editor on a canvas with layers (`image`/`text`/`shape`). Tools: upload image, add text (font size/color), add shapes (rectangle/circle, fill), move/resize/rotate/opacity/z-order, 8 CSS filters (brightness, contrast, saturate, hue, blur, grayscale, sepia, invert), crop presets (Free/1:1/4:3/…), flip horizontal, zoom. Export/download PNG. Runs fully client-side (canvas).

## 11. Music Studio (`music-studio.tsx`)

Generates original compositions from a text prompt + mood (happy/chill/epic/sad). Client-side seeded-RNG music theory (scale/chords/bass/melody/drum pattern per mood) → rendered by `MusicWidget` as an interactive piano-roll with play/pause and export/download. History of generated tracks.

## 12. Data Lab (`data-lab.tsx`)

CSV/TSV/`;` paste or file upload → parses up to 5000 rows → **auto-statistics** (numeric columns: min/max/mean/sum/count), **bar chart** (Recharts, column picker, top-N), **data table**. "Ask infinity-ai to analyze" sends a summary to chat.

## 13. Deep Research (`research-panel.tsx` + server `research-engine.ts`)

- **Depth levels**: standard (~5–12h), deep (~1–3d), quantum (~1w+), omni (~weeks, never truly ends). Modes: agent/normal/both.
- Job states: queued → running (progress %, phase, live log, notes) → completed/failed/cancelled.
- UI: new research form (topic, mode, depth), live job cards with phase log + cancel, time estimate, **"Open Gem"** once finished.
- Server loop: plans phases → searches web (Tavily) → writes notes → critiques gaps → replans → grows until depth reached → writes a report → spawns a **Gem** (an expert conversation with the report as system prompt) via web push when done.

## 14. Gem Dialog (`gem-dialog.tsx`)

Create a custom assistant persona: name + system prompt → `POST /api/infinity-ai/conversations/gem` → opens as a new conversation (kind=`gem`, uses its own system prompt instead of the infinity-ai default).

## 15. infinity-ai Browser (`infinity-ai-browser.tsx` + server `puppeteer-browser.ts`)

PiP window showing **live screenshots of a real headless Chrome** streamed over WebSocket. Controls: URL bar + go, back/forward/refresh, **agent mode** (goal → vision LLM drives the browser using a fine-grid click system, live step log), pause/resume, grid toggle, minimize, fullscreen. Backend: `POST /api/infinity-ai/browse/agent-run`, `/action`, `/fetch`, `/pause-state`, `/ws-url`.

## 16. Camera & Interactive Mode

- **`camera-feed.tsx`**: react-webcam live feed, front/rear camera flip, **TensorFlow.js COCO-SSD** object detection (80 classes, runs in-browser, free), bounding-box canvas overlay, snapshot capture, error card with Retry + "upload a photo instead" fallback.
- **`interactive-overlay.tsx`**: animated highlight circles around detected objects; voice commands "highlight/circle/find X".
- **`screen-share.tsx`**: getUserMedia screen capture shared to infinity-ai (frame every 1s); voice annotation commands ("annotate X, label").
- **`orb.tsx`**: the voice orb with 6 states — `idle`, `wake`, `recording` (red rings), `transcribing`, `thinking`, `speaking` (green rings + amplitude-reactive particles + 7-bar waveform).

## 17. Voice / Speech stack

- `use-audio-recorder` → `POST /api/infinity-ai/transcribe` (NVIDIA NIM Whisper large-v3).
- `use-speech-recognition` (Web Speech API) + `use-wake-word` (wake word detection) + `use-clap-detection` (audio-level clap) — hands-free.
- `use-emotion-detection` — sentiment of the last reply (badge under orb).
- TTS: `useSynthesizeSpeech` → `POST /api/infinity-ai/speak` (ElevenLabs, British male default). Timers via `use-timer-orchestration` (server-side durable timers + strip).

## 18. Widgets (14) + cards — `/api/infinity-ai/widget-detector` on the server

clock (timezones), weather (Open-Meteo, forecast), timer (set/add/cancel, parse natural durations), alarm, calendar (ICS feeds + Google Calendar), images (NVIDIA image search), date, calculator (safe expression parser), define (dictionary API), unit converter, currency (exchange rate), map (OpenStreetMap), random (dice/coin/number), music (composition). Plus `CommandCard` (terminal result) and `FileEditCard`. Detection is regex-intent first (`detectIntent`), LLM-assisted fallback (`detectWidgetIntentWithLLM`).

## 19. Collabora / Group chat (`group-settings.tsx` + server `groups.ts`, `collab.ts`, `crdt.ts`)

- **Groups**: create group per conversation, kind AI/human, AI replies always-or-on-mention, invite code (copy), join by code, members list with personas, leave. Auth: local accounts (`POST /api/infinity-ai/accounts/signup|login|logout`, `GET /accounts/me`).
- **Collab**: cursor/selection/preview/terminal sharing across users (`POST /api/infinity-ai/collab/*`), CRDT-based file sync, file export.

## 20. Conversation Actions (`conversation-actions.tsx`)

Dropdown per conversation: **Share** (public link, `/api/infinity-ai/conversations/:id/share`), **Pin/Unpin** (`/pin`), **Files** (list chat attachments), **Search within** chat, **Add to Project** (`/api/infinity-ai/projects`), **Export** chat to `.txt` (client-side).

---

## 21. Backend API Map (Express, `/api/infinity-ai/*`; 49 route modules)

**Core voice/chat**: `POST /chat` (SSE stream), `POST /transcribe` (Whisper), `POST /speak` (TTS), `POST /generate-image` (Flux via NVIDIA), `GET /code` (infinity-ai reads own source).
**Conversations**: `GET/POST/DELETE /conversations`, `GET /conversations/:id`, `GET /conversations/search`, `POST /conversations/gem`, pin/share, `DELETE /conversations`.
**Settings/memory/keys**: `GET/PUT /settings`, `GET /system-prompt`, `GET/PATCH/DELETE /memories/:topic`, `GET/POST/PUT/DELETE /llm-keys`, `GET/PUT/DELETE /secrets/:key`.
**Build system**: `/build/ask|iterate|plan|scaffold|preview/start|stop|agent|status`, `/build/screenshot`, `/build/walkthrough`, `/build/apps` (+ restore), `/build/env`; `/terminal` (stream/start/stop/reset), `/hot-reload/*` (SSE events), `/packages` (install/uninstall/search), `/package` (editor), `/git/*`, `/search` (+ replace), `/test/*`, `/debug/*`, `/history/*` (snapshots), `/templates` + `/community-templates`, `/docker/*`, `/database/*`, `/api-explorer/*`, `/migrations/*`, `/env/*`, `/config/*`, `/import/*`, `/export/*`, `/e2e/*`, `/performance/*`, `/security/*`, `/accessibility/*`, `/compatibility/*`.
**Research**: `POST /research`, `GET /research`, `GET /research/:id`, `GET /research/estimate`, `POST /research/:id/cancel`.
**Browser**: `/browse/*` (agent-run, action, fetch, pause, ws-url).
**Integrations**: `/gmail/*` (OAuth + status/disconnect), `/spotify/*` (auth/current/control), `/push/*` (VAPID + subscribe).
**Files/workspace**: `/files` route module (list/upload/download), `/workspace` (create/patch/delete/mkdir), `/projects` + `/project-tags`, `/groups` + `/accounts` + `/collab`.
**Misc**: `/timers` (CRUD + pause/resume/extend/cancel), `/verify` (fact-check), `/search` (Tavily), `/health`.

## 22. Chat pipeline (server `chat.ts`, 1369 lines)

1. Intent pre-classification: `capability-intent.ts` → timer / image_generation / screen_share / agent_browser / build → server immediately emits the matching confirmation event (`image_request_detected`, `screen_share_detected`, `agent_browser_detected`, `build_mode_detected`).
2. Widget detection: `widget-detector.ts` (regex → LLM fallback) → hydrates data (weather, currency, calendar, images…) → attached to reply.
3. Live context (`live-context.ts`): time/date/weather/calendar/memories/user profile/personality modifier.
4. Tools: `run_terminal` (live shell, streams `terminal_result`), `read_source_code` / `write_source_file` (emits `file_edit`), `fetch_figma_design` (emits `figma_design`). Tool-call markers parsed from the raw reply via `tryParseToolDispatch`.
5. LLM: `llm-client.ts` — multi-key pool (env `OPENAI_LLM_API_KEY` + DB keys), priority ordering, per-error-class quarantine (401/403→24h, 429/quota→45m, bad model→30m, transient→5m), auto cross-key retry (10 attempts × 10s cooldown). **Chat/voice use manual mode**: one attempt, then on failure the client shows a "retry key / move to next key" prompt (`llm_manual_retry` SSE error).
6. **SSE event types**: `delta` (token), `thinking`, `widget`, `suggestions`, `follow_up`, `terminal_result`, `file_edit`, `figma_design`, `done`, `error` (incl. `llm_manual_retry`), plus the 4 `*_detected` confirmations.
7. Reply persisted (role, content, reasoning), title auto-generated, conversation saved; memory upserted (`user_memories` keyed by topic); web-push sent when research/background jobs finish.

## 23. Data model (Postgres via Drizzle, `@workspace/db`)

`conversations` (kind: chat|gem, systemPrompt), `messages` (role, content, reasoning, cascade), `infinity-ai_settings` (key/value), `user_memories` (topic upsert), `llm_keys`, `secrets`, `timers`, `projects`, `groups` + members/invites/accounts, `files`, `research_jobs`, `gmail_tokens`, `spotify_tokens`, `push_subscriptions`, `build_apps`.

## 24. Notables / caveats

- **Free/0€ constraint**: NVIDIA NIM (LLM + vision + Whisper + Flux image), Open-Meteo, Tavily, ElevenLabs free tier, OpenStreetMap, dictionary APIs, web push self-hosted. TensorFlow.js COCO-SSD in-browser.
- **Recent QA findings** (from `dba2bd6`): menu crash, `@Build` not implemented, LLM 500 — some may still be open.
- `config/infinity-ai.ts` (server) holds LLM model (`openai/gpt-oss-120b`), image model, Whisper function ID, ElevenLabs voice/model, and the full infinity-ai system prompt (persona: calm, precise, British; concise spoken replies).
