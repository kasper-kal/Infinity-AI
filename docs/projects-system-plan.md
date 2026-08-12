# Jarvis Projects System — Build Plan (Steps 1–20 of 32)

> **Status:** Phases B–H implemented; remaining phases are still planned only.
> **Source:** User's 32-step brief, first 20 steps captured in full below.
> **Living document:** will be extended when steps 21–32 are handed over; phases may be re-cut then.

---

## 1. Repo grounding — what already exists to reuse

The brief says: inspect the repository, reuse working architecture, don't replace it. Findings:

### Existing Projects code (a lighter system already lives here)
- **DB schema** `lib/db/src/schema/projects.ts` — a ChatGPT-style *folder* system, NOT yet a workspace:
  - `projects` (id, name, color, archived, **instructions** [legacy compatibility column], createdAt, updatedAt)
  - `project_instructions` (ordered explicit rules; canonical source for the dedicated Project Instructions UI and chat injection)
  - `projectChats` (projectId ↔ conversationId) — conversation↔project association **already exists**
  - `projectFiles` (projectId ↔ fileId, cross-db, no FK) — shared context files exist
  - `pins` (conversation-level pinning only)
- **Backend routes** `artifacts/api-server/src/routes/jarvis/projects.ts` — CRUD: `GET/POST /projects`, `PATCH /projects/:id`, plus project-chat listing. Registered in `routes/jarvis/index.ts` as `projectsRouter`.
- **Frontend** `artifacts/jarvis/src/components/project-gallery.tsx` — sidebar component (Projects + Files gallery) rendered inside `chat-sidebar.tsx` (~line 147). Create project, expand → load its chats.
- `routes/jarvis/project-tags.ts` — tag helper route also exists.

**Implication:** extend/upgrade this, don't rebuild. The `projects`/`projectChats`/`projectFiles` tables are the natural base for a full workspace. `pins` needs a project-level variant (currently conversation-only).

### Existing global Memory system (the pattern to clone, project-scoped)
- **DB schema** `lib/db/src/schema/memories.ts` — `userMemories` (topic [PK, upsert key], value, updatedAt). Simple, no source/pin/category.
- **Routes** `memories.ts` — `GET /memories`, `PATCH /memories/:topic`, `DELETE /memories/:topic`.
- **LLM auto-extraction already exists** in `artifacts/api-server/src/routes/jarvis/chat.ts` (~L448–495): a routine that asks the model "extract memorable facts → upsert into userMemories" (topic as target, so updates-not-duplicates), with explicit do-not-remember rules.
- **Context injection already exists** in chat.ts (~L504+): a `memory + profile` block assembled from `userMemories` and injected into the system prompt.

**Implication:** Project Memory reuses this exact machinery: same extraction-prompt shape, same upsert-by-key, same injected-block approach — but **scoped per `project_id`**, with `source` + `category` + `pin` added, and a relevance filter so we never dump all memories into every request.

### Other reusable pieces
- **Research:** `researchJobs` table (`lib/db/src/schema/research.ts`) + `routes/jarvis/research.ts`. Background jobs table with progress/log/notes/heartbeat — the pattern both for research-to-project association and for project *activity*.
- **Book Studio** (`books.ts` schema, `book.ts` routes, `book-studio.tsx`, ~45 `book.*` i18n keys) — the most recent full feature end-to-end; copy its conventions: Drizzle schema + idempotent auto-migrate entries, router registration, frontend wizard, `en`/`nl` i18n Records, background polling + push notification.
- **Auto-migrate:** `lib/db/src/auto-migrate.ts` (books.ts added ~20 `ALTER ADD COLUMN IF NOT EXISTS` entries) — reuse for every new table/column below.
- **Stack/conventions:** Drizzle ORM + Postgres (Neon), Express routers under `/api/jarvis/*`, React + Vite + Tailwind + framer-motion + lucide-react, i18n via `src/lib/i18n.tsx` (`nl: Record<keyof typeof en, string>` type-enforced). **0-euro budget — no paid services, no free trials.**

### 1B. Repo grounding — steps 11–20 (what already exists to reuse)

Steps 11–20 are mostly system-level (files, research, tasks, agent-readiness, activity, DB, API, context pipeline, UI, empty states). Findings that ground them:

