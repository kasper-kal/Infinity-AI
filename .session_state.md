# Jarvis Session State

LAST_UPDATED: 2026-08-12 09:10
COMPLETED_STEPS: 11
PENDING_STEPS: 21+ (Projects System: steps 11-32 not yet received)

## Active request (DONE)
> User: "start with splitting home.tsx (2000 lines is way too much for one file) and finish the nl (dutch) i18n gaps"

### Task #1 — Split home.tsx into composables [x] DONE
- [x] Extract 7 presentational components into `artifacts/jarvis/src/components/home/`:
  - `key-retry-banner.tsx` (LLM-key retry banner)
  - `home-header.tsx` (translucent toolbar, returns null in voice mode)
  - `camera-mode-view.tsx` (full-screen object detection)
  - `voice-mode-view.tsx` (orb + status + PiP toggles + widget/convo panel)
  - `chat-mode-view.tsx` (TimerStrip + mobile widget strip + ConversationFeed + ChatComposer)
  - `chat-composer.tsx` (the input bar: + menu, toggles, textarea, dictation, voice button)
  - `pip-browser-window.tsx` (draggable PiP Jarvis browser)
- [x] Consolidate duplicated `AttachedFile` interface → `@/types/widget.ts` (also used by `use-chat-stream.ts`)
- [x] Rewrite `home.tsx` JSX to compose the new components; strip now-unused imports; add `handleComposerPlusAction` (reduced +-menu handler) + `handleComposerDrop`
- [x] `home.tsx`: 2000 → 1520 lines; `tsc --noEmit` passes clean (EXIT 0)

### Task #2 — Finish Dutch (nl) i18n gaps [x] DONE
- [x] Add 15 new keys to both `en` and `nl` in `src/lib/i18n.tsx`
  (type-enforced: `nl: Record<keyof typeof en, string>`)
  - `sidebar.openHistory` / `sidebar.closeHistory`
  - `input.attachTitle` / `input.fileAttachedLabel` / `input.agentModeIndicator` / `input.attachmentAlt`
  - `keyRetry.title` / `keyRetry.sameKey` / `keyRetry.nextKey` / `keyRetry.nextKeyWithName` / `keyRetry.dismiss`
  - `voice.you` / `voice.jarvis`
  - `camera.note`
- [x] Route all previously-hardcoded strings through `t()`:
  key-retry-banner (title, dismiss, same/next key), home-header (history aria), camera-mode-view (detection note), voice-mode-view (YOU/JARVIS ×3), chat-composer (FILE ATTACHED, +-menu title, agent-mode indicator, attachment alt)
- [x] `tsc --noEmit` passes clean (EXIT 0); final sweep finds no remaining hardcoded UI strings in the new components

### Task #3 — Repo clutter audit + cleanup [x] DONE (executed)
- [x] Swept the repo (excl. node_modules/.git/.env*): root reports, empties, scripts, dup content, screenshots, temp/logs
- [x] Tracked vs untracked via `git ls-files` (all junk tracked except `.wwebjs_cache`)
- [x] Delivered two-table report: Table A (safe to delete) / Table B (move to archive). Biggest item: `.wwebjs_auth/` (233 files, 37MB, orphaned WhatsApp session). 23 root QA reports superseded by qa-report/JARVIS-COMPLETE-AUDIT.txt
- [x] USER APPROVED → executed:
  - Batch 1 (c4ea241): moved 7 archival docs + 22 reference assets to archive/, ui-walkthrough.mjs to qa-report/
  - Batch 2 (97aed33): deleted .wwebjs_auth/ (233 files, 37MB), .wwebjs_cache/, 23 QA reports, 6 stale screenshots, whatsapp-bridge.js, 8 walkthrough scripts, 3 root scripts, full_chat_with_thinking.txt (0B), .launch.log, 6 md5-verified attached_assets duplicates; removed empty attached_assets/ dir
  - Extended .gitignore: .wwebjs_auth, .wwebjs_cache, .launch.log, *.jpg
  - Working tree clean; 393 files tracked; ui-walkthrough.mjs reference in qa-report report intact

## Active request (NEW) — Books/ sample folder
> User: "ive put examples of books (5) in a folder called 'Books' this WILL be upadated often"

### Task #4 — Register Books/ sample folder [x] DONE
- [x] Inspected Books/: 5 samples — House-to-House-snippet.txt (EN memoir), boy-7-dutch-example.txt (NL YA), The Martian.pdf, hunger-games-18.pdf, it-by-stephen-king.pdf
- [x] No book-ingestion feature exists yet in artifacts/ — folder is fresh test data for a future feature
- [x] Committed + pushed da4f55f (5 files, ~515KB). Books/ will be updated often — treat as live resource, re-check contents each session

