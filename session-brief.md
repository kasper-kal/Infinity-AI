# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-14 01:25

## Just did (last action)
- **Fixed all remaining Phase 0 TypeScript errors** blocking `pnpm run typecheck`:
  - Fixed hoisting issue in `build-studio.tsx`: moved Phase 0 keyboard shortcuts and command palette setup (lines 427-469) after function declarations (`beginScaffold`, `createCheckpoint`, `loadFiles`)
  - Fixed `BuildPlan` type compatibility: changed `steps: string[]` to `steps: PlanStep[]` and imported `PlanStep` from `build-plan-view`
  - Fixed `createPortal` import in `build-toast.tsx`: changed from `import { createPortal } from 'react'` to `import { createPortal } from 'react-dom'`
  - Fixed effect cleanup return type in `build-toast.tsx`: removed boolean return from cleanup function, now returns `void`
- **Typecheck passes**: `pnpm run typecheck` completes with zero errors
- **Full build passes**: `pnpm run build` completes successfully (vite build + api-server build) — 3707 modules transformed, dist artifacts generated
- **Created 5 new Phase 0 components** (all following conventions: CSS variables, framer-motion, lucide-react, i18n):
  - `build-progress-ring.tsx` — Progress ring with pulse animation
  - `build-toast.tsx` — Toast system with 5 variants
  - `build-skeleton.tsx` — Skeleton loading components
  - `use-build-shortcuts.ts` — Keyboard shortcut hook
  - `build-command-palette.tsx` — Fuzzy-search command palette
- **Integrated new components** into `build-studio.tsx` (imports, state, hooks, render)
- **Added 8 missing i18n keys** for Phase 0 components (EN + NL)

## Project state — right now
- **UI cleanup work:** core chat-shell cleanup is implemented and verified across toolbar, sidebar, Projects, conversation feed, and composer; remaining hardcoded light/dark colors were converted to theme tokens (user bubble, header actions, voice/camera back buttons, settings avatar badge).
- **Build Studio progress work:** complete. The transcript is portaled out of the notice content, screenshot requests settle safely, accepted plans leave plan mode immediately, plan requests preserve earlier updates, pipeline terminal states remain visible, progress messages avoid nested state updates, and dismissed questions cannot strand the run.
- **Continuity system:** `CLAUDE.md` routine + `KNOWLEDGE.md` (how it works) + `session-brief.md` (live state) replace the old 3 logs (archived in `archive/`). `source-code.ts` blocks KNOWLEDGE/session-brief from Jarvis-the-app's source reading.
- **Projects System:** brief "persistent workspaces with isolated project memory". Core backend (project CRUD, management, conversation scoping, project home backend), Project Memory (isolated storage, CRUD/pin APIs, keyword retrieval, project-scoped extraction), Project Instructions (ordered rules, scoped API, bilingual UI, chat injection), first-class Projects navigation (search/sort/archive/pin/rename/delete/create-from-chat/move + quick-access rail), AI Context Pipeline (six scoped sources assembled into PROJECT CONTEXT block), and Project Activity feed (cursor pagination, search, load-more, emoji icons, i18n, logActivity wired across all mutating routes). All verified with typecheck + build passing.
- **Book Studio:** fully built + wired (schema, engine, routes, wizard, polling, A5 PDF verified). Pending: one live end-to-end run (needs server `.env`).
- **Build Mode (Infinity):** completion plan in `BUILD_MODE_COMPLETION_PLAN.md` with Phase 0–5. **Currently building Phase 0: UI Unfuck** — mobile transcript bottom sheet (50%/90% snap, drag handle, swipe dismiss), plan horizontal scroll cards, tool call collapsible cards (color-coded), diff preview full-screen modal, progress ring top-center, keyboard avoidance, safe areas, desktop three-pane resizable layout (Plan 320px | Transcript flex | Preview 380px), tool call tree with filter, live preview iframe with console overlay, diff view side-by-side/inline toggle, keyboard shortcuts, CSS variable theme, skeleton loading, error toasts, accessibility (ARIA, focus management, screen reader announcements).
- **DB (Drizzle, `lib/db/src/schema/`):** accounts · books · build-apps · conversations · files · gmail · groups · llm-keys · memories (global) · project-instructions (scoped) · project-memory (scoped) · projects (+projectChats/projectFiles/pins) · push · research · secrets · settings · sharing · spotify · timers.
- **Features:** chat (global memory + LLM auto-extraction ~chat.ts L448 + context injection ~L504), voice mode, camera detection, Build Studio (@Build shortcut, CodeMirror), Book Studio, deep-research background jobs, Projects folder system, code editor, Jarvis browser, music/Spotify, timers, Gmail/Calendar, command palette.

