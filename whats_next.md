# What's Next

## Last session (2026-08-11)

**User message:** "Audit this repo (/home/kasperkal1970/Jarvis) for unnecessary clutter and produce a cleanup list. Do NOT delete anything — just list candidates with a recommendation per item."

**What I did:**
- Swept the whole repo (excl. node_modules/.git/.env*): root-level report files with line counts, empty files, superseded test scripts, duplicated QA content, stale screenshots, temp/log artifacts.
- Cross-checked tracking state with `git ls-files` — all junk is tracked except `.wwebjs_cache/`.
- Produced the two-table report (A. Safe to delete, B. Move to archive) with path · size/lines · what it is · recommendation · why. **Nothing deleted** — recommendations only.

**Key findings:**
- `.wwebjs_auth/` — 233 tracked files, ~37MB orphaned WhatsApp-Web Chromium session (zero code refs) → delete + gitignore
- 23 root QA/BUTTON reports superseded by `qa-report/JARVIS-COMPLETE-AUDIT.txt` (which explicitly corrects them) → delete
- `screenshots/` (6 jpg, tracked) stale, superseded by qa-report screenshots → delete
- `full_chat_with_thinking.txt` 0B empty tracked junk → delete
- `ui-walkthrough.mjs` is the only live audit script (referenced by qa-report) → move to qa-report/
- 8 orphaned walkthrough/*.mjs + 3 root scripts → delete
- attached_assets: 3+ duplicate pastes and 2 duplicate image pairs (md5-verified) → keep 1 each, delete dups
- Archive candidates: AI_DOES_THE_THINKING_PROMPT.md, PROJECT_MAP.md, full-walktrough-by-freebuff.txt, build-mode-competitor-analysis.txt, SYSTEM_STATUS_FINAL.txt, RENDER_FIX_SUMMARY.md → new archive/ folder

**My response:** Full two-table audit report delivered. Asked for approval to execute (git rm Table A, move Table B to archive/, extend .gitignore).

## Next steps (awaiting user direction)
- Wait for user approval to execute the cleanup
- If approved: run the deletions/moves, update .gitignore, commit+push
