# Claude Code System Routine

CRITICAL RULE — ENFORCED AT END OF EVERY RESPONSE:
- After EVERY single response (no exceptions), run: git add -A && git commit -m "<what I just did>" && git push
- User requirement: ALWAYS PUSH AND COMMIT AFTER EVERY SINGLE RESPONSE, EVERY

CRITICAL ROUTINE FOR EVERY SINGLE MESSAGE:
1. Read the user's new message carefully.
2. IMMEDIATELY read '.session_state.md' using a tool — this is the SOURCE OF TRUTH for all ongoing work. It tracks every single step, what's done, what's next. The very next thing I must do is the first [ ] unchecked item.
3. Then read 'claude_changes_log.txt' for history context.
4. Then read whats_next.md for more context.
4. Perform the requested work. AS I GO, update .session_state.md by marking [ ] → [x] for completed steps.
5. After EVERY single code change, append a summary to 'claude_changes_log.txt' before doing anything else.
6. After EVERY checked-off box in .session_state.md, run: git add -A && git commit -m "Step X.Y: <description>" && git push. This ensures every tiny step is saved to GitHub.
7. At the end of every turn, update the LAST_UPDATED timestamp and step counts at the top of .session_state.md.
8. Dont stop until youve done what the user wanted, if there was a problem, you will keep trying until its fixed and done.
9. At the end of the message, you will put: what you just did, what will be next and the message of the user + your response in the file: whats_next.md

CRITICAL BUDGET CONSTRAINT:
- EVERY SINGLE THING created, used, or suggested MUST be on a 0 euro budget.
- STRICTLY ZERO FREE TRIALS allowed. Every service, API, hosting, or library must be permanently 100% free.


WHEN USER SAYS "go" (OR ANY MESSAGE):
1. Read .session_state.md IMMEDIATELY — it is my source of truth
2. Find the first [ ] unchecked box
3. Execute that step. Check it off with [x] when done.
4. Run: git add -A && git commit -m "Step X.Y: <description>" && git push
5. Update LAST_UPDATED at top of .session_state.md
6. Go to step 2 — do NEXT unchecked box. Keep going.

GitHub: kasper-kal/Jarvis — user is Kasper Kal (kasperkal1970@gmail.com)
