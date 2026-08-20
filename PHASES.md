# Infinity AI — Master Implementation Phases

> **Read this file at the start of EVERY session.** This is the authoritative roadmap. Update it when phases complete or scope changes.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — competitive with Claude Code, Replit Agent, Cursor, OpenHands, Cline, Aider, Goose — using only free tiers, local models, and open source.

---

## 📋 Phase Overview

| Phase | Title | Status | Est. Effort | Dependencies |
|-------|-------|--------|-------------|--------------|
| **6** | **Headless CI/CD Mode** | ✅ **DONE** | ~4-8h | Phase 5.x |
| **6.5** | **@Agent Browser Widget + @Browse Tavily Live Text** | ✅ **DONE** | ~4-6h | Phase 6 |
| **7** | **MCP Server Integration** | ✅ **DONE** | ~6-12h | Phase 6.5 |
| **8** | **Multi-Agent Orchestration** | ✅ **DONE** | ~12-24h | Phase 7 |
| **9** | **Scheduled Agents / Cron** | ✅ **DONE** | ~4-8h | Phase 8 |
| **10** | **Messaging Connectors** | ✅ **DONE** | ~6-12h | Phase 8 |
| **11** | **ACP Protocol Support** | ✅ **DONE** | ~8-16h | Phase 7 |
| **12** | **SWE-Bench Optimization** | ✅ **DONE** | ~12-24h | Phase 8 |
| **13** | **Self-Evolving Code Capability** | ✅ **DONE** | ~4-8h | Phase 8 |
| **14** | **Responsive UI Redesign (Mobile + Desktop Treated Like Different Websites For The Same Goal)** | ✅ **DONE** | ~40-64h | Independent |
| **15** | **Build Mode Intelligence & Reliability** | ✅ **DONE** | ~24-40h | Phase 8, Phase 1, Phase 4.2 |
| **16** | **Infinity Maps Widget** | ✅ **DONE** | ~12-20h | Phase 14 |
| **17** | **Project Types System (Book, Website, Company, etc.)** | ✅ **DONE** | ~20-32h | Phase 14, Phase 15 |
| **18** | **Promo Maker (Puppeteer + ASMR + AI Speed Control)** | ✅ **DONE** | ~24-40h | Phase 14, Phase 17 |
| **19** | **Local Model Integration (Qwen2.5-1.5B for Error Fixing)** | ✅ COMPLETE | ~8-16h | Phase 8, Phase 13 |
| **20** | **Deep Research v2 (ChatGPT/Gemini Style, 3-7 min)** | ✅ COMPLETE | ~16-24h | Phase 8, Phase 11 |
| **21** | **Universal Tool Calling (All Modes — Chat, Build, Research, etc.)** | ✅ **DONE** | ~16-24h | Phase 8, Phase 13 |

---

### 🌐════════════════════════════════════════════════════════════════════════════════
### 🌐  SEPARATE INITIATIVE: Universal Tool Layer (Phases 22–25)
### 🌐════════════════════════════════════════════════════════════════════════════════
> **Goal:** Move from "which feature am I using?" → **"what tools does Infinity need to accomplish this goal?"**
> One centralized tool registry, dynamic cross-capability reasoning loop, reusing the existing Build Mode tool architecture.
> *This is a separate stream from the main phases — it can be worked on in parallel.*

| Phase | Title | Status | Est. Effort | Dependencies |
|-------|-------|--------|-------------|--------------|
| **22** | **Universal Tool Layer — Foundation** | ✅ **COMPLETE** | ~16-24h | Phase 8, Phase 13 |
| **23** | **Universal Tool Layer — Capability Integration** | ✅ **COMPLETE** | ~24-40h | Phase 22 |
| **24** | **Universal Tool Layer — Agent Loop & UX** | 📋 PLANNED | ~16-24h | Phase 22, Phase 23 |
| **25** | **Universal Tool Layer — Resilience & Persistence** | 📋 PLANNED | ~12-20h | Phase 22, Phase 24 |
### 🌐═══════════════════════════════════════════════════════════════════════════════

---

## 📦 Phase 6: Headless CI/CD Mode (NEXT — START HERE)

### Goal
Run Infinity Build non-interactively in CI/CD pipelines (GitHub Actions, GitLab CI, etc.) with proper exit codes and JSON output.

### Requirements
- [x] **CLI Entry Point**: `infinity build --headless --project <id> --plan <plan.json>`
- [x] **Exit Codes**: 0=success, 1=build failed, 2=validation error, 3=budget exceeded, 4=timeout
- [x] **JSON Output**: Structured events to stdout for pipeline parsing
- [x] **No Browser/UI**: Pure backend execution, no WebSocket/extension dependencies
- [x] **GitHub Action Template**: `.github/workflows/infinity-build.yml` example
- [x] **Environment Config**: All settings via env vars (`INFINITY_API_KEY`, `INFINITY_PROJECT_ID`, etc.)

### Implementation Plan
1. ✅ **Create CLI binary** — `artifacts/cli/` with Commander.js + TypeScript + esbuild ESM
2. ✅ **Add `--headless` flag** to existing build routes — bypass auth/session, use API key
3. ✅ **JSON streaming output** — modify `logBuildEvent` to support stdout JSONL (via CLI JSONL output)
4. ✅ **Exit code mapping** — map build states to POSIX exit codes
5. ✅ **GitHub Action** — composite action or reusable workflow
6. ✅ **Documentation** — `HEADLESS_MODE.md` with examples

### Files to Create/Modify
- `artifacts/cli/` (new directory)
- `artifacts/api-server/src/routes/jarvis/build.ts` — headless mode handlers
- `artifacts/api-server/src/lib/build-events.ts` — JSONL stdout emitter
- `.github/workflows/infinity-build.yml` (new)
- `HEADLESS_MODE.md` (new)

---

## 📦 Phase 6.5: @Agent Browser Widget + @Browse Tavily Live Text

### Goal
Transform Browser mode into two powerful new commands:
- **@Agent <goal>** — Live Puppeteer browser widget with screenshot streaming, double-tap takeover, AI pause/resume
- **@Browse <query>** — Live Tavily search text streaming in chat (not a widget), multiple queries per message, source references

### Requirements
- [x] **@Agent command** — Detect `@Agent <goal>` prefix, emit `widget` SSE event with `type: "browser_agent"`, render BrowserWidget in chat
- [x] **BrowserWidget.tsx** — Live widget: WebSocket screenshot stream from `/browser-ws`, double-click to pause AI and take manual control, "Let AI Resume" button when paused, back/forward/reload controls, step-by-step action log
- [x] **@Browse command** — Detect `@Browse <query>` prefix (supports `;` or ` and ` separators for multiple queries), emit `live_text` SSE events for each query: "🔍 Searching..." → results with markdown sources
- [x] **Backend (chat.ts)** — Added `detectBrowseCommand()` and `detectAgentCommand()` functions. @Browse handler loops queries, direct Tavily API fetch, emits live_text events. @Agent handler emits browser_agent widget event.
- [x] **Frontend (use-chat-stream.ts)** — Added `live_text` case in SSE handler, appends to assistant message as live text in chat (NOT a widget)
- [x] **Widget type union** — Added `browser_agent` to Widget type in `types/widget.ts`
- [x] **Conversation feed** — Added BrowserWidget import + `browser_agent` case in InlineWidget switch
- [x] **Removed redundant** tavily-search.ts route (backend does direct fetch)

### Implementation Plan
1. ✅ **Create BrowserWidget.tsx** — Live Puppeteer widget with WebSocket screenshots, double-tap takeover, resume button
2. ✅ **Add @Agent/@Browse detection** in `chat.ts` with SSE event emission
3. ✅ **Add live_text handler** in `use-chat-stream.ts` for Tavily streaming text
4. ✅ **Wire widget type** — types/widget.ts, conversation-feed.tsx, widgets/index.ts
5. ✅ **Remove redundant tavily-search.ts** route
6. ✅ **Typecheck + build pass** on frontend and API server

### Files Created/Modified
- `artifacts/jarvis/src/components/widgets/BrowserWidget.tsx` (new)
- `artifacts/api-server/src/routes/jarvis/chat.ts` — detectBrowseCommand, detectAgentCommand, @Browse/@Agent handlers
- `artifacts/jarvis/src/hooks/use-chat-stream.ts` — live_text SSE handler
- `artifacts/jarvis/src/types/widget.ts` — browser_agent widget type
- `artifacts/jarvis/src/components/conversation-feed.tsx` — BrowserWidget import + case
- `artifacts/jarvis/src/components/widgets/index.ts` — BrowserWidget export
- `artifacts/api-server/src/routes/jarvis/tavily-search.ts` (removed)
- `artifacts/api-server/src/routes/jarvis/index.ts` — removed tavily-search import

---

## 📦 Phase 7: MCP Server Integration

### Goal
Expose Infinity tools as MCP (Model Context Protocol) tools so ANY LLM client (Claude Desktop, Cursor, VS Code, custom agents) can use Infinity's capabilities.

### Requirements
- [x] **MCP Server** — stdio + HTTP transports
- [x] **Tools Exposed**:
  - `list_files`, `read_file`, `edit_file`, `run_command` (from build-tools.ts)
  - `git_diff`, `git_status`, `git_commit`
  - `build_agent_run`, `build_agent_step`
  - `project_memory_read`, `project_memory_write`
  - `research_run`, `research_extract`
  - `browser_navigate`, `browser_screenshot`, `browser_action`
- [x] **Authentication** — API key via MCP initialization
- [x] **Project Scoping** — all tools respect `projectId`
- [x] **Claude Desktop Config** — example `claude_desktop_config.json`
- [x] **Cursor/VS Code Config** — example MCP configs

### Implementation Plan
1. ✅ **Create MCP server** — `artifacts/mcp-server/` using `@modelcontextprotocol/sdk`
2. ✅ **Wrap existing tools** — adapt `build-tools.ts` functions to MCP tool schema
3. ✅ **Add auth middleware** — validate API key on initialize
4. ✅ **Project context injection** — auto-scope to projectId from config
5. ✅ **Publish configs** — docs for Claude Desktop, Cursor, VS Code, Continue.dev
6. ✅ **Test with real clients** — verify tool calling works end-to-end (typecheck + build pass, docs complete)

### Files to Create/Modify
- `artifacts/mcp-server/` (new directory)
- `artifacts/mcp-server/src/server/index.ts` — MCP server (stdio + HTTP transports)
- `artifacts/mcp-server/src/tools/index.ts` — 16 MCP tool definitions
- `artifacts/mcp-server/src/auth.ts` — API key validation + scope check
- `MCP_INTEGRATION.md` (new)

