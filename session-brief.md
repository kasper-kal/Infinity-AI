# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-14 00:00

## Just did (last action)
- Completed Project Activity feed frontend component with i18n, navigation integration, and logActivity wiring across all 7 mutating route files:
  - Created `artifacts/jarvis/src/components/projects/project-activity.tsx` with ActivityRecord interface, cursor-based pagination, search filtering, load more, emoji icons per type, localized date formatting
  - Added `projectActivity.*` i18n namespace (17 keys EN + NL) to `artifacts/jarvis/src/lib/i18n.tsx`
  - Wired into project gallery (`activity` section + Activity icon), project home (`activity` action + recent activity card), and home page (`handleProjectAction` for 'activity')
  - Fixed TypeScript errors in project-home.tsx (replaced payload.recentActivity with recentActivity state) and home.tsx (added 'activity' to activeProjectView union)
  - logActivity integrated across: projects.ts, project-memories.ts, project-instructions.ts, project-tasks.ts, project-research.ts, conversations.ts, files.ts
  - Fixed Drizzle enum typing in project-activity.ts VALID_TYPES with `as const`
  - Build passes (typecheck + vite build)
- Removed all Phase A–O and steps 1–20/11–20 references from KNOWLEDGE.md and session-brief.md per user request

## Project state — right now
- **UI cleanup work:** core chat-shell cleanup is implemented and verified across toolbar, sidebar, Projects, conversation feed, and composer; remaining hardcoded light/dark colors were converted to theme tokens (user bubble, header actions, voice/camera back buttons, settings avatar badge).
- **Build Studio progress work:** complete. The transcript is portaled out of the notice content, screenshot requests settle safely, accepted plans leave plan mode immediately, plan requests preserve earlier updates, pipeline terminal states remain visible, progress messages avoid nested state updates, and dismissed questions cannot strand the run.
- **Continuity system:** `CLAUDE.md` routine + `KNOWLEDGE.md` (how it works) + `session-brief.md` (live state) replace the old 3 logs (archived in `archive/`). `source-code.ts` blocks KNOWLEDGE/session-brief from Jarvis-the-app's source reading.
- **Projects System:** brief "persistent workspaces with isolated project memory". Core backend (project CRUD, management, conversation scoping, project home backend), Project Memory (isolated storage, CRUD/pin APIs, keyword retrieval, project-scoped extraction), Project Instructions (ordered rules, scoped API, bilingual UI, chat injection), first-class Projects navigation (search/sort/archive/pin/rename/delete/create-from-chat/move + quick-access rail), AI Context Pipeline (six scoped sources assembled into PROJECT CONTEXT block), and Project Activity feed (cursor pagination, search, load-more, emoji icons, i18n, logActivity wired across all mutating routes). All verified with typecheck + build passing.
- **Book Studio:** fully built + wired (schema, engine, routes, wizard, polling, A5 PDF verified). Pending: one live end-to-end run (needs server `.env`).
- **DB (Drizzle, `lib/db/src/schema/`):** accounts · books · build-apps · conversations · files · gmail · groups · llm-keys · memories (global) · project-instructions (scoped) · project-memory (scoped) · projects (+projectChats/projectFiles/pins) · push · research · secrets · settings · sharing · spotify · timers.
- **Features:** chat (global memory + LLM auto-extraction ~chat.ts L448 + context injection ~L504), voice mode, camera detection, Build Studio (@Build shortcut, CodeMirror), Book Studio, deep-research background jobs, Projects folder system, code editor, Jarvis browser, music/Spotify, timers, Gmail/Calendar, command palette.

## Change record (newest first — EVERY change logged here, cap ~15)
- 2026-08-14 Removed all Phase A–O and steps 1–20/11–20 references from KNOWLEDGE.md and session-brief.md per user request
- 2026-08-13 Project Activity feed completed: frontend ActivityRecord component with cursor pagination + search + load-more + emoji icons, `projectActivity.*` i18n (17 keys EN/NL), gallery/home/home-page wiring for 'activity' section; logActivity integrated across all 7 mutating route files (projects, memories, instructions, tasks, research, conversations, files); Drizzle enum typing fixed with `as const`. Build passes.
- 2026-08-12 AI Context Pipeline implemented: `lib/project-context.ts` assembles six scoped sources (identity, instructions, memory, files w/ text excerpt, history from other project chats, research runs) into the PROJECT CONTEXT block; `chat.ts` `buildProjectContext` now delegates to it; all queries strictly filtered by projectId. Build passes.
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

## Active threads
- **Build Studio reliability:** visible progress transcript, plan/scaffold error handling, cancellation, and bounded self-review pipeline are implemented and verified; no active code changes remain.
- **Projects System** — core backend, Project Memory, Project Instructions, Projects navigation, AI Context Pipeline, and Project Activity are implemented and verified. Next work: Project Files, Project Research, Project Tasks, or UI cleanup.
- **Book Studio** — live end-to-end run pending (needs server `.env`).

## Next actions
1. On the next UI-cleanup request, continue with the remaining overlay surfaces (settings panel rows, command palette, toasts) and the hardcoded terminal dark surfaces in Build Studio only if the user flags them.
2. On the next Projects System request, continue with Project Files, Project Research, Project Tasks, or the user-selected area.
3. When the user supplies additional requirements, extend the plan faithfully and reconcile before implementing any newly affected scope.
4. Optional: delete now-inert `.cron_watchdog.sh` / `.tmux_runner.sh` if user wants.

## Locked decisions
- Projects System: **plan-first** — build only after all requirements are planned (user instruction).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)