#### File storage already exists (step 11) — extend, don't rebuild
- **`/api/files`** (`artifacts/api-server/src/routes/files.ts`) is the existing file API: `POST` (multipart upload, 50 MB limit, mime-sniffed), `GET` (list, `?conversation_id=` filter, 200-cap), `GET /:key` (serve blob, mime sniff, inline `Content-Disposition`).
- **Schema** `lib/db/src/schema/files.ts` lives in the SEPARATE files DB (`DATABASE_URL_FILES`, falls back to main): id, conversationId (nullable), kind (`image|document|audio|build-app|code`), name, mime, size, storageKey, bucket, owner (`user|jarvis|account`), createdAt.
- **Storage lib** `lib/storage.ts` already exposes `getStorage().remove(key)` on all backends (local disk, R2, B2) — delete is a thin addition, not new infrastructure.
- **Gaps vs step 11:** no delete, no rename (`PATCH`), no forced download (`?download=1`), no name search, no project association on upload, no project-scoped listing. The `projectFiles` join table (projectId ↔ fileId, cross-db, **no FK possible**) exists in schema but is **not wired into any backend route yet** — the frontend gallery lists *all* `/api/files` (global), not project files.
- **Plan:** add the missing operations to the SAME `/api/files` router; accept `projectId` on upload and maintain the `project_files` join; add `GET /projects/:id/files`.

#### Research engine already exists (step 12) — integrate, don't rebuild
- **`researchJobs`** (`lib/db/src/schema/research.ts`): run-level entity already holding title, prompt, mode, depth, status, progress, phase, **log** (append-only step log), **notes** (distilled corpus), **report** (final synthesized report), gemSystemPrompt, gemConversationId, heartbeat, timestamps.
- **`/api/jarvis/research`** (`routes/jarvis/research.ts`): start (POST, background engine), list, get, cancel, estimate. The engine (`lib/research-engine.ts`) already has heartbeat + restart-resume.
- **Gaps vs step 12:** no project association (join planned in Phase A, not yet active), no project-scoped list, no first-class **Sources** surface, no **Saved findings** store. "Runs / reports" already exist — we associate + surface, we do NOT re-model the engine.

#### Ownership model (step 16)
- `accounts.ts`: minimal local accounts for **invited groupchat users** only; the **primary user has no account row**. So projects are implicitly single-owner (the primary user) today.
- **Plan:** add nullable `owner_account_id` to `projects` (null = primary user). Full `project_members` table deferred until multi-user projects are real.

#### Agent-ready building blocks (step 14)
- The autonomous loop doesn't exist yet, but Jarvis already has the pieces agent activity would produce: **research engine** (long background jobs w/ heartbeat+resume), **browser** (`routes/jarvis/browse.ts`), **terminal**, **code editor**, **Build Studio** (files changed), **tests route**, **git routes**.
- **Plan:** add the agent-run/action schema now (so Projects are agent-ready), defer the autonomous agent itself.

#### Critical honest finding for step 18 (AI context pipeline)
- Today chat.ts injects a **global memory + profile** block into the system prompt. Project chats now also inject project identity, all ordered `project_instructions` rules (with a legacy-column fallback), and Phase E relevant project memory. `project_files` is still referenced by no backend route, so files, history, and research remain future context-pipeline work. The remaining pipeline work reuses this injection point + the Phase E relevance engine.

---

## 2. Requirements — steps 1–10, captured in full

### Step 1 — CORE CONCEPT: a Project is a persistent workspace
- NOT a superficial folder/tag system. A project must own its own **context, files, conversations, memory, research, tasks, and eventually agent activity**.
- Example project: "My Restaurant Website" containing:
  - Conversations · Project Memory · Files · Research · Tasks · Code/workspace · Generated assets · Project instructions · Activity/history
- Everything belonging to a project has a **relationship to the project**.
- The user can leave Jarvis and return later and continue the same project **without re-explaining** it.

### Step 2 — PROJECTS ARE FIRST-CLASS
- Add a **Projects section to the main Jarvis navigation/sidebar**.
- User can: Create · Rename · Delete/archive · Open · **Search** projects · **Sort** projects · See **recently used** projects · **Pin/favorite** projects · **Create a project from an existing conversation** · **Move/copy a conversation into a project**.
- Must feel native to Jarvis — not a separate application.

### Step 3 — PROJECT HOME (dashboard)
- Each project needs a dedicated home/dashboard.
- Example layout:
  - PROJECT NAME / Description
  - `[Continue working]` `[New chat]`
  - Recent activity
  - Conversations · Files · Research · Tasks · Memory
- The home must immediately communicate: **what the project is**, **what has recently happened**, **what Jarvis knows**, **what the user can continue doing**.
- UI must stay consistent with existing Jarvis design — **no new visual language**.