## Change record (newest first — EVERY change logged here, cap ~15)
- 2026-08-14 **Full build passes** (typecheck + vite build) — Phase 0 TypeScript fixes complete, 3707 modules transformed, dist artifacts generated
- 2026-08-14 Fixed all remaining Phase 0 TypeScript errors (hoisting, BuildPlan type, createPortal import, effect cleanup); typecheck passes with zero errors; 5 new Phase 0 components created and integrated
- 2026-08-14 Rendered TranscriptBottomSheet in build-studio.tsx return; full build passes (typecheck + vite build). Phase 0 transcript bottom sheet (50%/90% snap, drag handle, swipe dismiss) now active on mobile.
- 2026-08-14 Added 8 missing i18n keys for Build Studio Phase 0 (EN + NL); fixed 3 TypeScript errors in build-diff-preview.tsx, build-plan-view.tsx, home.tsx; full build passes (typecheck + vite build).
- 2026-08-14 Updated KNOWLEDGE.md and session-brief.md to reflect current work: Phase 0 (UI Unfuck) from BUILD_MODE_COMPLETION_PLAN.md — Build Mode mobile-first UI overhaul
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
- **Build Mode (Infinity) Phase 0: UI Unfuck** — **Core infrastructure COMPLETE**: 5 new components created (progress ring, toast system, skeleton loading, keyboard shortcuts, command palette), i18n keys added, **TypeScript errors fixed, typecheck passes, full build passes**. **Transcript bottom sheet (50%/90% snap, drag handle, swipe dismiss) DONE.** **Progress ring rendered on mobile header. Command palette portal + toast system integrated.** Next: verify skeleton loading states render, verify command palette opens via shortcut (Cmd/Ctrl+Shift+P), then implement plan horizontal scroll cards, tool call collapsible cards (color-coded), diff preview full-screen modal, keyboard avoidance, safe areas, desktop three-pane resizable layout, tool call tree, live preview, diff view, accessibility.
- **Build Studio reliability:** visible progress transcript, plan/scaffold error handling, cancellation, and bounded self-review pipeline are implemented and verified; no active code changes remain.
- **Projects System** — core backend, Project Memory, Project Instructions, Projects navigation, AI Context Pipeline, and Project Activity are implemented and verified. Next work: Project Files, Project Research, Project Tasks, or UI cleanup.
- **Book Studio** — live end-to-end run pending (needs server `.env`).

## Next actions
1. **Verify Phase 0 components render correctly** — progress ring in mobile header (visible during build), toast system via BuildToaster portal, skeleton loading states, command palette opens via shortcut (Cmd/Ctrl+Shift+P)
2. **Continue Phase 0 (UI Unfuck) implementation** — implement plan horizontal scroll cards, tool call collapsible cards (color-coded), diff preview full-screen modal, keyboard avoidance, safe areas, desktop three-pane resizable layout (see `BUILD_MODE_COMPLETION_PLAN.md` Phase 0 checklist).
3. On the next UI-cleanup request, continue with the remaining overlay surfaces (settings panel rows, command palette, toasts) and the hardcoded terminal dark surfaces in Build Studio only if the user flags them.
4. On the next Projects System request, continue with Project Files, Project Research, Project Tasks, or the user-selected area.
5. When the user supplies additional requirements, extend the plan faithfully and reconcile before implementing any newly affected scope.
6. Optional: delete now-inert `.cron_watchdog.sh` / `.tmux_runner.sh` if user wants.

## Locked decisions
- Projects System: **plan-first** — build only after all requirements are planned (user instruction).
- Build Mode (Infinity): follow `BUILD_MODE_COMPLETION_PLAN.md` phases sequentially (Phase 0 → 1 → 2 → 3 → 4 → 5).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)