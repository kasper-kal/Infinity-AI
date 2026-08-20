# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-20 03:55

## Just did (last action)
- **Phase 20: Deep Research v2 — COMPLETE (100%):**
  - **Verified full implementation exists**: Engine (`deep-research-v2.ts`), API routes (`deep-research-v2.ts` router: POST /start, GET /status/:id, GET /stream/:id SSE, POST /cancel, POST /:id/expert), frontend widget (`DeepResearchWidget.tsx` with live SSE progress + final report renderer), chat command detection (`@Deep Research <topic>` in chat.ts), widget type wiring (types/widget.ts, widgets/index.ts, conversation-feed.tsx), i18n keys (EN + NL), db schema (`researchJobsV2` + `researchSourcesV2`).
  - **CRITICAL FIX — runtime DB tables missing**: `auto-migrate.ts` (the real bootstrap) did NOT create `research_jobs_v2` / `research_sources_v2` even though they were in the Drizzle schema. Added both CREATE TABLE + indexes to auto-migrate.ts so the engine actually works at runtime. This was the blocking gap.
  - **FIX — chat handler jobId mismatch**: chat.ts read `drData.jobId` but the route returns `job.id`. Corrected to `drData.id`.
  - **FIX — "Create Expert" button never rendered**: `onDeepResearchExpert` prop was optional and never supplied through the active chat path. Threaded it through `chat-mode-view.tsx` → `ConversationFeed` and wired `home.tsx` `ChatView` usage to call `loadConversation(convId)` + `setMode('chat')`. (AppShellRouter's `/app/*` ChatView already passed it through.)
  - **Typecheck + build pass** on all packages ✅
- **Phase 19: Local Model Integration — COMPLETE:**
  - Added `apply_fix` tool to build-tools.ts for applying local model fixes
  - Created ErrorBoundary component with "Fix with Local AI" button for any React error
  - Wrapped App with ErrorBoundary in App.tsx
  - Local model already integrated in build-agent verification loop and build-studio toast
  - All requirements checked off in PHASES.md

- **Phase 17: Project Types System — COMPLETE (100%):**
  - **Plugin system for custom project types implemented:**
    - Backend: `artifacts/api-server/src/lib/project-type-plugins.ts` — Auto-discovers JSON/YAML files in `.infinity/project-types/`, validates with Zod, merges with built-in types, hot-reload via file watcher
    - API routes added to `project-types.ts`: GET /plugins, POST /plugins/reload, GET /plugins/directory, POST /plugins/create, DELETE /plugins/:id
    - Frontend: `artifacts/jarvis/src/lib/project-types.ts` — async functions to load custom plugins from API, getAllProjectTypesWithPlugins(), getProjectTypeWithPlugins(), validateProjectTypeWithPlugins(), createPluginTemplate(), deleteCustomPlugin()
    - Example plugin template auto-created on first run
  - **All requirements now checked off** — Type Registry, Project Creation, Type-Specific UI (6 ProjectHome components), Type-Specific Tools (real Tavily+LLM), Persistence (DB migration done), **Extensibility (Plugin System)**
  - **Typecheck + build pass** on all packages

- **Phase 18: Promo Maker — COMPLETE (100%):**
  - **Core engine** (`promo-maker.ts`): Full Puppeteer orchestrator with script planner, frame recorder, ASMR audio generator (Web Audio API), video assembler (FFmpeg), speed optimizer
  - **Aesthetic cursor**: Spring-physics (mass/damping/stiffness), click ripple, trails, state-aware cursors
  - **ASMR audio**: Generated via Web Audio API — clicks, typing, whoosh, ambient
  - **Text overlays**: Animated captions with fade-in/out, positioning
  - **Smart timing**: LLM reviews recording → re-renders slow sections at 2-4x with frame blending
  - **Output**: MP4 (H.264) + WebM (VP9), 1080p/4K, 15-120s configurable
  - **Frontend widget** (`PromoWidget.tsx`): Progress stages, video player, download/share
  - **API routes** (`promo.ts`): Create, status, download, thumbnail, jobs, delete, retry
  - **Company project integration** (`ProjectHomeCompany.tsx`): "Create Promo Video" button
  - **Chat command** (`@Promo <url> <description>`): Detects + emits widget with progress
  - **Typecheck + build pass** ✅
- **Phase 16: Infinity Maps Widget COMPLETE** — Interactive maps widget for location queries ("where should I eat", "find coffee near me", "pizza places nearby"):
  - **Backend** (`maps.ts`): Overpass API + Nominatim integration with in-memory caching (5min TTL) and rate limiting (30 req/min per IP). Routes: GET /search (places), GET /geocode (location query), POST /detect (trigger detection from chat).
  - **Frontend** (`MapsWidget.tsx`): Leaflet + react-leaflet + react-leaflet-markercluster with marker clustering, bottom sheet with place details, category filters, radius slider, "Get Directions" (opens OS maps app via universal links), "Save to Project".
  - **Widget integration**: Added `maps` to Widget union in `types/widget.ts`, exported in `widgets/index.ts`, case in `conversation-feed.tsx`.
  - **Chat integration** (`chat.ts`): `detectMapsCommand()` detects @Maps prefix + 9 natural language patterns ("where should I eat", "coffee near me", "pizza places nearby", etc.). Emits widget SSE event with config (center, radius, categories).
  - **All typecheck + build pass** on both frontend and API server.
- **Added Security Hardening Initiative to PHASES.md + session-brief.md** — 11 critical security issues identified with concrete fix steps (must fix before Phase 17):
  1. **API key endpoints missing account authorization (CRITICAL)** — list/update/delete/regenerate query by key ID only, no ownership check
  2. **No centralized authentication middleware (CRITICAL)** — 40+ routers mounted individually, each must remember auth
  3. **Build terminal route missing authentication (CRITICAL)** — accepts user commands without auth
  4. **Build isolation security audit needed (HIGH)** — environment restriction ≠ sandboxing
  5. **Browser safety model regex URLs insufficient (HIGH)** — malicious sites can bypass via redirects, iframes
  6. **Global 1GB JSON body limit (HIGH)** — massive DoS surface
  7. **CORS extremely permissive (MEDIUM)** — no origin restrictions
  8. **Frontend bundle size — no code splitting verified (MEDIUM)** — massive deps, no evidence of lazy loading
  9. **Session invalidation on password change only (LOW)** — no invalidation on email change, 2FA, security settings
  10. **No rate limiting on auth endpoints (LOW)** — credential stuffing, enumeration risk
  11. **Secret redaction incomplete in logs/context (LOW)** — not verified across all log paths, SSE, debug panel, checkpoints
- **Added 5 new phases to PHASES.md + session-brief.md** (user feature requests, inserted BEFORE Universal Tool Layer):
  - **Phase 17: Project Types System** — Book, Website, Company, App, Research, Course types with tailored UI/tools (Company: logo/slogan/promo maker, Website: build mode/GitHub/Figma, Book: extends Book Studio)
  - **Phase 18: Promo Maker** — Puppeteer-driven promo videos with aesthetic cursor (OpenAI-style), ASMR sound effects (Web Audio API: clicks, typing, whoosh), AI speed optimization (detects slow sections, re-renders at 2-4x with frame blending)
  - **Phase 19: Local Model Integration** — Qwen2.5-1.5B-Instruct via Ollama for error fixing/explaining, chat fallback when all API keys cooling, build-agent verification loop integration
  - **Phase 20: Deep Research v2** — True 3-7 min deep research agent (ChatGPT/Gemini style), 20-50 sources, iterative plan→search→browse→extract→synthesize→gap analysis loop, structured report with citations, @DeepResearch trigger
- **Fixed monorepo typecheck** — All packages (acp-server, api-server) now pass TypeScript clean:
  - **acp-server**: Updated tsconfig.json to exclude `../api-server/src/routes` — this was causing TS2742 errors on Express Router types from route files. Fixed drizzle-orm version mismatch (now uses catalog: ^0.45.2). Created re-export shims for api-server lib imports. Fixed projectMemory→projectMemories import in resources.ts.
  - **api-server**: Moved logActivity from routes to lib/project-activity.ts to break import cycles. Created lib/notification-dispatch.ts to replace routes/jarvis/connectors import in build-scheduler. Created lib/gmail-context.ts to replace routes/jarvis/gmail import in live-context. All routes imports removed from lib/ code.
- **Phase 11: ACP Protocol Support COMPLETE** — Typecheck now passes cleanly. ACP server exposes 16 tools via HTTP + WebSocket transports, with API key auth and project scoping.
- **Phase 14: Responsive UI Redesign (Mobile + Desktop as Different Websites) — LAYOUT PRIMITIVES COMPLETE** — Created 5 layout primitive components for the new design system:
  - **AppShell** (`src/components/layout/AppShell.tsx` + `.css`) — Top-level application layout with header, sidebar, right sidebar, footer, mobile overlay backdrop, collapsible sidebar, resize handles, keyboard navigation
  - **Sidebar** (`src/components/layout/Sidebar.tsx` + `.css`) — Reusable sidebar with navigation, sections, collapsible support, badge support, nested items, divider, footer
  - **Panel** (`src/components/layout/Panel.tsx` + `.css`) — Flexible container panels with variants (default/elevated/outlined/filled/glass), collapsible, resizable, scrollable, PanelGroup, PanelStack, SplitPanel
  - **Canvas** (`src/components/layout/Canvas.tsx` + `.css`) — Infinite canvas/whiteboard with zoom, pan, grid, touch support, keyboard navigation, layers, zoom indicator, screen↔canvas coordinate conversion
  - **ResponsiveGrid** (`src/components/layout/ResponsiveGrid.tsx` + `.css`) — CSS Grid + Flexbox + Masonry + Container Query grids, responsive columns per breakpoint, auto-fit/auto-fill, dense packing, GridItem for explicit placement
  - Created barrel export: `src/components/layout/index.ts`
- **Phase 14: Responsive UI Redesign (Mobile + Desktop as Different Websites) — BASE UI COMPONENTS COMPLETE** — Created 10 base UI components with Liquid Glass design tokens:
  - **Button** (Button, IconButton, ButtonGroup) — variants: primary/secondary/ghost/danger/glass, sizes: xs-xl, loading, icons
  - **Input** (Input, Textarea, Select) — label/error/helper/icon support
  - **Dialog** (Dialog, AlertDialog, Drawer) — focus trapping, portal rendering, animations
  - **Tooltip** (Tooltip, Toast, ToastContainer, useToast) — positioning, auto-dismiss
  - **Table** (Table, VirtualizedTable) — sorting, selection, row actions, compact/striped/hoverable
  - **Tree** (Tree, FileTree) — keyboard nav, expand/collapse, multi-select, indentation guides
  - **Tabs** (Tabs, SegmentedControl) — line/enclosed/soft/glass variants, horizontal/vertical
  - **CodeEditor** (CodeEditor, DiffEditor, InlineEditor) — CodeMirror wrapper with 25+ languages, themes, diff editor
  - **Terminal** (Terminal, TerminalSession) — xterm.js wrapper with toolbar, session tabs, fit addon, web links
  - **DiffView** (DiffView, InlineDiff, FileDiff) — diff hunk/line rendering, word diff, file diff header, context collapse
  - **MarkdownRenderer** (MarkdownRenderer, MarkdownEditor) — marked.js renderer with GFM, syntax highlighting, footnotes, alerts, editor with toolbar
  - All components support: light/dark themes, high contrast mode, reduced motion, proper ARIA accessibility, portal rendering where needed
  - Created barrel export: `src/components/ui/index.ts`

- **Mobile-first Claude Code Remote Control (yippee/) COMPLETE** — Phone browser → web interface (port 3000) → backend bridge (Codespace) → Claude Code via node-pty → OmniRoute:
  - **Backend (server.js):** Express + node-pty + SSE streaming, multi-session management with history persistence
  - **Real session detection:** Parses ~/.claude/sessions/*.json for metadata (pid, sessionId, cwd, name, status)
  - **AI titles from transcripts:** Parses ~/.claude/projects/*/transcript.jsonl for `aiTitle` field (e.g., "Build mobile remote control for Claude Code", "Starting phase 8")
  - **Resume existing sessions:** Uses `claude --resume <sessionId>` with proper cwd
  - **Clean env vars:** Strips CLAUDE_CODE_CHILD_SESSION, CLAUDE_CODE_SESSION_ID, CLAUDECODE to fix "transcript saving off" warning; keeps OmniRoute model env vars so sessions work
  - **API endpoints:** /api/stream/:id (SSE), /api/send/:id (prompt), /api/stop/:id (Ctrl+C), /api/claude-sessions (real sessions with AI titles), /api/session/new (create/resume), /api/sessions (UI sessions), /api/session/:id/history (chat replay)
  - **Frontend (public/index.html):** Mobile-first chat UI with bubbles/avatars (WhatsApp/ChatGPT style), chat picker dropdown with two sections: "Your chats" (active UI sessions) + "Resume a session" (real Claude sessions with AI titles), real-time history loading on session switch, auto-refresh every 5s, immediate user bubble display on send
  - **Verified working:** Resumed existing session "429bfa1d-ea34-4910-9737-3a467e65b79d" (AI title: "Starting phase 8") — sends prompts, receives streaming responses, transcript saving works without warning

- **Phase 7: MCP Server Integration COMPLETE** — Infinity now exposes 16 tools via MCP (Model Context Protocol):
  - Created `artifacts/mcp-server/` — standalone TypeScript package using `@modelcontextprotocol/sdk`
  - **stdio + HTTP transports** — `InfinityMcpServer` class with `runStdio()` (Claude Desktop, Cursor) and `runHttp()` (remote clients at `/mcp`, health at `/health`)
  - **16 MCP tools** in `src/tools/index.ts`: list_files, read_file, edit_file, run_command, git_diff, git_status, git_commit, build_agent_run, build_agent_step, project_memory_read, project_memory_write, research_run, research_extract, browser_navigate, browser_screenshot, browser_action — each maps to an Infinity API endpoint
  - **Auth middleware** in `src/auth.ts` — validates `INFINITY_API_KEY` via `/api/jarvis/auth/me`, checks scopes (`build:read`, `build:write`, `research:read`, `research:write`) per tool call
  - **Project scoping** — all tools auto-scope to `INFINITY_PROJECT_ID` from env/config
  - **Documentation** — `MCP_INTEGRATION.md` with full setup + config examples for Claude Desktop, Cursor, VS Code, Continue.dev
  - **Typecheck + build pass** on MCP server (`npm run typecheck` + `npm run build` clean)
- **@Agent Browser Widget + @Browse Tavily Live Text COMPLETE** — Turned Browser mode into two new commands:
- **@Agent Browser Widget + @Browse Tavily Live Text COMPLETE** — Turned Browser mode into two new commands:
  - **@Agent <goal>** — Puppeteer live browser widget (BrowserWidget.tsx): shows live screenshot stream via WebSocket (/browser-ws), double-click to take over (AI pauses, user controls), "Let AI Resume" button appears when paused, back/forward/reload controls, step-by-step action log. Consumes /api/jarvis/browse/agent-run SSE endpoint.
  - **@Browse <query>** — Tavily live text streaming in chat (NOT a widget): streams "🔍 Searching for..." → results with markdown sources, supports multiple queries per message (@Browse query1; query2; query3), shows source references with clickable links. Backend does direct Tavily fetch in chat.ts, emits live_text SSE events.
  - **Backend (chat.ts):** Added `detectBrowseCommand()` and `detectAgentCommand()` detection functions. @Browse handler loops queries, emits live_text events with search progress + results. @Agent handler emits widget event with type="browser_agent" + goal. Removed redundant tavily-search.ts route.
  - **Frontend:** Added `live_text` case in use-chat-stream.ts SSE handler (appends to assistant message as live text). Added `browser_agent` to Widget union in types/widget.ts. Added BrowserWidget import + case to conversation-feed.tsx. Exported BrowserWidget in widgets/index.ts.
  - Typecheck + build pass on both frontend and API server.
- **Phase 6 COMPLETE** — Headless CI/CD Mode fully implemented:
  - **CLI binary built and working** (`infinity` command) — Commander.js + TypeScript + esbuild ESM output
  - **Exit codes implemented** — 0=success, 1=build failed, 2=validation error, 3=budget exceeded, 4=timeout
  - **JSONL streaming output** — Real-time structured events to stdout for pipeline parsing
  - **API Key authentication infrastructure** — `api-key-auth.ts` middleware with Bearer/x-api-key support, scope checking (`requireScope`)
  - **User API Key management routes** — CRUD endpoints in `api-keys.ts` (create, list, update, delete, regenerate) using existing `llm_keys` table with `source="user-api"`
  - **Applied apiKeyAuth to ALL 40+ build routes** in `build.ts` with `requireAuth` + `requireScope("build:write")` for write operations
  - **GitHub Action template** — `.github/workflows/infinity-build.yml` with reusable workflow support
  - **Documentation** — `HEADLESS_MODE.md` with complete CI/CD examples (GitHub Actions, GitLab CI, CircleCI)
  - **Model-agnostic LLM abstraction** already complete from previous phase
  - **Git worktree isolation + checkpoint/resume** already complete
  - Typecheck + build pass, CLI `infinity --help` works

- **Created PHASES.md** — Master implementation roadmap with 15 phases (Phases 0-5 complete, Phases 6-15 planned). Includes detailed requirements, implementation plans, file lists, and autonomous execution rules.
- **Updated CLAUDE.md** — Added PHASES.md as mandatory first read, added autonomous execution rules for "go" command.
- **Updated session-brief.md** — Replaced next actions with phased roadmap from PHASES.md.
- **Auth system COMPLETE**: Implemented login/register/logout/profile/password using existing accounts/sessions tables in schema:
  - Added bcrypt for password hashing (12 rounds)
  - Created `artifacts/api-server/src/routes/jarvis/auth.ts` with endpoints:
    - `POST /api/jarvis/auth/register` — register new account (email, password, displayName)
    - `POST /api/jarvis/auth/login` — login with email/password, returns session cookie
    - `POST /api/jarvis/auth/logout` — invalidate session, clear cookie
    - `GET /api/jarvis/auth/me` — get current authenticated account from session cookie
    - `PUT /api/jarvis/auth/profile` — update displayName/avatarUrl
    - `PUT /api/jarvis/auth/password` — change password (invalidates all other sessions)
  - Registered authRouter in `index.ts` (mounted before conversations)
  - Session cookies: httpOnly, secure in production, 30-day expiry, SameSite=lax
  - Typecheck + build pass

## Previous action (Gem→Expert rename, user-facing)
- Renamed the "Gem" feature to "Expert" across the entire codebase (15 files) + README. Frontend: `GemDialog`→`ExpertDialog` (file rename), route `/conversations/gem`→`/conversations/expert`, i18n `gem.*`→`expert.*` (EN+NL), PlusMenu `new-gem`→`new-expert`, CommandPalette `gem`→`expert`, ResearchPanel `onOpenGem`→`onOpenExpert`, ProjectResearch/ChatComposer labels, AppOverlays/home.tsx props. README: "Gem"→"Expert" + Experts section added.

## Previous action (Browser extension for Infinity COMPLETE)
- Created complete Manifest V3 browser extension enabling Infinity to control user's actual browser:
  - Added WebSocket endpoint `/api/jarvis/extension/ws` to API server with `extension.ts` route — handles extension connections, ping/pong heartbeat, message routing
  - Added REST endpoints: `/extension/status` (list connected extensions), `/extension/send` (send message to specific extension), `/extension/broadcast` (broadcast to all extensions)
  - Updated `server.ts` to handle WebSocket upgrades for extension connections
  - Created complete extension at `artifacts/infinity-extension/`:
    - `manifest.json` — Manifest V3 with permissions (tabs, scripting, storage, webNavigation, host_permissions for API server + all URLs)
    - `background.js` — Service worker connecting to `ws://127.0.0.1:8080/api/jarvis/extension/ws` with auto-reconnect, handles execute_action, navigate, get_tabs, get_tab_content, evaluate_script, screenshot, get_interactive_elements
    - `content-script.js` — Runs in all pages, provides DOM interaction: get_interactive_elements, click_element, type_text, select_option, press_key, scroll_page, hover_element, focus_element, clear_input, get_page_content, evaluate
    - `popup.html` + `popup.js` — Clean UI with connection status, tab list, activity log, connect/disconnect/refresh tabs/clear log buttons
    - `injected.js` — Page-context script for cookies, localStorage, sessionStorage, performance timing, network info
    - SVG icons (16, 32, 48, 128px) — Infinity ∞ logo with gradient
  - Verified working: WebSocket connection + ping/pong + REST message send/broadcast + status endpoint all functional
  - Typecheck + build pass

## Previous action (Gem→Expert rename, user-facing)
- Renamed the "Gem" feature to "Expert" across the entire codebase (15 files) + README. Frontend: `GemDialog`→`ExpertDialog` (file rename), route `/conversations/gem`→`/conversations/expert`, i18n `gem.*`→`expert.*` (EN+NL), PlusMenu `new-gem`→`new-expert`, CommandPalette `gem`→`expert`, ResearchPanel `onOpenGem`→`onOpenExpert`, ProjectResearch/ChatComposer labels, AppOverlays/home.tsx props. README: "Gem"→"Expert" + Experts section added.

## Previous action (Gem→Expert rename, user-facing)
- Renamed the "Gem" feature to "Expert" across the entire codebase (15 files) + README. Frontend: `GemDialog`→`ExpertDialog` (file rename), route `/conversations/gem`→`/conversations/expert`, i18n `gem.*`→`expert.*` (EN+NL), PlusMenu `new-gem`→`new-expert`, CommandPalette `gem`→`expert`, ResearchPanel `onOpenGem`→`onOpenExpert`, ProjectResearch/ChatComposer labels, AppOverlays/home.tsx props. README: "Gem"→"Expert" + Experts section added.

## Project state — right now
- **UI cleanup work:** core chat-shell cleanup implemented and verified across toolbar, sidebar, Projects, conversation feed, and composer; remaining hardcoded light/dark colors converted to theme tokens.
- **Build Studio progress work:** complete. Transcript portaled out of notice content, screenshot requests settle safely, accepted plans leave plan mode immediately, plan requests preserve earlier updates, pipeline terminal states remain visible, progress messages avoid nested state updates, dismissed questions cannot strand the run.
- **Continuity system:** `CLAUDE.md` routine + `KNOWLEDGE.md` (how it works) + `session-brief.md` (live state) replace the old 3 logs (archived in `archive/`). `source-code.ts` blocks KNOWLEDGE/session-brief from Jarvis-the-app's source reading.
- **Projects System:** brief "persistent workspaces with isolated project memory". Core backend (project CRUD, management, conversation scoping, project home backend), Project Memory (isolated storage, CRUD/pin APIs, keyword retrieval, project-scoped extraction), Project Instructions (ordered rules, scoped API, bilingual UI, chat injection), first-class Projects navigation (search/sort/archive/pin/rename/delete/create-from-chat/move + quick-access rail), AI Context Pipeline (six scoped sources assembled into PROJECT CONTEXT block), and Project Activity feed (cursor pagination, search, load-more, emoji icons, i18n, logActivity wired across all mutating routes). All verified with typecheck + build passing.
- **Book Studio:** fully built + wired (schema, engine, routes, wizard, polling, A5 PDF verified). Live end-to-end run ready (server `.env` now configured).
- **Build Mode (Infinity):** completion plan in `BUILD_MODE_COMPLETION_PLAN.md` with Phase 0–5. **Phase 0: UI Unfuck — COMPLETE**. **Phase 1: Foundation (worktree isolation + checkpoints) — COMPLETE**. **Phase 2: Loop Intelligence — COMPLETE** (diff preview ✓, verification loop ✓, parallel fan-out ✓, modular prompts ✓, retry-with-fixer ✓, UI diff modal ✓, wire execute-plan ✓). **Phase 3.1: Smart Working Context — COMPLETE** (fileMap, keyDecisions, errorPatterns, tokenBudget, compaction). **Phase 3.2: Project-Scoped Memory Integration — COMPLETE** (instructions, memory, activity, files wired into build loop). **Phase 4.1: Workspace Snapshots + Rollback — COMPLETE** (tar.gz snapshots at checkpoints, history timeline, restore/export). **Phase 4.2: Browser Pool — COMPLETE** (3-5 pre-warmed Chromium, session persistence, screenshot diffing, CDP accessibility). **Phase 4.3: Resource Limits + Cost Tracking — COMPLETE** (per-workspace budgets, token/cost tracking, daily aggregates, dashboard). **Phase 4.4: Command Palette + Keyboard Mastery — COMPLETE** (10 server-side command routes backing client palette). **Phase 5.1: Telemetry + Debugging — COMPLETE** (structured event log, REST routes, frontend Debug panel with Live/Replay). **Phase 5.2: Export / Share / Clone — COMPLETE** (6 backend routes + Debug panel UI with ZIP/tar.gz export, Share, Clone). **Phase 5.3: Edge Cases — FULL COMPLETE** (build-edge-cases.ts library + 11 REST routes + Debug panel UI + build loop integration with preflightCheck, enqueueBuild, withRetry). All phases 0-5 COMPLETE.
- **File System Access API Integration (Infinity Build):** COMPLETE. Browser-native `showDirectoryPicker()` allows users to select a local directory as persistent workspace. Created `file-system-access.ts` (complete FS API service) + `indexed-db.ts` (persistence). Modified `build-studio.tsx`: FS API when folder connected, fallback to backend API. Explorer sidebar UI with Connect/Disconnect buttons, status indicator, reconnecting spinner. Browser unsupported warning for Safari/Firefox. 11 i18n keys (EN+NL). Typecheck + build pass.
- **Gem → Expert rename:** COMPLETE. User-facing "Gem" feature (custom expert personas + deep-research-spawned expert chats) renamed to "Expert" everywhere. DB/API contract preserved: `kind: "gem"`, `gem_system_prompt`, `gem_conversation_id`, `gemSystemPrompt`, `gemConversationId` fields kept for backward compatibility.
- **DB (Drizzle, `lib/db/src/schema/`):** accounts · books · build-apps · **build-budgets** · **build-costs** · **build-daily-aggregates** · **build-checkpoints** · conversations · files · gmail · groups · llm-keys · memories (global) · project-instructions (scoped) · project-memory (scoped) · projects (+projectChats/projectFiles/pins) · push · research · secrets · settings · sharing · spotify · timers.
- **Features:** chat (global memory + LLM auto-extraction ~chat.ts L448 + context injection ~L504), voice mode, camera detection, Build Studio (@Build shortcut, CodeMirror), Book Studio, deep-research background jobs, Projects folder system, code editor, Jarvis browser, music/Spotify, timers, Gmail/Calendar, command palette, **Experts** (custom personas + research-spawned specialists).
- **Server `.env`:** configured with all API keys (OpenRouter, NVIDIA NIM, Whisper, Flux, ElevenLabs, Tavily, Spotify, Gmail, Figma, Neon Postgres).

## Change record (newest first — EVERY change logged here, cap ~15)
- 2026-08-20 **Phase 20: Deep Research v2 COMPLETE** — True 3-7 min deep research agent (ChatGPT/Gemini style):
  - Verified all components exist: engine (iterative plan→search→browse→extract→synthesize→gap-analysis loop, max 3 iterations, 20-50 sources via Tavily + browser + Semantic Scholar), API routes, SSE streaming, DeepResearchWidget with live progress + citation-linked report, @Deep Research chat trigger, "Create Expert" button integration.
  - **CRITICAL runtime fix**: `auto-migrate.ts` was missing `research_jobs_v2` / `research_sources_v2` CREATE TABLE statements — added both tables + indexes so the engine actually works at runtime.
  - **Fixed chat handler**: jobId field mismatch (route returns `id`, chat expected `jobId`).
  - **Wired "Create Expert" button**: threaded `onDeepResearchExpert` through active chat path (home.tsx → ChatModeView → ConversationFeed) so the button now renders and navigates to the new expert conversation.
  - Typecheck + build pass ✅
- 2026-08-19 **Phase 18: Promo Maker COMPLETE** — Apple/OpenAI quality promo video engine:
  - Spring-physics cursor (mass/damping/stiffness), magnetic attraction, click ripple, trails, state-aware cursors
  - Procedural ASMR audio via FFmpeg filter_complex (ambient, clicks, whooshes, typing, sweeps, reverb)
  - Narrative script structure (hook→demo→CTA) with section-aware text styling and positioning
  - Device frame mockups (iPhone, MacBook, iPad) — SVG-generated, FFmpeg-rendered with realistic bezels/notches/shadows
  - Google Fonts downloading/embedding — downloads TTF from CSS URLs, uses brand kit fonts in overlays
  - Color grading (contrast, saturation, vignette, film grain), professional text overlays with fade animations
  - Brand kit integration (Company project palette + fonts), AI speed optimization (LLM-analyzed variable speed)
  - Frontend PromoWidget with synchronized text overlays, fullscreen player, download/share
  - Company project "Create Promo Video" button passes brandKit
  - Typecheck + build pass on all packages ✅
- 2026-08-19 **Phase 16: Infinity Maps Widget COMPLETE** — Interactive maps widget for location queries:
  - Backend (`maps.ts`): Overpass API + Nominatim integration with in-memory caching (5min TTL) and rate limiting (30 req/min per IP). Routes: GET /search, GET /geocode, POST /detect
  - Frontend (`MapsWidget.tsx`): Leaflet + react-leaflet + react-leaflet-markercluster with marker clustering, bottom sheet details, category filters, radius slider, "Get Directions" (OS maps app via universal links), "Save to Project"
  - Widget integration: `maps` type added to Widget union, exported in widgets/index.ts, case in conversation-feed.tsx
  - Chat integration (`chat.ts`): `detectMapsCommand()` detects @Maps + 9 natural language patterns. Emits widget SSE event
  - All typecheck + build pass on both frontend and API server
- 2026-08-19 **Phase 15 Task 11: Skills System COMPLETE** — Created complete reusable capabilities system for Build Mode agents:
  - `build-skills.ts` (800+ lines): SkillDefinition schema (instructions, toolPreferences, verificationRules, conventions, environment, roleBindings, extends), SkillRegistry (discovery by category/tag/role, project-scoped filtering, stats), SkillLoader (JSON/YAML file loading, inheritance resolution with circular detection, merge logic), AgentSkillBinding (per-project/role skill assignments with priority), SkillMarketplace (local-first package management, $0 budget, install/publish/search)
  - 9 built-in skill definitions in `artifacts/api-server/src/lib/skills/`: base.json (foundation), react-engineer.json, debugger.json, ui-designer.json, api-engineer.json, database-engineer.json, devops-engineer.json, security-auditor.json, performance-engineer.json
  - Fixed acp-server typecheck by excluding browser-side Phase 15 files from tsconfig.json
  - Fixed 2 typecheck errors in build-skills.ts: added "skill" to BuildEventType, null check for entry at line 292
  - Full workspace typecheck passes clean
- 2026-08-19 **Phase 15 Task 9: Tool Failure Handling (Resilient Tool Layer) COMPLETE** — Extended `build-tools.ts` and `build-edge-cases.ts` with comprehensive resilience layer:
  - **Tool failure classification** — npm_install, browser_error, compilation_error, network_failure, timeout, disk_full, permission_denied, git_conflict, unknown
  - **Circuit breaker pattern** — per-tool failure tracking with auto-open/half-open/closed states
  - **Diagnostic agents** — 3 built-in agents: npm-install-fixer (pnpm fallback), browser-recovery (slot refresh), compilation-fixer (TypeScript error escalation)
  - **Recovery actions** — retry_same, retry_alternative, fallback_tool, escalate_to_diagnostic, require_human, abort
  - **Resilient execution wrapper** — `executeToolResilient()` with diagnosis, retry, circuit breaker, metrics
  - **Tool resilience configs** — per-tool retry config, circuit breaker thresholds, fallback tools, diagnostic agents
  - **Health checks & metrics** — `runToolHealthCheck()`, `getResilienceMetrics()`, `recordResilienceMetric()`
- 2026-08-19 **Phase 15 typecheck fixes COMPLETE** — Fixed all TypeScript typecheck errors in Phase 15 library files and route files:
  - Added `phase` property to all 7 `saveCheckpoint` calls in `build.ts` (lines 689, 791, 1177, 1275, 1380, 2318, 2791)
  - Added `phase` property to `saveCheckpoint` call in `build-export.ts` (line 458) for clone operation
  - Added `phase` property to `saveCheckpoint` call in `build-checkpoints.ts` (line 31) for manual checkpoint creation
  - All typecheck errors resolved, full workspace now passes `npm run typecheck` clean
- 2026-08-18 **Added Phase 15 to PHASES.md + updated session-brief.md** — Comprehensive plan addressing all 10 user feedback points + Skills system:
  1. **Visual Verification System** — Build→Launch→Open→Inspect→Fix→Re-check loop with browser-based verification (layouts, overflow, spacing, assets, buttons, console, mobile, runtime)
  2. **Done Contract System** — Deterministic completion checklist with verification gates (build, runtime, visual, criteria, tests, links, security) before explicit DONE signal
  3. **Catastrophic Failure Recovery** — Checkpoint 1/2/3 (plan, step groups, pre-verify) with auto-restore, failure classifiers, recovery actions per type
  4. **Git-First Build Mode** — Worktree per build, incremental commits, final diff, success→keep branch, failure→auto-revert
  5. **Context Management & Compression** — Raw history→Summarizer→Compact memory pipeline with 4 compaction levels, persistent storage, Debug panel
  6. **Human Takeover / Steering** — Interruptible execution, steering commands, resume with injection, approval gates, real-time chat
  7. **Model Routing + Effort Chooser** — Lite (~3min), High (~15min), Max (~45min) with role-based routing, provider failover, cost tracking
  8. **Build Intelligence / Project Map** — Persistent subsystem analyzing framework, PM, entry points, architecture, DB, routes, components, tests, config
  9. **Tool Failure Handling** — Resilient wrapper: diagnose→retry→alternative→escalate per tool type (npm, browser, compile, network)
  10. **Security Boundaries** — Command allow/deny, secret redaction, env protection, workspace sandboxing, filesystem boundaries, network permissions, destructive confirmation, per-agent tool permissions, self-mod guardrails
  11. **Skills System** — Reusable capabilities: react-engineer, debugger, ui-designer, api-engineer, database-engineer, devops-engineer, security-auditor, performance-engineer with registry, inheritance, marketplace
- 2026-08-18 **Fixed monorepo typecheck completely** — All packages (acp-server, api-server) pass TypeScript clean:
  - **acp-server**: Updated tsconfig.json to exclude `../api-server/src/routes` (was causing TS2742 errors). Fixed drizzle-orm version to catalog:. Created re-export shims for api-server lib imports. Fixed projectMemory→projectMemories import.
  - **api-server**: Moved logActivity from routes to lib/project-activity.ts (breaks import cycles). Created lib/notification-dispatch.ts (replaces routes/jarvis/connectors import). Created lib/gmail-context.ts (replaces routes/jarvis/gmail import). All routes imports removed from lib/ code.
- 2026-08-18 **Phase 11: ACP Protocol Support COMPLETE** — Typecheck passes. ACP server exposes 16 tools via HTTP + WebSocket with API key auth and project scoping.
- 2026-08-18 **Updated PHASES.md** — Phase 11 marked complete with typecheck fix; Phase 14 renamed per user correction.
- 2026-08-17 **Phase 8: Multi-Agent Orchestration COMPLETE** — Planner→Coder→Reviewer→Fixer pipeline with shared context + parallel execution:
  - Created `artifacts/api-server/src/lib/agent-prompts/` (planner, coder, reviewer, fixer prompts via buildInfinityPrompt)
  - Created `artifacts/api-server/src/lib/build-orchestrator.ts` — BuildOrchestrator class + runMultiAgentBuild factory; topological sort + parallel groups (Promise.allSettled); coder/fixer reuse runAgentForStep; planner/reviewer use LLM adapter jsonMode; 3 fix iterations max
  - Extended build-context.ts (modifiedFiles Map), build-telemetry.ts (orchestrator + orchestrator_start events), project-activity.ts + db schema (orchestration_ran activity type)
  - New API routes: `POST /build/orchestrate` (requireAuth, build:write, enqueueBuild + preflightCheck + saveCheckpoint), `GET /build/orchestrate/status/:projectId` (requireAuth)
  - Fixed 3 type errors + buildInfinityPrompt 2-arg→options-object in all 4 prompts + build-events.ts WriteStream union + task-queue.ts executeStep type + db enum. Full workspace typecheck passes clean.
- 2026-08-17 **Phase 7: MCP Server Integration COMPLETE** — Infinity exposes 16 tools via MCP (Model Context Protocol) for ANY LLM client:
  - Created `artifacts/mcp-server/` with stdio + HTTP transports, 16 tool definitions, auth middleware, project scoping
  - Tools: list_files, read_file, edit_file, run_command, git_diff, git_status, git_commit, build_agent_run, build_agent_step, project_memory_read, project_memory_write, research_run, research_extract, browser_navigate, browser_screenshot, browser_action
  - Auth: validates `INFINITY_API_KEY` via `/api/jarvis/auth/me`, scope checks per tool
  - Docs: `MCP_INTEGRATION.md` with configs for Claude Desktop, Cursor, VS Code, Continue.dev
  - Typecheck + build pass clean
- 2026-08-17 **@Agent Browser Widget + @Browse Tavily Live Text COMPLETE** — Turned Browser mode into two new commands:
  - **@Agent <goal>** — Puppeteer live browser widget (BrowserWidget.tsx): shows live screenshot stream via WebSocket (/browser-ws), double-click to take over (AI pauses, user controls), "Let AI Resume" button appears when paused, back/forward/reload controls, step-by-step action log. Consumes /api/jarvis/browse/agent-run SSE endpoint.
  - **@Browse <query>** — Tavily live text streaming in chat (NOT a widget): streams "🔍 Searching for..." → results with markdown sources, supports multiple queries per message (@Browse query1; query2; query3), shows source references with clickable links. Backend does direct Tavily fetch in chat.ts, emits live_text SSE events.
  - **Backend (chat.ts):** Added `detectBrowseCommand()` and `detectAgentCommand()` detection functions. @Browse handler loops queries, emits live_text events with search progress + results. @Agent handler emits widget event with type="browser_agent" + goal. Removed redundant tavily-search.ts route.
  - **Frontend:** Added `live_text` case in use-chat-stream.ts SSE handler (appends to assistant message as live text). Added `browser_agent` to Widget union in types/widget.ts. Added BrowserWidget import + case to conversation-feed.tsx. Exported BrowserWidget in widgets/index.ts.
  - Typecheck + build pass on both frontend and API server.
- 2026-08-16 **Phase 6 COMPLETE** — Headless CI/CD Mode fully implemented: CLI with exit codes (0-4), JSONL streaming output, API key auth, GitHub Action template (.github/workflows/infinity-build.yml), complete documentation (HEADLESS_MODE.md). All 6 requirements met, typecheck + build pass.
- 2026-08-16 **Phase 6 Foundation COMPLETE** — Headless CI/CD Mode foundation implemented: CLI binary built (`infinity` command works), API key auth middleware + routes, applied to all 40+ build routes with scope checking. Typecheck + build pass.
- 2026-08-16 **Created PHASES.md + updated CLAUDE.md + session-brief.md**: Master roadmap with 15 phases (0-5 done, 6-15 planned). CLAUDE.md now requires reading PHASES.md first. Autonomous execution rules added.
- 2026-08-16 **Auth system COMPLETE**: Implemented login/register/logout/profile/password using existing accounts/sessions tables in schema. Added bcrypt (12 rounds), created `auth.ts` with 6 endpoints (register, login, logout, me, profile, password), registered in index.ts, session cookies (httpOnly, secure, 30-day expiry). Typecheck + build pass.

- 2026-08-16 **Chat/voice mode API key fallback logic COMPLETE**: Implemented sequential retry flow per user specification — fail → "Try same key" button (retries same key once) → if fails again → "Try next key" button (tries next key in pool). Backend: modified `artifacts/api-server/src/routes/jarvis/chat.ts` manual key mode (`manualCreate`) for single attempt per key with `llm_manual_retry` error carrying current/next key info. Frontend: modified `artifacts/jarvis/src/hooks/use-chat-stream.ts` with `retryAttempt` state (0=initial, 1=first retry same key, 2=second retry next key), `retrySameKey()`/`retryNextKey()` callbacks, UI shows appropriate buttons per attempt. Typecheck + build pass.

- 2026-08-16 **Facial recognition in camera mode COMPLETE**: Added MediaPipe Face Landmarker integration using `@mediapipe/tasks-vision` (same library as hand tracking, 100% free, runs in browser via WebAssembly). Created `use-face-tracking.ts` hook (478 landmarks, bounding box, key features, head pose), integrated into `camera-feed.tsx` with `enableFaceTracking` prop and `drawFaceOverlay` (face mesh, feature points, head pose indicator), enabled in `camera-mode-view.tsx`. Typecheck passes (only pre-existing api-client-react build error).

- 2026-08-16 **Removed legacy single-shot generation functions**: Deleted `generateStarterFiles()`, `parseStarterFiles()`, `reviewFallback()`, and `reviewAndFixWorkspace()` from `build.ts` — no longer used since `/build/scaffold` and `/build/iterate` now use `runAutonomousAgent` (Phase 1 Autonomous Coding Agent). Typecheck + build pass.
- 2026-08-16 **Phase 1 Autonomous Coding Agent COMPLETE**: Replaced single-shot JSON-map generation with tool-using autonomous coding agent. Created `build-tools.ts` (9 tools: list_files, read_file, edit_file, run_command, screenshot, inspect_console, inspect_dom, inspect_accessibility, git_diff), `build-agent.ts` (AgentState machine, runAutonomousAgent, runAgentForStep, runAgentIteration, parseToolCalls, checkDone, runVerification), 3 new routes in build.ts (`/build/agent/run`, `/build/agent/step`, `/build/agent/tools`). Fixed TypeScript errors: ScreenshotViewport export, BuildEventType agent events, PlanStep type conflict. Typecheck + build pass.
- 2026-08-16 **Model-Agnostic LLM Abstraction COMPLETE**: Implemented strict architectural abstraction layer so Infinity agent NEVER knows which LLM provider powers it. Created `llm-adapter.ts` (LLMAdapter interface, OpenAICompatibleAdapter for any OpenAI-compatible API, LLMAdapterError with sanitization), `infinity-prompt.ts` (INFINITY_IDENTITY immutable prefix + role-specific instructions + buildInfinityPrompt single entry point), `adapter-factory.ts` (createBestAdapter, createManualAdapter, createAdapterFromEntry, adapterFactory). Migrated all 10+ LLM call sites in build.ts, chat.ts, browse.ts, debug.ts to new abstraction. Fixed TypeScript errors in llm-adapter.ts (OpenAIClient interface→class, tool call chunk index), browse.ts (LLMContentPart import), debug.ts (completion.content access). Typecheck + build pass. All providers (Claude, GPT, Gemini, OpenRouter, NVIDIA NIM, local vLLM, future) now work identically.
- 2026-08-16 **File System Access API Integration COMPLETE**: Added browser-native File System Access API (`window.showDirectoryPicker`) to Infinity Build for persistent local folder workspace; created `file-system-access.ts` + `indexed-db.ts`; modified `build-studio.tsx` with FS API integration (fallback to backend API); Explorer sidebar UI (Connect/Disconnect, status indicator, reconnecting spinner); browser unsupported warning for Safari/Firefox; 11 i18n keys (EN+NL); typecheck + build pass
- 2026-08-16 **Phase 5.3 — Edge Cases INTEGRATION COMPLETE**: Wired preflightCheck, enqueueBuild, withRetry into `/build/execute-plan` and `/build/iterate` in build.ts; pre-flight validation before builds, concurrent build queuing per project, LLM call retry with exponential backoff; typecheck + build pass — Phase 5.3 now FULL COMPLETE
- 2026-08-16 **Phase 5.3 — Edge Cases FRONTEND COMPLETE**: Debug panel wired with 5 Edge Cases action buttons (Preflight, Disk Space, Queue, Edge Cases, Rate Limit) + status grid display; loading states; 9 new i18n keys EN+NL; typecheck + build pass
- 2026-08-16 **Phase 5.3 — Edge Cases BACKEND COMPLETE**: Created `build-edge-cases.ts` library (~500 lines) with 6 resilience utilities + 11 API routes in build.ts; network retry with backoff, disk full pause, rate limit queue, git conflict auto-resolve, workspace corruption detect/repair, concurrent build queue, pre-flight check; typecheck + build pass
- 2026-08-16 **Phase 5.2 — Export/Share/Clone FRONTEND COMPLETE**: Debug panel wired with ZIP export, tar.gz export, Share (copy link), Clone (prompt target projectId) buttons; loading states, clipboard copy, success toast; 4 new i18n keys EN+NL; build-export.ts (6 backend routes) already complete prior session; typecheck + build pass
- 2026-08-16 **Phase 5.1 — Telemetry + Debugging FULL COMPLETE**: Frontend Debug panel added (build-debug-panel.tsx) with Live/Replay toggle, 11-type filter, summary, count, export JSONL, copy summary, clear logs, type-colored event table; debug tab added to StudioTab/TAB_ORDER; 26 i18n keys (EN+NL); typecheck + build pass
- 2026-08-15 **Phase 4.4 — Command Palette + Keyboard Mastery COMPLETE**: Fixed TypeScript errors in build.ts command routes (`ctx.steps`→`completedSteps`, `refreshFileMap` signature, `StepResult[]` serialization, `Map`→`Object` for checkpoint); all 10 server-side command routes working (create-checkpoint, rollback, export, refresh-files, browser open/close, budget status, budget set); typecheck + build pass
- 2026-08-15 **Phase 4.2 — Browser Pool COMPLETE**: Created `browser-pool.ts`; added 10 browser pool routes (status, acquire/release, navigate, action, state, screenshot, elements, captcha, accessibility, scale); 3-5 pre-warmed Chromium, session persistence, idle scaling; typecheck + build pass
- 2026-08-15 **Phase 4.1 — Workspace Snapshots + One-Click Rollback COMPLETE**: Created `workspace-snapshots.ts`; added 4 snapshot routes (list, create, restore, delete); auto-snapshot after checkpoint; tar.gz + JSON sidecars; typecheck + build pass
- 2026-08-15 **Phase 4.3 — Resource Limits + Cost Tracking COMPLETE**: Created `build-budgets.ts` schema + lib; added 7 budget routes to build.ts; per-workspace budgets, token/cost tracking, daily aggregates, dashboard; typecheck + build pass
- 2026-08-15 **Phase 3.2 — Project-Scoped Memory Integration COMPLETE**: Created `build-project-context.ts`; wired project instructions, memory, activity, files into `/build/execute-plan`, `/build/scaffold`, `/build/iterate`; strict projectId guarding prevents cross-project leakage; typecheck + build pass
- 2026-08-15 **Gem→Expert 10/10 — internal backend rename complete**: createGem→createExpert, expertSystemPrompt var, 💎→🧠 emoji, BACKWARD COMPAT header + inline comments, conversations.ts/chat.ts comments clarified legacy DB value; only remaining "gem": Ruby gem pkg mgr, kind:"gem" (legacy, documented), API gemSystemPrompt/gemConversationId (contract, documented)
- 2026-08-15 **Gem → Expert rename COMPLETE**: Renamed "Gem" to "Expert" across codebase (15 files, component rename, route, i18n, props, README); typecheck + build pass, pushed
- 2026-08-15 **Phase 2 COMPLETE**: All 3 tasks done (UI diff modal ✓, retry loop with fixer ✓, wire /build/execute-plan ✓); typecheck + build pass
- 2026-08-15 **Phase 2 Task #2 COMPLETE**: Retry loop with fixer prompt on verification failure implemented in `/build/iterate`; typecheck + build pass
- 2026-08-15 **Phase 2 PARTIAL**: Diff preview, verification loop, parallel fan-out, modular prompts implemented; typecheck + build pass
- 2026-08-15 **Phase 1 COMPLETE**: Git worktree isolation + checkpoint/resume system implemented, typecheck + build pass, pushed to GitHub
- 2026-08-15 Server `.env` written with all credentials (gitignored)
- 2026-08-14 **Full build passes** (typecheck + vite build) — Phase 0 TypeScript fixes complete, 3707 modules transformed, dist artifacts generated
- 2026-08-14 Fixed all remaining Phase 0 TypeScript errors (hoisting, BuildPlan type, createPortal import, effect cleanup); typecheck passes with zero errors; 5 new Phase 0 components created and integrated
- 2026-08-14 Rendered TranscriptBottomSheet in build-studio.tsx return; full build passes (typecheck + vite build). Phase 0 transcript bottom sheet (50%/90% snap, drag handle, swipe dismiss) now active on mobile.
- 2026-08-14 Added 8 missing i18n keys for Build Studio Phase 0 (EN + NL); fixed 3 TypeScript errors in build-diff-preview.tsx, build-plan-view.tsx, home.tsx; full build passes (typecheck + vite build).
- 2026-08-14 Updated KNOWLEDGE.md and session-brief.md to reflect current work: Phase 0 (UI Unfuck) from BUILD_MODE_COMPLETION_PLAN.md — Build Mode mobile-first UI overhaul
- 2026-08-14 Removed all Phase A–O and steps 1–20/11–20 references from KNOWLEDGE.md and session-brief.md per user request
- 2026-08-13 Project Activity feed completed: frontend ActivityRecord component with cursor pagination + search + load-more + emoji icons, `projectActivity.*` i18n (17 keys EN/NL), gallery/home/home-page wiring for 'activity' section; logActivity integrated across all 7 mutating route files (projects, memories, instructions, tasks, research, conversations, files); Drizzle enum typing fixed with `as const`. Build passes.
- 2026-08-12 AI Context Pipeline implemented: `lib/project-context.ts` assembles six scoped sources (identity, instructions, memory, files w/ text excerpt, history from other project chats, research runs) into the PROJECT CONTEXT block; `chat.ts` `buildProjectContext` now delegates to it; all queries strictly filtered by projectId. Build passes.
- 2026-08-12 Jarvis composer cleanup: the input now uses a centered max-width surface with neutral theme tokens instead of competing hardcoded light/dark pill styles.
- 2026-08-12 Jarvis conversation-feed cleanup: assistant content now sits in a bounded reading column, user bubbles have a readable maximum width, and feed spacing is less cramped.
- 2026-08-12 Jarvis Projects cleanup: the Projects section starts collapsed so the conversation list remains the primary sidebar focus.
- 2026-08-12 Jarvis sidebar cleanup: navigation is grouped, the workspace header is compact, and footer actions no longer compete with the top toolbar.

## Active threads
- **Phase 11: ACP Protocol Support** — **COMPLETE**: Typecheck passes cleanly. ACP server exposes 16 tools via HTTP + WebSocket with API key auth and project scoping.
- **Phase 8: Multi-Agent Orchestration** — **COMPLETE**: Planner→Coder→Reviewer→Fixer pipeline with shared context, parallel execution, verification loop (max 3 fix iterations). New API routes `/build/orchestrate` + `/build/orchestrate/status`. Full workspace typecheck passes.
- **@Agent Browser Widget + @Browse Tavily Live Text** — **COMPLETE**: Two new commands implemented and verified:
  - @Agent: Puppeteer live widget with screenshot streaming, double-tap takeover, resume button
  - @Browse: Live text streaming in chat with multiple queries, source references
  - Both typecheck + build pass
- **Build Mode (Infinity) Phase 6: Headless CI/CD Mode** — **COMPLETE**: CLI binary (`infinity` command), exit codes, JSONL streaming, API key auth, GitHub Action template, docs. Typecheck + build pass.
- **Build Mode (Infinity) Phase 0: UI Unfuck** — **COMPLETE**: All mobile/desktop UI components built and integrated. Typecheck + build pass.
- **Build Mode (Infinity) Phase 1: Foundation** — **COMPLETE**: Git worktree isolation, checkpoint/resume system, atomic commits, instant rollback. Typecheck + build pass.
- **Tavily Research (1-hour)**: **COMPLETED** - Competitive analysis to make Infinity "THE BEST IT CAN BE for $0" vs Claude Code, Replit Agent, Cursor, OpenHands, Cline, Aider, Goose. Key findings synthesized into actionable improvements below.
- **Responsive UI redesign**: **IN PROGRESS** - Phase 14 — Created design tokens + 10 base UI components + 5 layout primitives. Now building feature views (Build, Chat, Terminal, Settings, Projects) with BOTH desktop (sidebar nav, keyboard shortcuts) and mobile (bottom nav, sheets, swipe) implementations. Treat them as different websites for same goal.
- **Phase 15: Build Mode Intelligence & Reliability** — **ALL 11 TASKS COMPLETE** ✅:
  - Task 1 (Visual Verification) ✅ DONE
  - Task 2 (Done Contract) ✅ DONE
  - Task 3 (Checkpoint/Recovery) ✅ DONE
  - Task 4 (Git-First Build) ✅ DONE
  - Task 5 (Context Compression) ✅ DONE
  - Task 6 (Human Takeover) ✅ DONE
  - Task 7 (Model Router) ✅ DONE
  - Task 8 (Project Map) ✅ DONE
  - Task 9 (Tool Failure Handling) ✅ DONE
  - Task 10 (Security Boundaries) ✅ DONE
  - Task 11 (Skills System) ✅ DONE
  - All 11 Phase 15 tasks complete!
- **Phase 16: Infinity Maps Widget** — **COMPLETE**: Interactive maps widget with Overpass/Nominatim backend, Leaflet frontend, widget SSE integration, chat detection for location queries. Typecheck + build pass on both frontend and API server.

- **Security Hardening Initiative (After All Phases)** — 11 issues with concrete fix steps added to end of PHASES.md:
  1. API key endpoints missing account authorization (CRITICAL)
  2. No centralized authentication middleware (CRITICAL)
  3. Build terminal route missing authentication (CRITICAL)
  4. Build isolation security audit needed (HIGH)
  5. Browser safety model regex URLs insufficient (HIGH)
  6. Global 1GB JSON body limit (HIGH)
  7. CORS extremely permissive (MEDIUM)
  8. Frontend bundle size — no code splitting verified (MEDIUM)
  9. Session invalidation on password change only (LOW)
  10. No rate limiting on auth endpoints (LOW)
  11. Secret redaction incomplete in logs/context (LOW)

## New Phases Added (User Request)
- **Phase 16: Infinity Maps Widget** — **COMPLETE**: Interactive maps widget for location queries ("where should I eat"), OpenStreetMap + Overpass API, Leaflet/MapLibre, directions to OS maps apps
- **Phase 17: Project Types System** — PLANNED: Book, Website, Company, App, Research, Course types with tailored UI/tools (Company: logo/slogan/promo, Website: build mode/GitHub/Figma, Book: extends Book Studio)
- **Phase 18: Promo Maker** — **COMPLETE**: Puppeteer-driven promo videos with aesthetic cursor (OpenAI-style), ASMR sound effects (Web Audio API), AI speed optimization (detects slow sections, re-renders at 2-4x)
- **Phase 19: Local Model Integration** — **COMPLETE**: Qwen2.5-1.5B-Instruct via Ollama for error fixing/explaining, "Fix with Local AI" button in error toast + ErrorBoundary, build-agent verification loop integration to apply fixes to its own code
- **Phase 20: Deep Research v2** — PLANNED: True 3-7 min deep research agent (ChatGPT/Gemini style), 20-50 sources, iterative plan→search→browse→extract→synthesize→gap analysis loop, structured report with citations

## Tavily Research Findings — Key Gaps & Actionable Improvements for Infinity

### 1. Multi-Agent Coordination (Missing in Infinity)
- **Claude Code**: Single agent with sub-agent tool use, no persistent multi-agent orchestration
- **OpenHands/Cline**: Single agent per task, but can spawn sub-tasks
- **LangGraph/Autogen/CrewAI**: Full multi-agent frameworks with state machines, handoffs, shared memory
- **Action for Infinity**: Add multi-agent orchestration layer — planner agent → coder agents → reviewer agent → fixer agent with explicit handoff protocol and shared context store

### 2. Scheduled Agents / Cron (Missing in Infinity)
- **Replit Agent**: Background agents that run on schedules
- **OpenHands**: Supports scheduled tasks via cron-like triggers
- **Cursor**: No native scheduling
- **Action for Infinity**: Add cron scheduler for agents — run builds, research, maintenance on schedules (daily, weekly, custom). Integrate with existing `build-scheduler` concept in Phase 5.3

### 3. Messaging Connectors (Missing in Infinity)
- **All major agents**: Slack/Discord/Telegram integrations for notifications & control
- **Claude Code**: Slack app for notifications
- **Action for Infinity**: Add connector framework — Slack bot, Discord bot, Telegram bot for build status, chat notifications, remote command execution

### 4. Headless CI/CD Mode (Partial in Infinity)
- **Replit Agent**: Full headless mode for CI pipelines
- **OpenHands**: Headless mode for automated runs
- **Claude Code**: `--headless` flag for CI
- **Action for Infinity**: Add `--headless` CLI mode for Infinity Build — run builds non-interactively, exit codes for CI, JSON output for pipeline integration

### 5. ACP Protocol Support (Missing in Infinity)
- **Anthropic ACP**: Agent Client Protocol for standardized agent-tool communication
- **MCP**: Model Context Protocol (already have browser extension as MCP-like)
- **Action for Infinity**: Implement ACP server — allows external clients to drive Infinity agent, standardizes tool calls, enables IDE integrations beyond browser

### 6. MCP Server Integration (Partial - have browser extension)
- **Current**: Browser extension acts as MCP-like client
- **Missing**: MCP server exposing Infinity tools (file ops, git, build, research) to external LLMs
- **Action for Infinity**: Build MCP server — expose `list_files`, `read_file`, `edit_file`, `run_command`, `build_agent` as MCP tools

### 7. Deeper SWE-Bench Optimization (Missing in Infinity)
- **SWE-Bench Verified**: 500 real GitHub issues — top agents score 30-60% resolve rate
- **Key patterns**: Reproduction-first, test-driven fixing, iterative verification, patch generation
- **Action for Infinity**: Add SWE-Bench mode — reproduce issue → write failing test → fix → verify → generate patch. Integrate with build-agent verification loop

### 8. Local LLM Excellence (Infinity has this ✓)
- **Qwen3-Coder**: 32B/7B — best open coding model, beats GPT-4 on some benchmarks
- **DeepSeek-Coder-V2**: 236B/16B — strong reasoning, 128K context
- **Codestral**: 22B — optimized for code completion
- **Devstral**: 22B — agentic coding focus
- **Infinity status**: Already configured via Ollama + OpenRouter/NVIDIA NIM failover ✓

### 9. File System Access API (Infinity has this ✓)
- **Unique advantage**: Browser-native `showDirectoryPicker()` for persistent local workspace
- **Competitors**: Most require Docker/VM or cloud workspace
- **Infinity status**: Complete integration with IndexedDB persistence ✓

### 10. Autonomous Coding Agent (Infinity has this ✓)
- **Phase 1 complete**: Tool-using agent with 9 tools, state machine, verification
- **Competitors**: OpenHands, Cline, Aider have similar but less integrated with browser
- **Infinity status**: Complete with browser pool, snapshots, edge cases ✓

## Priority Implementation Order (for $0 budget)
1. **Headless CI/CD mode** — unlocks automated testing, free GitHub Actions
2. **MCP Server** — makes Infinity tools available to any LLM client
3. **Multi-agent orchestration** — planner→coder→reviewer→fixer pipeline
4. **Scheduled agents/cron** — automated maintenance, research, builds
5. **Messaging connectors** — Slack/Discord/Telegram for remote monitoring
6. **ACP Protocol** — standardized IDE integration
7. **SWE-Bench mode** — benchmark & optimize against real issues
- **Build Mode (Infinity) Phase 1: Autonomous Coding Agent (NEW)** — **COMPLETE**: Replaced single-shot JSON-map generation with tool-using autonomous agent. Created build-tools.ts (9 tools), build-agent.ts (state machine + runAutonomousAgent/runAgentForStep), 3 new API routes (/build/agent/run, /build/agent/step, /build/agent/tools). Typecheck + build pass.
- **Facial recognition in camera mode** — **COMPLETE**: MediaPipe Face Landmarker (478 landmarks, bounding box, key features, head pose) integrated alongside object detection + hand tracking. 100% free, browser-based.
- **Browser extension for Infinity** — **COMPLETE**: Created full Manifest V3 extension with WebSocket endpoint, background service worker, content script, popup UI, and injected script. API server has /api/jarvis/extension/ws + REST endpoints. Verified working end-to-end.
- **Build Mode (Infinity) Phase 2: Loop Intelligence** — **COMPLETE**: Diff preview ✓, verification loop ✓, parallel fan-out ✓, modular prompts ✓, retry loop with fixer prompt ✓, UI diff modal integration ✓, wire /build/execute-plan ✓.
- **Build Mode (Infinity) Phase 3.1: Smart Working Context** — **COMPLETE**: fileMap, keyDecisions, errorPatterns, tokenBudget, compaction implemented in `build-context.ts`.
- **Build Mode (Infinity) Phase 3.2: Project-Scoped Memory Integration** — **COMPLETE**: Created `build-project-context.ts`; wired project instructions, memory, activity, files into `/build/execute-plan`, `/build/scaffold`, `/build/iterate`; strict projectId guarding.
- **Build Mode (Infinity) Phase 4.1: Workspace Snapshots + Rollback** — **COMPLETE**: Tar.gz snapshots at checkpoints, history timeline, restore/export actions, 4 REST routes; typecheck + build pass.
- **Build Mode (Infinity) Phase 4.2: Browser Pool** — **COMPLETE**: 3-5 pre-warmed Chromium, session persistence, screenshot diffing, CDP accessibility, 10 REST routes; typecheck + build pass.
- **Build Mode (Infinity) Phase 4.3: Resource Limits + Cost Tracking** — **COMPLETE**: Per-workspace budgets, token/cost tracking, daily aggregates, dashboard stats, 7 REST routes; typecheck + build pass.
- **Build Mode (Infinity) Phase 4.4: Command Palette + Keyboard Mastery** — **COMPLETE**: 10 server-side command routes (create-checkpoint, rollback, export, refresh-files, browser open/close, budget status/set) backing client palette; typecheck + build pass.
- **Build Mode (Infinity) Phase 5.1: Telemetry + Debugging** — **COMPLETE**: Backend `logBuildEvent` wired to all build lifecycle routes + checkpoints; REST routes (recent/all/summary/count, DELETE, batch POST); frontend Debug panel (build-debug-panel.tsx) with Live/Replay, type filter, summary, export JSONL, clear logs; 26 i18n keys; typecheck + build pass.
- **Build Mode (Infinity) Phase 5.2: Export / Share / Clone** — **BACKEND + FRONTEND COMPLETE**: 6 backend routes (export/info, export/zip, export/tar-gz, share, shared/:token, clone) + Debug panel UI with ZIP/tar.gz export buttons, Share (copy link), Clone (prompt target projectId); 4 i18n keys; typecheck + build pass.
- **Build Mode (Infinity) Phase 5.3: Edge Cases** — **FULL COMPLETE**: `build-edge-cases.ts` library + 11 REST routes + Debug panel UI (Preflight, Disk Space, Queue, Edge Cases, Rate Limit buttons + status grid) + build loop integration; network retry, disk full pause, rate limit queue, git conflict auto-resolve, workspace corruption detect/repair, concurrent build queue, pre-flight check; 9 i18n keys EN+NL; typecheck + build pass. All Phase 5 complete.
- **Build Studio reliability:** visible progress transcript, plan/scaffold error handling, cancellation, bounded self-review pipeline implemented and verified; no active code changes remain.
- **Projects System** — core backend, Project Memory, Project Instructions, Projects navigation, AI Context Pipeline, and Project Activity are implemented and verified. Next work: Project Files, Project Research, Project Tasks, or UI cleanup.
- **Book Studio** — fully built + wired, server `.env` now ready for live end-to-end run.
- **Gem → Expert rename** — **COMPLETE (10/10)**: User-facing + internal backend terminology now consistent. DB `kind:"gem"`, API `gemSystemPrompt`/`gemConversationId` kept as documented legacy contract.

## Next actions
1. **Phase 18: Promo Maker** — **IN PROGRESS**: Core engine implemented with spring-physics cursor, zoom/pan actions, ASMR audio generation, basic text overlays. Need to enhance to Apple/OpenAI quality:
   - Brand kit integration (colors, fonts from company project via Tavily API)
   - Professional text overlays with company fonts, dynamic positioning, animations
   - Device frame mockups (iPhone, MacBook, iPad)
   - Color grading/post-processing (LUTs, contrast, saturation, vignette)
   - Narrative script structure (hook → demo → CTA sections)
   - Per-segment variable speed optimization (LLM-driven)
   - Update PromoWidget to show step descriptions as text overlays synchronized with video
   - Connect ProjectHomeCompany brand data (palette, fonts) through API to promo-maker
2. **Phase 14: Responsive UI Redesign (Mobile + Desktop as Different Websites)** — IN PROGRESS: Create feature views in `artifacts/jarvis/src/components/views/` for Build, Chat, Terminal, Settings, Projects — each with BOTH desktop (sidebar nav, keyboard shortcuts) and mobile (bottom nav, sheet modals, swipe gestures) implementations. Treat them as different websites for the same goal.
3. **Phase 17: Project Types System** — PLANNED: Book, Website, Company, App, Research, Course types with tailored UI/tools (Company: logo/slogan/promo, Website: build mode/GitHub/Figma, Book: extends Book Studio)
4. **Phase 19: Local Model Integration** — PLANNED: Qwen2.5-1.5B-Instruct via Ollama for error fixing/explaining, chat fallback when keys cooling, build-agent integration
5. **Phase 20: Deep Research v2** — PLANNED: True 3-7 min deep research agent (ChatGPT/Gemini style), 20-50 sources, iterative plan→search→browse→extract→synthesize→gap analysis loop, structured report with citations
6. **Phase 10: Messaging Connectors** — Slack/Discord/Telegram bots for notifications & remote control
7. **Phase 12: SWE-Bench Optimization** — Reproduction-first, test-driven fixing mode
8. **Phase 13: Self-Evolving Code Capability** — Agent modifies own code with safety gates
9. **Chat/voice mode API key fallback logic** — **COMPLETE**: fail → retry button → if fail again → retry button → if clicked, try next API key (try same key once, then switch)

## Locked decisions
- Projects System: **plan-first** — build only after all requirements are planned (user instruction).
- Build Mode (Infinity): follow `BUILD_MODE_COMPLETION_PLAN.md` phases sequentially (Phase 0 → 1 → 2 → 3 → 4 → 5).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)