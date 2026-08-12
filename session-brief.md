# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-12

## Just did (last action)
- Updated README with an Agent Workflow section that points automation agents to `AGENTS.md` and explains the continuity files (`CLAUDE.md`, `session-brief.md`, `KNOWLEDGE.md`).

## Project state — right now
- **UI cleanup work:** core chat-shell cleanup is implemented and verified across toolbar, sidebar, Projects, conversation feed, and composer; remaining hardcoded light/dark colors were converted to theme tokens (user bubble, header actions, voice/camera back buttons, settings avatar badge).
- **Build Studio progress work:** complete. The transcript is portaled out of the notice content, screenshot requests settle safely, accepted plans leave plan mode immediately, plan requests preserve earlier updates, pipeline terminal states remain visible, progress messages avoid nested state updates, and dismissed questions cannot strand the run.
- **Continuity system:** `CLAUDE.md` routine + `KNOWLEDGE.md` (how it works) + `session-brief.md` (live state) replace the old 3 logs (archived in `archive/`). `source-code.ts` blocks KNOWLEDGE/session-brief from Jarvis-the-app's source reading.
- **Projects System:** 32-step user brief "persistent workspaces with isolated project memory". Steps 1–20 remain planned in `docs/projects-system-plan.md`, with **Phases B–H implemented** (including ordered Project Instructions and first-class Projects navigation). Phases I–O remain planned. Awaiting steps 21–32.
- **Book Studio:** fully built + wired (schema, engine, routes, wizard, polling, A5 PDF verified). Pending: one live end-to-end run (needs server `.env`).
- **DB (Drizzle, `lib/db/src/schema/`):** accounts · books · build-apps · conversations · files · gmail · groups · llm-keys · memories (global) · project-instructions (scoped) · project-memory (scoped) · projects (+projectChats/projectFiles/pins) · push · research · secrets · settings · sharing · spotify · timers.
- **Features:** chat (global memory + LLM auto-extraction ~chat.ts L448 + context injection ~L504), voice mode, camera detection, Build Studio (@Build shortcut, CodeMirror), Book Studio, deep-research background jobs, Projects folder system, code editor, Jarvis browser, music/Spotify, timers, Gmail/Calendar, command palette.

