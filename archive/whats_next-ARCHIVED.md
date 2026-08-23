# What's Next

## Current session (2026-08-12) — Projects System: plan doc (steps 1–10 of 32)

**User message:** 32-step brief "Build infinity-ai Projects: Persistent Workspaces With Isolated Project Memory." Asked me to **summarize + plan build phases for steps 1–10 in a .md first** (explicitly NOT plan mode, NOT a build). Steps 11–20 and 21–32 will be handed over next.

**What I did:**
- Grounded the plan in the repo: existing ChatGPT-style `projects`/`projectChats`/`projectFiles`/`pins` schema + `routes/infinity-ai/projects.ts` + `project-gallery.tsx`; global `userMemories` + `memories.ts` routes; LLM auto-extraction (~chat.ts L448) + memory-block injection (~chat.ts L504); `researchJobs`; Book Studio as the full-feature pattern; idempotent `auto-migrate.ts`.
- Wrote **`docs/projects-system-plan.md`** — full step 1–10 requirement capture (no details skipped) + build phases A–H (data model, first-class CRUD, project home, scoped conversations + context injection, project memory w/ relevant retrieval + extraction, memory UI, instructions, first-class nav) + per-phase verification + open questions.
- Committed + pushed (plan only, no code changed).

**Next:** user hands over steps 11–20 → extend the plan doc (re-cut phases if needed). Implementation only after the full brief is planned.

---

## Previous session (2026-08-12) — CLAUDE.md cleanup

**User message:** "remove everything about a chromebook, about auto resume, the entirety of line 37 and 36"

**What I did:** Removed the AUTO-RESUME SYSTEM section (infinity-ai-launch.sh/tmux/omniroute, .cron_watchdog.sh, 106-step checklist, "9999 restart cycles") and the "User is rebooting Chromebook. Full plan: memory file pending-redesign" line from CLAUDE.md. Kept the GitHub identity line. Verified clean via grep. Committed + pushed `2cbf5ae`.

**Next:** Nothing pending from this task. The Book Studio live end-to-end run is still the open item whenever the user wants it.

---

## Previous session (2026-08-11) — Book Studio built inside infinity-ai

**User message:** "So what i want is a website where you can make an actual book, like that you actually receive a PDF in A5, beautifully formatted, good font etc. You start with your idea, it gets planned into chapters and a summary... approve the plan or click a button to tell the LLM to change something... AI messaged separately 10 pages at a time... existing pages get uploaded with every request and updated as pages get added... also receives a few pages from existing books in the folder 'Books' so it knows the writing style... then the .txt + inspo books get uploaded again with 'Tell me exactly what to change' ×2... then formatted with a good font... one last final check... push notification + download the formatted .pdf in A5. BYO API key inside the website... inspo books in 'Books', personal project, no legal problems." User chose **Autonomous background job** + **Full book layout PDF** via AskUserQuestion.

**What I did (5 pushed commits):**
1. `86de2b7` — **DB schema `book_jobs`** (idea, language, pageCount, wordsPerPage, chunkSize, critiquePasses, status/progress/phase/log, plan, growing manuscript, samples, masked BYO apiKey/baseUrl/model, pdfFile, error, heartbeatAt) + idempotent auto-migrate.
2. `f866815` — **Style-sample reader** (book-samples.ts: re-scans Books/ every call, .txt/.md/.pdf via pdf-parse, language sniff, bounded 18k prompt) + **autonomous engine** (book-engine.ts: 10-page separate LLM calls, growing book.txt recap, 2 critique passes, buildBookHtml with title page/TOC/chapter pages/`@page A5`/Liberation Serif, Puppeteer → data/books/<id>.pdf, per-loop cancel, recoverStuckBookJobs, BYO→shared-pool fallback).
3. `c787680` — **Plan generation + routes** (generatePlan/replanPlan, routes/infinity-ai/book.ts: /book/plan, /book/plan/review, /book/samples, /book/jobs ± /:id, /:id/cancel, /:id/pdf; BYO keys masked in every response).
4. `d4d002f` — **Frontend wizard** (book-studio.tsx: setup → plan with "Change something" loop & Approve → job cards with progress/log/cancel/Download PDF + book.txt; studio card in studios-hub; 12s background polling + push/browser/toast notification on completion in home.tsx; 45 book.* i18n keys en+nl).

**Verification:** api-server book files type-clean; infinity-ai app typechecks with **0 errors**; server bundles (build.mjs, dist 9.2mb); Book-samples reader verified live against Books/ (6 books, PDF extraction + language sniffing); Puppeteer A5 PDF render verified on this machine (~27KB).

**Important:** No `.env` exists in the repo (gitignored by design). The live **LLM calls, Neon DB persistence and web-push** can only be exercised on the running app which already has its env. The user's real API keys (incl. the Neon DATABASE_URL) from a previous session are NOT stored here — the server's `.env` must already exist in production.

**My response (what user should know):** The Book Studio is fully built and wired into the Studios hub. Open infinity-ai → Studios → **Book Studio**, type an idea, set pages/chunk/passes/BYO key if wanted, "Plan my book", review the chapters, ask for changes as many times as you like, then "Approve & start writing". It runs in the background — close the tab, get a push notification when the A5 PDF is ready, download it from the YOUR BOOKS list. The only thing not yet exercised is one live full end-to-end run (requires the server env + an LLM key), which I can kick off whenever the app is running.

## Next steps (awaiting user direction)
- Run one real book end-to-end against the live app once it's up (needs the server's `.env`).
- User to update Books/ often — the studio re-scans the folder on every plan/job start, no cache.
- Possible follow-ups: publish the PDF to a downloadable history page, custom cover image upload, A5 paperback vs digital length guidance.