### Step 4 — PROJECT-SCOPED CONVERSATIONS
- A conversation belongs to **exactly one project or none** (outside projects).
- Starting a conversation **from inside a project** auto-associates it AND auto-injects the project context — Jarvis knows it's the restaurant website without the user repeating it.
- User can: create a new conversation inside a project · **move** an existing conversation into a project · **remove** a conversation from a project **without deleting it** · see project conversations · **search** project conversations.
- **No duplication of conversation data — use relationships/references** (the existing `projectChats` join table does this).

### Step 5 — PROJECT MEMORY — *VERY IMPORTANT*
- Every project gets a **completely separate memory system** — NOT the same as Jarvis's global/user memory.
  - Global: "User prefers dark interfaces."
  - Project: "This project uses dark green." · "Do not use red." · "Backend uses PostgreSQL." · "Client wants online reservations."
- Project memory must **NEVER leak into unrelated projects**; unrelated global/project memories must **never contaminate another project**.

### Step 6 — PROJECT MEMORY SOURCES
- Project memory learns from things inside the project. Potential sources:
  - Project conversations · Project files · Research performed inside the project · Project instructions · Agent activity/results · Explicit user-created memories
- Architecture must store each memory's **source**, e.g.:
  - "Do not use red in the UI." → Source: Conversation → "Design discussion" → Aug 11, 2026
  - "Backend uses PostgreSQL." → Source: File → README.md
  - "Client wants online reservations." → Source: Research/Conversation

### Step 7 — MEMORY UI
- Dedicated **Project → Memory** tab/page showing what Jarvis currently remembers.
- Example grouped view:
  - **About this project** — Restaurant website · Dutch customers · Premium/minimal design
  - **Technical** — Next.js · Tailwind · PostgreSQL
  - **Decisions** — No red in UI · Minimal navbar · Mobile-first
  - **Requirements** — Online reservations · Opening hours Tue-Sun
- Each memory supports: **View · Edit · Delete/Forget · Pin · Source**.
- Pinned memories = treated as particularly important project rules.
- Show where a memory came from whenever possible.

### Step 8 — MEMORY IS NOT JUST A NOTES LIST
- NOT a static textarea. It must be **usable by the AI**.
- When Jarvis receives a message inside a project, the **backend retrieves relevant Project Memory and includes it in the AI's context**.
- **Relevant retrieval preferred over dumping everything** (if architecture supports it).
- Example: 100 memories; user asks "Change the database schema" → retrieve technical/database-related memories, not every fact.

### Step 9 — AUTOMATIC MEMORY EXTRACTION
- Build architecture for Jarvis to extract useful project facts from project activity.
- **Only** genuinely useful info: requirements · constraints · decisions · project-specific preferences · architecture decisions · important facts · recurring instructions · project goals.
- Avoid temporary conversational noise. Avoid duplicates.
- **If the same fact changes, update the existing memory** rather than creating conflicting copies:
  - Old: "Primary color is blue." → Later: "Change the primary color to green." → update, don't duplicate.

### Step 10 — PROJECT INSTRUCTIONS
- Dedicated **Project Instructions** area — permanent user-written rules, e.g.:
  - "Always use TypeScript." · "Never use Bootstrap." · "Use a minimalist design." · "Do not modify the authentication system without asking."
- Included **whenever Jarvis operates inside the project**.
- Clearly distinguish **PROJECT INSTRUCTIONS** (explicit rules from the user) from **PROJECT MEMORY** (information Jarvis has learned/retained).

---

## 2B. Requirements — steps 11–20, captured in full

### Step 11 — PROJECT FILES
- Projects need a Files section. Users should be able to: **Upload · Browse · Preview (where supported) · Delete · Rename · Download · Search** files.
- **Reuse Jarvis's existing file-storage infrastructure** — do NOT create a second unrelated file-storage system (one exists: `/api/files` + R2/local blobs, see section 1B).
- Every project file should have a **project association**.
- Files should be **available as context to Jarvis when relevant** (feeds step 18).

### Step 12 — PROJECT RESEARCH
- Research results should be **attachable to Projects**. If Jarvis performs research while inside a project, **associate the run/result with that project**.
- The project should eventually have: **Research runs · Reports · Sources · Saved findings**.
- Do **not rebuild the existing research system** (it exists: `researchJobs` + background engine). **Integrate** it with Projects.

### Step 13 — PROJECT TASKS
- Add a **lightweight Tasks section**. Users create tasks like: "Fix mobile navigation" · "Research competitors" · "Add authentication" · "Deploy website".
- Tasks have: **title · description · status · priority · created time · updated time · optional due date · optional conversation reference · optional file/reference · optional project memory/reference**.
- Statuses: **TODO · IN PROGRESS · DONE**.
- **Keep it lightweight** — do NOT turn it into a giant project-management application.

