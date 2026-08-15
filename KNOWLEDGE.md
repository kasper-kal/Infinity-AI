# KNOWLEDGE.md — Jarvis Durable Knowledge

> Curated project memory. **Replaces** claude_changes_log.txt + .session_state.md + whats_next.md (archived in `archive/`).
> Read alongside **session-brief.md** (the living working state). **UPDATE on change — never append.**
> If a fact here is stale, edit it. If something durable happened, add it here (and note it in session-brief.md's recent conversation).

## Who & ground rules
- Owner: **Kasper Kal** (kasperkal1970@gmail.com). GitHub: kasper-kal/Jarvis. Personal hobby project.
- Budget: **every thing, service, API, hosting, library = 0 euro, permanently free, no free trials.**
- Continuity: user wants every session to feel like one chat → **session-brief.md is the live state (updated every change)**; this file is the stable how-it-works reference.
- **Memory rule: never store personal trivia** (titles, how to address the user, small talk). Only project state, change record, and how-it-works. Trivia like "sir" dies with the session by design.
- User works in short, structured messages; dislikes stale/repetitive tracking noise.

## Repository map (reuse, don't rebuild)
- Monorepo: `artifacts/api-server` (Express, port 8080) · `artifacts/jarvis` (React + Vite, port 5173) · `lib/db` (Drizzle package `@workspace/db`) · `Books/` (live style samples) · `scripts/` · `docs/` · `archive/` · `qa-report/`.
- Stack: Drizzle ORM + Postgres (Neon), Express routers under `/api/jarvis/*`, React + Tailwind + framer-motion + lucide-react, i18n `en`/`nl` (type-enforced `nl: Record<keyof typeof en, string>`), Puppeteer (A5 PDFs, screenshots).
- DB schema: `lib/db/src/schema/` (one file per domain). Idempotent migrations: `lib/db/src/auto-migrate.ts` (`CREATE TABLE IF NOT EXISTS` + `ALTER ... ADD COLUMN IF NOT EXISTS`).
- LLM key pool lives in server `.env` (gitignored): OpenRouter first, NVIDIA NIM failover; plus Whisper, Flux, ElevenLabs, Tavily, Spotify, Google.

### Existing systems to reuse
- **Global memory** — `userMemories` (topic PK upsert) + `routes/jarvis/memories.ts` (GET/PATCH/DELETE) + LLM auto-extraction in chat.ts (~L448, upserts not duplicates) + memory-block injection into system prompt (~L504).
- **Projects folder system** (base for the Projects upgrade) — schema `projects`/`projectChats`/`projectFiles`/`pins` in `lib/db/src/schema/projects.ts`; CRUD in `routes/jarvis/projects.ts`; UI `components/project-gallery.tsx` rendered in `chat-sidebar.tsx` (~line 147). Create project, expand → load its chats.
- `routes/jarvis/project-tags.ts` — tag helper route also exists.
- **Background research jobs** — `researchJobs` schema + `routes/jarvis/research.ts` (queued/running/completed, progress/phase/log/notes/heartbeat, resume-on-boot pattern).
- **Book Studio** (`books.ts` schema, `book.ts` routes, `book-studio.tsx`, ~45 `book.*` i18n keys) — the most recent full feature end-to-end; copy its conventions: Drizzle schema + idempotent auto-migrate entries, router registration, frontend wizard, `en`/`nl` i18n Records, background polling + push notification.
- **Auto-migrate:** `lib/db/src/auto-migrate.ts` (books.ts added ~20 `ALTER ADD COLUMN IF NOT EXISTS` entries) — reuse for every new table/column below.
- **Stack/conventions:** Drizzle ORM + Postgres (Neon), Express routers under `/api/jarvis/*`, React + Vite + Tailwind + framer-motion + lucide-react, i18n via `src/lib/i18n.tsx` (`nl: Record<keyof typeof en, string>` type-enforced). **0-euro budget — no paid services, no free trials.**
- **Jarvis-the-app must not read internal working docs** — blocked in `artifacts/api-server/src/lib/source-code.ts` (KNOWLEDGE.md, session-brief.md, jarvis config, .env, etc.).

## Active projects
> Live status (what's done/in-flight/next) always lives in **session-brief.md** — this section holds only permanent facts.
- **Book Studio** — permanent facts: full A5-PDF book generator (idea → plan → approve/"change something" → 10-page LLM chunks → 2 critique passes → A5 PDF + book.txt), BYO API key, push notification, background job. Built + verified.
- **Projects System** — permanent facts: user's brief "persistent workspaces with isolated project memory"; full requirement capture + implementation plan in `docs/projects-system-plan.md`; core backend (project CRUD, management, conversation scoping, project home backend), Project Memory (isolated storage, CRUD/pin APIs, keyword retrieval, project-scoped extraction), Project Instructions (ordered rules, scoped API, bilingual UI, chat injection), first-class Projects navigation (search/sort/archive/pin/rename/delete/create-from-chat/move + quick-access rail), AI Context Pipeline (six scoped sources assembled into PROJECT CONTEXT block), and Project Activity feed (cursor pagination, search, load-more, emoji icons, i18n, logActivity wired across all mutating routes). All verified with typecheck + build passing.
- **Build Mode (Infinity)** — permanent facts: completion plan in `BUILD_MODE_COMPLETION_PLAN.md` with Phase 0 (UI Unfuck — mobile bottom sheet, desktop three-pane layout, theme tokens, accessibility), Phase 1 (Foundation — git worktree isolation, checkpoint/resume, structured tool results), Phase 2 (Loop Intelligence — diff preview, verification loop, parallel fan-out, prompt overhaul), Phase 3 (Context & Memory — smart working context, project-scoped memory integration), Phase 4 (Developer Experience — snapshots/rollback, browser pool, resource limits, command palette), Phase 5 (Polish — telemetry, export/share, edge cases). **Phase 0 (UI Unfuck) COMPLETE**. **Phase 1 (Foundation: git worktree isolation + checkpoints/resume) COMPLETE**. Currently at **Phase 2: Loop Intelligence** — diff preview + confirmation, real verification loop (tsc/vitest/eslint/build), parallel step fan-out, prompt engineering overhaul.

## Decisions registry
- 2026-08-15 Build Mode (Infinity) Phase 1: git worktree isolation + checkpoint/resume implemented — each project gets isolated repo at `WORKSPACE_ROOT/worktrees/<id>` with branch `infinity/build/<id>`, node_modules symlinked to global pnpm store, atomic per-iteration commits, instant rollback via `git reset --hard HEAD~1`. Checkpoints persisted to `build_checkpoints` table with plan, completedSteps, workingContext, fileSnapshots, tokenUsage. Resume endpoint fetches latest incomplete checkpoint.
- 2026-08-12 Jarvis UI cleanup: the daily chat shell uses a restrained hierarchy with one toolbar action cluster, quieter grouped sidebar navigation, collapsed Projects by default, bounded conversation reading width, and a centered composer surface; every control surface uses the theme tokens — no hardcoded `bg-white dark:bg-[#...]` or hex bubble colors (user bubble = `bg-primary/10 dark:bg-primary/25`, toolbar/back buttons = `bg-card/80` + `border-border/50`). Deliberate brand colors stay (Studios hub per-studio tiles, Figma purple, Build Studio dark code surfaces).
- 2026-08-12 Build Studio reliability: build progress is shown in a live Jarvis transcript rather than only a spinner/toast; plan acceptance closes plan mode before scaffolding, aborts are explicit cancellations, screenshot busy state is always released, and self-review is bounded.
- 2026-08-12 Projects System navigation: the existing Jarvis sidebar remains the global shell, while its Projects section provides scoped search/sort/archive/pin/rename/delete/create-from-chat/move actions and a compact project quick-access rail; unsupported project tools report honestly until their dedicated implementation lands.
- 2026-08-12 Projects System instructions: `project_instructions` is the canonical ordered rule store, exposed through strict project-scoped CRUD/reorder APIs and a bilingual Jarvis-native editor; mutations synchronize the legacy `projects.instructions` column, and project chat injects all rules with legacy fallback.
- 2026-08-12 Projects System memory: Project Memory is a dedicated Jarvis-native view opened from the project home, with bilingual grouped CRUD/search/pin controls; it does not alter global chat navigation.
- 2026-08-12 Projects System memory engine: `project_memories` is keyed by `(projectId, canonical key)`; retrieval is zero-cost keyword scoring with all pinned memories plus up to twelve relevant rows; project chats extract only durable project facts and never read/write global user memory.
- 2026-08-12 Projects System conversations: project chats are created transactionally, hidden from global conversation list/search, and receive project identity plus project instructions instead of global user-memory context; dedicated project-memory retrieval completed.
- 2026-08-12 Projects System home: implemented the scoped project-home aggregate and Jarvis-native dashboard, including project selection, back/continue/new-chat callbacks, and the useful empty state.
- 2026-08-11 Repo cleanup: stale docs → `archive/`; deleted orphaned WhatsApp session + junk; extended `.gitignore`.
- 2026-08-12 CLAUDE.md: removed AUTO-RESUME SYSTEM section + Chromebook note.
- 2026-08-12 Continuity redesign: replaced the 3 routine files with **KNOWLEDGE.md + session-brief.md**; raw history archived.

## Conventions that must not break
- **Commit + push after every response** (user requirement — see CLAUDE.md).
- Every UI string goes through `t()`, added to BOTH `en` + `nl`.
- Work is "done" only when both apps typecheck + server bundles (unless a quick fix).
- 0-euro budget everywhere, no free trials.