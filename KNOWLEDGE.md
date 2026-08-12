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

### Existing systems to reuse (detail/reuse map: docs/projects-system-plan.md §1)
- **Global memory** — `userMemories` (topic PK upsert) + `routes/jarvis/memories.ts` (GET/PATCH/DELETE) + LLM auto-extraction in chat.ts (~L448, upserts not duplicates) + memory-block injection into system prompt (~L504).
- **Projects folder system** (base for the Projects upgrade) — schema `projects`/`projectChats`/`projectFiles`/`pins` in `lib/db/src/schema/projects.ts`; CRUD in `routes/jarvis/projects.ts`; UI `components/project-gallery.tsx` rendered in `chat-sidebar.tsx`.
- **Background research jobs** — `researchJobs` schema + `routes/jarvis/research.ts` (queued/running/completed, progress/phase/log/notes/heartbeat, resume-on-boot pattern).
- **Book Studio** = the reference full feature end-to-end (schema + auto-migrate + routes + wizard UI + ~45 `book.*` i18n keys + background polling + push notification).
- **Build Studio** — @Build chat shortcut, theme-aware editor, CodeMirror, browser agent.
- **Jarvis-the-app must not read internal working docs** — blocked in `artifacts/api-server/src/lib/source-code.ts` (KNOWLEDGE.md, session-brief.md, jarvis config, .env, etc.).

## Active projects
> Live status (what's done/in-flight/next) always lives in **session-brief.md** — this section holds only permanent facts.
- **Book Studio** — permanent facts: full A5-PDF book generator (idea → plan → approve/"change something" → 10-page LLM chunks → 2 critique passes → A5 PDF + book.txt), BYO API key, push notification, background job. Built + verified.
- **Projects System** — permanent facts: user's 32-step brief "persistent workspaces with isolated project memory"; plan-first approach mandated by user; full requirement capture + phases A–H in `docs/projects-system-plan.md`.

## Decisions registry
- 2026-08-11 Repo cleanup: stale docs → `archive/`; deleted orphaned WhatsApp session + junk (c4ea241, 97aed33); extended `.gitignore`.
- 2026-08-12 CLAUDE.md: removed AUTO-RESUME SYSTEM section + Chromebook note.
- 2026-08-12 Continuity redesign: replaced the 3 routine files with **KNOWLEDGE.md + session-brief.md**; raw history archived.

## Conventions that must not break
- **Commit + push after every response** (user requirement — see CLAUDE.md).
- Every UI string goes through `t()`, added to BOTH `en` + `nl`.
- Work is "done" only when both apps typecheck + server bundles (unless a quick fix).
- 0-euro budget everywhere, no free trials.