### Step 14 — AGENT-READY ARCHITECTURE
- This Projects system will eventually power an **autonomous Jarvis agent** — design the data model so future agent activity can belong to a Project: `Project → Agent Run → Actions → Files changed → Tests → Browser activity → Result`.
- Do **not necessarily implement the complete autonomous agent now** unless the existing architecture makes it easy.
- But make Projects **capable of becoming the agent's persistent workspace**.

### Step 15 — PROJECT ACTIVITY
- Add a **lightweight activity/history view**. Examples: **Project created · Conversation started · File uploaded · Research completed · Memory added · Memory updated · Task completed · Agent ran · File changed**.
- This should make the project **feel alive**.

### Step 16 — DATABASE
- **Inspect the existing database/schema first** (done — section 1B). Create **proper relational structures**, not one giant JSON object.
- At minimum determine whether the architecture needs entities equivalent to: `projects · project_members/ownership (if applicable) · project_conversations · project_files · project_memories · project_instructions · project_tasks · project_research · project_activity`.
- Use the repository's **existing ORM/database conventions**; do **NOT blindly duplicate tables** if equivalents already exist. Add **migrations properly**. **Preserve existing data**.

### Step 17 — API
- Create **clean backend APIs** following the existing Jarvis API conventions — the **frontend should never directly manipulate the database**.
- Support: Create / Get / List / Update / Delete-archive project, plus project **conversations · files · memories · instructions · tasks · activity**.
- Keep **authorization / project-ownership checks server-side**.

### Step 18 — AI CONTEXT PIPELINE — *critical*
- When a conversation belongs to a project, the context pipeline must be capable of receiving:
  1. **Project identity**
  2. **Project instructions**
  3. **Relevant project memory**
  4. **Relevant project files/context**
  5. **Relevant project conversation history**
  6. **Relevant research**
- Do **NOT send irrelevant project data unnecessarily**.
- Do **NOT include Project A's memory when talking inside Project B**.
- Do **NOT include project context in unrelated global conversations**.

### Step 19 — UI/UX
- Follow the **existing Jarvis visual system**. Do NOT make Projects look like Notion, or a generic SaaS dashboard. It should feel like **Jarvis + persistent workspace**.
- The **project sidebar** should make it extremely easy to: **switch projects · start a chat · open memory · open files · open research · open tasks · open settings/instructions**.
- **Avoid excessive navigation layers.**

### Step 20 — EMPTY STATES
- Make empty projects useful. For a brand-new project: **"Your project is ready."** then useful actions: **[Start a conversation] [Upload files] [Add instructions] [Add first task]**.
- Do **NOT** show a giant empty dashboard.

---

## 3. Build phases (steps 1–20 mapped to concrete work)

> Order = dependency-first. Backend/schema before UI. Phases are cut so steps 21–32 can slot in without rework.

### Phase A — Data model & migration (foundations for steps 1, 2, 4, 5, 6, 10)
**Extend existing `projects` table** (new columns, idempotent `ALTER ... ADD COLUMN IF NOT EXISTS` in `auto-migrate.ts`):
- `description` text — project home / search
- `pinned` boolean default false — project-level favorite
- `lastOpenedAt` timestamp — "recently used" sorting

**New tables (new schema file `lib/db/src/schema/project-memory.ts` + auto-migrate CREATE TABLE):**
- `project_memories` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `category` text (about/technical/decisions/requirements + freeform), `content` text, `key` text (canonical upsert key — prevents duplicates, step 9), `sourceType` text (`conversation|file|research|instruction|agent|manual`), `sourceRef` text (conversation title + date, file path, etc.), `pinned` boolean default false, `createdAt`, `updatedAt`.
- `project_instructions` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `text` text, `sortOrder` int, `createdAt`, `updatedAt`. (Step 10 wants a dedicated *area* with multiple rules + CRUD — a table beats the single legacy `projects.instructions` column; the legacy column stays synchronized for back-compat.)
- `project_tasks` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `title`, `status` (`todo|doing|done`), `sortOrder`, `createdAt`, `updatedAt`. (Tasks surface on the project home now; full task workflow may be in later steps.)
- `project_activity` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `type` (`chat|file|research|memory|instruction|task|other`), `description` text, `createdAt`. Append-only feed for "Recent activity" + activity/history requirement.
- `project_research` join — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `researchJobId uuid`, `createdAt`. Associates background research to a project (research engine already persists jobs; we add the relationship, no duplication).

