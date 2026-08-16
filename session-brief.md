# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-16 02:10

## Just did (last action)
- **Phase 5.3 — Edge Cases FRONTEND COMPLETE**: Wired Debug panel with Edge Cases UI in build-debug-panel.tsx:
  - Added 5 action buttons: Preflight Check (Shield), Disk Space (HardDrive), Queue (ListChecks), Edge Cases (AlertTriangle), Rate Limit (Zap)
  - Each has loading state with Loader2 spinner; results displayed in status grid below header
  - Preflight shows pass/fail with issues list; Disk Space shows free/total/percent with critical/warning/ok badges
  - Queue shows waiting count + busy/idle status; Edge Cases lists unresolved with type/severity/message
  - Rate Limit shows allowed/limited with retry-after countdown
  - Added Shield, HardDrive, GitMerge, AlertTriangle, Zap, ListChecks icon imports
  - Added 9 new i18n keys (EN+NL): edgePreflight, edgePreflightOk, edgePreflightIssues, edgeDiskSpace, edgeQueue, edgeCases, edgeRateLimit, edgeStatus
  - Typecheck + full build pass

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
- **Build Mode (Infinity):** completion plan in `BUILD_MODE_COMPLETION_PLAN.md` with Phase 0–5. **Phase 0: UI Unfuck — COMPLETE**. **Phase 1: Foundation (worktree isolation + checkpoints) — COMPLETE**. **Phase 2: Loop Intelligence — COMPLETE** (diff preview ✓, verification loop ✓, parallel fan-out ✓, modular prompts ✓, retry-with-fixer ✓, UI diff modal ✓, wire execute-plan ✓). **Phase 3.1: Smart Working Context — COMPLETE** (fileMap, keyDecisions, errorPatterns, tokenBudget, compaction). **Phase 3.2: Project-Scoped Memory Integration — COMPLETE** (instructions, memory, activity, files wired into build loop). **Phase 4.1: Workspace Snapshots + Rollback — COMPLETE** (tar.gz snapshots at checkpoints, history timeline, restore/export). **Phase 4.2: Browser Pool — COMPLETE** (3-5 pre-warmed Chromium, session persistence, screenshot diffing, CDP accessibility). **Phase 4.3: Resource Limits + Cost Tracking — COMPLETE** (per-workspace budgets, token/cost tracking, daily aggregates, dashboard). **Phase 4.4: Command Palette + Keyboard Mastery — COMPLETE** (10 server-side command routes backing client palette). Next: Phase 5 (Polish).
- **Gem → Expert rename:** COMPLETE. User-facing "Gem" feature (custom expert personas + deep-research-spawned expert chats) renamed to "Expert" everywhere. DB/API contract preserved: `kind: "gem"`, `gem_system_prompt`, `gem_conversation_id`, `gemSystemPrompt`, `gemConversationId` fields kept for backward compatibility.
- **DB (Drizzle, `lib/db/src/schema/`):** accounts · books · build-apps · **build-budgets** · **build-costs** · **build-daily-aggregates** · **build-checkpoints** · conversations · files · gmail · groups · llm-keys · memories (global) · project-instructions (scoped) · project-memory (scoped) · projects (+projectChats/projectFiles/pins) · push · research · secrets · settings · sharing · spotify · timers.
- **Features:** chat (global memory + LLM auto-extraction ~chat.ts L448 + context injection ~L504), voice mode, camera detection, Build Studio (@Build shortcut, CodeMirror), Book Studio, deep-research background jobs, Projects folder system, code editor, Jarvis browser, music/Spotify, timers, Gmail/Calendar, command palette, **Experts** (custom personas + research-spawned specialists).
- **Server `.env`:** configured with all API keys (OpenRouter, NVIDIA NIM, Whisper, Flux, ElevenLabs, Tavily, Spotify, Gmail, Figma, Neon Postgres).

