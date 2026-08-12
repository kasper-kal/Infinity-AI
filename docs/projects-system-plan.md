# Jarvis Projects System — Build Plan (Steps 1–10 of 32)

> **Status:** PLAN ONLY — no implementation yet.
> **Source:** User's 32-step brief, first 10 steps captured in full below.
> **Living document:** will be extended when steps 11–20 and 21–32 are handed over; phases may be re-cut then.

---

## 1. Repo grounding — what already exists to reuse

The brief says: inspect the repository, reuse working architecture, don't replace it. Findings:

### Existing Projects code (a lighter system already lives here)
- **DB schema** `lib/db/src/schema/projects.ts` — a ChatGPT-style *folder* system, NOT yet a workspace:
  - `projects` (id, name, color, archived, **instructions** [single text col, injected as system text], createdAt, updatedAt)
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

## 3. Build phases (steps 1–10 mapped to concrete work)

> Order = dependency-first. Backend/schema before UI. Phases are cut so steps 11–32 can slot in without rework.

### Phase A — Data model & migration (foundations for steps 1, 2, 4, 5, 6, 10)
**Extend existing `projects` table** (new columns, idempotent `ALTER ... ADD COLUMN IF NOT EXISTS` in `auto-migrate.ts`):
- `description` text — project home / search
- `pinned` boolean default false — project-level favorite
- `lastOpenedAt` timestamp — "recently used" sorting

**New tables (new schema file `lib/db/src/schema/project-memory.ts` + auto-migrate CREATE TABLE):**
- `project_memories` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `category` text (about/technical/decisions/requirements + freeform), `content` text, `key` text (canonical upsert key — prevents duplicates, step 9), `sourceType` text (`conversation|file|research|instruction|agent|manual`), `sourceRef` text (conversation title + date, file path, etc.), `pinned` boolean default false, `createdAt`, `updatedAt`.
- `project_instructions` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `text` text, `sortOrder` int, `createdAt`. (Step 10 wants a dedicated *area* with multiple rules + CRUD — a table beats the single legacy `projects.instructions` column; the legacy column stays for back-compat and is fed from this table.)
- `project_tasks` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `title`, `status` (`todo|doing|done`), `sortOrder`, `createdAt`, `updatedAt`. (Tasks surface on the project home now; full task workflow may be in later steps.)
- `project_activity` — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `type` (`chat|file|research|memory|instruction|task|other`), `description` text, `createdAt`. Append-only feed for "Recent activity" + activity/history requirement.
- `project_research` join — `id uuid PK`, `projectId uuid FK→projects (cascade)`, `researchJobId uuid`, `createdAt`. Associates background research to a project (research engine already persists jobs; we add the relationship, no duplication).

### Phase B — Backend: first-class Projects CRUD + management (step 2)
Extend `routes/jarvis/projects.ts` (all responses reuse existing `cleanText` guard; keep shapes consistent):
- `GET /projects?q=&sort=&archived=` — search (name/description ILIKE) + sort (`updated|created|name|recently used`) + pin-first ordering.
- `POST /projects` (exists — add `description`), `PATCH /projects/:id` (exists — add rename/description/color/archive), `DELETE /projects/:id` (new — hard delete + cascade; archive already available via PATCH).
- `POST /projects/:id/open` — touch `lastOpenedAt` for recently-used.
- `POST /projects/:id/pin` / `DELETE /projects/:id/pin` — toggle favorite.
- `POST /projects` with `fromConversationId` — create-from-conversation (clone conversation metadata, move it in).
- Conversation↔project moves: `POST /conversations/:id/project` (move), `DELETE /conversations/:id/project` (remove from project, keep conversation).
- **Isolation invariant (step 5):** every project-scoped query is filtered `WHERE project_id = :id`; a project's data is only ever addressable through its own id.

### Phase C — Project Home backend + UI (step 3)
- `GET /projects/:id/home` — aggregate: project (name/description), recent activity (last ~10 `project_activity`), counts + latest entries for conversations/files/research/tasks/memory.
- Frontend `src/components/projects/project-home.tsx` — layout exactly per the brief: name + description, `[Continue working]` (reopen last conversation) + `[New chat]` (start a scoped conversation), Recent activity feed, and tiles for Conversations · Files · Research · Tasks · Memory. Uses existing Tailwind/framer-motion/lucide + `t()` i18n (`projectHome.*` keys in `en` + `nl`).