### Phase B — Backend: first-class Projects CRUD + management (step 2)
**Status: IMPLEMENTED** — backend routes and the required project management columns are now in place; frontend wiring is deferred to the later navigation/home phases.

Implemented in `routes/jarvis/projects.ts` (all inputs use the existing `cleanText` guard; project-scoped queries enforce the project id):
- `GET /projects?q=&sort=&archived=` — search (name/description ILIKE) + sort (`updated|created|name|recently used`) + pin-first ordering.
- `POST /projects` (exists — add `description`), `PATCH /projects/:id` (exists — add rename/description/color/archive), `DELETE /projects/:id` (new — hard delete + cascade; archive already available via PATCH).
- `POST /projects/:id/open` — touch `lastOpenedAt` for recently-used.
- `POST /projects/:id/pin` / `DELETE /projects/:id/pin` — toggle favorite.
- `POST /projects` with `fromConversationId` — create-from-conversation (clone conversation metadata, move it in).
- Conversation↔project moves: `POST /conversations/:id/project` (move), `DELETE /conversations/:id/project` (remove from project, keep conversation).
- **Isolation invariant (step 5):** every project-scoped query is filtered `WHERE project_id = :id`; a project's data is only ever addressable through its own id.

### Phase C — Project Home backend + UI (step 3)
**Status: IMPLEMENTED** — the project home is reachable from the existing sidebar and keeps future project tools honest until their backend phases land.

Implemented:
- `GET /projects/:id/home` — scoped aggregate with project identity, recent activity derived from existing project/conversation/file relationships, counts, and latest entries. Research/tasks/memory are explicit empty sections until their tables and routes land.
- Frontend `src/components/projects/project-home.tsx` — Jarvis-native dashboard with name + description, `[Continue working]` (reopen last conversation), `[New chat]` (create and move a conversation into the project), recent activity, and tiles for Conversations · Files · Research · Tasks · Memory.
- The Home shell now switches into the dashboard when a project is selected from the existing sidebar, supports back/continue/new-chat callbacks, an honest empty-project state, and English/Dutch `projectHome.*` translations.

### Phase D — Project-scoped conversations (step 4)
**Status: IMPLEMENTED** — project conversations now have an explicit lifecycle and context boundary; the dedicated project-memory retrieval pass remains in Phase E.

Implemented:
- **Auto-associate:** `POST /conversations` accepts `projectId` and creates the conversation plus its `projectChats` relationship in one transaction. Project Home uses this path for new chats.
- **Scoped list/search:** `GET /conversations?projectId=` and `GET /conversations/search?q=&projectId=` return only that project's conversations. Unscoped list/search excludes project-linked conversations so they do not leak into global history.
- **Context boundary:** chat resolves the conversation's project server-side and injects project identity plus the ordered dedicated `project_instructions` rules, falling back to legacy `projects.instructions` for older data. Global user memory is suppressed for project conversations; Phase E adds relevant project-memory retrieval and project-scoped extraction.
- Move / remove remains available through the Phase B conversation↔project endpoints, with the one-project invariant preserved by the move transaction.
- Frontend: the Home shell passes the active project to the sidebar, which lists and searches scoped project conversations; Project Home creates project chats through the scoped API. Existing conversation rendering is reused.

### Phase E — Project Memory system (steps 5, 6, 8, 9 — the heart)
**Status: IMPLEMENTED** — project memory now has isolated relational storage, CRUD/pin APIs, zero-cost keyword retrieval, and project-scoped automatic extraction. The bilingual Phase F memory UI is implemented below.
- **Routes** `routes/jarvis/project-memories.ts`:
  - `GET /projects/:id/memories` — grouped by category for the UI (step 7 shape).
  - `POST /projects/:id/memories` — manual add (sourceType `manual`, explicit source field).
  - `PATCH /memories/:memoryId` — edit content/category/pin.
  - `DELETE /memories/:memoryId` — forget.
  - `POST /memories/:memoryId/pin` — pin/unpin.