## Active request — Book Studio (build inside existing Jarvis web app)
> User: "a website where you can make an actual book ... actually receive a PDF in A5, beautifully formatted ... plan into chapters, approve or change something, AI messaged separately 10 pages at a time, growing book.txt sent each time, style samples from Books/, critique passes, format, final check, push notification. BYO API key inside the website. Personal project, no legal problems." Choices: Autonomous background job + Full book layout PDF.

### Task #5 — DB schema book_jobs [x] DONE (86de2b7)
- [x] lib/db/src/schema/books.ts: bookJobs table (idea, language, pageCount, wordsPerPage, chunkSize, critiquePasses, status, progress, phase, log, plan, manuscript, samples, apiKey BYO masked, baseUrl, model, pdfFile, error, heartbeatAt)
- [x] auto-migrate.ts: CREATE TABLE book_jobs + ~20 ALTER ADD COLUMN IF NOT EXISTS entries (idempotent)

### Task #6 — Style-sample reader (Books/) [x] DONE (f866815)
- [x] book-samples.ts: re-scans Books/ every call (never caches), reads .txt/.md/.pdf via pdf-parse, sniffs en/nl/other, samplesToPrompt bounded to 18k chars
- [x] Runtime verified against real Books/ (6 books, PDF extraction + language sniffing working)

### Task #7 — Autonomous book engine [x] DONE (f866815)
- [x] book-engine.ts: generateChunk (10-page separate LLM calls, growing manuscript recap), critiquePass (full manuscript + samples, "Tell me exactly what to change" ×2), finalCheck, buildBookHtml (title page + TOC + chapter pages, @page A5, Liberation Serif=Times New Roman), renderPdf via Puppeteer, runBookJob with per-loop re-read (cancel interrupts), recoverStuckBookJobs
- [x] BYO key (apiKey/baseUrl/model) used directly via new OpenAI(); falls back to runWithLLM key pool

### Task #8 — Plan generation + routes [x] DONE (c787680)
- [x] generatePlan()/replanPlan() for idea→plan and the "change something" loop (before a job exists)
- [x] routes/jarvis/book.ts: POST /book/plan, POST /book/plan/review, GET /book/samples, POST /book/jobs, GET /book/jobs, GET /book/jobs/:id, POST /book/jobs/:id/cancel, GET /book/jobs/:id/pdf; BYO keys MASKED in every response
- [x] Registered bookRouter in routes/jarvis/index.ts

### Task #9 — Frontend component + wiring [x] DONE (d4d002f)
- [x] components/book-studio.tsx: wizard modal — idea + language + page slider + words/page + chunk size + critique passes + BYO key collapsible + live Books/ samples indicator → plan (chapters, "Change something" re-plan loop, Approve) → job cards (progress, phase log, cancel, Download PDF + book.txt)
- [x] studios-hub.tsx: 'book' studio card; app-overlays.tsx + home.tsx: 12s background polling of /api/jarvis/book/jobs, push/browser/toast notification when a book completes, case 'book' in handleStudioSelect
- [x] 45 book.* i18n keys added to en + nl
- [x] Jarvis app typechecks clean (0 errors)

### Task #10 — Verify end-to-end [x] DONE (f866815+d4d002f+verification)
- [x] Server bundle builds (build.mjs, dist/index.mjs 9.2mb)
- [x] Puppeteer A5 PDF render verified on this machine (~27KB, page numbers footer, @page A5)
- [x] Jarvis app typecheck: 0 errors; api-server typecheck clean for book files
- [x] NOT testable without env: live LLM calls (plan/chunks/critique) + Neon DB persistence + web-push. Needs the gitignored .env on the server (production already has it).

## Next steps (awaiting user direction)
- Bring up the Book Studio in the running app and run one full book end-to-end (requires the server's .env with DATABASE_URL + LLM keys)
- Consider splitting `use-chat-stream.ts` and `AppOverlays` next if the user wants more decomposition

## Active request — Projects System (persistent workspaces, 32-step brief)
> User: "Build Jarvis Projects: Persistent Workspaces With Isolated Project Memory" — 32 steps, handed over in chunks of 10.

### Task #11 — Plan steps 1-10 [x] DONE (docs/projects-system-plan.md)
- [x] Inspected repo: existing projects.ts schema (projects/projectChats/projectFiles/pins), routes/jarvis/projects.ts CRUD, project-gallery.tsx, global userMemories + memories.ts routes, LLM extraction + injection in chat.ts, researchJobs, auto-migrate, i18n en/nl
- [x] Wrote docs/projects-system-plan.md: full step 1-10 capture + build phases A-H + verification + open questions (NO implementation yet)
- [ ] Receive steps 11-20 → extend plan doc, re-cut phases if needed
- [ ] Receive steps 21-32 → finalize plan, then begin implementation