### Phase D — Project-scoped conversations (step 4)
- **Auto-associate:** creating a conversation from inside a project sets `projectChats` row on creation.
- **Auto-context injection:** in `chat.ts` system-prompt assembly (where the global memory block is injected today), when the conversation has a project: inject (a) **Project Instructions** (all of them, step 10), (b) **relevant Project Memories** (subset, step 8), (c) a short project identity line (name + description). All scoped strictly to that project — **no cross-project leakage**.
- Move / remove / list / search: extend conversations route to filter by project + expose move/remove endpoints (Phase B route covers moves; conversations list gains `?projectId=`).
- Frontend: project conversations list + "new conversation in project" + move-to-project affordance in the sidebar/project home. Reuse existing `ConversationFeed`/`ChatComposer` — **do not duplicate conversation rendering**.

### Phase E — Project Memory system (steps 5, 6, 8, 9 — the heart)
- **Routes** `routes/jarvis/project-memories.ts`:
  - `GET /projects/:id/memories` — grouped by category for the UI (step 7 shape).
  - `POST /projects/:id/memories` — manual add (sourceType `manual`, explicit source field).
  - `PATCH /memories/:memoryId` — edit content/category/pin.
  - `DELETE /memories/:memoryId` — forget.
  - `POST /memories/:memoryId/pin` — pin/unpin.
- **Relevant retrieval (step 8):** in-project chat builds the memory block by **keyword relevance** — tokenize the user message, score `project_memories` rows by term overlap + category match, take top-N (e.g. 12) **+ always include pinned**. No vector DB/paid service (0-euro). Optional pgvector upgrade (Neon supports it) deferred — see Open Questions.
- **Automatic extraction (step 9):** generalize the existing chat.ts LLM extraction routine (currently targets `userMemories`) into a project-scoped pass: after a project conversation turn, ask the model for candidate facts **with a category + canonical `key`**; upsert `project_memories` by `(projectId, key)` so changed facts **update, never duplicate**. Skip noise per the brief's whitelist (requirements/constraints/decisions/preferences/architecture/facts/recurring instructions/goals) and the existing do-not-remember rules.
- **Isolation (step 5):** every read/write is project-scoped; global memory and other projects' memory are never included in a project's context, and project memory is never injected into non-project or other-project chats.

### Phase F — Memory UI (step 7)
- `src/components/projects/project-memory.tsx` — Project → Memory tab:
  - Grouped view (About this project / Technical / Decisions / Requirements by `category`).
  - Per-memory: **View** (expand) · **Edit** (inline) · **Delete/Forget** · **Pin** (badge + sort priority) · **Source** (render sourceType + sourceRef, e.g. "Conversation → Design discussion → Aug 11, 2026").
  - Manual add memory (with category + source), search within memory list.
  - Distinct visual treatment for **Pinned** (important project rules).
- `projectHome.*` / `projectMemory.*` i18n keys in `en` + `nl`.

### Phase G — Project Instructions (step 10)
- `routes`: CRUD on `project_instructions` (list / add / edit / delete / reorder) under `routes/jarvis/projects.ts` or a small dedicated router.
- UI: `src/components/projects/project-instructions.tsx` — clearly labeled **PROJECT INSTRUCTIONS** vs **PROJECT MEMORY** (separate tabs/sections, different framing: "rules you set" vs "what Jarvis learned").
- Injection: full instructions block included whenever a chat runs inside the project (Phase D).

### Phase H — Navigation: Projects are first-class (step 2)
- Sidebar: a **Projects section** in `chat-sidebar.tsx` — create/rename/delete-archive/open, **search**, **sort**, **recently used**, **pin/favorite**, move/copy conversation into project, create-from-conversation.
- Upgrade `project-gallery.tsx` (or replace its render with the new first-class section) — keep the same component boundaries and design tokens so it feels native.
- Project home becomes the landing view when opening a project; standard chat remains available.

---

## 4. Verification (per phase, matching project norms)
- `tsc --noEmit` clean for **both** `artifacts/jarvis` and `artifacts/api-server` (+ `lib/db` built).
- Server bundles (`build.mjs`).
- Auto-migrate runs idempotently (fresh + existing DB).
- Where possible, Puppeteer smoke like Book Studio (create project → home → memory add → conversation inherits context).
- Live LLM/DB paths only fully exercisable where the server's `.env` exists (repo `.env` is gitignored by design).

## 5. Open questions / deferrals
- **Relevant retrieval depth:** keyword scoring for v1; pgvector embedding retrieval is possible on Neon but costs LLM tokens per memory write — defer decision until steps 11+ clarify (there may be an embedding path in a later step).
- **Steps 11–32 unknown:** likely cover files/workspace, agent activity, tasks workflow, generated assets, delete/archive flows, activity history UI, security. Phases A–H are cut so these append cleanly (new tables/routes/components rather than rework).
- **Existing `projects.instructions` legacy column:** keep populated from the new `project_instructions` table for back-compat, or migrate on read.
- **Research association:** `project_research` join added now; the research *engine* itself (background job) stays untouched.