- **Relevant retrieval (step 8):** in-project chat builds the memory block by **keyword relevance** — tokenize the user message, score `project_memories` rows by term overlap + category match, take top-N (e.g. 12) **+ always include pinned**. No vector DB/paid service (0-euro). Optional pgvector upgrade (Neon supports it) deferred — see Open Questions.
- **Automatic extraction (step 9):** generalize the existing chat.ts LLM extraction routine (currently targets `userMemories`) into a project-scoped pass: after a project conversation turn, ask the model for candidate facts **with a category + canonical `key`**; upsert `project_memories` by `(projectId, key)` so changed facts **update, never duplicate**. Skip noise per the brief's whitelist (requirements/constraints/decisions/preferences/architecture/facts/recurring instructions/goals) and the existing do-not-remember rules.
- **Isolation (step 5):** every read/write is project-scoped; global memory and other projects' memory are never included in a project's context, and project memory is never injected into non-project or other-project chats. Compatibility mutation endpoints require an explicit `projectId` when the memory id is not nested.

### Phase F — Memory UI (step 7)
**Status: IMPLEMENTED** — Project Memory is now a dedicated Jarvis-native view opened from the Project Home Memory tile; global chat navigation remains unchanged.

Implemented in `src/components/projects/project-memory.tsx`:
- Grouped view by memory category with pinned-first visual treatment.
- Per-memory source type/reference, last-updated date, inline edit, forget, and pin/unpin controls.
- Manual add form with content, category, and optional source reference.
- Scoped search through the Phase E project-memory API, loading/error/empty states, and bilingual English/Dutch copy.
- Project Home memory tile opens the view; Back returns to the same project dashboard.

### Phase G — Project Instructions (step 10)
**Status: IMPLEMENTED** — explicit project rules now have their own relational storage, scoped management API, dedicated bilingual UI, and chat-context injection.

Implemented:
- Schema and idempotent migration for `project_instructions` with strict project FK isolation, stable ordering, and timestamps; the legacy `projects.instructions` column remains for compatibility.
- API router `routes/jarvis/project-instructions.ts`: `GET/POST /projects/:id/instructions`, scoped `PATCH/DELETE /projects/:projectId/instructions/:instructionId`, and strict reorder via `POST /projects/:id/instructions/reorder`. Mutations keep the legacy column synchronized, and old single-column instructions are materialized on read.
- Frontend `src/components/projects/project-instructions.tsx`: Jarvis-native bilingual rule editor with add/edit/delete, move up/down ordering, explicit-rule framing, and useful loading/error/empty states.
- Project Home's Instructions tile opens the dedicated view; chat injects every dedicated rule in order, with a safe fallback to legacy instructions if migration is not yet available.

### Phase H — Navigation: Projects are first-class (step 2)
**Status: IMPLEMENTED** — the existing Jarvis sidebar now exposes Projects as a first-class, scoped workspace navigator without replacing global chat navigation.

Implemented in `project-gallery.tsx`, `chat-sidebar.tsx`, and `pages/home.tsx`:
- Project search against name and description, with updated/created/name/recently-used sorting and archived-project visibility.
- Create, create-from-current-conversation, open, inline rename, archive/restore, pin/unpin, hard delete, and move-current-chat actions; the one-project-per-conversation invariant remains enforced by the backend.
- A compact project quick-access rail for home, new chat, memory, files, research, tasks, and instructions. Implemented views open directly; future views report honestly through the existing Jarvis toast instead of pretending to exist.
- Project Home remains the landing view when opening a project, while the regular global chat list and navigation stay available outside the project scope.
- All new navigation copy is routed through the existing English/Dutch i18n contract.

### Re-cut of phases A–H (deltas introduced by steps 11–20)

Steps 11–20 add system-level work on top of A–H rather than reworking them. Deltas:

- **Phase A (data model):** add `owner_account_id` nullable to `projects` (step 16 ownership); `project_tasks` grows to the step 13 shape (description, priority, due, refs — see Phase K); `project_activity.type` enum expands to the step 15 event set (see Phase M); new agent tables `project_agent_runs` + `project_agent_actions` added (step 14, Phase M).
- **Phase B (projects CRUD):** unchanged; ownership check added per step 17.
- **Phase C (project home):** gains the step 20 **empty state** ("Your project is ready." + 4 actions) and the step 15 "Recent activity" strip (Phase M wires the feed).
- **Phase D (scoped conversations):** the context-injection bullet is **expanded into Phase L** (identity + instructions + memory → + relevant files, relevant history, relevant research). Move/remove/list/search work is unchanged.
- **Phase E (memory engine):** unchanged — its keyword-relevance retrieval is the shared engine Phase L reuses for files/history/research too.
- **Phase F (memory UI):** unchanged.
- **Phase G (instructions):** now implemented; the dedicated ordered rule table, API, UI, and injection are active.
- **Phase H (navigation):** gains the step 19 **quick-access rail** (switch project, chat, memory, files, research, tasks, instructions — flat, no extra layers).

### Phase I — Project Files (step 11)

