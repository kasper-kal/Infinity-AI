# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-12

## Just did (last action)
- Restructured this file to the user's exact continuity contract: **Just did / Project state now / Change record (updated on every change)**. Old "Recent conversation" dropped — unnecessary space.

## Project state — right now
- **Continuity system:** `CLAUDE.md` routine + `KNOWLEDGE.md` (how it works) + `session-brief.md` (live state) replace the old 3 logs (archived in `archive/`). `source-code.ts` blocks KNOWLEDGE/session-brief from Jarvis-the-app's source reading.
- **Projects System:** 32-step user brief "persistent workspaces with isolated project memory". Steps 1–10 planned in `docs/projects-system-plan.md` (phases A–H). **No implementation yet.** Awaiting steps 11–20.
- **Book Studio:** fully built + wired (schema, engine, routes, wizard, polling, A5 PDF verified). Pending: one live end-to-end run (needs server `.env`).
- **DB (Drizzle, `lib/db/src/schema/`):** accounts · books · build-apps · conversations · files · gmail · groups · llm-keys · memories (global) · projects (+projectChats/projectFiles/pins) · push · research · secrets · settings · sharing · spotify · timers.
- **Features:** chat (global memory + LLM auto-extraction ~chat.ts L448 + context injection ~L504), voice mode, camera detection, Build Studio (@Build shortcut, CodeMirror), Book Studio, deep-research background jobs, Projects folder system, code editor, Jarvis browser, music/Spotify, timers, Gmail/Calendar, command palette.

## Change record (newest first — EVERY change logged here, cap ~15)
- 2026-08-12 session-brief restructured to live-state format; CLAUDE.md routine + KNOWLEDGE.md updated to encode the contract (update on every change; never store personal trivia).
- 2026-08-12 Continuity redesign: KNOWLEDGE.md + session-brief.md replace the 3 old logs; CLAUDE.md routine updated; source-code.ts blockers updated (9ef62ab).
- 2026-08-12 Projects System plan: `docs/projects-system-plan.md` written for steps 1–10 (4541abd).
- 2026-08-12 CLAUDE.md cleanup: removed AUTO-RESUME SYSTEM + Chromebook note (2cbf5ae).
- 2026-08-11 Book Studio: all 10 tasks done + verified (schema, engine, routes, wizard, polling, A5 PDF).
- 2026-08-11 Repo cleanup executed (c4ea241, 97aed33).
- 2026-08-11 home.tsx split (2000→1520 lines) + nl i18n gaps filled.
- 2026-08-11 `Books/` folder added (5 style samples; user updates it often — re-scan every session).

## Active threads
- **Projects System** — awaiting steps 11–20; then 21–32; then build.
- **Book Studio** — live end-to-end run pending (needs server `.env`).

## Next actions
1. Receive steps 11–20 of Projects System brief → extend `docs/projects-system-plan.md`, re-cut phases A–H if needed.
2. Receive 21–32 → finalize plan → begin implementation.
3. Optional: delete now-inert `.cron_watchdog.sh` / `.tmux_runner.sh` if user wants.

## Locked decisions
- Projects System: **plan-first** — build only after all 32 steps are planned (user instruction).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)