## Change record (newest first — EVERY change logged here, cap ~15)
- 2026-08-12 README Agent Workflow section added so contributors and automation agents know to read `AGENTS.md` and keep the continuity files aligned.
- 2026-08-12 Chat-shell hardcoded-color cleanup verified: `pnpm run typecheck` and `git diff --check` pass; user bubble, header actions (GroupSettings/ConversationActions), voice/camera back buttons, and the settings avatar badge now use theme tokens instead of hardcoded light/dark hexes.
- 2026-08-12 Jarvis composer cleanup: the input now uses a centered max-width surface with neutral theme tokens instead of competing hardcoded light/dark pill styles.
- 2026-08-12 Jarvis conversation-feed cleanup: assistant content now sits in a bounded reading column, user bubbles have a readable maximum width, and feed spacing is less cramped.
- 2026-08-12 Jarvis Projects cleanup: the Projects section starts collapsed so the conversation list remains the primary sidebar focus.
- 2026-08-12 Jarvis sidebar cleanup: navigation is grouped, the workspace header is compact, and footer actions no longer compete with the top toolbar.
- 2026-08-12 Jarvis UI cleanup started: HomeHeader now uses a single restrained toolbar hierarchy with consistent surfaces and an explicit New Chat action.
- 2026-08-12 Build Studio progress reliability verification passed: `pnpm run typecheck` and `git diff --check` are clean; production build was not run per Freebuff's no-unrequested-build rule, and preview remains stopped/not started.
- 2026-08-12 Build Studio question-dialog dismissal now settles an unanswered waiting run as cancelled rather than leaving it stuck.
- 2026-08-12 Durable Build Studio knowledge now documents the live progress transcript, explicit cancellation/error states, screenshot cleanup, and bounded self-review.
- 2026-08-12 Build Studio progress message updates now use a ref-backed snapshot, avoiding state setters inside the progress-list updater.
- 2026-08-12 Build Studio plan-ready and scaffold-start toasts no longer replace the live progress transcript.
- 2026-08-12 Build Studio pipeline failures no longer overwrite the progress transcript with a separate toast; preview/screenshot notices are suppressed during the pipeline.
- 2026-08-12 Build Studio plan requests now reuse the active progress run instead of restarting it from a stale progress-status closure.
- 2026-08-12 Build Studio accepted plans now snapshot the approved plan, close plan mode immediately, and reject an empty prompt before scaffolding.
- 2026-08-12 Build Studio screenshot requests now reset busy state in a finally block and treat aborts as a settled cancellation path.
- 2026-08-12 Build Studio progress host decoupled from the normal notice content; the visible transcript is being finalized as a standalone overlay.
- 2026-08-12 Build Studio progress wiring added: build lifecycle handlers now publish live transcript messages, abort active requests, surface errors, and stop after a bounded self-review limit.
- 2026-08-12 Build Studio progress panel added: the transcript shows user request, Jarvis updates, elapsed timing, status, cancel, and close controls using the existing i18n system.
- 2026-08-12 Build Studio progress foundation added: timed transcript state, cancellation refs, and explicit terminal states are ready for the visible build-progress chat panel.
- 2026-08-12 Phase H final verification passed: typecheck, build, diff checks, and preview-status verification are complete; preview remains stopped with the saved commands intact.
- 2026-08-12 Phase H build verification passed: typecheck and both workspace builds are clean; only pre-existing Vite sourcemap/chunk-size warnings remain, and preview stays stopped.
- 2026-08-12 Durable knowledge updated: `KNOWLEDGE.md` now records Phase H navigation as implemented and Phase I project files as the next gap.
- 2026-08-12 Phase H plan updated: first-class project navigation, scoped management actions, quick access, and global-navigation boundaries are now documented as implemented.
- 2026-08-12 Phase H typecheck passed after the Projects navigation/frontend wiring; backend and frontend workspace checks are clean.
- 2026-08-12 Phase H typecheck fix: project conversation JSON is awaited before updating the chat cache, keeping the async loader valid.
- 2026-08-12 Phase H Home wiring added: project shortcuts now open the project home, memory, instructions, or honest future-tool feedback; the project chat shortcut creates a scoped conversation without changing global chat navigation.
- 2026-08-12 Phase H sidebar bridge added: `ChatSidebar` now forwards the active project and quick-access/new-project-chat callbacks into the upgraded Projects section.
- 2026-08-12 Phase H bilingual Projects navigation copy added: project search, sort, archive, pin, rename, move, quick-access, and gallery labels now use the shared English/Dutch i18n dictionaries.
- 2026-08-12 Phase H gallery typing cleanup: the new quick-access labels use the shared `TranslationKey` contract and unused navigation imports were removed.
- 2026-08-12 Phase H Projects section upgraded: first-class scoped search/sort, archive visibility, pinning, inline rename, archive/delete actions, create-from-conversation, move-current-chat, and project quick-access controls are now in the sidebar; preview remains stopped.
- 2026-08-12 Phase G legacy compatibility hardening verified: the legacy project PATCH path and dedicated instruction APIs remain synchronized; typecheck and build pass.
- 2026-08-12 Phase G legacy compatibility completed: the existing project PATCH instruction contract now updates the dedicated ordered table transactionally, while dedicated mutations continue syncing the legacy column.
- 2026-08-12 Durable knowledge corrected: the Projects System context boundary now records dedicated project instructions plus completed project-memory retrieval.
- 2026-08-12 Phase G plan schema detail corrected: the project-instructions record now documents updated timestamps and legacy-column synchronization.
- 2026-08-12 Phase G final diff/status verification passed; preview is stopped with the saved commands intact.
- 2026-08-12 Phase G bilingual copy added: Project Instructions controls, ordering labels, empty states, and the explicit Memory distinction are available in English and Dutch through the existing i18n contract.
- 2026-08-12 Phase G Home wiring added: the Project Home Instructions tile opens the dedicated view and Back returns to the project dashboard without changing global chat navigation.
- 2026-08-12 Phase G bilingual Project Instructions view added: explicit rule list, add/edit/delete, reorder controls, empty/loading/error states, and a clear separation from Project Memory.
- 2026-08-12 Phase G chat context now reads every dedicated instruction in project order, with safe fallback to the legacy instruction column when needed.
- 2026-08-12 Phase G instruction router registered in the Jarvis API before the legacy project router; scoped endpoints are now reachable under `/api/jarvis/projects/:id/instructions`.
- 2026-08-12 Phase G instruction APIs added: strict project-scoped list/add/edit/delete/reorder routes sync the legacy `projects.instructions` field while preserving existing rules.
- 2026-08-12 Phase G auto-migration added: fresh and existing databases now receive the ordered `project_instructions` table and project/order index idempotently.
- 2026-08-12 Phase G schema exported through `@workspace/db`, so server routes and chat context can use scoped project instructions; preview remains stopped.
- 2026-08-12 Phase G verified: `pnpm run typecheck` and `pnpm run build` pass; only existing Vite sourcemap/chunk-size warnings remain, and preview stays stopped.
- 2026-08-12 Phase G plan updated: `docs/projects-system-plan.md` now records the dedicated instruction table, APIs, UI, legacy compatibility, and chat injection as implemented.
- 2026-08-12 Phase G started: added `project_instructions` relational schema with strict project FK, explicit rule text, ordering, and timestamps; preview remains stopped.
- 2026-08-12 Phase F verified: `pnpm run typecheck`, `pnpm run build`, and `git diff --check` pass; only existing Vite sourcemap/chunk-size warnings remain, and preview stays stopped.
- 2026-08-12 Phase F project-memory search broadened to match content, canonical keys, and categories for the UI's scoped search box.
- 2026-08-12 Phase F plan and durable knowledge updated: the project plan and `KNOWLEDGE.md` now record the bilingual Project Memory view as implemented, with Phase G next.
- 2026-08-12 Phase F bilingual copy added: all Project Memory controls and category/source labels are available in English and Dutch through the existing i18n contract.
- 2026-08-12 Phase F Home integration added: the Project Home Memory tile opens the dedicated scoped memory view, and back navigation returns to the project dashboard without changing global chat navigation.
- 2026-08-12 Phase F Project Memory view added: grouped cards, source labels, manual add form, search, inline edit, forget, and pin/unpin controls use the existing Jarvis visual system.
- 2026-08-12 Phase F started: Project Memory UI is the active implementation slice; preview remains stopped.
- 2026-08-12 Phase E chat integration added: project context now retrieves scoped relevant/pinned memory, and project turns use project-keyed extraction while global chats retain global-memory extraction.
- 2026-08-12 Phase E project-memory router registered ahead of global memory routes, preserving global-memory compatibility while keeping scoped mutations explicit.
- 2026-08-12 Phase E isolated memory routes added: grouped project list, manual canonical-key upsert, scoped edit/delete, and pin/unpin endpoints, with compatibility mutations requiring projectId.
- 2026-08-12 Phase E retrieval helper added: project-only keyword scoring selects up to twelve relevant memories and always includes pinned rows, with no vector/paid dependency.
- 2026-08-12 Phase E auto-migration added: fresh and existing databases receive the scoped memory table plus canonical-key and project/pin indexes idempotently.
- 2026-08-12 Phase E schema exported through `@workspace/db`, making the scoped memory table available to server routes and chat context.
- 2026-08-12 Phase E schema added: `project_memories` has project FK isolation, category/content/key, source metadata, pinning, timestamps, and a per-project canonical-key unique index.
- 2026-08-12 Phase E verified: `pnpm run typecheck`, `pnpm run build`, and `git diff --check` pass; the preview configuration remains saved but the preview is stopped.
- 2026-08-12 Durable project knowledge updated: `KNOWLEDGE.md` records Phase E's canonical-key storage, pinned-plus-relevant retrieval, and project-only extraction boundary.
- 2026-08-12 Phase E implementation completed: scoped schema/migration, CRUD/pin routes, keyword retrieval, project-only extraction, and context isolation are in place; final build verification is next; preview remains stopped.
- 2026-08-12 Phase D completed and verified: scoped creation/list/search, project context injection, global-memory suppression, Home/sidebar wiring, `pnpm run typecheck`, `pnpm run build`, and `git diff --check` pass; preview remains stopped.
- 2026-08-12 Phase D global isolation: unscoped conversation list/search excludes project-linked conversations so project chats do not appear in global history.
- 2026-08-12 Phase D frontend/context wiring: Project Home uses transactional project creation, the sidebar requests scoped lists/searches, and chat injects project identity plus legacy instructions while suppressing global memory.
- 2026-08-12 Phase D backend started: conversation creation accepts `projectId` transactionally; general list/search accept `projectId` and enforce project-scoped results.
- 2026-08-12 Phase C completed and verified: dashboard conditional rendering, scoped home aggregate, project callbacks, empty state, `en`/`nl` copy, `pnpm run typecheck`, `pnpm run build`, and `git diff --check` all pass; preview remains stopped.
- 2026-08-12 Phase C Home callbacks added: project chat creation uses existing conversation creation + Phase B move API; project navigation closes cleanly back to chat.
- 2026-08-12 Phase C Home shell started: added project-dashboard state and ProjectHome integration point.
- 2026-08-12 Phase C sidebar callback completed: `ChatSidebar` forwards project selection to the Home shell.
- 2026-08-12 Phase C sidebar bridge added: Project Gallery now emits the selected project id so the Home shell can render its dashboard.
- 2026-08-12 Phase C UI added: `components/projects/project-home.tsx` plus matching `en`/`nl` `projectHome.*` translation keys.
- 2026-08-12 Phase C backend started: added scoped `/projects/:id/home` aggregation using existing project/conversation/file relationships, with explicit empty future sections.
- 2026-08-12 Durable project knowledge updated: `KNOWLEDGE.md` now records Phase B as implemented and the remaining context-pipeline gaps.
- 2026-08-12 Phase B verified: `pnpm run typecheck`, `pnpm run build`, and `git diff --check` pass; preview was not started.
- 2026-08-12 Phase B plan status updated: `docs/projects-system-plan.md` now records the backend slice as implemented and remaining phases as planned.
- 2026-08-12 Phase B typecheck fix: narrowed `req.params.id` in the shared `/chats` + `/conversations` handler.
- 2026-08-12 Phase B routes implemented: first-class project management plus conversation↔project move/remove semantics, with project existence checks and project-scoped queries.
- 2026-08-12 Phase B migration added: fresh `projects` tables include management fields; existing tables receive idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements.
- 2026-08-12 Phase B started: project schema now includes `description`, `pinned`, and `lastOpenedAt` needed for project search, favorites, and recently-used sorting.
- 2026-08-12 Freebuff preview configured: install `pnpm install` · preview `sh scripts/start-dev.sh` :5173 · build `pnpm run build`. `scripts/start-dev.sh` boots API (8080) bg + Vite (5173, 0.0.0.0) fg, merges root `.env.local`+`.env` → `artifacts/api-server/.env`, ensures Chrome deps.
- 2026-08-12 Projects System plan extended to steps 1–20: repo-grounded steps 11–20 (files/research/tasks/agent-ready/activity/DB/API/context-pipeline/UI/empty-states), added phases I–O + re-cut A–H. Key finding: `project_files`/`projects.instructions` exist in schema but are unwired (context pipeline is greenfield).
- 2026-08-12 session-brief Next-actions sharpened for the steps 11–20 handoff: read plan doc first, extend faithfully, DON'T implement yet (plan-first).
- 2026-08-12 session-brief restructured to live-state format; CLAUDE.md routine + KNOWLEDGE.md updated to encode the contract (update on every change; never store personal trivia).
- 2026-08-12 Continuity redesign: KNOWLEDGE.md + session-brief.md replace the 3 old logs; CLAUDE.md routine updated; source-code.ts blockers updated (9ef62ab).
- 2026-08-12 Projects System plan: `docs/projects-system-plan.md` written for steps 1–10 (4541abd).
- 2026-08-12 CLAUDE.md cleanup: removed AUTO-RESUME SYSTEM + Chromebook note (2cbf5ae).
- 2026-08-11 Book Studio: all 10 tasks done + verified (schema, engine, routes, wizard, polling, A5 PDF).
- 2026-08-11 Repo cleanup executed (c4ea241, 97aed33).
- 2026-08-11 home.tsx split (2000→1520 lines) + nl i18n gaps filled.
- 2026-08-11 `Books/` folder added (5 style samples; user updates it often — re-scan every session).

## Active threads
- **Build Studio reliability:** visible progress transcript, plan/scaffold error handling, cancellation, and bounded self-review pipeline are implemented and verified; no active code changes remain.
- **Projects System** — Phases B–H are implemented and verified; Phase I project files is next. Steps 21–32 are still awaited for the full-plan reconciliation.
- **Book Studio** — live end-to-end run pending (needs server `.env`).

## Next actions
1. On the next UI-cleanup request, continue with the remaining overlay surfaces (settings panel rows, command palette, toasts) and the hardcoded terminal dark surfaces in Build Studio only if the user flags them.
2. On the next Projects System request, read `docs/projects-system-plan.md` first and continue with Phase I project files or the user-selected phase.
3. When the user supplies steps 21–32, extend the plan faithfully and reconcile phases before implementing any newly affected scope.
4. Optional: delete now-inert `.cron_watchdog.sh` / `.tmux_runner.sh` if user wants.

## Locked decisions
- Projects System: **plan-first** — build only after all 32 steps are planned (user instruction).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)
