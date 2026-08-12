# session-brief.md — Living Working State

> Read FIRST every session (alongside **KNOWLEDGE.md**). **Rewritten every turn** — this is how sessions feel like one chat.
> `LAST_UPDATED` must be touched every turn. `NEXT ACTIONS` is what the next session executes first.

LAST_UPDATED: 2026-08-12

## Current situation
We redesigned the continuity files: `claude_changes_log.txt`, `.session_state.md`, `whats_next.md` are archived; **KNOWLEDGE.md + this brief** replace them. Mid-handoff on the 32-step **Projects System** brief: steps 1–10 planned, user is sending 11–20 next.

## Active threads
- **Projects System** — awaiting steps 11–20. On receipt: extend `docs/projects-system-plan.md`, re-cut phases A–H if needed. Build starts only after all 32 steps are planned.
- **Book Studio** — live end-to-end book run still pending (needs server `.env`).

## Next actions
1. Receive steps 11–20 of the Projects System brief → extend the plan doc.
2. Then receive 21–32 → finalize plan → begin implementation.
3. Optional/unstarted: wire a SessionStart hook + `claude --continue` for literal continuity; delete now-inert `.cron_watchdog.sh` / `.tmux_runner.sh` if user wants.

## Locked decisions
- Projects System: **plan-first** — build only after all 32 steps are planned (user instruction).
- Continuity: two files (this + KNOWLEDGE.md) replace the three old logs; raw history preserved in `archive/`.

## Open questions
- Launcher continuity: switch jarvis-launch to `claude --continue` so relaunches literally continue the chat? (not decided)

## Recent conversation
- User asked why sessions keep "forgetting" → I explained it's logs-vs-memory, proposed resume brief + durable knowledge + SessionStart hook + `--continue`.
- User approved: "remove most old info from the 3 files, create 1–2 files to replace them" → this consolidation (KNOWLEDGE.md + session-brief.md, old files archived, CLAUDE.md routine updated, source-code.ts blockers updated).
- User is sending the Projects brief in chunks of 10 (1–10 planned, 11–20 next).
