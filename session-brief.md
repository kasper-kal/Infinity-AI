# session-brief.md — Live Project State & Handoff

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Updated on EVERY change** — this is how sessions feel like one chat.
> This file must ALWAYS reflect the project *right now*. After every change: append to Change record, refresh Project state.
> **Never store personal trivia here** (e.g. what to call the user) — that's unnecessary space. Only state, changes, and how-it-works.

LAST_UPDATED: 2026-08-12

## Just did (last action)
- Extended `docs/projects-system-plan.md` with **steps 11–20** (faithful full capture: section 1B repo-grounding + section 2B requirements + re-cut of phases A–H + new phases I–O + updated verification/open questions). Plan remains **PLANNED ONLY** — no implementation. Awaiting steps 21–32.

## Project state — right now
- **Continuity system:** `CLAUDE.md` routine + `KNOWLEDGE.md` (how it works) + `session-brief.md` (live state) replace the old 3 logs (archived in `archive/`). `source-code.ts` blocks KNOWLEDGE/session-brief from Jarvis-the-app's source reading.
- **Projects System:** 32-step user brief "persistent workspaces with isolated project memory". Steps 1–20 planned in `docs/projects-system-plan.md` (sections 1+1B grounding, 2+2B requirements, phases A–H + re-cut + I–O). **No implementation yet.** Awaiting steps 21–32.
- **Book Studio:** fully built + wired (schema, engine, routes, wizard, polling, A5 PDF verified). Pending: one live end-to-end run (needs server `.env`).
- **DB (Drizzle, `lib/db/src/schema/`):** accounts · books · build-apps · conversations · files · gmail · groups · llm-keys · memories (global) · projects (+projectChats/projectFiles/pins) · push · research · secrets · settings · sharing · spotify · timers.
- **Features:** chat (global memory + LLM auto-extraction ~chat.ts L448 + context injection ~L504), voice mode, camera detection, Build Studio (@Build shortcut, CodeMirror), Book Studio, deep-research background jobs, Projects folder system, code editor, Jarvis browser, music/Spotify, timers, Gmail/Calendar, command palette.

## Change record (newest first — EVERY change logged here, cap ~15)
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
- **Projects System** — steps 1–20 planned; **awaiting the user's paste of steps 21–32**. On receipt: READ `docs/projects-system-plan.md` FIRST, extend it faithfully, reconcile phases. Build only after all 32 steps are planned.
- **Book Studio** — live end-to-end run pending (needs server `.env`).

## Next actions
1. **When the user pastes steps 21–32 of the Projects System brief (next fresh-chat handoff):** read `docs/projects-system-plan.md` first (steps 1–20 fully captured there), then EXTEND it — full faithful capture of 21–32, NO details skipped — and reconcile/re-cut phases A–O if the new steps change the shape. Do NOT start implementing: plan-first until all 32 steps are planned (locked decision).
2. Receive all 32 → finalize plan → begin implementation (phases A–O in dependency order).
3. Optional: delete now-inert `.cron_watchdog.sh` / `.tmux_runner.sh` if user wants.

## Locked decisions
- Projects System: **plan-first** — build only after all 32 steps are planned (user instruction).
- Continuity: KNOWLEDGE.md + session-brief.md replace the old logs; raw history in `archive/`.
- Memory rule: no personal trivia — only project state, changes, and how-it-works.

## Open questions
- Switch launcher to `claude --continue` for literal chat continuation? (not decided)