## Change record (newest first — EVERY change logged here, cap ~15)
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
- **Build Mode (Infinity) Phase 0: UI Unfuck** — **COMPLETE**: All mobile/desktop UI components built and integrated. Typecheck + build pass.
- **Build Mode (Infinity) Phase 1: Foundation** — **COMPLETE**: Git worktree isolation, checkpoint/resume system, atomic commits, instant rollback. Typecheck + build pass.
- **Build Mode (Infinity) Phase 2: Loop Intelligence** — **COMPLETE**: Diff preview ✓, verification loop ✓, parallel fan-out ✓, modular prompts ✓, retry loop with fixer prompt ✓, UI diff modal integration ✓, wire /build/execute-plan ✓.
- **Build Mode (Infinity) Phase 3.1: Smart Working Context** — **COMPLETE**: fileMap, keyDecisions, errorPatterns, tokenBudget, compaction implemented in `build-context.ts`.
- **Build Mode (Infinity) Phase 3.2: Project-Scoped Memory Integration** — **COMPLETE**: Created `build-project-context.ts`; wired project instructions, memory, activity, files into `/build/execute-plan`, `/build/scaffold`, `/build/iterate`; strict projectId guarding.
- **Build Mode (Infinity) Phase 4.1: Workspace Snapshots + Rollback** — **COMPLETE**: Tar.gz snapshots at checkpoints, history timeline, restore/export actions, 4 REST routes; typecheck + build pass.
- **Build Mode (Infinity) Phase 4.2: Browser Pool** — **COMPLETE**: 3-5 pre-warmed Chromium, session persistence, screenshot diffing, CDP accessibility, 10 REST routes; typecheck + build pass.
- **Build Mode (Infinity) Phase 4.3: Resource Limits + Cost Tracking** — **COMPLETE**: Per-workspace budgets, token/cost tracking, daily aggregates, dashboard stats, 7 REST routes; typecheck + build pass.
- **Build Mode (Infinity) Phase 4.4: Command Palette + Keyboard Mastery** — **COMPLETE**: 10 server-side command routes (create-checkpoint, rollback, export, refresh-files, browser open/close, budget status/set) backing client palette; typecheck + build pass.
- **Build Mode (Infinity) Phase 5.1: Telemetry + Debugging** — **COMPLETE**: Backend `logBuildEvent` wired to all build lifecycle routes + checkpoints; REST routes (recent/all/summary/count, DELETE, batch POST); frontend Debug panel (build-debug-panel.tsx) with Live/Replay, type filter, summary, export JSONL, clear logs; 26 i18n keys; typecheck + build pass.
- **Build Mode (Infinity) Phase 5.3: Edge Cases** — **FULL COMPLETE**: `build-edge-cases.ts` library + 11 REST routes + Debug panel UI (Preflight, Disk Space, Queue, Edge Cases, Rate Limit buttons + status grid); network retry, disk full pause, rate limit queue, git conflict auto-resolve, workspace corruption detect/repair, concurrent build queue, pre-flight check; 9 i18n keys EN+NL; typecheck + build pass
- **Build Mode (Infinity) Phase 5.2: Export / Share / Clone** — **BACKEND + FRONTEND COMPLETE**: 6 backend routes (export/info, export/zip, export/tar-gz, share, shared/:token, clone) + Debug panel UI with ZIP/tar.gz export buttons, Share (copy link), Clone (prompt target projectId); 4 i18n keys; typecheck + build pass.
- **Build Studio reliability:** visible progress transcript, plan/scaffold error handling, cancellation, bounded self-review pipeline implemented and verified; no active code changes remain.
- **Projects System** — core backend, Project Memory, Project Instructions, Projects navigation, AI Context Pipeline, and Project Activity are implemented and verified. Next work: Project Files, Project Research, Project Tasks, or UI cleanup.
- **Book Studio** — fully built + wired, server `.env` now ready for live end-to-end run.
- **Gem → Expert rename** — **COMPLETE (10/10)**: User-facing + internal backend terminology now consistent. DB `kind:"gem"`, API `gemSystemPrompt`/`gemConversationId` kept as documented legacy contract.

## Next actions
1. **Phase 5.3 Integration** — Wire edge case handlers into build loop (`/build/execute-plan`, `/build/iterate`) to use preflightCheck, withRetry, enqueueBuild automatically

## Locked decisions
- Projects System: **plan-first** — build only after all requirements are planned (user instruction).
- Build Mode (Infinity): follow `BUILD_MODE_COMPLETION_PLAN.md` phases sequentially (Phase 0 → 1 → 2 → 3 → 4 → 5).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)