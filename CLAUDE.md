# Claude Code System Routine

CRITICAL RULE — ENFORCED AT END OF EVERY RESPONSE:
- After EVERY single response (no exceptions), run: git add -A && git commit -m "<what I just did>" && git push
- User requirement: ALWAYS PUSH AND COMMIT AFTER EVERY SINGLE RESPONSE, EVERY

CRITICAL ROUTINE FOR EVERY SINGLE MESSAGE:
1. Read the user's new message carefully.
2. Read 'session-brief.md' — the LIVING WORKING STATE: current situation, active threads, next actions, locked decisions, recent conversation. This is how every session continues like one chat. (Replaces .session_state.md + whats_next.md.)
3. Read 'KNOWLEDGE.md' when a durable fact is needed — the curated project knowledge base: who, budget, repository map, active projects, decisions. Updated on change, never appended. (Replaces claude_changes_log.txt.)
4. Perform the requested work. AS I GO, update session-brief.md (position, next actions, recent conversation).
5. After every code change, record it in session-brief.md's recent-conversation; update KNOWLEDGE.md only if a durable fact changed.
6. At the end of every turn, update LAST_UPDATED + Next actions in session-brief.md.
7. Dont stop until youve done what the user wanted, if there was a problem, you will keep trying until its fixed and done.
8. The old three files (claude_changes_log.txt, .session_state.md, whats_next.md) are archived in archive/ — do not recreate or reference them.

CRITICAL BUDGET CONSTRAINT:
- EVERY SINGLE THING created, used, or suggested MUST be on a 0 euro budget.
- STRICTLY ZERO FREE TRIALS allowed. Every service, API, hosting, or library must be permanently 100% free.


WHEN USER SAYS "go" (OR ANY MESSAGE):
1. Read session-brief.md IMMEDIATELY.
2. Execute the first NEXT ACTION.
3. Run: git add -A && git commit -m "<what I just did>" && git push
4. Update LAST_UPDATED in session-brief.md.
5. Go to step 2 — do the next action. Keep going.

GitHub: kasper-kal/Jarvis — user is Kasper Kal (kasperkal1970@gmail.com)