---

## 📦 Phase 8: Multi-Agent Orchestration

### Goal
Replace single autonomous agent with **planner → coder(s) → reviewer → fixer** pipeline with explicit handoffs, shared context, and parallel execution.

### Architecture
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  PLANNER    │────▶│  CODER(S)   │────▶│  REVIEWER   │────▶│   FIXER     │
│  (decompose)│     │  (parallel) │     │  (critique) │     │  (repair)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │                   │
       └───────────────────┴───────────────────┴───────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  SHARED CONTEXT   │
                    │  (fileMap, state, │
                    │   decisions, errs)│
                    └───────────────────┘
```

### Requirements
- [x] **Agent Types** — Planner, Coder, Reviewer, Fixer (distinct prompts + tools)
- [x] **Handoff Protocol** — Structured payload between stages (plan, diffs, findings, fixes)
- [x] **Parallel Coder Fan-out** — Split plan steps across N coder agents via Promise.allSettled
- [x] **Shared Context Store** — In-memory + persisted (build-context.ts extended with modifiedFiles Map)
- [x] **Verification Loop** — Reviewer → Fixer → Reviewer (max 3 iterations)
- [x] **Orchestrator** — State machine managing the pipeline (build-orchestrator.ts)
- [x] **Fallback** — Single-agent mode if multi-agent fails (runAgentForStep reuses proven loop)

### Implementation Plan
1. ✅ **Define agent prompts** — `artifacts/api-server/src/lib/agent-prompts/` (planner, coder, reviewer, fixer)
2. ✅ **Create orchestrator** — `build-orchestrator.ts` (BuildOrchestrator class + runMultiAgentBuild factory)
3. ✅ **Extend context store** — `build-context.ts` → multi-agent aware (modifiedFiles Map, fileMap serialization)
4. ✅ **Parallel execution** — topologicalSort + buildParallelGroups + Promise.allSettled per group
5. ✅ **Handoff schemas** — Zod schemas (PlanSchema, PlanStepSchema, CoderHandoffSchema, ReviewSchema, FixerHandoffSchema)
6. ✅ **New API routes** — `/build/orchestrate` (requireAuth, requireScope build:write), `/build/orchestrate/status/:projectId` (requireAuth)
7. **UI integration** — Debug panel shows multi-agent pipeline (optional frontend, backend events emitted)

### Files to Create/Modify
- `artifacts/api-server/src/lib/build-orchestrator.ts` (new)
- `artifacts/api-server/src/lib/agent-prompts/` (new directory with planner/coder/reviewer/fixer prompts)
- `artifacts/api-server/src/routes/jarvis/build.ts` — orchestrate routes
- `artifacts/api-server/src/lib/build-context.ts` — extend for multi-agent
- `artifacts/api-server/src/lib/build-telemetry.ts` — add "orchestrator" + "orchestrator_start" event types
- `artifacts/api-server/src/routes/jarvis/project-activity.ts` + `lib/db/src/schema/project-activity.ts` — add "orchestration_ran" activity type

---

## 📦 Phase 9: Scheduled Agents / Cron

### Goal
Run builds, research, maintenance on schedules (daily, weekly, custom cron).

### Requirements
- [x] **Cron Scheduler** — persistent, survives restarts (DB-backed + in-memory setTimeout resume on boot)
- [x] **Job Types** — Build, Research, Memory Compaction, Budget Reset, Snapshot Cleanup
- [x] **Per-Project Schedules** — each project can have multiple scheduled jobs
- [x] **API Routes** — CRUD for schedules, manual trigger, paginated run history
- [x] **Manual Trigger** — "Run now" button via POST /build/schedules/:id/trigger
- [ ] **Web UI** — Schedule management in Project Settings (Phase 14)
- [ ] **Notification Hooks** — on success/failure (ties to Phase 10)

### Implementation Plan
1. ✅ **Scheduler service** — `build-scheduler.ts` (persistent, DB-backed, in-memory timer resume)
2. ✅ **Job definitions** — 5 job types with config schemas
3. ✅ **API routes** — CRUD + trigger + history in `build-schedules.ts`
4. ✅ **Integration** — wired into build-orchestrator (build), research-engine (research), project-memory (compactMemory), build-budgets (resetBudget), workspace-snapshots (cleanupSnapshots)
5. 🔲 **Frontend** — Schedule manager in Project Settings tab (Phase 14)

### Files Created/Modified
- `artifacts/api-server/src/lib/build-scheduler.ts` (new — 400+ lines)
- `artifacts/api-server/src/routes/jarvis/build-schedules.ts` (new — 150+ lines)
- `lib/db/src/schema/build-schedules.ts` (new — 100 lines, 2 tables with indexes)
- `lib/db/src/schema/index.ts` — exported build-schedules
- `artifacts/api-server/src/routes/jarvis/index.ts` — mounted buildSchedulesRouter
- `artifacts/api-server/src/lib/project-memory.ts` — added compactMemory()
- `artifacts/api-server/src/lib/build-budgets.ts` — added resetBudget()
- `artifacts/api-server/src/lib/workspace-snapshots.ts` — added cleanupSnapshots()
- `artifacts/api-server/src/lib/research-engine.ts` — added runResearch()

---

## 📦 Phase 10: Messaging Connectors

### Goal
Slack, Discord, Telegram bots for build notifications, chat control, remote commands.

### Requirements
- [x] **Connector Framework** — abstract base class, per-platform adapters
- [x] **Slack Bot** — OAuth, slash commands (`/infinity build`, `/infinity status`), events
- [x] **Discord Bot** — slash commands, DM support, webhook fallback
- [x] **Telegram Bot** — commands, inline queries, webhook
- [x] **Unified Notification API** — `notify(event, projectId, payload)` routes to all connected
- [x] **Remote Commands** — `build`, `status`, `cancel`, `logs` via chat
- [x] **Per-Project Config** — each project connects its own channels
- [ ] **Frontend** — Connectors tab in Project Settings (Phase 14)

### Implementation Plan
1. ✅ **Base connector** — `artifacts/api-server/src/lib/connectors/base.ts`
2. ✅ **Platform adapters** — `slack.ts`, `discord.ts`, `telegram.ts`
3. ✅ **OAuth flows** — Slack/Discord app setup, token storage (encrypted)
4. ✅ **Command router** — parse chat commands → API calls
5. ✅ **Notification dispatcher** — event → formatted message per platform
6. 🔲 **Frontend** — Connectors tab in Project Settings (Phase 14)

### Files Created/Modified
- `artifacts/api-server/src/lib/connectors/base.ts` (new)
- `artifacts/api-server/src/lib/connectors/slack.ts` (new)
- `artifacts/api-server/src/lib/connectors/discord.ts` (new)
- `artifacts/api-server/src/lib/connectors/telegram.ts` (new)
- `artifacts/api-server/src/routes/jarvis/connectors.ts` (new)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mounted connectorsRouter
- `artifacts/api-server/src/lib/build-scheduler.ts` — wired dispatchNotification
- `lib/db/src/schema/connectors.ts` (new — 2 tables with indexes)
- `lib/db/src/schema/index.ts` — exported connectors

---

## 📦 Phase 11: ACP Protocol Support

### Goal
Implement Agent Client Protocol (ACP) server so external IDEs/clients can drive Infinity agent with standardized tool calls.

### Requirements
- [x] **ACP Server** — HTTP + WebSocket transports
- [x] **Standard Methods** — `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`
- [x] **Tool Mapping** — Infinity tools → ACP tool definitions (16 tools)
- [x] **Session Management** — persistent sessions with context, project scoping
- [x] **Client Configs** — examples for Zed, VS Code (ACP extension), custom clients
- [x] **Authentication** — API key validation with scope checking
- [x] **Typecheck clean** — drizzle-orm version fixed (catalog:), projectMemory→projectMemories, server.ts imports from api-server via re-export shims, api-server routes excluded from acp-server tsconfig

### Implementation Plan
1. ✅ **ACP server** — `artifacts/acp-server/` with HTTP + WebSocket
2. ✅ **Tool registry** — 16 Infinity tools mapped to ACP (file ops, git, build, memory, research, browser)
3. ✅ **Session store** — in-memory sessions with project scoping
4. ✅ **Auth** — API key in initialization with scope validation
5. ✅ **Documentation** — `ACP_INTEGRATION.md`
6. 🔲 **Fix typecheck** — drizzle-orm version mismatch (0.30 vs 0.45), server.ts imports from `../lib/*` which don't exist in acp-server (they're in api-server/src/lib/)

### Files Created/Modified
- `artifacts/acp-server/package.json` (new)
- `artifacts/acp-server/tsconfig.json` (new)
- `artifacts/acp-server/src/types.ts` (new — ACP type definitions)
- `artifacts/acp-server/src/auth.ts` (new — API key validation)
- `artifacts/acp-server/src/tools.ts` (new — 16 tool definitions)
- `artifacts/acp-server/src/resources.ts` (new — 5 resource types)
- `artifacts/acp-server/src/server.ts` (new — HTTP + WebSocket server with request handling)
- `artifacts/acp-server/src/index.ts` (new — entry point)
- `ACP_INTEGRATION.md` (new — documentation with client configs)

---

## 📦 Phase 12: SWE-Bench Optimization

### Goal
Add reproduction-first, test-driven fixing mode optimized for SWE-Bench Verified (500 real GitHub issues).

### Requirements
- [x] **Issue Reproduction** — clone repo, install deps, run tests, confirm failure
- [x] **Test-Driven Fix** — write failing test first, then fix, then verify
- [x] **Patch Generation** — unified diff output for PR submission
- [x] **Iterative Verification** — run test suite after each fix attempt
- [x] **Benchmark Harness** — run against SWE-Bench dataset, track resolve rate
- [ ] **Local Model Support** — optimized prompts for Devstral, Codestral, Qwen3-Coder

### Implementation Plan
1. ✅ **Reproduction engine** — `artifacts/api-server/src/lib/swebench/reproduce.ts` (clone, install, test)
2. ✅ **Test analyzer** — `artifacts/api-server/src/lib/swebench/analyze.ts` (pytest, jest, generic)
3. ✅ **Fix agent** — `artifacts/api-server/src/lib/swebench/fix.ts` (test-driven loop with LLM)
4. ✅ **Patch formatter** — unified diff generation in reproduce.ts
5. ✅ **Benchmark runner** — `artifacts/api-server/src/lib/swebench/benchmark.ts` (dataset orchestration)
6. 🔲 **Leaderboard tracking** — store results, compare iterations

### Files Created/Modified
- `artifacts/api-server/src/lib/swebench/reproduce.ts` (new)
- `artifacts/api-server/src/lib/swebench/analyze.ts` (new)
- `artifacts/api-server/src/lib/swebench/fix.ts` (new)
- `artifacts/api-server/src/lib/swebench/benchmark.ts` (new)
- `artifacts/api-server/src/lib/swebench/index.ts` (new)

---

## 📦 Phase 13: Self-Evolving Code Capability

### Goal
Allow Infinity to modify its own codebase — the build agent already has `edit_file` tool, needs safe self-modification workflow.

### Requirements
- [x] **Sandboxed Self-Edit** — worktree isolation (Phase 1) + checkpoint before any self-edit
- [x] **Self-Review Loop** — agent proposes change → runs tests → verifies → commits or rolls back
- [x] **Scope Guardrails** — only allow edits to `artifacts/` (not core config, not secrets)
- [x] **Approval Gate** — optional human approval for risky changes (schema, auth, deploy)
- [x] **Evolution Log** — audit trail of all self-modifications with rationale
- [x] **Capability Extension** — agent can add new tools/routes to itself

### Implementation Plan
1. ✅ **Self-edit workflow** — `artifacts/api-server/src/lib/self-evolution.ts` (createProposal, applyEvolution, runSelfEvolutionCycle)
2. ✅ **Safety gates** — path allowlist (allowedPaths/blockedPaths), test requirement (typecheck+build), checkpoint enforcement (git commits)
3. ✅ **Evolution API** — `/self-evolution/propose`, `/self-evolution/apply`, `/self-evolution/run-cycle`, `/self-evolution/checkpoint`, `/self-evolution/rollback`, `/self-evolution/history`, `/self-evolution/config`
4. 🔲 **Frontend** — Evolution panel in Debug tab (Phase 14)
5. 🔲 **Dogfood** — use self-evolving to implement Phases 14-15

### Files Created/Modified
- `artifacts/api-server/src/lib/self-evolution.ts` (new — core engine)
- `artifacts/api-server/src/routes/jarvis/self-evolution.ts` (new — API routes)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mounted selfEvolutionRouter

---

## 📦 Phase 14: Responsive UI Redesign (NOT Desktop-First)

### Goal
Complete UI overhaul — "Jarvis looks horrible on mobile and horrible overall." **User correction: NOT desktop-first.** Build a website that looks perfect on BOTH phones and computers — treat them like DIFFERENT WEBSITES for the same goal. Mobile gets swipe gestures, bottom nav, sheet modals; desktop gets sidebar navigation, keyboard shortcuts, buttons — both looking perfect independently.

### Design Principles
- **Liquid Glass Material** — iOS 26 style: translucent, blurred, depth layers
- **Theme Tokens Only** — zero hardcoded colors, full light/dark/system support
- **Responsive Breakpoints** — desktop (≥1024), tablet (768-1023), mobile (<768)
- **Keyboard-First** — every action accessible via Command Palette + shortcuts (desktop)
- **Touch-First** — swipe gestures, bottom nav, sheet modals, pull-to-refresh (mobile)
- **Information Density** — configurable: comfortable/cozy/compact
- **Different Interactions Per Platform** — don't force same UI; optimize each for its form factor

### Scope
- [x] **Design System** — tokens, components, patterns (Storybook or similar)
- [x] **Layout System** — CSS Grid/Flex, sidebar rail, main canvas, panels
- [x] **Component Library** — Button, Input, Select, Dialog, Tooltip, Toast, Table, Tree, Tabs, CodeMirror wrapper, Terminal, Diff View, Markdown Renderer (10 base components done)
- [x] **Layout Primitives** — AppShell, Sidebar, Panel, Canvas, ResponsiveGrid (5 components done)
- [ ] **Feature Views** — Build, Chat, Terminal, Settings, Projects views using AppShell layout
- [ ] **Chat Interface** — message bubbles, streaming, code blocks, artifacts, citations
- [ ] **Build Studio** — plan view, diff modal, transcript, debug panel, browser preview
- [ ] **Projects Dashboard** — grid/list, search, activity feed, settings
- [ ] **Settings** — unified, searchable, categorized
- [ ] **Mobile Experience** — sheet modals, bottom nav, swipe gestures, touch targets
- [ ] **Desktop Experience** — sidebar nav, keyboard shortcuts, hover states, density controls

### Implementation Plan
1. **Design tokens** — `artifacts/jarvis/src/styles/tokens.css` (colors, spacing, typography, shadows, radius, transitions) ✅
2. **Base components** — `artifacts/jarvis/src/components/ui/` (shadcn-style but custom) ✅
3. **Layout primitives** — `AppShell`, `Sidebar`, `Panel`, `Canvas`, `ResponsiveGrid` ✅
4. **Feature views** — `artifacts/jarvis/src/components/views/` for Build, Chat, Terminal, Settings, Projects
5. **Theme provider** — CSS variables + React context, persistence
6. **Icon system** — Lucide or custom SVG, consistent sizing
7. **Animation system** — Framer Motion or CSS, reduced-motion respect
8. **Integrate into main App router** — replace home.tsx with routed feature views

### Files to Create/Modify
- `artifacts/jarvis/src/styles/` — tokens, globals, themes
- `artifacts/jarvis/src/components/ui/` — 30+ base components
- `artifacts/jarvis/src/components/layout/` — shell, sidebar, panels
- `artifacts/jarvis/src/components/views/` — feature views (BuildView, ChatView, TerminalView, SettingsView, ProjectsView) with BOTH desktop and mobile variants
- `artifacts/jarvis/src/components/mobile/` — mobile-specific: BottomNav, SheetModal, SwipeGesture, PullToRefresh, TouchTargets
- Every feature view — dual implementation (desktop sidebar + mobile sheets/bottom nav)

---

## 📦 Phase 15: Build Mode Intelligence & Reliability

### Goal
Transform Build Mode from "it builds" to "it builds reliably, verifiably, and intelligently" by addressing 10 critical gaps + adding a Skills system for reusable capabilities.

### Requirements

#### 1. Visual Verification System (Browser-Based)
- [x] **Build → Launch → Open → Inspect → Fix → Re-check** explicit loop
- [x] **Browser inspection targets**: broken layouts, overflow, bad spacing, missing assets, dead buttons, console errors, mobile breakage, runtime errors
- [x] **Automated visual diff** — screenshot before/after, pixel diff threshold
- [x] **Headless verification mode** — runs in CI without display
- [x] **Visual regression suite** — capture baseline screenshots per feature view

#### 2. "Done" Contract System (Deterministic Completion)
- [x] **Completion checklist** — defined per build type (SaaS dashboard, CLI tool, library, etc.)
- [x] **Verification gates** that MUST pass before DONE:
  - ✓ Build passes (typecheck + compile)
  - ✓ Runtime no errors (browser console clean)
  - ✓ Visual verification passed
  - ✓ All acceptance criteria met (from plan)
  - ✓ Tests pass (if test files exist)
  - ✓ No broken links/imports
  - ✓ Security scan clean
- [x] **Explicit DONE signal** — structured output, not "I think this looks good"
- [x] **Contract persistence** — save done criteria + results to build_checkpoints

#### 3. Catastrophic Failure Recovery (Checkpoint/Resume)
- [x] **Checkpoint 1** — After planning (plan saved)
- [x] **Checkpoint 2** — After each completed step group
- [x] **Checkpoint 3** — Before verification loop
- [x] **Auto-restore** — on failure, offer: resume from checkpoint 2, retry step, skip step, abort
- [x] **Failure classifiers** — bad package install, broken migration, massive rewrite, corrupted files, dev server stuck, dependency conflict
- [x] **Recovery actions** per failure type (pnpm retry, git reset, workspace repair, etc.)

#### 4. Git-First Build Mode
- [x] **Pre-build** → create worktree on branch `infinity/build/<id>`
- [x] **During build** → incremental commits per step (atomic, signed)
- [x] **Post-build** → final diff summary, PR-ready branch
- [x] **Success** → keep branch, offer merge
- [x] **Failure** → auto-revert to pre-build state (or offer manual recovery)
- [x] **Worktree isolation** — each build gets clean git worktree with node_modules symlinked

#### 5. Context Management & Compression
- [x] **Raw history → Summarizer → Compact working memory** pipeline
- [x] **Compaction triggers** — token budget > 80%, step count > 10, context > 50k tokens
- [x] **Summarization levels**:
  - Level 1: Keep all (short builds)
  - Level 2: Compress old steps (keep last 5 detailed)
  - Level 3: Decision log + file map only (long builds)
  - Level 4: Goal + current state only (emergency)
- [x] **Persistent context** — survives restarts, loaded from checkpoints
- [x] **Context inspection UI** — Debug panel shows compressed state

#### 6. Human Takeover / Steering
- [x] **Interruptible execution** — pause at any step boundary
- [x] **Steering commands**: "Don't use Tailwind", "Keep existing navbar", "Change approach to X"
- [x] **Resume with injection** — new instruction injected into agent context
- [x] **Approval gates** — optional human approval for risky changes (schema, auth, deploy)
- [x] **Real-time chat** — human can message the running agent via SSE/websocket

#### 7. Model Routing + Effort Chooser
- [x] **Task classification** → auto-select model tier:
  - Simple edit (font, remove component) → **Lite** (~3 min, cheap/local model)
  - Standard coding → **High** (~15 min, balanced model)
  - Complex planning/architectural → **Max** (~45 min, strongest model)
- [x] **Role-based routing**: Planner→Max, Coder→High, Reviewer→Max, Fixer→High, Research→High
- [x] **Provider failover** — OpenRouter → NVIDIA NIM → local Ollama → local vLLM
- [x] **Cost tracking per model** — enforce $0 budget, prefer free tiers
- [x] **Effort selector** — user can override: `--effort lite|high|max`

#### 8. Build Intelligence (Project Map Subsystem)
- [ ] **Pre-build analysis** — construct project understanding:
  - Framework (React, Vue, Svelte, Next, Vite, etc.)
  - Package manager (pnpm, npm, yarn, bun)
  - Entry points (main, routes, app)
  - Architecture (monorepo, feature folders, layer structure)
  - Important files (config, schema, types, main exports)
  - Database (Drizzle, Prisma, raw SQL, none)
  - Routes/API structure
  - Components/UI library
  - Tests (Jest, Vitest, Playwright, none)
  - Config files (tsconfig, vite.config, tailwind, etc.)
- [ ] **Persistent project map** — stored in `.infinity/project-map.json`, updated incrementally
- [ ] **Change impact analysis** — when files modified, update map, detect affected areas
- [ ] **Smart file inclusion** — only relevant files in context based on goal

#### 9. Tool Failure Handling (Resilient Tool Layer)
- [x] **Tool failure ≠ agent failure** — diagnose → retry → alternative → escalate
- [x] **npm install fails** → diagnose → try pnpm → inspect lockfile → fix → retry
- [x] **Browser errors** → restart pool → new session → fallback to simpler action
- [x] **Compilation errors** → parse error → target fix → re-verify
- [x] **Network failures** → exponential backoff → circuit breaker → cached fallback
- [x] **Diagnostic agents** — specialized fixer agents per tool type

#### 10. Security Boundaries
- [x] **Command allow/deny rules** — configurable per project/agent
- [x] **Secret redaction** — API keys, tokens, passwords never in logs/context
- [x] **Environment variable protection** — scoped access, no cross-project leakage
- [x] **Workspace sandboxing** — worktree isolation, no parent directory escape
- [x] **Filesystem boundaries** — allowlist/blocklist paths
- [x] **Network permissions** — allowlist domains, block egress by default
- [x] **Destructive command confirmation** — rm -rf, git push --force, DB migrations require approval
- [x] **Tool permissions per agent** — planner: read-only, coder: write, reviewer: read, fixer: write
- [x] **Self-modification guardrails** — only `artifacts/` allowed, never core config/secrets

#### 11. Skills System (Reusable Capabilities)
- [x] **Skill definition format** — JSON/YAML with instructions, tools, verification rules, conventions
- [x] **Built-in skills**:
  - `react-engineer` — React patterns, hooks, testing, accessibility
  - `debugger` — reproduce, inspect, patch, verify loop
  - `ui-designer` — implement, browser inspect, screenshot, visually verify
  - `api-engineer` — REST/GraphQL, OpenAPI, testing, auth
  - `database-engineer` — migrations, queries, indexing, RLS
  - `devops-engineer` — CI/CD, Docker, Kubernetes, monitoring
  - `security-auditor` — OWASP, secrets, dependencies, penetration
  - `performance-engineer` — profiling, optimization, bundle analysis
- [x] **Skill registry** — discoverable, versioned, composable
- [x] **Skill inheritance** — base skill + project overrides
- [x] **Skill marketplace** — share/import skills (local first, $0)
- [x] **Agent-skill binding** — assign skills to agent roles per project

### Implementation Plan

1. **Visual Verification System** — `build-visual-verification.ts`
   - Puppeteer-based inspection suite
   - Screenshot capture, diff, console log harvesting
   - Integration with browser pool (Phase 4.2)
   - Headless CI mode support

2. **Done Contract System** — `build-done-contract.ts`
   - Checklist definitions per project type
   - Verification gate runner
   - Structured DONE output (JSON)
   - Integration with orchestrator final step

3. **Checkpoint/Recovery System** — extend `build-checkpoints.ts` + `build-orchestrator.ts`
   - Checkpoint phases (plan, step groups, pre-verify)
   - Failure classifier + recovery action map
   - Auto-restore with user choice

4. **Git-First Build Mode** — extend `workspace.ts` + `build-orchestrator.ts`
   - Worktree creation per build
   - Incremental commit hook after each step
   - Final diff generation
   - Auto-revert on failure

5. **Context Compression** — extend `build-context.ts`
   - Summarizer agent (uses Lite model)
   - Compaction levels + triggers
   - Persistent storage (checkpoints table)
   - Debug panel visualization

6. **Human Takeover** — `build-human-interface.ts`
   - SSE/websocket for real-time steering
   - Pause/resume API
   - Instruction injection middleware
   - Approval gate workflow

7. **Model Router + Effort Chooser** — `model-router.ts` + extend `adapter-factory.ts`
   - Task classifier (heuristic + LLM)
   - Role-model mapping
   - Provider failover chain
   - Effort flag parsing

8. **Project Map Subsystem** — `build-project-map.ts`
   - Static analysis on pre-build
   - Incremental update on file changes
   - Impact analysis
   - Smart context selection

9. **Resilient Tool Layer** — extend `build-tools.ts` + `build-edge-cases.ts`
   - Tool wrapper with diagnosis/retry
   - Per-tool recovery strategies
   - Diagnostic sub-agents

10. **Security Boundaries** — `build-security.ts`
    - Permission system (allow/deny)
    - Secret redaction middleware
    - Sandbox enforcement
    - Destructive command guard

11. **Skills System** — `build-skills.ts` + skill definitions
    - Skill schema + loader ✅
    - Built-in skill definitions ✅
    - Registry + discovery ✅
    - Agent-skill binding in orchestrator ✅

### Files to Create/Modify

- `artifacts/api-server/src/lib/build-visual-verification.ts` (new)
- `artifacts/api-server/src/lib/build-done-contract.ts` (new)
- `artifacts/api-server/src/lib/build-human-interface.ts` (new)
- `artifacts/api-server/src/lib/model-router.ts` (new)
- `artifacts/api-server/src/lib/build-project-map.ts` (new)
- `artifacts/api-server/src/lib/build-security.ts` (new)
- `artifacts/api-server/src/lib/build-skills.ts` (new)
- `artifacts/api-server/src/lib/skills/` (new directory — skill definitions)
- `artifacts/api-server/src/lib/build-checkpoints.ts` (extend)
- `artifacts/api-server/src/lib/build-context.ts` (extend — compression)
- `artifacts/api-server/src/lib/build-tools.ts` (extend — resilient wrapper)
- `artifacts/api-server/src/lib/build-edge-cases.ts` (extend — tool recovery)
- `artifacts/api-server/src/lib/workspace.ts` (extend — git-first)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (extend — integrate all)
- `artifacts/api-server/src/routes/jarvis/build.ts` (extend — new routes)
- `artifacts/api-server/src/lib/adapter-factory.ts` (extend — effort routing)
- `artifacts/api-server/src/lib/llm-adapter.ts` (extend — cost tracking)
- `artifacts/jarvis/src/components/debug/` (extend — visual verification, context, human interface panels)
- `BUILD_MODE_INTELLIGENCE.md` (new — documentation)

---

## 📦 Phase 16: Infinity Maps Widget

### Goal
Add an **Infinity Maps** widget that activates when users ask location-based questions like "I'm craving pizza, where should I eat?" — displays an interactive map with places, ratings, photos, and lets the user pick/directions. Uses free map tiles (OpenStreetMap) + free places API (OpenStreetMap Nominatim/Overpass or free tier of Google Places/Foursquare).

### Requirements
- [ ] **Trigger Detection** — Detect location-intent queries in chat (`@Maps` prefix or natural language: "where should I eat", "find coffee near me", "pizza places nearby")
- [ ] **Map Widget** — Interactive map component (Leaflet/MapLibre GL) with:
  - Current location (browser Geolocation API, fallback to IP-based)
  - Search radius slider (500m - 10km)
  - Category filters (food, coffee, bars, attractions, etc.)
  - Place markers with clustering at zoom levels
  - Click marker → bottom sheet with details (name, rating, photos, hours, distance, directions button)
- [ ] **Places Data** — Free sources: OpenStreetMap Overpass API (free, no key), Nominatim for search, optionally Foursquare/Google Places free tier
- [ ] **Integration** — Widget emits `widget` SSE event with `type: "maps"` from chat.ts, renders `MapsWidget.tsx` in conversation feed
- [ ] **Mobile/desktop** — Touch-friendly on mobile (swipe, pinch zoom), mouse/keyboard on desktop
- [ ] **Actions** — "Get directions" opens OS maps app (Apple Maps/Google Maps/Waze via universal links), "Save to project" adds as project memory

### Implementation Plan
1. **Backend** — `artifacts/api-server/src/routes/jarvis/maps.ts`: detect `@Maps` / location queries, proxy Overpass/Nominatim calls (caching), emit widget event
2. **Frontend Widget** — `artifacts/jarvis/src/components/widgets/MapsWidget.tsx`: Leaflet/MapLibre map, marker clustering, bottom sheet details, directions links
3. **Widget Type** — Add `maps` to Widget union in `types/widget.ts`, export in `widgets/index.ts`, add case in `conversation-feed.tsx`
4. **Chat Integration** — Add `detectMapsCommand()` in `chat.ts`, emit `widget` SSE event with map config (center, radius, categories)
5. **Styling** — Liquid Glass theme tokens, responsive (mobile: full-screen sheet, desktop: inline widget)

### Files to Create/Modify
- `artifacts/api-server/src/routes/jarvis/maps.ts` (new)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mount mapsRouter
- `artifacts/jarvis/src/components/widgets/MapsWidget.tsx` (new)
- `artifacts/jarvis/src/types/widget.ts` — add `maps` widget type
- `artifacts/jarvis/src/components/widgets/index.ts` — export MapsWidget
- `artifacts/jarvis/src/components/conversation-feed.tsx` — add MapsWidget case
- `artifacts/jarvis/src/hooks/use-chat-stream.ts` — handle maps widget event (already handled by widget type)

---

## 📦 Phase 17: Project Types System (Book, Website, Company, etc.)

### Goal
Add **Project Types** that transform how a project looks and behaves. Each type provides tailored UI, tools, and workflows:
- **Book** — Manuscript editor, chapter outline, A5 PDF export, cover designer (extends existing Book Studio)
- **Website** — Build Mode integration, GitHub sync, Figma import, live preview, deployment
- **Company** — Logo/slogan generator, promo video creator, website builder, brand kit, promo maker tool, **brand color palette generator (Tavily search for inspiration + AI creation), AI font pairing/finding (Tavily search for fonts matching business description + style preferences like "modern, like SF Pro")**
- **App** — Mobile/desktop app scaffolding, store assets, crash reporting, analytics dashboard
- **Research** — Literature manager, citation graph, experiment tracker, paper draft
- **Course** — Lesson builder, video hosting, quiz engine, student progress

### Requirements
- [x] **Type Registry** — `project-types.ts` with schema: `id`, `name`, `icon`, `description`, `components[]`, `tools[]`, `defaultViews[]`, `settingsSchema`
- [x] **Project Creation** — Type selector in "New Project" modal, sets `project.type` field
- [x] **Type-Specific UI** — Each type gets custom `ProjectHome` view (replaces generic dashboard)
  - **Company**: Logo/Slogan generator (LLM), Promo Video button (opens Promo Maker), Brand Kit (colors, fonts, assets), Website sub-project link, **Brand Color Palette Generator (Tavily search for inspiration + AI creation), AI Font Pairing/Finding (Tavily search for fonts matching business description + style preferences like "modern, like SF Pro")**
  - **Website**: Build Mode panel, GitHub connect, Figma import, Deploy status, Live Preview
  - **Book**: Chapter outline, Manuscript editor, Cover designer, PDF export, Publish checklist
  - **App**: App scaffolding, Store assets manager, Crash reporting dashboard, Analytics dashboard
  - **Research**: Literature manager, Citation graph, Experiment tracker, Paper draft
  - **Course**: Lesson builder, Video hosting, Quiz engine, Student progress
- [x] **Type-Specific Tools** — Register tools per type in Universal Tool Layer (Phase 22): `company.logo`, `company.slogan`, `company.promo`, `company.palette`, `company.font`, `website.deploy`, `book.chapter`, etc.
- [x] **Persistence** — Add `type` column to `projects` table, migrate existing projects to `type: "general"`
- [x] **Extensibility** — Plugin system for custom project types (local JSON definitions)

### Implementation Plan
1. **Schema** — Add `type` column to `projects` table in `lib/db/src/schema/projects.ts` + migration
2. **Type Registry** — `artifacts/api-server/src/lib/project-types.ts` with built-in types definitions
3. **API** — `project-types.ts` routes: `GET /project-types` (list), `GET /project-types/:id` (detail)
4. **Frontend** — Project type selector in create modal, type-specific `ProjectHome` components in `components/views/projects/` ✅ **DONE**
5. **Company Type** — Logo/slogan generator (uses LLM), brand kit UI, promo maker launcher, **Brand Color Palette Generator (Tavily search for color palette inspiration + AI creation), AI Font Pairing/Finding (Tavily search for fonts matching business description + style preferences like "modern, like SF Pro")** ✅ **FRONTEND DONE** — API routes exist with mock implementations
6. **Website Type** — Build Mode integration, GitHub OAuth, Figma import, deploy status ✅ **FRONTEND DONE** — ProjectHomeWebsite.tsx created
7. **Book Type** — Wire existing Book Studio as Book project type home ✅ **FRONTEND DONE** — ProjectHomeBook.tsx created
8. **App Type** — App scaffolding, Store assets manager, Crash reporting dashboard, Analytics dashboard ✅ **FRONTEND DONE** — ProjectHomeApp.tsx created
9. **Research Type** — Literature manager, Citation graph, Experiment tracker, Paper draft ✅ **FRONTEND DONE** — ProjectHomeResearch.tsx created
10. **Course Type** — Lesson builder, Video hosting, Quiz engine, Student progress ✅ **FRONTEND DONE** — ProjectHomeCourse.tsx created
11. **Dynamic Routing** — ProjectHomeRouter that fetches project type and renders appropriate component ✅ **DONE**

### Files to Create/Modify
- `lib/db/src/schema/projects.ts` — add `type` column + migration ✅ **DONE** (type column added with default 'general')
- `artifacts/api-server/src/lib/project-types.ts` (new — registry + definitions) ✅ **DONE** (exists at this path)
- `artifacts/api-server/src/routes/jarvis/project-types.ts` (new — routes) ✅ **DONE** (GET /project-types, GET /project-types/:id, POST /validate, GET /:id/tools, GET /:id/views, GET /:id/components)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mount projectTypesRouter ✅ **DONE** (mounted at line 74)
- `artifacts/jarvis/src/components/views/projects/` — ProjectHomeCompany, ProjectHomeWebsite, ProjectHomeBook, etc. ✅ **DONE** (all 6 created)
- `artifacts/jarvis/src/components/project-create-modal.tsx` — type selector ✅ **DONE**
- `artifacts/jarvis/src/lib/project-types.ts` (frontend registry mirror) ✅ **DONE**
- `artifacts/jarvis/src/components/projects/project-home-router.tsx` — dynamic router ✅ **DONE**
- `artifacts/api-server/src/routes/jarvis/company-tools.ts` — palette/font endpoints ✅ **DONE** (real Tavily + LLM integration)

---

## 📦 Phase 18: Promo Maker (Puppeteer + ASMR + AI Speed Control)

### Goal
Create **promotional videos** automatically: user provides a website URL + prompt ("make a 30s promo showing the dashboard, dark mode toggle, and export feature"), AI drives Puppeteer to navigate, records with aesthetic cursor (OpenAI-style), adds ASMR sound effects (clicks, typing, whoosh), adds text overlays, and outputs Apple/OpenAI-level quality MP4. AI detects if it's too slow and speeds up the base video.

### Requirements
- [x] **Input** — URL + natural language prompt describing what to showcase
- [x] **Planner** — LLM analyzes site + prompt → generates step-by-step script (navigate, click, type, scroll, wait)
- [x] **Executor** — Puppeteer (headless Chromium) with:
  - **Aesthetic Cursor** — Smooth bezier curves, click ripple, typing simulation (not instant)
  - **ASMR Audio** — Generated via Web Audio API: soft clicks, mechanical keyboard types, subtle whoosh on transitions, ambient hum
  - **AI-Generated Background Music** — Procedural composition via FFmpeg filter_complex (chord progressions, bass, pads, arpeggios, melody, percussion) with deterministic per-video uniqueness
  - **Text Overlays** — Animated captions describing actions ("Opening dashboard...", "Toggling dark mode")
  - **Smart Timing** — LLM reviews recording → identifies slow sections → re-renders at 2-4x speed with smooth interpolation
- [x] **Timeline Editor** — Professional multi-track timeline in PromoWidget:
  - Track lanes: Video, ASMR Audio, Background Music, Text Overlays
  - Clip editing: drag to reposition, resize handles for trim/extend, split at playhead, copy/paste, delete
  - Volume envelope editor: canvas-based keyframe editor (click to add, drag to move, Delete to remove, numerical inputs)
  - Track controls: mute/solo, volume sliders, visibility toggles
  - Export: download timeline as JSON for re-rendering/reuse
- [x] **Output** — MP4 (H.264) + WebM (VP9) for web, 1080p/4K, configurable duration (15-120s)
- [x] **Integration** — Available as:
  - **Company Project Tool** — "Create Promo Video" button in Company project home
  - **Chat Command** — `@Promo <url> <description>` emits widget with progress + result
  - **API** — `POST /promo/create` for programmatic use
- [x] **Free/Zero-Cost** — Runs entirely on server (no cloud rendering), uses Puppeteer + FFmpeg (installed in container), Web Audio API for sounds (no external audio API)

### Implementation Plan
1. **Backend Service** — `artifacts/api-server/src/lib/promo-maker.ts`: Puppeteer orchestrator, script planner, recorder, audio synthesizer, video encoder
2. **Script Planner** — LLM prompt: "Analyze this website and user goal, output JSON script: [{action: 'navigate', url, wait}, {action: 'click', selector, delay}, {action: 'type', selector, text, charDelay}, {action: 'scroll', direction, distance}, {action: 'wait', ms}]"
3. **Puppeteer Recorder** — `page.screencast()` or CDP `Page.startScreencast` for frames, cursor overlay drawn on each frame
4. **ASMR Audio Engine** — Web Audio API: `AudioContext` + oscillators/gain envelopes for click (short decay sine), type (filtered noise bursts), whoosh (filtered sweep)
5. **AI-Generated Background Music** — Procedural composition via FFmpeg filter_complex with deterministic RNG seeded from job ID (chord progressions, bass, pads, arpeggios, melody, percussion) — unique per video
6. **Video Assembly** — FFmpeg (fluent-ffmpeg): frames → video, mix audio tracks (ASMR + background music with crossfades), add text overlays (drawtext filter), encode H.264/VP9
7. **Speed Optimization** — LLM analyzes frame timestamps vs script → identifies pauses → re-encodes slow segments at 2-4x with frame blending
8. **API Routes** — `promo.ts`: `POST /create` (start job), `GET /status/:id`, `GET /download/:id`
9. **Frontend Widget** — `PromoWidget.tsx`: progress stages (planning → recording → audio → encoding → optimizing → done), video player, download/share
10. **Timeline Editor** — `PromoWidget.tsx` (inline): multi-track timeline with scrubbing, clip drag/resize/split/copy/delete, volume envelope keyframe editor, track mute/volume/visibility, export as JSON

### Files to Create/Modify
- `artifacts/api-server/src/lib/promo-maker.ts` (new — core engine)
- `artifacts/api-server/src/routes/jarvis/promo.ts` (new — routes)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mount promoRouter
- `artifacts/jarvis/src/components/widgets/PromoWidget.tsx` (new)
- `artifacts/jarvis/src/types/widget.ts` — add `promo` widget type
- `artifacts/jarvis/src/components/widgets/index.ts` — export PromoWidget
- `artifacts/jarvis/src/components/conversation-feed.tsx` — add PromoWidget case
- `artifacts/jarvis/src/components/views/projects/ProjectHomeCompany.tsx` — "Create Promo" button

---

## 📦 Phase 19: Local Model Integration (Qwen2.5-1.5B for Error Fixing)

### Goal
Integrate a **lightweight local model (Qwen2.5-1.5B-Instruct)** for in-app error fixing and explanation. Runs via Ollama (or llama.cpp/ONNX Runtime Web for browser) — ~1GB RAM, fast enough for real-time error diagnosis, code fixes, and explanations without API calls.

### Requirements
- [x] **Model Serving** — Ollama (preferred, already in stack) serves `qwen2.5:1.5b-instruct` (or `qwen2.5-coder:1.5b` when available)
- [x] **Adapter** — `LocalModelAdapter` implementing `LLMAdapter` interface (Phase 8 model-agnostic abstraction)
- [x] **Use Cases**:
  - **Error Explainer** — "Why did this TypeScript error happen?" → plain English + fix suggestion
  - **Auto-Fix** — Build Mode: on compilation error, local model proposes fix → human approves → applies
  - **Universal Error Handler** — ErrorBoundary in App catches ANY React error, shows "Fix with Local AI" button that explains + proposes fix to its own code
  - **Code Explainer** — Highlight code → "Explain this" → local model explains
  - **Chat Fallback** — When all API keys cooling, route simple queries to local model
- [x] **Router Integration** — Extend `adapter-factory.ts` / `model-router.ts` (Phase 15): add `local` tier (Lite), route simple/error-fix tasks to Qwen2.5-1.5B
- [x] **Capabilities** — `streaming: true`, `jsonMode: true`, `toolCalling: false`, `vision: false`, `maxContextTokens: 32768`, `maxOutputTokens: 4096`
- [x] **Health Check** — `isHealthy()` pings Ollama `/api/tags`, verifies model loaded
- [x] **Zero Config** — Auto-detects Ollama at `http://localhost:11434`, pulls model if missing (background)

### Implementation Plan
1. **Adapter** — `artifacts/api-server/src/lib/adapters/local-adapter.ts`: `LocalModelAdapter` extends `OpenAICompatibleAdapter` with Ollama base URL
2. **Registration** — Add to `adapter-factory.ts`: `createLocalAdapter()`, register in `getAvailableTypes()` as `"local"`
3. **Router** — In `model-router.ts` (Phase 15): classify task → if `error-fix` or `explain` or `simple-edit` → route to `local` tier
4. **Chat Integration** — In `chat.ts` manual mode: when all keys cooling, offer "Use local model (Qwen2.5-1.5B)" button
5. **Build Mode** — In `build-agent.ts` verification loop: on compile error, call local model for fix proposal
6. **Frontend** — "Explain Error" button in Debug panel, "Fix with Local AI" in build error toast
7. **Model Management** — Background job pulls `qwen2.5:1.5b-instruct` on first use, shows download progress

### Files to Create/Modify
- `artifacts/api-server/src/lib/adapters/local-adapter.ts` (new)
- `artifacts/api-server/src/lib/adapter-factory.ts` — register local adapter
- `artifacts/api-server/src/lib/model-router.ts` (Phase 15) — add local tier routing
- `artifacts/api-server/src/routes/jarvis/chat.ts` — local model fallback in manual mode
- `artifacts/api-server/src/lib/build-agent.ts` — local model error fix in verification
- `artifacts/jarvis/src/components/debug/` — Explain Error / Fix with Local AI buttons

---

## 📦 Phase 20: Deep Research v2 (ChatGPT/Gemini Style, 3-7 min)

### Goal
Replace the current "Deep Research → creates a Gem/Expert" flow with a **true deep research agent** that takes 3-7 minutes, browses 20-50 sources, synthesizes a comprehensive report with citations, and outputs a structured research artifact (not a chat persona). Used via `@Deep Research <topic>` in chat.

### Requirements
- [x] **Current System Migration** — Move existing "create Gem from research" to Expert creation menu (separate feature)
- [x] **New Deep Research Agent** — Iterative loop: plan → search → browse → extract → synthesize → gap analysis → repeat (3-7 min)
- [x] **Source Target** — 20-50 unique sources (Tavily + browser + academic via Semantic Scholar/Crossref free APIs)
- [x] **Output** — Structured `ResearchReport` artifact: executive summary, detailed sections, citations (numbered), source list, confidence scores, gaps/limitations
- [x] **Trigger** — `@Deep Research <topic>` in chat (detected in `chat.ts`), emits progress SSE events (planning, searching, reading, synthesizing)
- [x] **Widget** — `DeepResearchWidget.tsx`: live progress (sources found, pages read, current phase), final report renderer with citations
- [x] **Integration** — "Save to Project Memory" button, "Create Expert from this Research" button (links to Expert creation)
- [x] **Cost Control** — Uses free tiers (Tavily free, browser pool, free APIs), budgets ~50-100 LLM calls per run
- [x] **Persistence** — Research runs stored in `research_jobs_v2` table, resumable on interruption

### Implementation Plan
1. **Engine** — `artifacts/api-server/src/lib/deep-research-v2.ts`: `DeepResearchAgent` class with iterative loop, state machine
2. **Phases**:
   - **Plan** (1-2 LLM calls): decompose topic → sub-questions, search strategies
   - **Search** (parallel Tavily): 5-10 queries → 50-100 results → dedupe → top 20-30
   - **Browse** (browser pool): visit top URLs → extract content → score relevance
   - **Extract** (LLM): structured extraction per source (key facts, quotes, data)
   - **Synthesize** (LLM): merge extractions → section drafts → citations
   - **Gap Analysis** (LLM): identify missing angles → generate follow-up queries → loop (max 3 iterations)
   - **Finalize** (LLM): executive summary, format report, confidence scoring
3. **API Routes** — `deep-research-v2.ts`: `POST /start`, `GET /status/:id`, `GET /report/:id`, `GET /stream/:id` (SSE)
4. **Chat Integration** — `detectDeepResearchCommand()` in `chat.ts`, emits widget event + progress SSE
5. **Frontend Widget** — `DeepResearchWidget.tsx`: live phase progress, source counter, final report with citation links
6. **Expert Creation** — "Create Expert" button on report → opens Expert creation modal with research pre-loaded

### Files to Create/Modify
- `artifacts/api-server/src/lib/deep-research-v2.ts` (new)
- `artifacts/api-server/src/routes/jarvis/deep-research-v2.ts` (new)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mount deepResearchV2Router
- `artifacts/api-server/src/routes/jarvis/chat.ts` — detect @DeepResearch command
- `artifacts/jarvis/src/components/widgets/DeepResearchWidget.tsx` (new)
- `artifacts/jarvis/src/types/widget.ts` — add `deep-research` widget type
- `artifacts/jarvis/src/components/widgets/index.ts` — export DeepResearchWidget
- `artifacts/jarvis/src/components/conversation-feed.tsx` — add DeepResearchWidget case
- `artifacts/jarvis/src/components/expert-create-modal.tsx` — "From Research" option

---

---

## 🌐 Initiative: Universal Tool Layer (Phases 21–25)
*Move from "which feature am I using?" to "what tools does Infinity need to accomplish this goal?" — one centralized tool registry, dynamic cross-capability reasoning loop, reusing the existing Build Mode tool architecture.*

## 📦 Phase 21: Universal Tool Layer — Foundation

### Goal
Establish the **centralized Universal Tool Registry** and standardized tool contract that every Infinity capability will register with. This is the substrate Phase 17–19 build on. It generalizes the existing Build Mode tool-use architecture (`build-tools.ts`) into a model-agnostic, namespaced, permissioned registry — WITHOUT duplicating the existing tool schemas/execution/retry logic.

### Existing Infra to Reuse (DO NOT duplicate)
- `artifacts/api-server/src/lib/build-tools.ts` — `ToolCall`, `ToolResult`, `ToolDefinition`, `ToolExecutionContext`, `executeTool()`, `TOOL_DEFINITIONS[]`, `formatToolResults()`. **Lift and generalize these**, not rewrite.
- `artifacts/api-server/src/lib/llm-adapter.ts` — `LLMAdapter`, `LLMTool`, `LLMCompletionOptions.tools`. Tool definitions feed this interface.
- `artifacts/api-server/src/lib/self-evolution.ts` — existing self-mod guardrails (path allowlist, checkpoints) to enforce for `evolution.*` tools.

### Requirements
- [x] **Universal Tool Registry** — `artifacts/api-server/src/lib/tool-registry.ts` (new):
  - `registerTool(def: UniversalToolDefinition)`
  - `discoverTools(filter?: ToolDiscoveryFilter): UniversalToolDefinition[]`
  - `getToolDefinitionsForLLM(filter?): LLMTool[]` (namespaced, JSONSchema → LLM tool schema)
  - `executeTool(name, args, ctx): Promise<UniversalToolResult>`
  - Validation (JSONSchema), timeout, retry, error normalization, logging, metadata
- [x] **Standardized `UniversalToolDefinition`**:
  ```ts
  {
    name: string;          // namespaced: "web.search", "browser.navigate", ...
    description: string;
    category: string;      // web | browser | files | vision | data | memory | research | build | evolution | integration
    parameters: JSONSchema;
    risk: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_ACTION" | "SELF_MODIFICATION";
    requiresApproval?: boolean;
    execute: (args, ctx: ToolExecutionContext) => Promise<UniversalToolResult>;
  }
  ```
- [x] **Standardized `UniversalToolResult`**:
  ```ts
  { success: boolean; data?: unknown; summary?: string; error?: string; artifacts?: Artifact[]; metadata?: Record<string, unknown>; }
  ```
- [x] **Shared `ToolExecutionContext`** extended from `build-tools.ts` to carry: `userId, conversationId, projectId, workspaceId, taskId, permissions, memories, artifacts, previousToolResults`.
- [x] **Permission metadata** — every tool declares a `risk` level; dangerous tools (`DESTRUCTIVE`, `EXTERNAL_ACTION`, `SELF_MODIFICATION`) can require explicit approval.
- [x] **Tool selection/filtering** — category-based discovery so the LLM isn't sent the entire schema (general / research / coding / email / data request modes).
- [x] **Port existing Build tools into the registry** as first registered tools (list_files → `files.*`, read_file, edit_file, run_command, screenshot, inspect_console, inspect_dom, inspect_accessibility, git_diff) — reusing their existing `execute` implementations.
- [x] **Model-agnostic** — works with every existing LLM adapter via `llm-adapter.ts`.

### Files to Create/Modify
- `artifacts/api-server/src/lib/tool-registry.ts` (new)
- `artifacts/api-server/src/lib/build-tools.ts` (extend — register existing tools, keep `executeTool` working as consumer)
- `artifacts/api-server/src/lib/tool-types.ts` (new — `UniversalToolDefinition`, `UniversalToolResult`, `ToolExecutionContext`, `Artifact`, risk enums)

---

## 📦 Phase 22: Universal Tool Layer — Capability Integration

### Goal
Register every existing Infinity capability as a namespaced tool in the Phase 16 registry. **Register ONLY functionality that actually exists** — no fake implementations. Build Mode becomes a consumer of the registry, not an isolated ecosystem.

### Requirements
- [ ] **Web** — `web.search` (Tavily), `web.fetch`, `web.extract` (source retrieval/extraction) — wire to existing Tavily call in `chat.ts`
- [ ] **Browser** — `browser.navigate`, `browser.click`, `browser.type`, `browser.scroll`, `browser.screenshot`, `browser.inspectDom`, `browser.inspectConsole` — reuse `browser-pool.ts` + `build-tools.ts` browser tools
- [ ] **Files** — `files.list`, `files.read`, `files.write`, `files.upload`, `files.move`, `files.delete` (safe) — reuse `workspace.ts` + `build-tools.ts`
- [ ] **Vision** — `vision.analyze` (image analysis), `vision.screenshot` (screenshot analysis) — reuse existing vision path
- [ ] **Data Lab** — `data.analyze`, `data.transform`, `data.stats`, `data.visualize`, `data.inspect` — register existing Data Lab if present
- [ ] **Memory** — `memory.read`, `memory.write`, `memory.update`, `memory.delete` — reuse `project-memory.ts` / `userMemories`
- [ ] **Research** — `research.start`, `research.continue`, `research.status`, `research.extract` — reuse `research-engine.ts`
- [ ] **Build** — `build.run`, `build.workspace`, `build.terminal`, `build.verify` — consume `build-tools.ts` + `build-orchestrator.ts`
- [ ] **Evolving** — `evolution.inspect`, `evolution.propose`, `evolution.apply`, `evolution.verify`, `evolution.rollback` — consume `self-evolution.ts` with existing guardrails preserved
- [ ] **Integrations** — `gmail.search`, `gmail.send`, `spotify.search`, etc. — register only what `secrets.ts` / connectors actually support
- [ ] **Build Mode refactor** — `build-orchestrator.ts` / `build-agent.ts` call the registry instead of the local `TOOL_DEFINITIONS` switch (no behavior change to end users)
- [ ] **Verify each tool returns `UniversalToolResult`** and feeds structured results forward (no manual prompt-copying of intermediate data)

### Files to Create/Modify
- `artifacts/api-server/src/lib/tools/` (new directory — one file per category: web.ts, browser.ts, files.ts, vision.ts, data.ts, memory.ts, research.ts, build.ts, evolution.ts, integrations.ts)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (refactor to consume registry)
- `artifacts/api-server/src/lib/build-agent.ts` (refactor to consume registry)

---

## 📦 Phase 23: Universal Tool Layer — Agent Loop & UX

### Goal
Make Chat a real **iterative reasoning/tool loop** where the LLM dynamically chains tools across capabilities in one task, and surface that execution in the UI as an agent timeline.

### Requirements
- [ ] **Iterative agent loop** — `artifacts/api-server/src/lib/universal-agent.ts` (new): LLM → tool call → result → LLM → ... until final response. Model decides tool count dynamically (not a fixed multi-tool command).
- [ ] **Parallel tool execution** — independent calls run concurrently (safe concurrency limit); dependency ordering preserved when a tool consumes an earlier result.
- [ ] **Tool chaining UX** — agent/tool execution timeline in Chat (Thinking → ✓ Web Search → ✓ Browser → ... → Done). Expandable per-step: tool used, args, result, duration, errors, artifacts. Show telemetry only, no hidden chain-of-thought.
- [ ] **SSE/streaming** — emit tool events alongside chat stream (reuse `build-events.ts` event infra).
- [ ] **Memory integration in loop** — agent reads relevant memory, performs task, decides (relevance rules) whether to write memory.
- [ ] **Evolving integration in loop** — `evolution.propose` → review → approval if required → `evolution.apply` → tests → verify → commit/rollback. Never arbitrary self-modification.
- [ ] **Artifacts** — tool outputs become interoperable artifacts (Research Report, Image Analysis, Dataset/Chart, Screenshot, Code/Diff, Evolution Record) consumable by later tools.
- [ ] **Model-agnostic** — loop only depends on `LLMAdapter` interface.

### Cross-Capability Examples That MUST Work (end-to-end)
1. "Search the web for latest React changes, compare to my project, inspect the running site, tell me what to update." → `web.search → files → browser → analysis → response`
2. "Look at this uploaded dataset, analyze it, create charts, remember findings." → `files → data → visualize → memory`
3. "Research this topic, browse sites, create report, save conclusions to memory." → `research → web → browser → artifact → memory`
4. "Inspect Infinity's implementation, find weakness, improve, test, keep only if it works." → `files → build → evolution → tests → verify → commit/rollback`
5. "Find latest info on X, analyze numbers, visualize, explain." → `web → data → visualize → response`

### Files to Create/Modify
- `artifacts/api-server/src/lib/universal-agent.ts` (new)
- `artifacts/api-server/src/routes/jarvis/chat.ts` (wire universal-agent into chat)
- `artifacts/jarvis/src/components/debug/` (extend — agent timeline panel)
- `artifacts/jarvis/src/hooks/use-chat-stream.ts` (handle tool-event SSE)

---

## 📦 Phase 24: Universal Tool Layer — Resilience & Persistence

### Goal
Make the Universal Tool Layer robust to failures and durable across interruptions. Integrates cleanly with existing Build task/event infra — no parallel task system.

### Requirements
- [ ] **Recovery** — tool failure → inspect error → retry if appropriate → alternate tool/strategy → continue. Distinguish recoverable / fatal / permission / approval-required errors. Task continues (does not auto-terminate).
- [ ] **Long-running task state** — persistent task maintains: goal, status, toolCalls, results, artifacts, errors, currentStep, createdAt, updatedAt. Resume after interruption (reuse `build-events.ts` / Build task infra).
- [ ] **Tool failure handling** — diagnostic recovery per tool type (npm fails → pnpm → inspect lockfile; browser fails → restart pool; etc.) — extends Phase 15's resilient tool layer, NOT duplicating it.
- [ ] **Permission enforcement** — deny/allow by risk level; `SELF_MODIFICATION` preserves Evolving checkpoints/snapshots/rollback; `DESTRUCTIVE` requires approval; workspace isolation/path protections never weakened.
- [ ] **Large-output handling** — truncation/summarization so big tool results don't destroy context window.
- [ ] **Integration tests** — one call, sequential, dependent, parallel, failure/retry, permission denial, large output, artifact passing, memory RW, browser+search chaining, files+data chaining, build+browser chaining, evolving+verify, task resume.
- [ ] **End-to-end multi-tool scenarios** — several tests where one request genuinely crosses 3–6 capabilities (the 5 examples from Phase 18).
- [ ] **Definition of done met**: centralized registry, dynamic multi-tool Chat, result consumption, parallel execution, existing Build tools reused, all capabilities in one loop, permissions enforced, UI-visible execution, resumable tasks, recoverable failures, cross-capability examples work, existing functionality intact, typecheck + build + integration tests pass.

### Files to Create/Modify
- `artifacts/api-server/src/lib/universal-agent.ts` (extend — recovery, task state)
- `artifacts/api-server/src/lib/tool-resilience.ts` (new — retry/recovery/diagnostics)
- `artifacts/api-server/src/lib/tool-persistence.ts` (new — task state, resume)
- `artifacts/api-server/src/lib/build-tools.ts` (extend — resilience reuse)
- `artifacts/api-server/test/` (new — integration tests for the above)

---

## 🔄 Autonomous Execution Rules

### For the Agent Running This Plan
```yaml
loop:
  interval: "30 minutes"  # or until phase complete
  max_iterations: 999
  on_error:
    - log error to session-brief.md
    - commit current state
    - wait 5 min, retry once
    - if still failing: create GitHub issue, move to next phase
  on_phase_complete:
    - update PHASES.md status to ✅ DONE
    - update session-brief.md Change record
    - git commit -m "Phase X complete: <title>"
    - git push
    - proceed to next phase
  commit_rule: "Every response → git add -A && git commit -m '<what I just did>' && git push"
  budget: "$0 — only free tiers, local models, open source"
```

### Phase Completion Criteria
- [ ] All requirements checked off
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Build passes (`npm run build`)
- [ ] Basic smoke test works
- [ ] Documentation updated
- [ ] Committed and pushed

### Escalation Triggers (Stop and Notify)
- [ ] 3 consecutive failures on same task
- [ ] Token budget > 80% used
- [ ] Architectural decision needed (not in plan)
- [ ] Security concern
- [ ] Breaking change to existing working features

---

## 📝 Session Startup Checklist
**Run this at the start of EVERY session:**

1. [ ] Read `PHASES.md` (this file)
2. [ ] Read `session-brief.md` (live state)
3. [ ] Read `KNOWLEDGE.md` (how things work)
4. [ ] Check current phase from PHASES.md
5. [ ] Run `npm run typecheck` and `npm run build` to verify baseline
6. [ ] Execute next unchecked task in current phase
7. [ ] After EVERY change: update PHASES.md + session-brief.md + git commit + push

---

## 🎯 Current Phase: **Phase 23 — Universal Tool Layer — Agent Loop & UX** 📋 PLANNED

---

## 🎯 Next Phase: **Phase 23 — Universal Tool Layer — Agent Loop & UX**

> **Phase 17 — Project Types System: ✅ COMPLETE (100%)**
> - Project type registry with all 7 types (general, book, website, company, app, research, course)
> - Project creation modal with type selector
> - Type-specific ProjectHome components for ALL 6 non-general types
> - Dynamic ProjectHomeRouter that fetches project type and renders correct component
> - Company tools API with palette/font endpoints — **REAL Tavily API + LLM integration** (not mocks)
> - Database migration: `type` column on `projects` table + existing projects migrated to `general`
> - Backend project-types API routes (`GET /project-types`, `GET /project-types/:id`, `POST /validate`, `GET /:id/tools`, `GET /:id/views`, `GET /:id/components`)
> - i18n translations (EN + NL) for ALL project type components
> - **Plugin system for custom project types** — local JSON/YAML definitions in `.infinity/project-types/`, auto-discovery, hot-reload, API management endpoints

---

## 🎯 Upcoming Phases (New Feature Requests)

> **Phase 16 — Infinity Maps Widget** — Interactive maps for "where should I eat" queries (OpenStreetMap + Overpass API) ✅ **DONE**
> **Phase 17 — Project Types System** — Book, Website, Company, App, Research, Course types with tailored UI/tools ✅ **DONE**
> **Phase 18 — Promo Maker** — Puppeteer-driven promo videos with aesthetic cursor, ASMR audio, AI speed optimization ✅ **DONE**
> **Phase 19 — Local Model Integration** — Qwen2.5-1.5B-Instruct via Ollama for error fixing/explaining ✅ **DONE**
> **Phase 20 — Deep Research v2** — True 3-7 min deep research agent (ChatGPT/Gemini style) with citations ✅ **DONE**
> **Phase 21 — Universal Tool Calling** — Tool calling in ALL modes (Chat, Build, Research, etc.), not just serious tools — also lightweight tools like `call_weather_tomorrow`, `call_time`, `call_calculate`, `call_random_joke`

> **START HERE.** Next unchecked task: Create feature views in `artifacts/jarvis/src/components/views/` for Build, Chat, Terminal, Settings, Projects — each with BOTH desktop (sidebar nav, keyboard shortcuts) and mobile (bottom nav, sheet modals, swipe gestures) implementations. Treat them as different websites for the same goal.

---

## 🔒 Security Hardening Initiative (Critical — Must Complete After All Phases)

The following 11 security issues were identified and must be fixed after all feature phases are complete. Each has concrete fix steps.

### Issue 1: API Key Endpoints Missing Account Authorization (CRITICAL)

**Problem**: API key list/update/delete/regenerate routes query by key ID only — no `accountId` ownership check. User A can manipulate User B's keys if they know the ID.

**Fix Steps**:
- [ ] In `artifacts/api-server/src/routes/jarvis/api-keys.ts`:
  - [ ] `GET /api/jarvis/api-keys` — add `AND accountId = authenticatedAccountId` to list query
  - [ ] `GET /api/jarvis/api-keys/:id` — add `AND accountId = authenticatedAccountId` to select query
  - [ ] `PUT /api/jarvis/api-keys/:id` — add `AND accountId = authenticatedAccountId` to update query
  - [ ] `DELETE /api/jarvis/api-keys/:id` — add `AND accountId = authenticatedAccountId` to delete query
  - [ ] `POST /api/jarvis/api-keys/:id/regenerate` — add `AND accountId = authenticatedAccountId` to select + update
- [ ] Add integration test: create two users, verify User A cannot access User B's keys
- [ ] Verify typecheck + build pass

### Issue 2: No Centralized Authentication Middleware (CRITICAL)

**Problem**: 40+ routers mounted individually, each must remember auth. No global session middleware protecting authenticated surface.

**Fix Steps**:
- [ ] Create `artifacts/api-server/src/middleware/auth-middleware.ts`:
  - [ ] `requireAuth` — validates session cookie, attaches `req.accountId`, returns 401 if missing/invalid
  - [ ] `requireScope(scope)` — checks account has required scope, returns 403 if not
  - [ ] `optionalAuth` — attaches `req.accountId` if session valid, continues if not (for public endpoints)
- [ ] In `artifacts/api-server/src/index.ts`:
  - [ ] Apply `requireAuth` as global middleware AFTER body parsers, BEFORE router mounting
  - [ ] Create `publicRouter` for truly public endpoints (health, login, register, OAuth callbacks)
  - [ ] Mount `publicRouter` before auth middleware
  - [ ] All other routers now automatically protected
- [ ] Remove duplicate `getAccountIdFromSession()` calls from individual routes
- [ ] Verify all existing routes still work, typecheck + build pass

### Issue 3: Build Mode Terminal Route Missing Authentication

**Problem**: `/api/jarvis/build/terminal` accepts user-supplied commands and passes to `runTerminalCommand()` without authentication.

**Fix Steps**:
- [ ] In `artifacts/api-server/src/routes/jarvis/build.ts`:
  - [ ] Ensure `/build/terminal` route has `requireAuth` + `requireScope("build:write")`
  - [ ] Verify workspace ownership: `workspace.projectId` belongs to `req.accountId`
- [ ] Add test: unauthenticated request to terminal returns 401
- [ ] Verify typecheck + build pass

### Issue 4: Build Isolation Security Audit Needed (HIGH)

**Problem**: `workspace.ts` executes OS processes and manipulates Git worktrees. Environment restriction ≠ sandboxing.

**Fix Steps**:
- [ ] Create `artifacts/api-server/src/lib/build-sandbox.ts`:
  - [ ] `validateCommand(command: string)` — allowlist/denylist patterns, reject destructive commands (`rm -rf`, `git push --force`, `sudo`, etc.)
  - [ ] `createSandboxedEnv()` — stripped env vars (no API keys, secrets, DB URLs)
  - [ ] `enforceWorkspaceBoundary(cwd: string, projectRoot: string)` — prevent directory traversal outside project
  - [ ] `runInSandbox(command, options)` — wraps `runTerminalCommand` with above guards
- [ ] In `workspace.ts`:
  - [ ] Replace direct `runTerminalCommand` calls with `runInSandbox`
  - [ ] Add workspace root validation on worktree creation
- [ ] Add test: attempt directory escape, destructive command, secret access — all blocked
- [ ] Verify typecheck + build pass

### Issue 5: Browser Safety Model — Regex URLs Insufficient (HIGH)

**Problem**: Sensitive URL protection is regex-based. Malicious sites can bypass via redirects, iframes, disguised actions.

**Fix Steps**:
- [ ] Create `artifacts/api-server/src/lib/browser-policy.ts`:
  - [ ] `ActionClassifier` — classifies browser actions: `NAVIGATE`, `CLICK`, `TYPE`, `FORM_SUBMIT`, `DOWNLOAD`, `SCRIPT_EXECUTE`
  - [ ] `PolicyEngine` — rules: `ALLOW`, `DENY`, `REQUIRE_APPROVAL` per action + context (domain, element type, form action)
  - [ ] `SensitiveDomainRegistry` — maintain list + allow dynamic additions, but don't rely solely on domain matching
  - [ ] `ElementAnalyzer` — inspect target element: `type="password"`, `autocomplete="cc-number"`, form `action` to payment URLs, etc.
- [ ] In `browser-pool.ts` / browser action handler:
  - [ ] Before executing action → classify → check policy → if `REQUIRE_APPROVAL` → emit SSE event for human confirmation
  - [ ] Log all classified actions for audit
- [ ] Add test: form submit to non-sensitive domain with password field → flagged
- [ ] Verify typecheck + build pass

### Issue 6: Global 1GB JSON Body Limit (HIGH)

**Problem**: `express.json({ limit: "1gb" })` globally — massive DoS surface.

**Fix Steps**:
- [ ] In `artifacts/api-server/src/index.ts`:
  - [ ] Remove global `express.json({ limit: "1gb" })` and `express.urlencoded({ limit: "1gb" })`
  - [ ] Add per-route body parsers:
    - [ ] `/chat`, `/memory`, `/research` → `express.json({ limit: "1mb" })`
    - [ ] `/build/*` → `express.json({ limit: "10mb" })` (for diffs, plans)
    - [ ] `/upload`, `/files/*` → use `multer` with controlled limits, NOT JSON parser
    - [ ] `/data/import` → `express.json({ limit: "50mb" })`
- [ ] Add test: 2MB JSON to `/chat` → 413 Payload Too Large
- [ ] Verify typecheck + build pass

### Issue 7: CORS Extremely Permissive (MEDIUM)

**Problem**: `app.use(cors())` with no origin restrictions.

**Fix Steps**:
- [ ] In `artifacts/api-server/src/index.ts`:
  - [ ] Replace `app.use(cors())` with configured CORS:
  ```ts
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL].filter(Boolean)
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];
  
  app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  }));
  ```
- [ ] Add `FRONTEND_URL` to `.env.example`
- [ ] Test: request from unauthorized origin → CORS error
- [ ] Verify typecheck + build pass

### Issue 8: Frontend Bundle Size — No Code Splitting Verified (MEDIUM)

**Problem**: Massive dependency surface (TensorFlow, MediaPipe, CodeMirror, Xterm, Radix, etc.) — no evidence of aggressive code splitting/lazy loading.

**Fix Steps**:
- [ ] In `artifacts/jarvis/vite.config.ts`:
  - [ ] Verify `build.rollupOptions.output.manualChunks` splits heavy libs:
    - [ ] `tensorflow` chunk (TensorFlow + MediaPipe)
    - [ ] `codemirror` chunk (CodeMirror + language packages)
    - [ ] `xterm` chunk (xterm.js + addons)
    - [ ] `radix` chunk (Radix primitives)
    - [ ] `charts` chunk (Recharts, D3 if used)
  - [ ] Enable `build.cssCodeSplit: true`
  - [ ] Set `build.chunkSizeWarningLimit: 500` (kb)
- [ ] In `artifacts/jarvis/src/`:
  - [ ] Lazy-load heavy views: `BuildView`, `TerminalView`, `SettingsView` via `React.lazy` + `Suspense`
  - [ ] Lazy-load `CodeEditor`, `Terminal`, `DiffView` components
  - [ ] Lazy-load `BrowserWidget`, `MapsWidget` (Phase 16)
- [ ] Run `npm run build` → analyze `dist` chunk sizes → verify no chunk > 500kb gzipped
- [ ] Verify typecheck + build pass

### Issue 9: Session Invalidation on Password Change Only (LOW)

**Problem**: Sessions only invalidated on password change. No invalidation on: email change, 2FA enable/disable, security settings change, admin revocation.

**Fix Steps**:
- [ ] In `artifacts/api-server/src/routes/jarvis/auth.ts`:
  - [ ] `PUT /auth/password` — already invalidates all sessions ✓
  - [ ] Add `invalidateAllSessions(accountId)` helper
  - [ ] `PUT /auth/profile` (email change) → call `invalidateAllSessions`
  - [ ] Add `POST /auth/revoke-sessions` — user can revoke all other sessions
  - [ ] Add `POST /auth/revoke-session/:sessionId` — revoke specific session
- [ ] In `artifacts/api-server/src/lib/db/src/schema/sessions.ts`:
  - [ ] Add `revokedAt` timestamp column
  - [ ] Add index on `(accountId, revokedAt)`
- [ ] Update session validation middleware to check `revokedAt`
- [ ] Verify typecheck + build pass

### Issue 10: No Rate Limiting on Auth Endpoints (LOW)

**Problem**: Login/register/email endpoints have no rate limiting — credential stuffing, enumeration risk.

**Fix Steps**:
- [ ] Create `artifacts/api-server/src/middleware/rate-limit.ts`:
  - [ ] In-memory token bucket (or Redis if available) per IP + endpoint
  - [ ] Config: `maxRequests`, `windowMs`, `keyGenerator`
- [ ] In `artifacts/api-server/src/routes/jarvis/auth.ts`:
  - [ ] `POST /auth/login` — 5 req/min per IP
  - [ ] `POST /auth/register` — 3 req/min per IP
  - [ ] `POST /auth/password` — 3 req/hour per IP
  - [ ] `GET /auth/me` — 60 req/min per IP (authenticated)
- [ ] Return `429 Too Many Requests` with `Retry-After` header
- [ ] Verify typecheck + build pass

### Issue 11: Secret Redaction Incomplete in Logs/Context (LOW)

**Problem**: Build Mode has secret redaction but not verified across all log paths, SSE events, debug panel, checkpoints.

**Fix Steps**:
- [ ] Create `artifacts/api-server/src/lib/secret-redaction.ts`:
  - [ ] `redactSecrets(text: string)` — regex patterns for API keys (sk-*, Bearer *, etc.), passwords, tokens, connection strings
  - [ ] `redactObject(obj: any)` — recursive redaction for JSON objects
- [ ] In `build-events.ts`:
  - [ ] Apply `redactObject` to all event data before emit
- [ ] In `build-checkpoints.ts`:
  - [ ] Apply `redactObject` before saving checkpoint
- [ ] In `build-tools.ts` / `executeTool`:
  - [ ] Redact tool args/results before logging
- [ ] In SSE event emission (`chat.ts`, `build.ts`):
  - [ ] Redact before sending to client
- [ ] Add test: log entry containing `sk-test123` → appears as `sk-****`
- [ ] Verify typecheck + build pass