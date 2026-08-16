# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-16 22:30

## Just did (last action)
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
- **Build Mode (Infinity) Phase 6: Headless CI/CD Mode** — **FOUNDATION COMPLETE**: CLI binary (`infinity` command), API key auth middleware + routes, all 40+ build routes protected with scope checking. **Next**: JSON streaming output, exit codes, GitHub Action template. Typecheck + build pass.
- **Build Mode (Infinity) Phase 0: UI Unfuck** — **COMPLETE**: All mobile/desktop UI components built and integrated. Typecheck + build pass.
- **Build Mode (Infinity) Phase 1: Foundation** — **COMPLETE**: Git worktree isolation, checkpoint/resume system, atomic commits, instant rollback. Typecheck + build pass.
- **Tavily Research (1-hour)**: **COMPLETED** - Competitive analysis to make Infinity "THE BEST IT CAN BE for $0" vs Claude Code, Replit Agent, Cursor, OpenHands, Cline, Aider, Goose. Key findings synthesized into actionable improvements below.
- **Desktop-first redesign**: **PENDING** - User complaint: "Jarvis looks horrible on mobile and horrible overall". Need complete UI overhaul with theme tokens, liquid glass material (iOS26 style), responsive layouts.

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
1. **Phase 6: Headless CI/CD Mode — COMPLETE FOUNDATION** — CLI binary built and working (`infinity` command), API key auth applied to all build routes. **Remaining**: Add JSON streaming output, proper exit codes (0=success, 1=build failed, 2=auth error, 3=timeout), GitHub Action template for CI/CD. Test end-to-end: create API key via UI, use CLI with `INFINITY_API_KEY` to run `infinity build --prompt "..." --headless --json`.
2. **Phase 7: MCP Server Integration** — Expose Infinity tools as MCP tools for any LLM client
3. **Phase 8: Multi-Agent Orchestration** — Planner→Coder→Reviewer→Fixer pipeline with shared context
4. **Phase 9: Scheduled Agents / Cron** — Persistent scheduler for builds, research, maintenance
5. **Phase 10: Messaging Connectors** — Slack/Discord/Telegram bots for notifications & remote control
6. **Phase 11: ACP Protocol Support** — Standardized IDE integration via Agent Client Protocol
7. **Phase 12: SWE-Bench Optimization** — Reproduction-first, test-driven fixing mode
8. **Phase 13: Self-Evolving Code Capability** — Agent modifies own code with safety gates
9. **Phase 14: Desktop-First Redesign** — Liquid glass material, theme tokens, keyboard-first
10. **Phase 15: Mobile as Separate Website** — PWA, touch-first, offline-first, dedicated subdomain
   - **Completed searches**: AI coding assistant comparisons (Claude Code, Replit Agent, Cursor), free local LLM models (Qwen3-Coder, DeepSeek-Coder-V2, Codestral, Devstral), open source agent architectures (OpenHands, Cline, Aider, Goose), MCP browser automation, agent architecture best practices
   - **Key findings so far**: 
     - Free LLM APIs in 2026: OpenRouter, Groq, Cerebras, Google AI Studio, NVIDIA NIM - all no credit card required
     - Best free tier combination: OpenRouter (model variety + failover) + Groq/Cerebras (speed) + Google AI Studio (context) + local Ollama (unlimited)
     - Top local coding models: Devstral (46.8% SWE-Bench Verified, 24B params, 128k context), Codestral (22B, 80+ languages, 32k context), Qwen3-Coder, DeepSeek-Coder-V2
     - OpenHands: Self-hosted control center, multiple agent backends, ACP-compatible, Docker/VM/local
     - Cline: Model-agnostic (200+ providers via OpenRouter), Plan/Act modes, .clinerules, MCP servers, multi-agent teams
     - Aider: Repo mapping, auto-git commits, voice-to-code, linting/testing, terminal CLI
     - Goose: Rust-based, desktop/CLI/API, 15+ LLM providers, 70+ MCP extensions, ACP protocol
     - Infinity already has: Autonomous agent with 9 tools, worktree isolation, checkpoint/resume, browser pool, model-agnostic LLM abstraction, file system access API, extension for browser control
     - **Gaps to address**: Multi-agent coordination, scheduled agents/cron, messaging connectors (Slack/Discord/Telegram), headless CI/CD mode, ACP protocol support, MCP server integration, deeper SWE-Bench optimization
3. **Desktop-first redesign, then mobile as separate website** — Original complaint: "Jarvis looks horrible on mobile and horrible overall"
4. **Chat/voice mode API key fallback logic** — **COMPLETE**: fail → retry button → if fail again → retry button → if clicked, try next API key (try same key once, then switch)

## Locked decisions
- Projects System: **plan-first** — build only after all requirements are planned (user instruction).
- Build Mode (Infinity): follow `BUILD_MODE_COMPLETION_PLAN.md` phases sequentially (Phase 0 → 1 → 2 → 3 → 4 → 5).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)