Extend the EXISTING `/api/files` router (do NOT create a second file system):
- `PATCH /api/files/:id` — rename (update `files.name`).
- `DELETE /api/files/:id` — delete metadata row + blob (`getStorage().remove(storageKey)`; backends already support it).
- Download: serve endpoint gains `?download=1` → `Content-Disposition: attachment` (default stays `inline`).
- Search: `GET /api/files` gains `?q=` (name ILIKE) alongside the existing `?conversation_id=` filter.
- Project association: `POST /api/files` accepts `projectId` → insert `project_files` join row (projectId, fileId). `GET /projects/:id/files` lists the project's files via the join.
- Preview: reuse the existing mime-sniffed serve — images render inline, documents via an embedded viewer (`<object>`/`<iframe>`), audio via the existing player; a light modal around the file URL.
- Frontend `src/components/projects/project-files.tsx`: grid/list, upload button, search box, preview modal, rename (inline), delete (confirm), download. Log activity (`file_uploaded`, `file_changed`).
- Files-as-context handoff to Phase L.

### Phase J — Project Research (step 12)

Activate the `project_research` join planned in Phase A; the research engine stays untouched:
- `POST /api/jarvis/research` accepts optional `projectId` → inserts the join row on start; `GET /projects/:id/research` lists runs (title, status, progress, phase, dates).
- Run detail reuses the existing job view (report / notes / log) — do not re-model.
- **Sources:** surfaced read-only from the run's existing `log`/`notes` (the engine already writes its sources there).
- **Saved findings:** small `project_research_findings` table (id, projectId, researchJobId, excerpt, createdAt) + pin/unpin endpoints — user-saved excerpts.
- Log `research_completed` on job completion (Phase M helper).

### Phase K — Project Tasks (step 13)

- Extend `project_tasks` (from the Phase A baseline) to the full step-13 shape: `description` text · `status` enum `todo|in_progress|done` (TODO / IN PROGRESS / DONE) · `priority` enum `low|medium|high` · `dueAt` timestamp (optional) · `conversationId` uuid nullable (FK→conversations, SET NULL) · `fileId` uuid nullable (→ files, cross-db, no FK) · `memoryId` uuid nullable (→ project_memories) · created/updated times (existing). **Kept deliberately light** — no boards, assignees, or dependencies.
- Routes `routes/jarvis/project-tasks.ts`: `GET /projects/:id/tasks`, `POST /projects/:id/tasks`, `PATCH /tasks/:id` (title/description/priority/due/status cycle), `DELETE /tasks/:id`.
- Frontend `src/components/projects/project-tasks.tsx`: inline add, status cycle (TODO → IN PROGRESS → DONE), priority chip, optional due date, delete. Log `task_added` / `task_completed`.

### Phase L — AI Context Pipeline (step 18) — *critical, supersedes Phase D's injection bullet*

At the system-prompt assembly point in `chat.ts` where the global memory block is injected today, when the conversation has a project, append a scoped `PROJECT CONTEXT` block built from all six sources:
1. **Project identity** — name + description, one short line.
2. **Project instructions** — ALL of them (few + authoritative, step 10).
3. **Relevant project memory** — Phase E engine: keyword-scored top-N + always pinned.
4. **Relevant project files/context** — keyword-scored top-N project files; for text-like kinds include a content excerpt (reuse the file-read path), for others name/mime/url.
5. **Relevant project conversation history** — the current conversation's messages are already the request context (existing); add keyword-scored excerpts from OTHER project conversations when relevant.
6. **Relevant research** — keyword-scored research runs: title, status, report/findings excerpt.
- **Isolation invariants (enforced in code, tested):** every sub-source queries `WHERE project_id = :id` only; project memory/instructions/files/history/research are NEVER injected into a non-project or other-project conversation; global memory is never injected into a project conversation. One `buildProjectContext(projectId, userMessage)` helper.

### Phase M — Agent-ready schema + activity feed (steps 14, 15)

- **Schema (built now, populated later — step 14):** `project_agent_runs` (id, projectId FK cascade, status `queued|running|completed|failed|cancelled`, objective, startedAt, completedAt, result summary, createdAt) and `project_agent_actions` (id, runId FK cascade, projectId, type `browser|code|file|test|terminal|search|other`, description, detail, createdAt) — covering the `Project → Agent Run → Actions → Files changed / Tests / Browser activity → Result` shape. **The autonomous agent loop itself is deferred** (matches the brief).
- **Activity (step 15):** expand `project_activity.type` to the event set — `project_created · conversation_started · file_uploaded · file_changed · research_completed · memory_added · memory_updated · instruction_added · task_added · task_completed · agent_ran`. One `logActivity(projectId, type, description)` helper; call it from every mutating endpoint (project CRUD, conversation moves, Phase I files, Phase J research, Phase K tasks, memory, instructions).
- Frontend `src/components/projects/project-activity.tsx`: full feed (newest first, grouped by day, type icon); the project home's "Recent activity" strip (Phase C) reads the same feed.

