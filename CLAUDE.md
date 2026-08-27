# Claude Code System Routine

CRITICAL RULE — ENFORCED AT END OF EVERY RESPONSE:
- After EVERY single response (no exceptions), run: git add -A && git commit -m "<what I just did>" && git push
- User requirement: ALWAYS PUSH AND COMMIT AFTER EVERY SINGLE RESPONSE, EVERY

CRITICAL ROUTINE FOR EVERY SINGLE MESSAGE:
1. Read the user's new message carefully.
2. Read 'PHASES.md' — the MASTER ROADMAP: all phases, current phase, requirements, implementation plans, autonomous execution rules. **Read this FIRST.**
3. Read 'session-brief.md' — the LIVE PROJECT STATE: what I just did, the project right now, the change record (every change, newest first), active threads, next actions. This is how every session continues like one chat. (Replaces .session_state.md + whats_next.md.)
4. Read 'KNOWLEDGE.md' when a durable fact is needed — how everything works + permanent rules. Updated on change, never appended. (Replaces claude_changes_log.txt.)
5. Perform the requested work. AS I GO — after EVERY singular change (code, file, decision) — update session-brief.md's Change record (newest first, cap ~15) + Project state, so the file ALWAYS reflects the project right now. **Also update PHASES.md when phase tasks complete.**
6. Update KNOWLEDGE.md only when a durable fact changed (how-it-works, permanent rule). Never store personal trivia (e.g. what to call the user) — that's unnecessary space.
7. At the end of every turn, update LAST_UPDATED + Next actions in session-brief.md.
8. Dont stop until youve done what the user wanted, if there was a problem, you will keep trying until its fixed and done.
9. The old three files (claude_changes_log.txt, .session_state.md, whats_next.md) are archived in archive/ — do not recreate or reference them.

CRITICAL BUDGET CONSTRAINT:
- EVERY SINGLE THING created, used, or suggested MUST be on a 0 euro budget.
- STRICTLY ZERO FREE TRIALS allowed. Every service, API, hosting, or library must be permanently 100% free.

AUTONOMOUS EXECUTION (when user says "go" or similar):
- Follow PHASES.md's "Autonomous Execution Rules" section
- Loop through phases until complete or escalation trigger hit
- Every response → git commit + push
- On phase complete → update PHASES.md status, commit, push, proceed to next phase


WHEN USER SAYS "go" (OR ANY MESSAGE):
1. Read session-brief.md IMMEDIATELY.
2. Execute the first NEXT ACTION.
3. Run: git add -A && git commit -m "<what I just did>" && git push
4. Update LAST_UPDATED in session-brief.md.
5. Go to step 2 — do the next action. Keep going.

GitHub: kasper-kal/Infinity-AI — user is Kasper Kal (kasperkal1970@gmail.com)

IMPORTANT EXTRA NOTE: NEVER fix typecheck errors before the phase or whatevr your currenttly doing is fully done, great!