### Phase N — API + ownership consolidation (step 17)

- Complete endpoint inventory (below) under the existing routers + the new routers (I–M), all following existing `/api/jarvis/*` conventions and the `cleanText` guard.
- **Ownership/authorization server-side:** every project-scoped handler resolves the project (`WHERE id = :id`), 404s on missing; single-owner model (`owner_account_id` null = primary user) enforced in handlers; the frontend only ever calls `/api/jarvis/*` — it never touches the DB (existing rule, kept).
- **Inventory:** `GET/POST /projects` · `GET/PATCH/DELETE /projects/:id` · `POST /projects/:id/open` · `POST/DELETE /projects/:id/pin` · `POST /projects` `fromConversationId` · `POST/DELETE /conversations/:id/project` · `GET /projects/:id/home` · `GET /projects/:id/conversations` · `GET/POST /projects/:id/files` + `PATCH/DELETE /api/files/:id` · `GET/POST /projects/:id/research` + findings endpoints · `GET/POST /projects/:id/memories` + `PATCH/DELETE/pin /memories/:id` · project instructions CRUD · `GET/POST /projects/:id/tasks` + `PATCH/DELETE /tasks/:id` · `GET /projects/:id/activity`.

### Phase O — Navigation + empty states (steps 19, 20)

- **Project sidebar (step 19):** when a project is open, a compact rail — **switch project · chat · memory · files · research · tasks · instructions/settings** — one click each, no nested layers. Reuses existing Tailwind/framer-motion/lucide tokens; keeps the Jarvis look (dark glass cards + the existing accent/border language), explicitly NOT Notion/Linear/SaaS chrome. Global Jarvis nav untouched; project chrome only inside a project.
- **Empty state (step 20):** Phase C's project home gets an empty branch for brand-new projects — **"Your project is ready."** + one-click **[Start a conversation] [Upload files] [Add instructions] [Add first task]** (wired to New chat / upload / instructions / first task). The activity feed seeds with the `project_created` event. No giant empty dashboard.

---

## 4. Verification (per phase, matching project norms)
- `tsc --noEmit` clean for **both** `artifacts/jarvis` and `artifacts/api-server` (+ `lib/db` built).
- Server bundles (`build.mjs`).
- Auto-migrate runs idempotently (fresh + existing DB).
- Where possible, Puppeteer smoke like Book Studio (create project → home → memory add → conversation inherits context).
- New phases I–O: file CRUD smoke (upload → rename → preview → download → delete, project association), research attach (start inside project → join row → list), task CRUD + status cycle, activity rows for every event type, and the critical **context-pipeline isolation test** — a message in Project A must not leak Project B's or global context, and vice versa.
- Live LLM/DB paths only fully exercisable where the server's `.env` exists (repo `.env` is gitignored by design).

## 5. Open questions / deferrals
- **Relevant retrieval depth:** keyword scoring for v1; pgvector embedding retrieval is possible on Neon but costs LLM tokens per memory write — defer decision until steps 11+ clarify (there may be an embedding path in a later step).
- **Steps 21–32 unknown** (steps 11–20 are now planned above): likely security/permissions, archiving/deletion flows, workspace/code, generated assets, and further agent wiring. Phases A–O are cut so these append cleanly (new tables/routes/components rather than rework).
- **Existing `projects.instructions` legacy column:** the dedicated `project_instructions` table is canonical; Phase G mutations synchronize the legacy column, and reads materialize old single-column data into the new table.
- **Research association:** `project_research` join added now; the research *engine* itself (background job) stays untouched.
- **Research "Sources"/"Saved findings" depth (step 12):** sources surfaced read-only from the existing job `log`/`notes` vs. new extraction/storage — deferred until steps 21–32 clarify.
- **Agent schema timing (step 14):** build `project_agent_runs` / `project_agent_actions` now (routes + activity wiring) or schema-only until the agent actually exists — pending later steps.
- **Files content extraction (step 18 item 4):** text extraction for document kinds (pdf/doc/txt) so file context can be excerpted per chat turn; cost/perf of reading blobs — reuse the existing file-read path, defer RAG-depth decisions.
